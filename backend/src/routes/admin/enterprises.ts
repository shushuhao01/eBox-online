import { Router } from 'express';
import Joi from 'joi';
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Enterprise } from '../../entities/account/Enterprise';
import { Account } from '../../entities/account/Account';
import { EnterpriseMember } from '../../entities/account/EnterpriseMember';
import { Sku } from '../../entities/account/Sku';
import { IpResource } from '../../entities/account/IpResource';
import { IpAssignment } from '../../entities/account/IpAssignment';
import { LicenseKey } from '../../entities/LicenseKey';
import { ok, fail, clientIp, superAdminRequired } from '../../middleware/helpers';
import { ApiError } from '../../middleware/errorHandler';
import { writeOperationLog } from '../../services/LogService';
import { pushEntitlementsForAccountId } from '../../services/AccountEventService';
import { getEntitlements } from '../../services/EntitlementService';

const router = Router();
const entRepo = () => AppDataSource.getRepository(Enterprise);
const accountRepo = () => AppDataSource.getRepository(Account);
const memberRepo = () => AppDataSource.getRepository(EnterpriseMember);

/**
 * 管理后台 · 企业管理（M7）
 * 列表 / 详情只读；人工调整席位（仅允许增加，超管操作，写审计并推送权益）。
 */

// GET /api/admin/enterprises?page=&pageSize=&keyword=&status=
router.get('/enterprises', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const keyword = String(req.query.keyword || '').trim();
    const status = req.query.status === undefined || req.query.status === '' ? null : Number(req.query.status);

    const qb = entRepo().createQueryBuilder('e');
    if (keyword) qb.andWhere('(e.code LIKE :kw OR e.name LIKE :kw)', { kw: `%${keyword}%` });
    if (status !== null && Number.isFinite(status)) qb.andWhere('e.status = :status', { status });

    const total = await qb.getCount();
    const rows = await qb.orderBy('e.id', 'DESC').offset((page - 1) * pageSize).limit(pageSize).getMany();

    const ids = rows.map((r) => String(r.id));
    const ownerIds = Array.from(new Set(rows.map((r) => String(r.ownerAccountId))));
    const [owners, memberRows] = await Promise.all([
      ownerIds.length ? accountRepo().createQueryBuilder('a').where('a.id IN (:...ids)', { ids: ownerIds }).getMany() : [],
      ids.length
        ? AppDataSource.query(
            'SELECT enterprise_id, COUNT(*) AS cnt FROM enterprise_members WHERE status <> 3 AND enterprise_id IN (?) GROUP BY enterprise_id',
            [ids]
          )
        : [],
    ]);
    const ownerMap = new Map(owners.map((a) => [String(a.id), a]));
    const memberMap = new Map<string, number>(
      (memberRows as Array<{ enterprise_id: string; cnt: string | number }>).map((r) => [String(r.enterprise_id), Number(r.cnt)])
    );

    ok(res, {
      total,
      page,
      pageSize,
      list: rows.map((e) => ({
        id: String(e.id),
        code: e.code,
        codePrefix: e.codePrefix,
        name: e.name,
        ownerAccountId: String(e.ownerAccountId),
        ownerLogin: ownerMap.get(String(e.ownerAccountId))?.login || null,
        seats: e.seats,
        usedSeats: memberMap.get(String(e.id)) || 0,
        skuId: e.skuId,
        status: e.status,
        expireAt: e.expireAt,
        createdAt: e.createdAt,
      })),
    });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// GET /api/admin/enterprises/:id（企业详情 + 成员 + 档位 + 卡密 + 网络 IP）
router.get('/enterprises/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) return fail(res, '参数错误', 400);
    const ent = await entRepo().findOneBy({ id });
    if (!ent) return fail(res, '企业不存在', 1008);
    const [members, owner] = await Promise.all([
      memberRepo().find({ where: { enterpriseId: id }, order: { id: 'ASC' } }),
      accountRepo().findOneBy({ id: String(ent.ownerAccountId) }),
    ]);
    const accountIds = members.map((m) => String(m.accountId));
    const accounts = accountIds.length
      ? await accountRepo().createQueryBuilder('a').where('a.id IN (:...ids)', { ids: accountIds }).getMany()
      : [];
    const accountMap = new Map(accounts.map((a) => [String(a.id), a]));

    const [sku, entitlements, keys, resources, assignments] = await Promise.all([
      ent.skuId ? AppDataSource.getRepository(Sku).findOneBy({ id: String(ent.skuId) }) : Promise.resolve(null),
      owner ? getEntitlements(owner) : Promise.resolve(null),
      AppDataSource.getRepository(LicenseKey).find({
        where: accountIds.length
          ? [{ enterpriseId: id }, { accountId: In(accountIds) }]
          : [{ enterpriseId: id }],
        order: { id: 'DESC' },
        take: 100,
      }),
      AppDataSource.getRepository(IpResource).find({ where: { enterpriseId: id }, order: { id: 'DESC' } }),
      AppDataSource.getRepository(IpAssignment).find({ where: { enterpriseId: id }, order: { id: 'DESC' } }),
    ]);

    const usedSeats = members.filter((m) => m.status !== 3).length;
    const activeIps = assignments.filter((a) => a.releasedAt === null).length;

    ok(res, {
      enterprise: {
        id: String(ent.id),
        code: ent.code,
        codePrefix: ent.codePrefix,
        name: ent.name,
        ownerAccountId: String(ent.ownerAccountId),
        ownerLogin: owner?.login || null,
        ownerNickname: owner?.nickname || null,
        ownerEmail: owner?.email || null,
        ownerLastLoginAt: owner?.lastLoginAt || null,
        seats: ent.seats,
        usedSeats,
        skuId: ent.skuId,
        skuLabel: sku?.label || null,
        status: ent.status,
        expireAt: ent.expireAt,
        createdAt: ent.createdAt,
        updatedAt: ent.updatedAt,
      },
      entitlements,
      members: members.map((m) => {
        const a = accountMap.get(String(m.accountId));
        return {
          id: String(m.id),
          accountId: String(m.accountId),
          login: a?.login || null,
          nickname: a?.nickname || null,
          email: a?.email || null,
          role: m.role,
          hint: m.hint,
          remark: m.remark,
          status: m.status,
          accountStatus: a?.status ?? null,
          lastLoginIp: a?.lastLoginIp || null,
          lastLoginAt: a?.lastLoginAt || null,
          createdAt: m.createdAt,
        };
      }),
      keys: keys.map((k) => ({
        id: String(k.id),
        code: k.code,
        tier: k.tier,
        level: k.level,
        tierCode: k.tierCode,
        durationDays: k.durationDays,
        seats: k.seats,
        status: k.status,
        bound: k.bound,
        accountId: k.accountId,
        accountLogin: k.accountId ? accountMap.get(String(k.accountId))?.login || null : null,
        activatedAt: k.activatedAt,
        accountExpireAt: k.accountExpireAt,
        usedAt: k.usedAt,
        createdAt: k.createdAt,
      })),
      ipResources: {
        total: resources.length,
        enabled: resources.filter((r) => r.status === 1).length,
        assigned: activeIps,
        using: resources.filter((r) => r.status === 1 && assignments.some((a) => String(a.resourceId) === String(r.id) && a.releasedAt === null)).length,
        list: resources.slice(0, 50).map((r) => ({
          id: String(r.id),
          host: r.host,
          port: r.port,
          proxyType: r.proxyType,
          status: r.status,
          health: r.health,
          remark: r.remark,
          assigned: assignments.some((a) => String(a.resourceId) === String(r.id) && a.releasedAt === null),
        })),
      },
    });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// PATCH /api/admin/enterprises/:id/seats（仅超管；只增不减；写审计）
router.patch('/enterprises/:id/seats', superAdminRequired, async (req, res) => {
  try {
    const { error, value } = Joi.object({
      seats: Joi.number().integer().min(1).max(10000).required(),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) return fail(res, '参数错误', 400);
    const ent = await entRepo().findOneBy({ id });
    if (!ent) return fail(res, '企业不存在', 1008);
    if (value.seats <= ent.seats) {
      return fail(res, `席位只允许增加（当前 ${ent.seats}，目标 ${value.seats}）`, 400);
    }
    const before = ent.seats;
    ent.seats = value.seats;
    await entRepo().save(ent);
    await writeOperationLog(
      req.auth!.userId,
      '企业人工加席位',
      ent.code,
      `席位 ${before} → ${value.seats}（${ent.name}）`,
      clientIp(req)
    );
    // 席位变更影响企业下全部成员权益：逐个推送在线账号
    const rows: Array<{ id: string }> = await AppDataSource.query('SELECT id FROM accounts WHERE enterprise_id = ?', [id]);
    await Promise.all(rows.map((r) => pushEntitlementsForAccountId(String(r.id))));
    ok(res, { id, seats: ent.seats }, '席位已调整');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

export default router;
