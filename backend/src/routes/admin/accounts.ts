import { Router } from 'express';
import Joi from 'joi';
import { AppDataSource } from '../../config/database';
import { Account } from '../../entities/account/Account';
import { Enterprise } from '../../entities/account/Enterprise';
import { ok, fail, clientIp } from '../../middleware/helpers';
import { ApiError } from '../../middleware/errorHandler';
import { writeOperationLog } from '../../services/LogService';
import { revokeAccountSessions } from '../../services/AccountService';
import { generateTempPassword, hashPassword } from '../../utils/accountCrypto';

const router = Router();
const accountRepo = () => AppDataSource.getRepository(Account);
const enterpriseRepo = () => AppDataSource.getRepository(Enterprise);

/**
 * 管理后台 · 账号运营（M1）
 * 列表 / 解锁 / 重置密码 / 启停用；所有写操作落 operation_logs。
 */

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
