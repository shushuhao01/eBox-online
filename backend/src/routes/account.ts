import { Router } from 'express';
import crypto from 'crypto';
import Joi from 'joi';
import { ok, fail, clientIp } from '../middleware/helpers';
import { ApiError } from '../middleware/errorHandler';
import { requireAccount } from '../middleware/accountAuth';
import { AppDataSource } from '../config/database';
import { Account } from '../entities/account/Account';
import { NotificationTemplate } from '../entities/account/NotificationTemplate';
import {
  registerAccount,
  loginAccount,
  isPhoneTaken,
  revokeSession,
  getProfile,
  listDevices,
  removeDevice,
  changePassword,
  requestPasswordReset,
  resetPasswordByCode,
} from '../services/AccountService';
import {
  activateForAccount,
  bindExistingKey,
  listAccountKeys,
  toKeySummary,
} from '../services/LicenseAccountService';
import { getEntitlements, findEffectiveKey } from '../services/EntitlementService';
import { inspectAccountUnbind } from '../services/KeyService';
import { reportProxyBlocked } from '../services/ProxyBlockService';
import { getAccountSummary, getAccountTrend } from '../services/TeamDashboardService';
import { buildClientConfig } from '../services/SkuService';
import { redeemUpgradeCode } from '../services/VoucherService';
import { getConfigValue } from '../services/ConfigService';
import { getClientEvent } from '../services/AgencyService';
import {
  isSmsEnabled,
  isValidMainlandPhone,
  loadAliyunSmsConfig,
  sendSms,
} from '../services/AliyunSmsService';
import {
  addAccountClient,
  removeAccountClient,
  pushEntitlementsForAccountId,
} from '../services/AccountEventService';
const router = Router();

/** 登录/资料接口统一附带：权益 + 当前生效卡密 */
async function entitlementPayload(account: Account) {
  const [entitlements, key] = await Promise.all([
    getEntitlements(account),
    findEffectiveKey(account),
  ]);
  return { entitlements, currentKey: key ? toKeySummary(key, key.id) : null };
}

const registerSchema = Joi.object({
  login: Joi.string().required().max(64),
  password: Joi.string().required().max(64),
  nickname: Joi.string().allow('').max(64),
  email: Joi.string().allow('').max(128),
  phone: Joi.string().allow('').max(32),
  agreementVersion: Joi.number().integer().min(1).default(1),
  deviceFp: Joi.string().allow('').max(64).default(''),
});

const loginSchema = Joi.object({
  login: Joi.string().required().max(64),
  password: Joi.string().required().max(64),
  deviceFp: Joi.string().allow('').max(64).default(''),
  deviceName: Joi.string().allow('').max(128).default(''),
  os: Joi.string().allow('').max(128).default(''),
  appVersion: Joi.string().allow('').max(32).default(''),
  /**
   * 个人席位换机确认：false = 只做预检并要求客户端确认；true = 用户已确认，执行解绑扣次；
   * 不传 = 旧客户端，保持原有自动换机行为（向后兼容）
   */
  confirmSwitch: Joi.boolean().optional(),
});

function maskFp(fp: string | null): string {
  if (!fp) return '';
  if (fp.length <= 6) return `${fp.slice(0, 2)}***`;
  return `${fp.slice(0, 6)}***${fp.slice(-2)}`;
}

// POST /api/v1/account/register
router.post('/account/register', async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const account = await registerAccount({
      ...value,
      ip: clientIp(req),
    });
    ok(res, {
      id: account.id,
      login: account.login,
      nickname: account.nickname,
      createdAt: account.createdAt,
    }, '注册成功');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/v1/account/login（个人 / 企业管理员 / 企业成员统一入口）
router.post('/account/login', async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const result = await loginAccount({
      ...value,
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });
    ok(res, {
      token: result.token,
      expiresAt: result.expiresAt,
      account: {
        id: result.account.id,
        login: result.account.login,
        nickname: result.account.nickname,
        role: result.account.role,
        status: result.account.status,
        enterpriseId: result.account.enterpriseId,
      },
      // 个人席位本月解绑配额（企业账号 / 无绑定卡密时不返回，兼容旧客户端）
      ...(result.unbindUsed !== undefined
        ? {
            unbindUsed: result.unbindUsed,
            unbindLimit: result.unbindLimit,
            unbindRemaining: result.unbindRemaining,
          }
        : {}),
      ...(await entitlementPayload(result.account)),
    }, '登录成功');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code, e.status || 200, e.data);
    throw e;
  }
});

// GET /api/v1/account/profile（资料 + 权益 + 当前生效卡密档位）
router.get('/account/profile', requireAccount, async (req, res) => {
  try {
    const auth = req.accountAuth!;
    const [profile, extra, unbind] = await Promise.all([
      getProfile(auth.account),
      entitlementPayload(auth.account),
      // 个人席位本月换机（解绑）配额：企业账号 / 无绑定卡密时为 null，不下发
      inspectAccountUnbind(auth.account.id, []),
    ]);
    ok(res, {
      ...profile,
      ...extra,
      ...(unbind
        ? {
            unbindUsed: unbind.unbindUsed,
            unbindLimit: unbind.unbindLimit,
            unbindRemaining: unbind.unbindRemaining,
          }
        : {}),
    });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// ---------------------------------------------------------------------------
// 手机号绑定（不强制；绑定后可用 手机号/用户名/邮箱 任一登录）
// ---------------------------------------------------------------------------
const PHONE_CODE_TTL_MS = 5 * 60 * 1000;
const PHONE_CODE_COOLDOWN_MS = 60 * 1000;
/** 发送配额（内存 TTL 计数，重启清零；仅用于防刷，不要求持久化） */
const PHONE_SEND_ACCOUNT_DAILY_LIMIT = 10;
const PHONE_SEND_IP_DAILY_LIMIT = 20;
const PHONE_SEND_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const phoneCodes = new Map<string, { code: string; expiresAt: number; sentAt: number; attempts: number }>();
const phoneSendQuota = new Map<string, { count: number; resetAt: number }>();

function genPhoneCode(): string {
  // CSPRNG：避免 Math.random 可预测导致验证码被猜解
  return String(crypto.randomInt(100000, 1000000));
}

/** 命中配额返回 true；首次计数时初始化窗口，顺带清理过期条目 */
function exceedSendQuota(key: string, limit: number): boolean {
  const now = Date.now();
  if (phoneSendQuota.size > 5000) {
    for (const [k, v] of phoneSendQuota) {
      if (v.resetAt <= now) phoneSendQuota.delete(k);
    }
  }
  const cur = phoneSendQuota.get(key);
  if (!cur || cur.resetAt <= now) {
    phoneSendQuota.set(key, { count: 1, resetAt: now + PHONE_SEND_QUOTA_WINDOW_MS });
    return false;
  }
  if (cur.count >= limit) return true;
  cur.count += 1;
  return false;
}

// POST /api/v1/account/phone/send-code
router.post('/account/phone/send-code', requireAccount, async (req, res) => {
  try {
    const { error, value } = Joi.object({ phone: Joi.string().trim().required().max(32) }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const phone = String(value.phone);
    if (!isValidMainlandPhone(phone)) return fail(res, '手机号格式不正确', 400);
    if (await isPhoneTaken(phone, req.accountAuth!.account.id)) {
      return fail(res, '该手机号已绑定其他账号', 400);
    }

    const now = Date.now();
    const existing = phoneCodes.get(phone);
    if (existing && now - existing.sentAt < PHONE_CODE_COOLDOWN_MS) {
      const wait = Math.ceil((PHONE_CODE_COOLDOWN_MS - (now - existing.sentAt)) / 1000);
      return fail(res, `请 ${wait} 秒后再获取验证码`, 429);
    }
    // 配额：单账号 / 单 IP 每日上限，防止短信轰炸与费用滥用
    if (exceedSendQuota(`phone-send:account:${req.accountAuth!.account.id}`, PHONE_SEND_ACCOUNT_DAILY_LIMIT)) {
      return fail(res, '今日获取验证码次数已达上限，请明日再试', 429);
    }
    if (exceedSendQuota(`phone-send:ip:${clientIp(req) || 'unknown'}`, PHONE_SEND_IP_DAILY_LIMIT)) {
      return fail(res, '当前网络获取验证码过于频繁，请稍后再试', 429);
    }
    if (!(await isSmsEnabled())) return fail(res, '短信服务未启用，请联系管理员', 400);
    const smsConfig = await loadAliyunSmsConfig();
    if (!smsConfig) return fail(res, '短信服务未配置', 400);
    const signName = (await getConfigValue('sms_sign_name')).trim();
    // 优先用「绑定手机号验证码」消息模板里配置的短信模板 CODE，未配置时回退全局验证码模板
    const bindTemplate = await AppDataSource.getRepository(NotificationTemplate).findOneBy({
      code: 'PHONE_BIND_CODE',
    });
    const templateCode =
      (bindTemplate?.smsTemplateCode || '').trim() || (await getConfigValue('sms_tpl_verify_code')).trim();
    if (!signName || !templateCode) return fail(res, '短信签名或模板未配置', 400);

    const code = genPhoneCode();
    await sendSms(smsConfig, { phone, signName, templateCode, templateParam: { code } });
    phoneCodes.set(phone, { code, expiresAt: now + PHONE_CODE_TTL_MS, sentAt: now, attempts: 0 });
    ok(res, { sent: true, cooldown: PHONE_CODE_COOLDOWN_MS / 1000 });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    return fail(res, e instanceof Error ? e.message : '验证码发送失败', 400);
  }
});

// POST /api/v1/account/phone/bind
router.post('/account/phone/bind', requireAccount, async (req, res) => {
  try {
    const auth = req.accountAuth!;
    const { error, value } = Joi.object({
      phone: Joi.string().trim().required().max(32),
      code: Joi.string().trim().required().length(6),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const phone = String(value.phone);
    if (!isValidMainlandPhone(phone)) return fail(res, '手机号格式不正确', 400);
    if (await isPhoneTaken(phone, auth.account.id)) return fail(res, '该手机号已绑定其他账号', 400);

    const entry = phoneCodes.get(phone);
    if (!entry || entry.expiresAt <= Date.now()) return fail(res, '验证码已过期，请重新获取', 400);
    if (entry.attempts >= 5) {
      phoneCodes.delete(phone);
      return fail(res, '验证码错误次数过多，请重新获取', 400);
    }
    if (entry.code !== String(value.code)) {
      entry.attempts += 1;
      return fail(res, '验证码不正确', 400);
    }

    auth.account.phone = phone;
    await AppDataSource.getRepository(Account).save(auth.account);
    phoneCodes.delete(phone);
    ok(res, await getProfile(auth.account), '手机号绑定成功');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/v1/account/logout
router.post('/account/logout', requireAccount, async (req, res) => {
  try {
    const auth = req.accountAuth!;
    await revokeSession(auth.session.id);
    ok(res, null, '已退出登录');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/v1/account/password（已登录修改密码）
router.post('/account/password', requireAccount, async (req, res) => {
  try {
    const { error, value } = Joi.object({
      oldPassword: Joi.string().required().max(64),
      newPassword: Joi.string().required().max(64),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const auth = req.accountAuth!;
    await changePassword(auth.account, value.oldPassword, value.newPassword, auth.session.id);
    ok(res, null, '密码修改成功');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/v1/account/password/forgot（发送 6 位邮箱重置码；未配置 SMTP 时提示联系客服）
router.post('/account/password/forgot', async (req, res) => {
  try {
    const { error, value } = Joi.object({
      login: Joi.string().required().max(64),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const result = await requestPasswordReset({ login: value.login, ip: clientIp(req) });
    ok(res, result, '若账号已绑定邮箱，重置码已发送，请查收');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/v1/account/password/reset（重置码 + 新密码）
router.post('/account/password/reset', async (req, res) => {
  try {
    const { error, value } = Joi.object({
      login: Joi.string().required().max(64),
      code: Joi.string().required().length(6).pattern(/^\d{6}$/),
      newPassword: Joi.string().required().max(64),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    await resetPasswordByCode(value);
    ok(res, null, '密码已重置，请使用新密码登录');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// GET /api/v1/account/devices
router.get('/account/devices', requireAccount, async (req, res) => {
  try {
    const auth = req.accountAuth!;
    const list = await listDevices(auth.account.id);
    ok(res, list.map((d) => ({
      id: d.id,
      machineFp: maskFp(d.machineFp),
      deviceName: d.deviceName,
      osInfo: d.osInfo,
      appVersion: d.appVersion,
      firstLoginAt: d.firstLoginAt,
      lastActiveAt: d.lastActiveAt,
      current: !!auth.session.machineFp && d.machineFp === auth.session.machineFp,
    })));
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// DELETE /api/v1/account/devices/:id
router.delete('/account/devices/:id', requireAccount, async (req, res) => {
  try {
    const auth = req.accountAuth!;
    await removeDevice(auth.account.id, String(req.params.id));
    ok(res, null, '设备已移除');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/v1/account/proxy-blocked（断网保护事件上报，M5 团队仪表盘统计）
const proxyBlockedSchema = Joi.object({
  machineFp: Joi.string().allow('').max(64).default(''),
  envId: Joi.string().allow('').max(64).default(''),
  detail: Joi.string().allow('').max(512).default(''),
});

router.post('/account/proxy-blocked', requireAccount, async (req, res) => {
  try {
    const { error, value } = proxyBlockedSchema.validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    await reportProxyBlocked(req.accountAuth!.account, value);
    ok(res, null);
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// ==================== 个人仪表盘（所有版本 / 等级开放，仅统计本人） ====================

// GET /api/v1/account/dashboard/summary（个人汇总卡 + 本人环境排行）
router.get('/account/dashboard/summary', requireAccount, async (req, res) => {
  try {
    ok(res, await getAccountSummary(req.accountAuth!.account));
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// GET /api/v1/account/dashboard/trend?days=7|30（个人环境趋势）
router.get('/account/dashboard/trend', requireAccount, async (req, res) => {
  try {
    const days = Number(req.query.days) === 30 ? 30 : 7;
    ok(res, { days, points: await getAccountTrend(req.accountAuth!.account, days) });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/v1/license/activate（登录后卡密激活 / 续费 / 升级）
router.post('/license/activate', requireAccount, async (req, res) => {
  try {
    const { error, value } = Joi.object({
      code: Joi.string().required().max(200),
      machineFp: Joi.string().required().length(16).pattern(/^[0-9a-f]{16}$/),
      mode: Joi.string().valid('renew', 'upgrade', 'defer').default('renew'),
      disclaimerVersion: Joi.number().integer().min(1).optional(),
      appVersion: Joi.string().allow('').max(32).default(''),
      os: Joi.string().allow('').max(128).default(''),
      enterpriseName: Joi.string().allow('').max(128).default(''),
      // 「升企业版」专用：要求卡密必须为企业版卡密，避免误用个人卡；其它入口不传
      requireEnterprise: Joi.boolean().default(false),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const result = await activateForAccount(req.accountAuth!.account, {
      ...value,
      ip: clientIp(req),
    });
    // 权益已变更：向该账号（企业卡同时向企业下全部成员）推送最新权益快照
    pushEntitlementsForAccountId(req.accountAuth!.account.id).catch(() => undefined);
    ok(res, result, result.upgraded ? '升级成功' : result.renewed ? '续费成功' : '激活成功');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code, e.status || 200, e.data);
    throw e;
  }
});

// POST /api/v1/account/bind-key（老用户绑定本机已有卡密）
router.post('/account/bind-key', requireAccount, async (req, res) => {
  try {
    const { error, value } = Joi.object({
      code: Joi.string().required().max(200),
      machineFp: Joi.string().allow('').max(64).default(''),
      disclaimerVersion: Joi.number().integer().min(1).optional(),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const result = await bindExistingKey(req.accountAuth!.account, {
      ...value,
      ip: clientIp(req),
    });
    pushEntitlementsForAccountId(req.accountAuth!.account.id).catch(() => undefined);
    ok(res, result, '卡密绑定成功');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// GET /api/v1/account/keys（生效 + 历史卡密，含覆盖升级关系）
router.get('/account/keys', requireAccount, async (req, res) => {
  try {
    ok(res, await listAccountKeys(req.accountAuth!.account));
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// GET /api/v1/account/events（SSE：权益变更实时推送）
//   鉴权：Authorization: Bearer <token>
//   事件：event: account.entitlements / account.kicked / config
//   连上即下发当前权益快照，之后仅在权益变更/强制下线时推送；每 25s 发送 ": ping" 保活。
//   可选 ?machineFp=xxx：设备管理踢下线时按机器指纹精确投递。
router.get('/account/events', requireAccount, async (req, res) => {
  try {
    const auth = req.accountAuth!;
    const entitlements = await getEntitlements(auth.account);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // 账号模式没有本机卡密：公告/代理商随账号长连接一起下发（首次连接先给快照）
    addAccountClient(auth.account.id, res, entitlements, String(req.query.machineFp || ''), await getClientEvent());
    const cleanup = () => removeAccountClient(auth.account.id, res);
    req.on('close', cleanup);
    req.on('error', cleanup);
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// GET /api/v1/config/client（商城升级链接、档位列表、免责声明版本、配置版本）
router.get('/config/client', async (_req, res) => {
  try {
    const cfg = await buildClientConfig();
    ok(res, { ...cfg, serverTime: Math.floor(Date.now() / 1000) });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/v1/account/upgrade-code/redeem（核销升级码：同档续费顺延 / 跨档覆盖升级）
router.post('/account/upgrade-code/redeem', requireAccount, async (req, res) => {
  try {
    const { error, value } = Joi.object({ code: Joi.string().trim().max(64).required() }).validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const result = await redeemUpgradeCode(req.accountAuth!.account, value.code);
    await pushEntitlementsForAccountId(req.accountAuth!.account.id);
    ok(res, result);
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code, e.status || 200);
    throw e;
  }
});

export default router;
