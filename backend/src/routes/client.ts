import { Router } from 'express';
import Joi from 'joi';
import { ok, fail, clientIp } from '../middleware/helpers';
import { ApiError } from '../middleware/errorHandler';
import { clientActivate, clientHeartbeat, clientUnbind, findByCode } from '../services/KeyService';
import { decodeAndVerify } from '../crypto/licenseCodec';
import { getConfigValue } from '../services/ConfigService';
import { getAgencyPayload } from '../services/AgencyService';
import { authenticateToken } from '../services/AccountService';
import { getEntitlements } from '../services/EntitlementService';
import { updateDeviceEnvStats } from '../services/DeviceStatsService';
import { AppDataSource } from '../config/database';
import { Device } from '../entities/Device';

const router = Router();

// 防重放：code+nonce 缓存 10 分钟（进程内 Map，足够单实例场景）
// 同一设备 60 秒内重复提交视为网络重试（幂等放行）；其他设备或超窗复用一律按重放拒绝
const NONCE_RETRY_MS = 60 * 1000;
const nonceCache = new Map<string, { at: number; machineFp: string }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of nonceCache) {
    if (now - v.at > 10 * 60 * 1000) nonceCache.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

function claimNonce(code: string, nonce: string, machineFp: string): boolean {
  const now = Date.now();
  const key = `${code}|${nonce}`;
  const prev = nonceCache.get(key);
  if (prev) return prev.machineFp === machineFp && now - prev.at <= NONCE_RETRY_MS;
  nonceCache.set(key, { at: now, machineFp });
  return true;
}

/** 客户端时间偏差 > 5 分钟视为异常 */
function clockSkewOk(clientTime: number): boolean {
  return Math.abs(Date.now() / 1000 - clientTime) <= 300;
}

const bodySchema = Joi.object({
  code: Joi.string().required().max(200),
  machineFp: Joi.string().required().length(16).pattern(/^[0-9a-f]{16}$/),
  appVersion: Joi.string().allow('').max(32).default(''),
  os: Joi.string().allow('').max(128).default(''),
  timestamp: Joi.number().integer().required(),
  nonce: Joi.string().required().max(64),
  // M5 环境统计（可选）：旧客户端不传时保持库中原值
  envTotal: Joi.number().integer().min(0).max(100000),
  envRunning: Joi.number().integer().min(0).max(100000),
  boundResourceIds: Joi.array().items(Joi.string().max(64)).max(500),
});

// POST /api/v1/activate
router.post('/activate', async (req, res) => {
  try {
    const { error, value } = bodySchema.validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const forceOnline = (await getConfigValue('force_online_activate')) === '1';
    // 重放一律拒绝；时钟偏差仅在强制在线激活时校验（老客户端系统时间不准也能激活）
    if (!claimNonce(value.code, value.nonce, value.machineFp)) {
      return fail(res, '请求异常或已过期', 401);
    }
    if (forceOnline && !clockSkewOk(value.timestamp)) {
      return fail(res, '请求异常或已过期', 401);
    }
    const result = await clientActivate(value.code, value.machineFp, {
      ip: clientIp(req),
      os: value.os,
      appVersion: value.appVersion,
      clientTime: value.timestamp,
    });
    ok(res, result);
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/v1/heartbeat
router.post('/heartbeat', async (req, res) => {
  try {
    const { error, value } = bodySchema.validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    if (!claimNonce(value.code, value.nonce, value.machineFp)) return fail(res, '请求异常或已过期', 401);
    const result = await clientHeartbeat(value.code, value.machineFp, {
      ip: clientIp(req),
      appVersion: value.appVersion,
      clientTime: value.timestamp,
    });
    // 代理商列表随心跳兜底下发（SSE 断线时仍能同步；客户端缺字段时保留本地缓存）
    const payload: Record<string, unknown> = { ...result, agencies: await getAgencyPayload() };
    // 账号体系：已登录客户端随心跳对齐权益（无 token 的旧客户端不受影响）
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token) {
      try {
        const auth = await authenticateToken(token);
        if (auth) {
          payload.entitlements = await getEntitlements(auth.account);
          // 环境统计随心跳落库（团队仪表盘数据源）；字段缺失/校验失败不影响心跳
          await updateDeviceEnvStats(auth.account, {
            machineFp: value.machineFp,
            envTotal: value.envTotal,
            envRunning: value.envRunning,
            boundResourceIds: value.boundResourceIds,
          });
        }
      } catch {
        /* 权益下发 / 统计落库失败不影响心跳主流程 */
      }
    }
    ok(res, payload);
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// 在线状态上报（团队仪表盘）：不参与授权校验，只刷新账号设备的活跃时间与环境统计。
// 客户端每 5 分钟上报一次，使「近 30 分钟在线」判定真实可用（心跳是小时级，无法支撑）。
const presenceSchema = Joi.object({
  machineFp: Joi.string().required().length(16).pattern(/^[0-9a-f]{16}$/),
  envTotal: Joi.number().integer().min(0).max(100000),
  envRunning: Joi.number().integer().min(0).max(100000),
  boundResourceIds: Joi.array().items(Joi.string().max(64)).max(500),
});

// POST /api/v1/presence
router.post('/presence', async (req, res) => {
  try {
    const { error, value } = presenceSchema.validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const auth = token ? await authenticateToken(token) : null;
    if (!auth) return fail(res, '未登录或登录已过期', 401);
    await updateDeviceEnvStats(auth.account, {
      machineFp: value.machineFp,
      envTotal: value.envTotal,
      envRunning: value.envRunning,
      boundResourceIds: value.boundResourceIds,
    });
    ok(res, { serverTime: Math.floor(Date.now() / 1000) });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/v1/unbind
router.post('/unbind', async (req, res) => {
  try {
    const { error, value } = bodySchema.validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    if (!claimNonce(value.code, value.nonce, value.machineFp)) return fail(res, '请求异常或已过期', 401);
    const result = await clientUnbind(value.code, value.machineFp, {
      ip: clientIp(req),
      appVersion: value.appVersion,
      clientTime: value.timestamp,
    });
    if (result.exceed) return fail(res, '本月解绑次数已达上限', 1006);
    ok(res, result);
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// GET /api/v1/status?code=&machineFp=
router.get('/status', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const fp = String(req.query.machineFp || '');
    const parsed = decodeAndVerify(code);
    if (!parsed) return fail(res, '激活码无效', 1001);
    const key = await findByCode(code);
    const serverTime = Math.floor(Date.now() / 1000);
    if (!key) {
      return ok(res, { online: false, registered: false, serverTime });
    }
    // 只返回客户端所需的授权字段，避免把整行卡密（批次/客户/备注/归属人等）暴露给匿名查询
    const device = await AppDataSource.getRepository(Device).findOneBy({ keyId: key.id, machineFp: fp });
    return ok(res, {
      online: true,
      registered: true,
      status: key.status,
      type: key.type,
      durationSec: Number(key.durationSec || 0),
      expireAt: key.expireAt ? Number(key.expireAt) : null,
      bound: key.bound === 1,
      unbindMax: key.unbindMax,
      usedAt: key.usedAt,
      deviceId: device?.id || null,
      serverTime,
    });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

export default router;
