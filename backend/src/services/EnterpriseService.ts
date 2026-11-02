import { AppDataSource } from '../config/database';
import { Account } from '../entities/account/Account';
import { AccountSession } from '../entities/account/AccountSession';
import { AccountDevice } from '../entities/account/AccountDevice';
import { Enterprise } from '../entities/account/Enterprise';
import { EnterpriseMember } from '../entities/account/EnterpriseMember';
import { LicenseKey } from '../entities/LicenseKey';
import { IpAssignment } from '../entities/account/IpAssignment';
import { IpResource } from '../entities/account/IpResource';
import { ApiError } from '../middleware/errorHandler';
import { generateTempPassword, hashPassword } from '../utils/accountCrypto';
import { writeOperationLog } from './LogService';

/**
 * 企业（团队）服务
 * - 企业卡密激活自动建团队、生成 8 位企业码（前 6 位全局唯一）
 * - 子账户账号 = 企业码前 6 位-序号，登录复用统一入口
 */

const accountRepo = () => AppDataSource.getRepository(Account);
const enterpriseRepo = () => AppDataSource.getRepository(Enterprise);
const memberRepo = () => AppDataSource.getRepository(EnterpriseMember);
const deviceRepo = () => AppDataSource.getRepository(AccountDevice);
const sessionRepo = () => AppDataSource.getRepository(AccountSession);
const keyRepo = () => AppDataSource.getRepository(LicenseKey);

// 去除易混字符 O/0/I/1
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ONLINE_WINDOW_MS = 30 * 60 * 1000;

function randomCode(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** 8 位企业码；前 6 位也需全局唯一（保证子账户账号全局唯一） */
export async function generateEnterpriseCode(): Promise<{ code: string; prefix: string }> {
  for (let i = 0; i < 30; i++) {
    const code = randomCode(8);
    const prefix = code.slice(0, 6);
    const dup = await enterpriseRepo()
      .createQueryBuilder('e')
      .where('e.code = :code OR e.code_prefix = :prefix', { code, prefix })
      .getCount();
    if (!dup) return { code, prefix };
  }
  throw new ApiError('企业码生成失败，请重试', 500);
}

/** 企业卡密激活：创建企业 + 管理员成员 + 账号归属 */
export async function openEnterpriseForActivation(
  account: Account,
  key: LicenseKey,
  seats: number,
  permanent: boolean,
  expireSec: number,
  enterpriseName?: string
): Promise<Enterprise> {
  if (account.enterpriseId) {
    const existing = await enterpriseRepo().findOneBy({ id: account.enterpriseId });
    if (existing) return existing;
  }
  const { code, prefix } = await generateEnterpriseCode();
  const name = (enterpriseName || '').trim() || `${account.nickname || account.login} 的团队`;
  const enterprise = await enterpriseRepo().save(
    enterpriseRepo().create({
      code,
      codePrefix: prefix,
      name: name.slice(0, 128),
      ownerAccountId: account.id,
      seats: Math.max(1, seats),
      skuId: key.skuId || null,
      status: 1,
      expireAt: permanent ? null : new Date(expireSec * 1000),
    })
  );

  const existsMember = await memberRepo().findOneBy({ enterpriseId: enterprise.id, accountId: account.id });
  if (!existsMember) {
    await memberRepo().save(
      memberRepo().create({
        enterpriseId: enterprise.id,
        accountId: account.id,
        role: 1,
        hint: null,
        remark: null,
        status: 1,
      })
    );
  }

  account.role = 2;
  account.enterpriseId = enterprise.id;
  account.everEnterprise = 1;
  await accountRepo().save(account);

  key.enterpriseId = enterprise.id;
  await keyRepo().save(key);
  return enterprise;
}

export interface EnterpriseContext {
  enterprise: Enterprise;
  member: EnterpriseMember;
}

/** 企业管理员上下文（越权统一 403） */
export async function requireEnterpriseAdmin(account: Account): Promise<EnterpriseContext> {
  if (!account.enterpriseId) throw new ApiError('仅企业管理员可操作', 4003, 403);
  const enterprise = await enterpriseRepo().findOneBy({ id: account.enterpriseId });
  if (!enterprise) throw new ApiError('企业不存在', 4004, 403);
  if (enterprise.status === 3 || (enterprise.expireAt && enterprise.expireAt.getTime() <= Date.now())) {
    throw new ApiError('企业已到期，请先续费', 2007, 403);
  }
  const member = await memberRepo().findOneBy({ enterpriseId: enterprise.id, accountId: account.id });
  if (!member || member.role !== 1 || member.status !== 1) {
    throw new ApiError('仅企业管理员可操作', 4003, 403);
  }
  return { enterprise, member };
}

export interface TeamMemberItem {
  id: string;
  accountId: string;
  login: string;
  nickname: string | null;
  role: number;
  hint: string | null;
  remark: string | null;
  status: number;
  lockedUntil: Date | null;
  createdAt: Date;
  lastActiveAt: Date | null;
  online: boolean;
}

export interface TeamMemberList {
  total: number;
  page: number;
  pageSize: number;
  seats: number;
  usedSeats: number;
  onlineCount: number;
  list: TeamMemberItem[];
}

export async function listTeamMembers(
  enterprise: Enterprise,
  opts: { page?: number; pageSize?: number; keyword?: string; status?: number }
): Promise<TeamMemberList> {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20));
  const qb = memberRepo()
    .createQueryBuilder('m')
    .innerJoin(Account, 'a', 'a.id = m.account_id')
    .where('m.enterprise_id = :entId', { entId: enterprise.id });

  if (opts.status !== undefined && opts.status !== null && opts.status >= 0) {
    qb.andWhere('m.status = :status', { status: opts.status });
  }
  const kw = (opts.keyword || '').trim();
  if (kw) {
    qb.andWhere('(a.login LIKE :kw OR a.nickname LIKE :kw OR m.hint LIKE :kw OR m.remark LIKE :kw)', {
      kw: `%${kw}%`,
    });
  }
  const total = await qb.getCount();
  const rows = await qb
    .orderBy('m.role', 'ASC')
    .addOrderBy('m.id', 'ASC')
    .offset((page - 1) * pageSize)
    .limit(pageSize)
    .getMany();

  const accounts = rows.length
    ? await accountRepo()
        .createQueryBuilder('a')
        .where('a.id IN (:...ids)', { ids: rows.map((r) => r.accountId) })
        .getMany()
    : [];
  const accountMap = new Map(accounts.map((a) => [String(a.id), a]));

  const lastActiveRows: Array<{ account_id: string; last_active_at: string | null }> = rows.length
    ? await AppDataSource.query(
        `SELECT account_id, MAX(last_active_at) AS last_active_at FROM account_devices
         WHERE account_id IN (${rows.map(() => '?').join(',')}) GROUP BY account_id`,
        rows.map((r) => r.accountId)
      )
    : [];
  const lastActiveMap = new Map(lastActiveRows.map((r) => [String(r.account_id), r.last_active_at]));

  const now = Date.now();
  const list: TeamMemberItem[] = rows.map((m) => {
    const a = accountMap.get(String(m.accountId));
    const lastActiveAt = lastActiveMap.get(String(m.accountId));
    const ts = lastActiveAt ? new Date(lastActiveAt).getTime() : 0;
    return {
      id: m.id,
      accountId: m.accountId,
      login: a?.login || '',
      nickname: a?.nickname || null,
      role: m.role,
      hint: m.hint,
      remark: m.remark,
      status: m.status,
      lockedUntil: a?.lockedUntil || null,
      createdAt: m.createdAt,
      lastActiveAt: lastActiveAt ? new Date(lastActiveAt) : null,
      online: !!ts && now - ts <= ONLINE_WINDOW_MS,
    };
  });

  const usedSeats = await memberRepo().countBy({ enterpriseId: enterprise.id, status: 1 });
  // 在线成员数按企业全量统计（30 分钟内有设备活跃），不随分页/筛选变化
  const onlineRows: Array<{ c: number | string }> = await AppDataSource.query(
    `SELECT COUNT(DISTINCT a.id) AS c FROM enterprise_members m
     JOIN accounts a ON a.id = m.account_id
     JOIN account_devices d ON d.account_id = a.id
     WHERE m.enterprise_id = ? AND m.status = 1 AND d.last_active_at >= ?`,
    [enterprise.id, new Date(now - ONLINE_WINDOW_MS)]
  );
  const onlineCount = Number(onlineRows[0]?.c || 0);
  return { total, page, pageSize, seats: enterprise.seats, usedSeats, onlineCount, list };
}

export interface CreateMemberResult {
  id: string;
  accountId: string;
  login: string;
  password: string;
  nickname: string | null;
  hint: string | null;
  seats: number;
  usedSeats: number;
}

/** 分配下一个子账户序号（企业码前 6 位-序号） */
async function nextMemberLogin(prefix: string): Promise<string> {
  const rows: Array<{ login: string }> = await AppDataSource.query(
    'SELECT login FROM accounts WHERE login LIKE ?',
    [`${prefix}-%`]
  );
  let max = 0;
  for (const r of rows) {
    const n = Number(String(r.login).slice(prefix.length + 1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  let seq = max + 1;
  for (let i = 0; i < 1000; i++) {
    const login = `${prefix}-${String(seq).padStart(3, '0')}`;
    const exists = await accountRepo().findOneBy({ login });
    if (!exists) return login;
    seq += 1;
  }
  throw new ApiError('子账户账号生成失败，请重试', 500);
}

export async function createTeamMember(
  admin: Account,
  ctx: EnterpriseContext,
  input: { nickname?: string; hint?: string; remark?: string; ip?: string }
): Promise<CreateMemberResult> {
  const used = await memberRepo().countBy({ enterpriseId: ctx.enterprise.id, status: 1 });
  if (used >= ctx.enterprise.seats) {
    throw new ApiError(`席位已满（${used}/${ctx.enterprise.seats}），请先购买席位扩容码`, 4090);
  }
  const login = await nextMemberLogin(ctx.enterprise.codePrefix);
  const password = generateTempPassword();
  const account = await accountRepo().save(
    accountRepo().create({
      login,
      passwordHash: await hashPassword(password),
      nickname: (input.nickname || '').trim() || null,
      email: null,
      phone: null,
      status: 1,
      lockCount: 0,
      lockedUntil: null,
      everEnterprise: 1,
      role: 3,
      enterpriseId: ctx.enterprise.id,
      lastLoginAt: null,
      lastLoginIp: null,
    })
  );
  const member = await memberRepo().save(
    memberRepo().create({
      enterpriseId: ctx.enterprise.id,
      accountId: account.id,
      role: 2,
      hint: (input.hint || '').trim() || null,
      remark: (input.remark || '').trim() || null,
      status: 1,
    })
  );
  await writeOperationLog(admin.id, 'team.member.create', account.login, `企业 ${ctx.enterprise.code} 创建子账户`, input.ip || '');
  return {
    id: member.id,
    accountId: account.id,
    login,
    password,
    nickname: account.nickname,
    hint: member.hint,
    seats: ctx.enterprise.seats,
    usedSeats: used + 1,
  };
}

async function getMemberOf(ctx: EnterpriseContext, memberId: string): Promise<EnterpriseMember> {
  const member = await memberRepo().findOneBy({ id: memberId, enterpriseId: ctx.enterprise.id });
  if (!member) throw new ApiError('成员不存在或不属于本企业', 4004, 403);
  return member;
}

export async function updateTeamMember(
  admin: Account,
  ctx: EnterpriseContext,
  memberId: string,
  input: { nickname?: string; hint?: string; remark?: string; status?: number; ip?: string }
): Promise<void> {
  const member = await getMemberOf(ctx, memberId);
  if (member.role === 1) throw new ApiError('不能修改企业管理员资料', 4005);
  const account = await accountRepo().findOneBy({ id: member.accountId });
  if (!account) throw new ApiError('成员账号不存在', 4004);

  if (input.nickname !== undefined) account.nickname = input.nickname.trim() || null;
  if (input.status !== undefined && [1, 2].includes(input.status)) {
    member.status = input.status;
    account.status = input.status === 2 ? 2 : 1;
    if (input.status === 2) await revokeMemberSessions(member.accountId);
  }
  if (input.hint !== undefined) member.hint = input.hint.trim() || null;
  if (input.remark !== undefined) member.remark = input.remark.trim() || null;

  await accountRepo().save(account);
  await memberRepo().save(member);
  await writeOperationLog(admin.id, 'team.member.update', account.login, '更新成员资料', input.ip || '');
}

async function revokeMemberSessions(accountId: string): Promise<void> {
  await sessionRepo()
    .createQueryBuilder()
    .update(AccountSession)
    .set({ revokedAt: new Date() })
    .where('account_id = :accountId AND revoked_at IS NULL', { accountId })
    .execute();
}

export async function resetTeamMemberPassword(
  admin: Account,
  ctx: EnterpriseContext,
  memberId: string,
  ip?: string
): Promise<{ login: string; password: string }> {
  const member = await getMemberOf(ctx, memberId);
  const account = await accountRepo().findOneBy({ id: member.accountId });
  if (!account) throw new ApiError('成员账号不存在', 4004);
  const password = generateTempPassword();
  account.passwordHash = await hashPassword(password);
  account.lockCount = 0;
  account.lockedUntil = null;
  if (account.status === 3) account.status = 1;
  await accountRepo().save(account);
  await revokeMemberSessions(account.id);
  await writeOperationLog(admin.id, 'team.member.reset_password', account.login, '重置成员密码并吊销会话', ip || '');
  return { login: account.login, password };
}

export async function unlockTeamMember(
  admin: Account,
  ctx: EnterpriseContext,
  memberId: string,
  ip?: string
): Promise<void> {
  const member = await getMemberOf(ctx, memberId);
  const account = await accountRepo().findOneBy({ id: member.accountId });
  if (!account) throw new ApiError('成员账号不存在', 4004);
  account.lockCount = 0;
  account.lockedUntil = null;
  if (account.status === 3) account.status = 1;
  await accountRepo().save(account);
  await writeOperationLog(admin.id, 'team.member.unlock', account.login, '解锁成员账号', ip || '');
}

export async function deleteTeamMember(
  admin: Account,
  ctx: EnterpriseContext,
  memberId: string,
  ip?: string
): Promise<void> {
  const member = await getMemberOf(ctx, memberId);
  if (member.role === 1) throw new ApiError('企业管理员不可删除', 4005);

  // 使用中（status=2）拒绝并返回占用清单；已分配未使用（status=1）随成员删除回收
  const assignments = await AppDataSource.getRepository(IpAssignment)
    .createQueryBuilder('ia')
    .where('ia.member_account_id = :accountId', { accountId: member.accountId })
    .andWhere('ia.status IN (1, 2)')
    .getMany();
  const inUse = assignments.filter((a) => a.status === 2);
  if (inUse.length) {
    const resources = await AppDataSource.getRepository(IpResource)
      .createQueryBuilder('r')
      .where('r.id IN (:...ids)', { ids: inUse.map((a) => a.resourceId) })
      .getMany();
    const resourceMap = new Map(resources.map((r) => [String(r.id), r]));
    const occupied = inUse.map((a) => {
      const r = resourceMap.get(String(a.resourceId));
      return {
        resourceId: a.resourceId,
        proxyType: r?.proxyType || '',
        host: r?.host || '',
        port: r?.port || 0,
        username: r?.username || '',
        envName: a.envName,
      };
    });
    throw new ApiError(
      `该成员仍有 ${inUse.length} 个 IP 资源使用中，请先回收后再删除`,
      4006,
      200,
      { occupied }
    );
  }
  if (assignments.length) {
    for (const a of assignments) {
      a.status = 3;
      a.releasedAt = new Date();
      a.releaseReason = '成员删除回收';
      await AppDataSource.getRepository(IpAssignment).save(a);
    }
  }

  member.status = 3;
  await memberRepo().save(member);
  const account = await accountRepo().findOneBy({ id: member.accountId });
  if (account) {
    account.status = 2;
    await accountRepo().save(account);
  }
  await revokeMemberSessions(member.accountId);
  await writeOperationLog(admin.id, 'team.member.delete', account?.login || member.accountId, '删除成员并释放席位', ip || '');
}

/** 企业信息（客户端团队面板展示） */
export async function getEnterpriseInfo(account: Account): Promise<{
  id: string;
  code: string;
  name: string;
  seats: number;
  usedSeats: number;
  expireAt: Date | null;
  role: number;
} | null> {
  if (!account.enterpriseId) return null;
  const ent = await enterpriseRepo().findOneBy({ id: account.enterpriseId });
  if (!ent) return null;
  const member = await memberRepo().findOneBy({ enterpriseId: ent.id, accountId: account.id });
  const usedSeats = await memberRepo().countBy({ enterpriseId: ent.id, status: 1 });
  return {
    id: ent.id,
    code: ent.code,
    name: ent.name,
    seats: ent.seats,
    usedSeats,
    expireAt: ent.expireAt,
    role: member?.role || 2,
  };
}

/** 设备列表辅助（团队成员上下线状态用） */
export async function latestActiveAt(accountId: string): Promise<Date | null> {
  const row = await deviceRepo()
    .createQueryBuilder('d')
    .select('MAX(d.last_active_at)', 'lastActiveAt')
    .where('d.account_id = :accountId', { accountId })
    .getRawOne<{ lastActiveAt: string | null }>();
  return row?.lastActiveAt ? new Date(row.lastActiveAt) : null;
}
