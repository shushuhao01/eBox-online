import { Router } from 'express';
import Joi from 'joi';
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Account } from '../../entities/account/Account';
import { Enterprise } from '../../entities/account/Enterprise';
import { AccountDevice } from '../../entities/account/AccountDevice';
import { AccountSession } from '../../entities/account/AccountSession';
import { IpAssignment } from '../../entities/account/IpAssignment';
import { IpResource } from '../../entities/account/IpResource';
import { LicenseKey } from '../../entities/LicenseKey';
import { Device } from '../../entities/Device';
import { ok, fail, clientIp } from '../../middleware/helpers';
import { ApiError } from '../../middleware/errorHandler';
import { writeOperationLog } from '../../services/LogService';
import { revokeAccountSessions } from '../../services/AccountService';
import { pushKick } from '../../services/AccountEventService';
import { getEntitlements, findEffectiveKey, keyIsPermanent } from '../../services/EntitlementService';
import { toKeySummary, keyDurationDays } from '../../services/LicenseAccountService';
import { resolveLocation } from '../../services/SiteAnalyticsService';
import { generateTempPassword, hashPassword } from '../../utils/accountCrypto';

const router = Router();
const accountRepo = () => AppDataSource.getRepository(Account);
const enterpriseRepo = () => AppDataSource.getRepository(Enterprise);

/** 卡密档位文案：按月/季/年/永久归类，非标准天数直接显示天数 */
function keyPlanLabel(durationDays: number): string {
  const d = Number(durationDays) || 0;
  if (d <= 0) return '永久';
  if (d >= 360 && d <= 370) return '年卡';
  if (d >= 85 && d <= 95) return '季卡';
  if (d >= 28 && d <= 31) return '月卡';
  return `${d}天`;
}

/**
 * 管理后台 · 账号运营（M1）
 * 列表 / 解锁 / 重置密码 / 启停用；所有写操作落 operation_logs。
 */

/**
 * 卡密权威到期时间：账号体系以 account_expire_at 为准；
 * 老数据（时长制/换机码）回退 expire_at，再回退「激活时间 + 时长」。
 * 永久卡返回 null（由 permanent 标记）。
 */
function keyEffectiveExpireAt(k: LicenseKey): Date | null {
  if (keyIsPermanent(k)) return null;
  if (k.accountExpireAt) return new Date(k.accountExpireAt);
  const sec = Number(k.expireAt || 0);
  if (sec > 0) return new Date(sec * 1000);
  const days = keyDurationDays(k);
  const start = k.activatedAt || k.usedAt;
  if (days > 0 && start) return new Date(new Date(start).getTime() + days * 86400 * 1000);
  return null;
}

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const rows: Array<Record<string, unknown>> = await AppDataSource.query(sql, params);
  const first = rows?.[0] || {};
  const v = Object.values(first)[0];
  return Number(v || 0);
}

// GET /api/admin/accounts/metrics（账号体系运营指标，M7）
router.get('/metrics', async (_req, res) => {
  try {
    const [
      accountsTotal,
      accountsToday,
      accountsLocked,
      accountsLockTotal,
      accountsDisabled,
      entTotal,
      entExpiring7,
      entExpired,
      resourcesTotal,
      resourcesAbnormal,
      activeBindings,
      upgradeUsed7,
      seatUsed7,
    ] = await Promise.all([
      scalar('SELECT COUNT(*) AS v FROM accounts'),
      scalar('SELECT COUNT(*) AS v FROM accounts WHERE created_at >= CURDATE()'),
      scalar('SELECT COUNT(*) AS v FROM accounts WHERE status = 3 OR (locked_until IS NOT NULL AND locked_until > NOW())'),
      scalar('SELECT COALESCE(SUM(lock_count), 0) AS v FROM accounts'),
      scalar('SELECT COUNT(*) AS v FROM accounts WHERE status = 2'),
      scalar('SELECT COUNT(*) AS v FROM enterprises'),
      scalar('SELECT COUNT(*) AS v FROM enterprises WHERE expire_at IS NOT NULL AND expire_at > NOW() AND expire_at <= DATE_ADD(NOW(), INTERVAL 7 DAY)'),
      scalar('SELECT COUNT(*) AS v FROM enterprises WHERE status = 3 OR (expire_at IS NOT NULL AND expire_at <= NOW())'),
      scalar('SELECT COUNT(*) AS v FROM ip_resources'),
      scalar('SELECT COUNT(*) AS v FROM ip_resources WHERE health = 3'),
      scalar('SELECT COUNT(*) AS v FROM ip_assignments WHERE released_at IS NULL'),
      scalar('SELECT COUNT(*) AS v FROM upgrade_codes WHERE used_at IS NOT NULL AND used_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'),
      scalar('SELECT COUNT(*) AS v FROM seat_addons WHERE used_at IS NOT NULL AND used_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'),
    ]);
    ok(res, {
      accounts: {
        total: accountsTotal,
        todayNew: accountsToday,
        locked: accountsLocked,
        lockTotal: accountsLockTotal,
        disabled: accountsDisabled,
        lockedRate: accountsTotal ? Number(((accountsLocked / accountsTotal) * 100).toFixed(2)) : 0,
      },
      enterprises: { total: entTotal, expiring7: entExpiring7, expired: entExpired },
      ipResources: {
        total: resourcesTotal,
        abnormal: resourcesAbnormal,
        abnormalRate: resourcesTotal ? Number(((resourcesAbnormal / resourcesTotal) * 100).toFixed(2)) : 0,
        activeBindings,
      },
      vouchers: { upgradeUsed7, seatUsed7 },
    });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// GET /api/admin/accounts?page=&pageSize=&keyword=&status=&role=
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const keyword = String(req.query.keyword || '').trim();
    const status = req.query.status === undefined || req.query.status === '' ? null : Number(req.query.status);
    const role = req.query.role === undefined || req.query.role === '' ? null : Number(req.query.role);

    const qb = accountRepo().createQueryBuilder('a');
    if (keyword) {
      qb.andWhere('(a.login LIKE :kw OR a.nickname LIKE :kw OR a.email LIKE :kw)', { kw: `%${keyword}%` });
    }
    if (status !== null && Number.isFinite(status)) qb.andWhere('a.status = :status', { status });
    if (role !== null && Number.isFinite(role)) qb.andWhere('a.role = :role', { role });

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('a.id', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getMany();

    const entIds = Array.from(new Set(rows.map((r) => r.enterpriseId).filter((v): v is string => !!v)));
    const enterprises = entIds.length
      ? await enterpriseRepo().createQueryBuilder('e').where('e.id IN (:...ids)', { ids: entIds }).getMany()
      : [];
    const entMap = new Map(enterprises.map((e) => [String(e.id), e]));

    // 客户端版本：取该账号最近心跳的设备上报的 app_version
    const ids = rows.map((r) => r.id);
    const versionMap = new Map<string, string>();
    const planMap = new Map<string, string>();
    if (ids.length) {
      // 客户端版本：优先账号设备上报（客户端登录/心跳写入），回退卡密设备心跳
      const acctDevices = await AppDataSource.getRepository(AccountDevice)
        .createQueryBuilder('ad')
        .where('ad.accountId IN (:...ids)', { ids })
        .andWhere('ad.appVersion IS NOT NULL')
        .orderBy('ad.lastActiveAt', 'DESC')
        .getMany();
      for (const d of acctDevices) {
        const aid = String(d.accountId || '');
        if (aid && d.appVersion && !versionMap.has(aid)) versionMap.set(aid, d.appVersion);
      }

      const devices = await AppDataSource.getRepository(Device)
        .createQueryBuilder('d')
        .where('d.accountId IN (:...ids)', { ids })
        .andWhere('d.appVersion IS NOT NULL')
        .orderBy('d.lastHeartbeatAt', 'DESC')
        .getMany();
      for (const d of devices) {
        const aid = String(d.accountId || '');
        if (aid && d.appVersion && !versionMap.has(aid)) versionMap.set(aid, d.appVersion);
      }

      // 卡密档位：取该账号最近激活的一张卡（含已过期，排除未使用/作废）
      const keys = await AppDataSource.getRepository(LicenseKey)
        .createQueryBuilder('k')
        .where('k.accountId IN (:...ids)', { ids })
        .andWhere('k.status IN (:...st)', { st: [1, 3] })
        .orderBy('k.activatedAt', 'DESC')
        .getMany();
      for (const k of keys) {
        const aid = String(k.accountId || '');
        if (aid && !planMap.has(aid)) planMap.set(aid, keyPlanLabel(k.durationDays));
      }
    }

    ok(res, {
      total,
      page,
      pageSize,
      list: rows.map((a) => {
        const ent = a.enterpriseId ? entMap.get(String(a.enterpriseId)) : null;
        return {
          id: a.id,
          login: a.login,
          nickname: a.nickname,
          email: a.email,
          phone: a.phone,
          role: a.role,
          status: a.status,
          lockCount: a.lockCount,
          lockedUntil: a.lockedUntil,
          everEnterprise: a.everEnterprise === 1,
          enterpriseId: a.enterpriseId,
          enterpriseCode: ent?.code || null,
          enterpriseName: ent?.name || null,
          clientVersion: versionMap.get(String(a.id)) || null,
          keyPlan: planMap.get(String(a.id)) || null,
          lastLoginAt: a.lastLoginAt,
          createdAt: a.createdAt,
        };
      }),
    });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

async function findAccount(id: string): Promise<Account> {
  if (!/^\d+$/.test(id)) throw new ApiError('参数错误', 400);
  const account = await accountRepo().findOneBy({ id });
  if (!account) throw new ApiError('账号不存在', 1008);
  return account;
}

// GET /api/admin/accounts/:id/detail
// 用户完整档案：个人信息 / 授权 / 绑定卡密 / 激活记录 / 会话心跳 / 环境 / IP 与归属地
router.get('/:id/detail', async (req, res) => {
  try {
    const account = await findAccount(String(req.params.id));
    const [enterprise, entitlements, effectiveKey] = await Promise.all([
      account.enterpriseId ? enterpriseRepo().findOneBy({ id: account.enterpriseId }) : Promise.resolve(null),
      getEntitlements(account),
      findEffectiveKey(account),
    ]);

    const keys = await AppDataSource.getRepository(LicenseKey).find({
      where: { accountId: account.id },
      order: { id: 'DESC' },
      take: 100,
    });
    const keyIds = keys.map((k) => String(k.id));
    const keyMap = new Map(keys.map((k) => [String(k.id), k]));

    const since = new Date(Date.now() - 10 * 60 * 1000);
    const [devices, sessions, acctDevices, assignments] = await Promise.all([
      keyIds.length
        ? AppDataSource.getRepository(Device).find({
            where: { keyId: In(keyIds) },
            order: { lastOnlineAt: 'DESC' },
            take: 100,
          })
        : Promise.resolve([]),
      AppDataSource.getRepository(AccountSession).find({
        where: { accountId: account.id },
        order: { lastSeenAt: 'DESC' },
        take: 20,
      }),
      AppDataSource.getRepository(AccountDevice).find({
        where: { accountId: account.id },
        order: { lastActiveAt: 'DESC' },
        take: 50,
      }),
      AppDataSource.getRepository(IpAssignment).find({
        where: { memberAccountId: account.id },
        order: { id: 'DESC' },
        take: 30,
      }),
    ]);

    const resourceIds = assignments.map((a) => String(a.resourceId));
    const resources = resourceIds.length
      ? await AppDataSource.getRepository(IpResource).find({ where: { id: In(resourceIds) } })
      : [];
    const resourceMap = new Map(resources.map((r) => [String(r.id), r]));

    // IP 归属地：仅解析最近出现的前 8 个 IP，避免离线库查询拖慢接口
    const ips = Array.from(new Set([
      ...devices.map((d) => d.lastIp),
      ...sessions.map((s) => s.clientIp),
    ].filter((v): v is string => !!v))).slice(0, 8);
    const locations = await Promise.all(ips.map((ip) => resolveLocation(ip)));
    const locMap = new Map<string, { country: string; province: string; city: string; isp: string }>();
    ips.forEach((ip, i) => locMap.set(ip, locations[i]));
    const locText = (ip: string | null) => {
      if (!ip) return null;
      const l = locMap.get(ip);
      if (!l) return null;
      const text = [l.country, l.province, l.city].filter(Boolean).join(' ');
      return text || null;
    };

    ok(res, {
      account: {
        id: account.id,
        login: account.login,
        nickname: account.nickname,
        email: account.email,
        phone: account.phone,
        role: account.role,
        status: account.status,
        lockCount: account.lockCount,
        lockedUntil: account.lockedUntil,
        everEnterprise: account.everEnterprise === 1,
        enterpriseId: account.enterpriseId,
        lastLoginAt: account.lastLoginAt,
        lastLoginIp: account.lastLoginIp,
        lastLoginRegion: locText(account.lastLoginIp),
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      },
      enterprise: enterprise
        ? {
            id: enterprise.id,
            code: enterprise.code,
            name: enterprise.name,
            status: enterprise.status,
            seats: enterprise.seats,
            expireAt: enterprise.expireAt,
            createdAt: enterprise.createdAt,
          }
        : null,
      entitlements,
      currentKey: effectiveKey ? toKeySummary(effectiveKey, effectiveKey.id) : null,
      keys: keys.map((k) => {
        const effectiveExpireAt = keyEffectiveExpireAt(k);
        return {
          id: k.id,
          code: k.code,
          type: k.type,
          tier: k.tier,
          level: k.level,
          tierCode: k.tierCode,
          durationDays: k.durationDays,
          seats: k.seats,
          status: k.status,
          bound: k.bound,
          unbindMax: k.unbindMax,
          enterpriseId: k.enterpriseId,
          activatedAt: k.activatedAt,
          permanent: keyIsPermanent(k),
          effectiveExpireAt: effectiveExpireAt ? effectiveExpireAt.toISOString() : null,
          accountExpireAt: k.accountExpireAt,
          expireAt: k.expireAt,
          usedAt: k.usedAt,
          createdAt: k.createdAt,
          remark: k.remark,
        };
      }),
      devices: acctDevices.map((d) => ({
        id: d.id,
        machineFp: d.machineFp,
        deviceName: d.deviceName,
        osInfo: d.osInfo,
        appVersion: d.appVersion,
        status: d.status,
        envTotal: d.envTotal,
        envRunning: d.envRunning,
        boundResourceIds: d.boundResourceIds || [],
        firstLoginAt: d.firstLoginAt,
        lastActiveAt: d.lastActiveAt,
        online: !!d.lastActiveAt && d.lastActiveAt >= since,
      })),
      activations: devices.map((d) => {
        const key = keyMap.get(String(d.keyId));
        return {
          id: d.id,
          keyId: d.keyId,
          keyCode: key?.code || null,
          tier: key?.tier ?? null,
          level: key?.level ?? null,
          machineFp: d.machineFp,
          status: d.status,
          firstActivateAt: d.firstActivateAt,
          lastOnlineAt: d.lastOnlineAt,
          lastHeartbeatAt: d.lastHeartbeatAt,
          lastIp: d.lastIp,
          region: locText(d.lastIp),
          osInfo: d.osInfo,
          appVersion: d.appVersion,
          online: d.status === 1 && !!d.lastOnlineAt && d.lastOnlineAt >= since,
        };
      }),
      sessions: sessions.map((s) => ({
        id: s.id,
        machineFp: s.machineFp,
        clientIp: s.clientIp,
        region: locText(s.clientIp),
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
        online: !s.revokedAt && !!s.lastSeenAt && s.lastSeenAt >= since,
      })),
      ipResources: assignments.map((a) => {
        const r = resourceMap.get(String(a.resourceId));
        return {
          id: a.id,
          resourceId: a.resourceId,
          proxyType: r?.proxyType ?? null,
          host: r?.host ?? null,
          port: r?.port ?? null,
          remark: r?.remark ?? null,
          health: r?.health ?? null,
          status: a.status,
          envId: a.envId,
          envName: a.envName,
          boundAt: a.boundAt,
          releasedAt: a.releasedAt,
          releaseReason: a.releaseReason,
        };
      }),
    });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/admin/accounts/:id/unlock
router.post('/:id/unlock', async (req, res) => {
  try {
    const account = await findAccount(String(req.params.id));
    account.lockCount = 0;
    account.lockedUntil = null;
    if (account.status === 3) account.status = 1;
    await accountRepo().save(account);
    await writeOperationLog(req.auth!.userId, '账号解锁', account.login, '后台解除账号锁定', clientIp(req));
    ok(res, null, '账号已解锁');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// POST /api/admin/accounts/:id/reset-password（生成一次性临时密码并吊销全部会话）
router.post('/:id/reset-password', async (req, res) => {
  try {
    const account = await findAccount(String(req.params.id));
    const password = generateTempPassword();
    account.passwordHash = await hashPassword(password);
    account.lockCount = 0;
    account.lockedUntil = null;
    if (account.status === 3) account.status = 1;
    await accountRepo().save(account);
    await revokeAccountSessions(account.id);
    await writeOperationLog(
      req.auth!.userId,
      '账号重置密码',
      account.login,
      '后台重置密码并吊销会话（返回一次性密码）',
      clientIp(req)
    );
    ok(res, { login: account.login, password }, '密码已重置，请将一次性密码告知用户');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// PATCH /api/admin/accounts/:id/status（1=正常 2=停用）
router.patch('/:id/status', async (req, res) => {
  try {
    const { error, value } = Joi.object({
      status: Joi.number().integer().valid(1, 2).required(),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const account = await findAccount(String(req.params.id));
    account.status = value.status;
    if (value.status === 1) {
      account.lockCount = 0;
      account.lockedUntil = null;
    } else {
      // 实时通知客户端下线（与公告同一 SSE 通道），再吊销会话
      pushKick(account.id, '您的账号已被管理员停用');
      await revokeAccountSessions(account.id);
    }
    await accountRepo().save(account);
    await writeOperationLog(
      req.auth!.userId,
      value.status === 1 ? '启用账号' : '停用账号',
      account.login,
      null,
      clientIp(req)
    );
    ok(res, null, value.status === 1 ? '账号已启用' : '账号已停用');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

export default router;
