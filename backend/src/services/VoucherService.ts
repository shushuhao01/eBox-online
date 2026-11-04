import crypto from 'crypto';
import { AppDataSource } from '../config/database';
import { Account } from '../entities/account/Account';
import { Enterprise } from '../entities/account/Enterprise';
import { LicenseKey } from '../entities/LicenseKey';
import { UpgradeCode } from '../entities/account/UpgradeCode';
import { SeatAddon } from '../entities/account/SeatAddon';
import { ApiError } from '../middleware/errorHandler';
import {
  findEffectiveKey,
  getEntitlements,
  keyExpireSeconds,
  type Entitlements,
} from './EntitlementService';
import { pushEntitlementsForAccountId } from './AccountEventService';
import { isEnterpriseMember } from './LicenseAccountService';

/**
 * 升级码 / 席位扩容码（M6）
 * - 升级码：后台按「时长档位」生成（月/季/年/永久），客户端核销后把当前卡密同档位升为高级版，到期时间不变。
 * - 席位扩容码：只增不减，核销后 enterprise.seats 立即增加，不改版本/级别/到期时间。
 * - 两类码均以「状态条件更新」保证并发下只能核销一次。
 */

const upgradeRepo = () => AppDataSource.getRepository(UpgradeCode);
const seatRepo = () => AppDataSource.getRepository(SeatAddon);

/** 升级码只按「时长档位」生成：同档位普通版 → 高级版，到期时间不变 */
const UPGRADE_DURATIONS = ['month', 'quarter', 'year', 'permanent'] as const;
type UpgradeDuration = (typeof UPGRADE_DURATIONS)[number];
const DURATION_LABEL: Record<UpgradeDuration, string> = {
  month: '月卡',
  quarter: '季卡',
  year: '年卡',
  permanent: '永久',
};

function isUpgradeDuration(value: unknown): value is UpgradeDuration {
  return typeof value === 'string' && (UPGRADE_DURATIONS as readonly string[]).includes(value);
}

function durationOfDays(days: number): UpgradeDuration {
  if (Number(days) <= 0) return 'permanent';
  if (Number(days) >= 365) return 'year';
  if (Number(days) >= 90) return 'quarter';
  return 'month';
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(prefix: string): string {
  const bytes = crypto.randomBytes(16);
  let body = '';
  for (let i = 0; i < 16; i++) body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${prefix}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}

async function uniqueUpgradeCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomCode('UP');
    if (!(await upgradeRepo().findOneBy({ code }))) return code;
  }
  throw new ApiError('生成升级码失败，请重试', 500, 500);
}

async function uniqueSeatCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomCode('SE');
    if (!(await seatRepo().findOneBy({ code }))) return code;
  }
  throw new ApiError('生成席位码失败，请重试', 500, 500);
}

function normalizeValidUntil(raw: string | number | undefined | null): Date | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ===========================================================================
// 升级码
// ===========================================================================

export interface CreateUpgradeCodesInput {
  /** 时长档位：月/季/年/永久；核销时只把当前卡密同档位升为高级版 */
  duration?: UpgradeDuration | null;
  fromSkuId?: string | null;
  accountId?: string | null;
  amount?: number | null;
  remark?: string | null;
  validUntil?: string | number | null;
  count: number;
  createdBy?: string | null;
}

export interface UpgradeCodeRow {
  id: string;
  code: string;
  toSkuCode: string | null;
  toSkuLabel: string | null;
  toDuration: UpgradeDuration | null;
  accountId: string | null;
  amount: string | null;
  remark: string | null;
  status: number;
  validUntil: string | null;
  usedAt: string | null;
  usedBy: string | null;
  createdAt: string;
}

export async function createUpgradeCodes(input: CreateUpgradeCodesInput): Promise<UpgradeCodeRow[]> {
  if (!isUpgradeDuration(input.duration)) {
    throw new ApiError('请选择升级档位（月/季/年/永久）', 400, 400);
  }
  const duration = input.duration;
  const count = Math.min(200, Math.max(1, Math.floor(input.count || 1)));
  const rows: UpgradeCode[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(
      upgradeRepo().create({
        code: await uniqueUpgradeCode(),
        fromSkuId: input.fromSkuId || null,
        toSkuId: null,
        duration,
        accountId: input.accountId || null,
        amount: input.amount === undefined || input.amount === null ? null : String(input.amount),
        remark: input.remark || null,
        status: 1,
        validUntil: normalizeValidUntil(input.validUntil),
        createdBy: input.createdBy || null,
      })
    );
  }
  const saved = await upgradeRepo().save(rows);
  return saved.map((r) => ({
    id: String(r.id),
    code: r.code,
    toSkuCode: null,
    toSkuLabel: DURATION_LABEL[duration],
    toDuration: duration,
    accountId: r.accountId,
    amount: r.amount,
    remark: r.remark,
    status: r.status,
    validUntil: r.validUntil ? r.validUntil.toISOString() : null,
    usedAt: null,
    usedBy: null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listUpgradeCodes(filter: {
  page?: number;
  pageSize?: number;
  status?: number;
  keyword?: string;
}): Promise<{ total: number; page: number; pageSize: number; list: UpgradeCodeRow[] }> {
  const page = Math.max(1, Number(filter.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filter.pageSize) || 20));
  const qb = upgradeRepo().createQueryBuilder('c');
  if (filter.status !== undefined && Number.isFinite(filter.status)) qb.andWhere('c.status = :status', { status: filter.status });
  const keyword = (filter.keyword || '').trim();
  if (keyword) qb.andWhere('(c.code LIKE :kw OR c.remark LIKE :kw)', { kw: `%${keyword}%` });
  const total = await qb.getCount();
  const rows = await qb.orderBy('c.id', 'DESC').offset((page - 1) * pageSize).limit(pageSize).getMany();
  return {
    total,
    page,
    pageSize,
    list: rows.map((r) => {
      const toDuration = isUpgradeDuration(r.duration) ? r.duration : null;
      return {
        id: String(r.id),
        code: r.code,
        toSkuCode: null,
        toSkuLabel: toDuration ? DURATION_LABEL[toDuration] : null,
        toDuration,
        accountId: r.accountId,
        amount: r.amount,
        remark: r.remark,
        status: r.status,
        validUntil: r.validUntil ? r.validUntil.toISOString() : null,
        usedAt: r.usedAt ? r.usedAt.toISOString() : null,
        usedBy: r.usedBy,
        createdAt: r.createdAt.toISOString(),
      };
    }),
  };
}

export async function voidUpgradeCode(id: string): Promise<void> {
  const r = await upgradeRepo()
    .createQueryBuilder()
    .update(UpgradeCode)
    .set({ status: 3 })
    .where('id = :id AND status = 1', { id })
    .execute();
  if (!r.affected) throw new ApiError('该升级码已使用或已作废', 4004, 400);
}

export interface RedeemUpgradeResult {
  entitlements: Entitlements;
  skuCode: string;
  skuLabel: string;
  seats: number;
  expireAt: string | null;
  permanent: boolean;
  renewed: boolean;
  upgraded: boolean;
}

/** 客户端核销升级码：同档续费顺延，跨档覆盖升级（新到期从当前时间起算） */
export async function redeemUpgradeCode(account: Account, rawCode: string): Promise<RedeemUpgradeResult> {
  // 升级码作用于企业卡，只允许企业管理员核销，避免子账户替整个企业升级
  if (await isEnterpriseMember(account)) {
    throw new ApiError('子账户不能核销升级码，请联系企业管理员', 2002, 403);
  }
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) throw new ApiError('请输入升级码', 400, 400);
  const record = await upgradeRepo().findOneBy({ code });
  if (!record) throw new ApiError('升级码无效', 4004, 400);
  if (record.status === 2) throw new ApiError('该升级码已被使用', 4004, 400);
  if (record.status !== 1) throw new ApiError('该升级码已作废', 4004, 400);
  if (record.validUntil && record.validUntil.getTime() <= Date.now()) throw new ApiError('该升级码已过期', 4004, 400);
  if (record.accountId && String(record.accountId) !== String(account.id)) {
    throw new ApiError('该升级码不属于当前账号', 4004, 400);
  }
  if (!isUpgradeDuration(record.duration)) {
    throw new ApiError('该升级码档位无效，请联系客服', 4004, 400);
  }
  const duration = record.duration;

  const currentKey = await findEffectiveKey(account);
  if (!currentKey) throw new ApiError('当前账号没有生效授权，请先激活卡密', 4004, 400);

  const currentTier = currentKey.tier === 2 ? 2 : 1;
  const currentLevel = currentKey.level === 2 ? 2 : 1;
  if (currentLevel >= 2) throw new ApiError('当前已是高级版，无需升级', 2007, 400);

  // 核销码的时长必须与当前卡密档位一致：只做「同档位 普通 → 高级」，不改变到期时间
  const currentDuration: UpgradeDuration = durationOfDays(currentKey.durationDays);
  if (currentDuration !== duration) {
    throw new ApiError(`该升级码为${DURATION_LABEL[duration]}，与当前卡密档位（${DURATION_LABEL[currentDuration]}）不一致`, 2008, 400);
  }

  const tierCode = `${currentTier === 2 ? 'ent' : 'per'}_pro_${duration}`;
  const skuLabel = `${currentTier === 2 ? '企业' : '个人'}高级 · ${DURATION_LABEL[duration]}`;
  const permanent = duration === 'permanent';
  const newExpireSec = permanent ? 0 : keyExpireSeconds(currentKey);
  const upgraded = true;

  const now = new Date();
  const newSeats = Math.max(1, Number(currentKey.seats) || 1);

  await AppDataSource.transaction(async (manager) => {
    const consumed = await manager
      .createQueryBuilder()
      .update(UpgradeCode)
      .set({
        status: 2,
        usedAt: now,
        usedBy: account.id,
        accountId: record.accountId || account.id,
        fromSkuId: currentKey.skuId || record.fromSkuId,
      })
      .where('id = :id AND status = 1', { id: record.id })
      .execute();
    if (!consumed.affected) throw new ApiError('该升级码已被使用', 4004, 400);

    await manager
      .createQueryBuilder()
      .update(LicenseKey)
      .set({
        tier: currentTier,
        level: 2,
        skuId: null,
        tierCode,
        durationDays: currentKey.durationDays,
        seats: newSeats,
        // 升级不改变到期时间：保持原卡密到期秒数（永久卡继续永久）
        accountExpireAt: permanent ? null : new Date(newExpireSec * 1000),
      })
      .where('id = :id', { id: currentKey.id })
      .execute();
  });

  const fresh = (await AppDataSource.getRepository(Account).findOneBy({ id: account.id })) || account;
  const entitlements = await getEntitlements(fresh);
  await pushEntitlementsForAccountId(account.id);
  return {
    entitlements,
    skuCode: tierCode,
    skuLabel,
    seats: newSeats,
    expireAt: permanent ? null : new Date(newExpireSec * 1000).toISOString(),
    permanent,
    renewed: false,
    upgraded,
  };
}

// ===========================================================================
// 席位扩容码
// ===========================================================================

export interface CreateSeatAddonsInput {
  seatDelta: number;
  count: number;
  enterpriseId?: string | null;
  remark?: string | null;
  validUntil?: string | number | null;
  createdBy?: string | null;
}

export interface SeatAddonRow {
  id: string;
  code: string;
  seatDelta: number;
  enterpriseId: string | null;
  remark: string | null;
  status: number;
  validUntil: string | null;
  usedAt: string | null;
  usedBy: string | null;
  createdAt: string;
}

function toSeatRow(r: SeatAddon): SeatAddonRow {
  return {
    id: String(r.id),
    code: r.code,
    seatDelta: r.seatDelta,
    enterpriseId: r.enterpriseId,
    remark: r.remark,
    status: r.status,
    validUntil: r.validUntil ? r.validUntil.toISOString() : null,
    usedAt: r.usedAt ? r.usedAt.toISOString() : null,
    usedBy: r.usedBy,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function createSeatAddons(input: CreateSeatAddonsInput): Promise<SeatAddonRow[]> {
  const seatDelta = Math.floor(input.seatDelta);
  if (!Number.isFinite(seatDelta) || seatDelta < 1 || seatDelta > 500) {
    throw new ApiError('席位增量需在 1–500 之间', 400, 400);
  }
  const count = Math.min(200, Math.max(1, Math.floor(input.count || 1)));
  const rows: SeatAddon[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(
      seatRepo().create({
        code: await uniqueSeatCode(),
        seatDelta,
        enterpriseId: input.enterpriseId || null,
        remark: input.remark || null,
        status: 1,
        validUntil: normalizeValidUntil(input.validUntil),
        createdBy: input.createdBy || null,
      })
    );
  }
  const saved = await seatRepo().save(rows);
  return saved.map(toSeatRow);
}

export async function listSeatAddons(filter: {
  page?: number;
  pageSize?: number;
  status?: number;
  keyword?: string;
}): Promise<{ total: number; page: number; pageSize: number; list: SeatAddonRow[] }> {
  const page = Math.max(1, Number(filter.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filter.pageSize) || 20));
  const qb = seatRepo().createQueryBuilder('s');
  if (filter.status !== undefined && Number.isFinite(filter.status)) qb.andWhere('s.status = :status', { status: filter.status });
  const keyword = (filter.keyword || '').trim();
  if (keyword) qb.andWhere('(s.code LIKE :kw OR s.remark LIKE :kw)', { kw: `%${keyword}%` });
  const total = await qb.getCount();
  const rows = await qb.orderBy('s.id', 'DESC').offset((page - 1) * pageSize).limit(pageSize).getMany();
  return { total, page, pageSize, list: rows.map(toSeatRow) };
}

export async function voidSeatAddon(id: string): Promise<void> {
  const r = await seatRepo()
    .createQueryBuilder()
    .update(SeatAddon)
    .set({ status: 3 })
    .where('id = :id AND status = 1', { id })
    .execute();
  if (!r.affected) throw new ApiError('该席位码已使用或已作废', 4004, 400);
}

/** 企业管理员查看本企业已核销的扩容记录 */
export async function listEnterpriseSeatAddons(enterpriseId: string): Promise<SeatAddonRow[]> {
  const rows = await seatRepo().find({ where: { enterpriseId, status: 2 }, order: { usedAt: 'DESC' }, take: 50 });
  return rows.map(toSeatRow);
}

export interface RedeemSeatAddonResult {
  seats: number;
  seatDelta: number;
  entitlements: Entitlements;
}

export async function redeemSeatAddon(account: Account, enterprise: Enterprise, rawCode: string): Promise<RedeemSeatAddonResult> {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) throw new ApiError('请输入席位扩容码', 400, 400);
  const record = await seatRepo().findOneBy({ code });
  if (!record) throw new ApiError('席位扩容码无效', 4004, 400);
  if (record.status === 2) throw new ApiError('该席位扩容码已被使用', 4004, 400);
  if (record.status !== 1) throw new ApiError('该席位扩容码已作废', 4004, 400);
  if (record.validUntil && record.validUntil.getTime() <= Date.now()) throw new ApiError('该席位扩容码已过期', 4004, 400);
  if (record.enterpriseId && String(record.enterpriseId) !== String(enterprise.id)) {
    throw new ApiError('该席位扩容码不属于当前企业', 4004, 400);
  }
  if (enterprise.expireAt && enterprise.expireAt.getTime() <= Date.now()) {
    throw new ApiError('企业已到期，请先续费后再核销', 2007, 400);
  }

  const now = new Date();
  let seats = enterprise.seats;
  await AppDataSource.transaction(async (manager) => {
    const consumed = await manager
      .createQueryBuilder()
      .update(SeatAddon)
      .set({
        status: 2,
        usedAt: now,
        usedBy: account.id,
        enterpriseId: record.enterpriseId || enterprise.id,
      })
      .where('id = :id AND status = 1', { id: record.id })
      .execute();
    if (!consumed.affected) throw new ApiError('该席位扩容码已被使用', 4004, 400);

    await manager
      .createQueryBuilder()
      .update(Enterprise)
      .set({ seats: () => `seats + ${Math.max(1, Math.floor(record.seatDelta))}` })
      .where('id = :id', { id: enterprise.id })
      .execute();
    const fresh = await manager.getRepository(Enterprise).findOneBy({ id: enterprise.id });
    seats = fresh?.seats || enterprise.seats + record.seatDelta;
  });

  // 席位变更影响企业下全部成员权益：逐个推送在线账号
  const rows: Array<{ id: string }> = await AppDataSource.query('SELECT id FROM accounts WHERE enterprise_id = ?', [enterprise.id]);
  await Promise.all(rows.map((r) => pushEntitlementsForAccountId(String(r.id))));

  const freshAccount = (await AppDataSource.getRepository(Account).findOneBy({ id: account.id })) || account;
  const entitlements = await getEntitlements(freshAccount);
  return { seats, seatDelta: record.seatDelta, entitlements };
}
