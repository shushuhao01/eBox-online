import { Router } from 'express';
import { AppDataSource } from '../../config/database';
import { IpResource } from '../../entities/account/IpResource';
import { Account } from '../../entities/account/Account';
import { Enterprise } from '../../entities/account/Enterprise';
import { ok, fail } from '../../middleware/helpers';
import { ApiError } from '../../middleware/errorHandler';

const router = Router();
const resourceRepo = () => AppDataSource.getRepository(IpResource);
const accountRepo = () => AppDataSource.getRepository(Account);
const entRepo = () => AppDataSource.getRepository(Enterprise);

/**
 * 管理后台 · IP 资源只读查看（M7）
 * 平台不自建、不预置资源；后台仅用于运营排查，账号密码一律掩码，不下发密文。
 */

function maskAccount(raw: string): string {
  const s = String(raw || '');
  if (!s) return '';
  if (s.length <= 2) return `${s[0] || ''}***`;
  return `${s.slice(0, 2)}***`;
}

// GET /api/admin/ip-resources?page=&pageSize=&scope=&keyword=&health=&status=
router.get('/ip-resources', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const scope = req.query.scope === undefined || req.query.scope === '' ? null : Number(req.query.scope);
    const health = req.query.health === undefined || req.query.health === '' ? null : Number(req.query.health);
    const status = req.query.status === undefined || req.query.status === '' ? null : Number(req.query.status);
    const keyword = String(req.query.keyword || '').trim();

    const qb = resourceRepo().createQueryBuilder('r');
    if (scope !== null && Number.isFinite(scope)) qb.andWhere('r.scope = :scope', { scope });
    if (health !== null && Number.isFinite(health)) qb.andWhere('r.health = :health', { health });
    if (status !== null && Number.isFinite(status)) qb.andWhere('r.status = :status', { status });
    if (keyword) qb.andWhere('(r.host LIKE :kw OR r.remark LIKE :kw)', { kw: `%${keyword}%` });

    const total = await qb.getCount();
    const rows = await qb.orderBy('r.id', 'DESC').offset((page - 1) * pageSize).limit(pageSize).getMany();

    const ownerIds = Array.from(new Set(rows.map((r) => String(r.ownerAccountId)).filter((v) => v !== '0')));
    const entIds = Array.from(new Set(rows.map((r) => String(r.enterpriseId)).filter((v) => v !== '0')));
    const [owners, enterprises] = await Promise.all([
      ownerIds.length ? accountRepo().createQueryBuilder('a').where('a.id IN (:...ids)', { ids: ownerIds }).getMany() : [],
      entIds.length ? entRepo().createQueryBuilder('e').where('e.id IN (:...ids)', { ids: entIds }).getMany() : [],
    ]);
    const ownerMap = new Map(owners.map((a) => [String(a.id), a]));
    const entMap = new Map(enterprises.map((e) => [String(e.id), e]));

    ok(res, {
      total,
      page,
      pageSize,
      list: rows.map((r) => ({
        id: String(r.id),
        scope: r.scope,
        ownerAccountId: r.ownerAccountId === '0' ? null : String(r.ownerAccountId),
        ownerLogin: r.ownerAccountId === '0' ? null : ownerMap.get(String(r.ownerAccountId))?.login || null,
        enterpriseId: r.enterpriseId === '0' ? null : String(r.enterpriseId),
        enterpriseName: r.enterpriseId === '0' ? null : entMap.get(String(r.enterpriseId))?.name || null,
        proxyType: r.proxyType,
        host: r.host,
        port: r.port,
        usernameMasked: maskAccount(r.username),
        remark: r.remark,
        status: r.status,
        health: r.health,
        latencyMs: r.latencyMs,
        lastCheckAt: r.lastCheckAt,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

export default router;
