import { AppDataSource } from '../config/database';
import { Account } from '../entities/account/Account';
import { AccountSession } from '../entities/account/AccountSession';
import { AccountDevice } from '../entities/account/AccountDevice';
import { Enterprise } from '../entities/account/Enterprise';
import { EnterpriseMember } from '../entities/account/EnterpriseMember';
import { LicenseKey } from '../entities/LicenseKey';
import { AgreementAcceptance } from '../entities/account/AgreementAcceptance';
import { AppConfig } from '../entities/account/AppConfig';
import { ApiError } from '../middleware/errorHandler';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashToken,
  maskLogin,
  generateResetCode,
  hashResetCode,
} from '../utils/accountCrypto';
import { loadSmtpConfig } from './SmtpConfigService';
import { sendTemplate, sendTemplateToEmail } from './NotifyService';
import { isValidMainlandPhone } from './AliyunSmsService';
import {
  consumeUnbindForAccountLogin,
  inspectAccountUnbind,
  accountUnbindQuotaError,
  AccountUnbindQuota,
} from './KeyService';
import { pushKick } from './AccountEventService';

const accountRepo = () => AppDataSource.getRepository(Account);
const sessionRepo = () => AppDataSource.getRepository(AccountSession);
const deviceRepo = () => AppDataSource.getRepository(AccountDevice);
const enterpriseRepo = () => AppDataSource.getRepository(Enterprise);
const memberRepo = () => AppDataSource.getRepository(EnterpriseMember);
const keyRepo = () => AppDataSource.getRepository(LicenseKey);
const agreementRepo = () => AppDataSource.getRepository(AgreementAcceptance);
const appConfigRepo = () => AppDataSource.getRepository(AppConfig);

export const SESSION_DAYS = 30;
export const MAX_LOGIN_FAILS = 5;
export const LOCK_MINUTES = 10;
const ONLINE_DEVICE_WINDOW_MINUTES = 30;

/** 手机号脱敏：138****1234 */
function maskPhone(phone: string): string {
  const p = String(phone || '').trim();
  if (p.length < 7) return p;
  return `${p.slice(0, 3)}****${p.slice(-4)}`;
}

export type AgreementType = 'user_agreement' | 'privacy_policy' | 'disclaimer';

export interface RegisterInput {
  login: string;
  password: string;
  nickname?: string;
  email?: string;
  phone?: string;
  agreementVersion?: number;
  deviceFp?: string;
  ip?: string;
}

export interface LoginInput {
  login: string;
  password: string;
  deviceFp?: string;
  deviceName?: string;
  os?: string;
  appVersion?: string;
  ip?: string;
  userAgent?: string;
  /** 个人席位换机确认：首次登录不带；用户确认后以 true 重发，才真正解绑/扣次数 */
  confirmSwitch?: boolean;
}

export function normalizeLogin(raw: string): string {
  const v = String(raw || '').trim();
  return v.includes('@') ? v.toLowerCase() : v;
}

export function isEmailLike(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export function isPhoneLike(v: string): boolean {
  return /^\d{6,20}$/.test(v);
}

/** 账号：3-32 位字母或数字（不含符号与中文） */
export function isAccountLike(v: string): boolean {
  return /^[A-Za-z0-9]{3,32}$/.test(v);
}

/** 昵称：汉字 / 字母 / 数字，1-32 位 */
export function isNicknameLike(v: string): boolean {
  return /^[\u4e00-\u9fa5A-Za-z0-9]{1,32}$/.test(v);
}

export function assertPasswordStrength(password: string): void {
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(password)) {
    throw new ApiError('密码需至少 8 位，且包含字母和数字', 1002);
  }
}

export async function recordAgreements(
  accountId: string,
  types: AgreementType[],
  version: number,
  deviceFp: string,
  ip: string
): Promise<void> {
  if (!types.length) return;
  const now = new Date();
  const rows = types.map((t) =>
    agreementRepo().create({
      accountId,
      agreementType: t,
      version: Math.max(1, Number(version) || 1),
      deviceFp: deviceFp || '',
      ip: ip || '',
      acceptedAt: now,
    })
  );
  await agreementRepo().save(rows);
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------
export async function registerAccount(input: RegisterInput): Promise<Account> {
  const login = normalizeLogin(input.login);
  if (!isAccountLike(login)) {
    throw new ApiError('账号需为 3-32 位字母或数字', 1003);
  }
  assertPasswordStrength(input.password);

  const nickname = String(input.nickname || '').trim();
  if (nickname && !isNicknameLike(nickname)) {
    throw new ApiError('昵称仅支持汉字、字母和数字', 1020);
  }
  const emailRaw = String(input.email || '').trim();
  if (emailRaw && !isEmailLike(emailRaw)) {
    throw new ApiError('请输入有效的邮箱地址', 1021);
  }
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  const phoneRaw = String(input.phone || '').trim();
  if (phoneRaw && !isPhoneLike(phoneRaw)) {
    throw new ApiError('请输入有效的手机号', 1022);
  }
  const phone = phoneRaw || null;

  // 账号唯一性：忽略大小写，避免与库内已有账号撞户
  const exists = await accountRepo()
    .createQueryBuilder('a')
    .where('LOWER(a.login) = LOWER(:login)', { login })
    .getOne();
  if (exists) throw new ApiError('该账号已被占用，请更换', 1004);

  const account = accountRepo().create({
    login,
    passwordHash: await hashPassword(input.password),
    nickname: nickname || null,
    email,
    phone,
    status: 1,
    lockCount: 0,
    lockedUntil: null,
    everEnterprise: 0,
    role: 1,
    enterpriseId: null,
    lastLoginAt: null,
    lastLoginIp: null,
  });
  const saved = await accountRepo().save(account);

  await recordAgreements(
    saved.id,
    ['user_agreement', 'privacy_policy'],
    input.agreementVersion ?? 1,
    input.deviceFp ?? '',
    input.ip ?? ''
  );
  const displayName = saved.nickname || login;
  // 注册成功通知（失败不影响注册主流程）
  void sendTemplate('REGISTER', { username: displayName, email: email || '' });
  // 管理员侧：新用户注册提醒
  void sendTemplate('ADMIN_ACCOUNT_REGISTERED', {
    username: displayName,
    login,
    account: login,
    email: email || '未填写',
    phone: phone || '未填写',
    ip: input.ip || '',
  });
  return saved;
}

// ---------------------------------------------------------------------------
// 登录（统一入口：个人 / 企业管理员 / 企业成员）
// ---------------------------------------------------------------------------
export interface LoginResult {
  token: string;
  expiresAt: Date;
  account: Account;
  /** 个人席位本月解绑配额（企业账号 / 无绑定卡密时不返回） */
  unbindUsed?: number;
  unbindLimit?: number;
  unbindRemaining?: number;
}

async function upsertDevice(accountId: string, input: LoginInput): Promise<void> {
  const fp = String(input.deviceFp || '').trim();
  if (!fp) return;
  const repo = deviceRepo();
  let device = await repo.findOneBy({ accountId, machineFp: fp });
  const now = new Date();
  if (!device) {
    device = repo.create({
      accountId,
      machineFp: fp,
      deviceName: input.deviceName?.trim() || null,
      osInfo: input.os?.trim() || null,
      appVersion: input.appVersion?.trim() || null,
      status: 1,
      firstLoginAt: now,
      lastActiveAt: now,
    });
  } else {
    device.status = 1;
    device.lastActiveAt = now;
    if (input.deviceName?.trim()) device.deviceName = input.deviceName.trim();
    if (input.os?.trim()) device.osInfo = input.os.trim();
    if (input.appVersion?.trim()) device.appVersion = input.appVersion.trim();
    if (!device.firstLoginAt) device.firstLoginAt = now;
  }
  await repo.save(device);
}

async function resolveSeatLimit(account: Account): Promise<number> {
  if (account.enterpriseId) {
    const ent = await enterpriseRepo().findOneBy({ id: account.enterpriseId });
    return ent?.seats || 0;
  }
  const key = await keyRepo()
    .createQueryBuilder('k')
    .where('k.account_id = :accountId', { accountId: account.id })
    .andWhere('k.status = 1')
    .orderBy('k.activated_at', 'DESC')
    .limit(1)
    .getOne();
  return key?.seats || 0;
}

/**
 * 登录占位：
 * - 个人账号：按卡密绑定的设备换机——新机器登录时解绑旧机器（旧机器是否退出/在线都不影响），
 *   并扣减本月解绑次数；同一台机器重复登录不扣次数。
 *   换机需要用户确认：首次登录只做检查并抛 DEVICE_SWITCH_REQUIRED，用户确认后带
 *   confirmSwitch=true 重发才真正解绑/扣次数。次数用尽时抛错，登录页直接展示提示文案。
 * - 企业账号：按购买席位管理（在线设备超席位时踢最久未活跃的），不占解绑额度。
 */
async function claimDeviceSlot(
  account: Account,
  input: LoginInput
): Promise<AccountUnbindQuota | null> {
  const fp = String(input.deviceFp || '').trim();
  const kickFps = new Set<string>();
  let quota: AccountUnbindQuota | null = null;

  if (account.enterpriseId) {
    const limit = await resolveSeatLimit(account);
    const since = new Date(Date.now() - ONLINE_DEVICE_WINDOW_MINUTES * 60 * 1000);
    const qb = deviceRepo()
      .createQueryBuilder('d')
      .where('d.account_id = :accountId', { accountId: account.id })
      .andWhere('d.status = 1')
      .andWhere('d.last_active_at >= :since', { since });
    if (fp) qb.andWhere('d.machine_fp <> :fp', { fp });
    const others = await qb.orderBy('d.last_active_at', 'ASC').getMany();
    const excess = limit > 0 ? others.length - limit + 1 : 0;
    if (excess > 0) others.slice(0, excess).forEach((d) => kickFps.add(d.machineFp));
  } else {
    // 个人账号：以卡密设备绑定为准，换机即扣一次本月解绑额度
    const res = await consumeUnbindForAccountLogin(account.id, fp ? [fp] : [], {
      ip: input.ip,
      appVersion: input.appVersion,
    });
    if (res) {
      quota = {
        unbindUsed: res.used,
        unbindLimit: res.max,
        unbindRemaining: res.max === -1 ? -1 : Math.max(0, res.max - res.used),
      };
    }
    res?.unboundFps.forEach((f) => kickFps.add(f));
  }

  if (kickFps.size === 0) return quota;

  const now = new Date();
  for (const victimFp of kickFps) {
    await deviceRepo()
      .createQueryBuilder()
      .update(AccountDevice)
      .set({ status: 0 })
      .where('account_id = :accountId', { accountId: account.id })
      .andWhere('machine_fp = :fp', { fp: victimFp })
      .andWhere('status = 1')
      .execute();
    await sessionRepo()
      .createQueryBuilder()
      .update(AccountSession)
      .set({ revokedAt: now })
      .where('account_id = :accountId', { accountId: account.id })
      .andWhere('machine_fp = :fp', { fp: victimFp })
      .andWhere('revoked_at IS NULL')
      .execute();
    pushKick(account.id, '您的账号已在新设备登录，本机已自动下线', victimFp);
  }
  return quota;
}

/** 按 用户名 / 邮箱 / 手机号 定位账号（登录统一入口）。 */
async function findAccountByIdentifier(identifier: string): Promise<Account | null> {
  const account = await accountRepo().findOneBy({ login: identifier });
  if (account) return account;
  if (identifier.includes('@')) {
    const byEmail = await accountRepo()
      .createQueryBuilder('a')
      .where('LOWER(a.email) = :email', { email: identifier.toLowerCase() })
      .getOne();
    if (byEmail) return byEmail;
  }
  if (isValidMainlandPhone(identifier)) {
    const byPhone = await accountRepo().findOneBy({ phone: identifier });
    if (byPhone) return byPhone;
  }
  return null;
}

/** 手机号是否已被其他账号占用。 */
export async function isPhoneTaken(phone: string, exceptAccountId?: string): Promise<boolean> {
  const found = await accountRepo().findOneBy({ phone });
  if (!found) return false;
  return String(found.id) !== String(exceptAccountId || '');
}

export async function loginAccount(input: LoginInput): Promise<LoginResult> {
  const login = normalizeLogin(input.login);
  const account = await findAccountByIdentifier(login);
  // 统一文案防枚举
  const invalid = new ApiError('账号或密码错误', 1001);

  if (!account) {
    // 固定合法 bcrypt 哈希，做一次等价耗时校验，避免时间侧信道枚举账号
    await verifyPassword(input.password, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
    throw invalid;
  }

  if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
    const mins = Math.max(1, Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60000));
    throw new ApiError(`账号已锁定，请 ${mins} 分钟后再试或联系管理员解锁`, 1006);
  }
  // 锁定期已过：自动恢复
  if (account.lockedUntil && account.lockedUntil.getTime() <= Date.now()) {
    account.lockedUntil = null;
    account.lockCount = 0;
    if (account.status === 3) account.status = 1;
  }
  if (account.status === 2) throw new ApiError('账号已停用，请联系管理员', 1007);
  if (account.status === 3) account.status = 1;

  const okPwd = await verifyPassword(input.password, account.passwordHash);
  if (!okPwd) {
    account.lockCount = (account.lockCount || 0) + 1;
    if (account.lockCount >= MAX_LOGIN_FAILS) {
      account.lockCount = MAX_LOGIN_FAILS;
      account.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      account.status = 3;
    }
    await accountRepo().save(account);
    if (account.lockCount >= MAX_LOGIN_FAILS) {
      void sendTemplate('ADMIN_ACCOUNT_LOCKED', {
        username: account.nickname || account.login,
        login: account.login,
        account: account.login,
        minutes: LOCK_MINUTES,
        ip: input.ip || '',
      });
    }
    throw invalid;
  }

  // 换机两步协议：先检查是否需要换机，未确认时不解绑、不扣次数、不踢人
  const fp = String(input.deviceFp || '').trim();
  if (!account.enterpriseId) {
    const inspection = await inspectAccountUnbind(account.id, fp ? [fp] : []);
    if (inspection && inspection.cost > 0) {
      if (!inspection.allowed) throw accountUnbindQuotaError(inspection);
      // 只有客户端显式传 false 才进入二次确认；未传该字段视为旧客户端，保持原有自动换机行为
      if (input.confirmSwitch === false) {
        const target = inspection.oldDeviceNames[0]
          ? `旧设备「${inspection.oldDeviceNames[0]}」`
          : '原设备';
        throw new ApiError(
          `检测到新设备登录，继续将解绑${target}并消耗 ${inspection.cost} 次本月解绑次数，是否继续？`,
          1023,
          200,
          {
            code: 'DEVICE_SWITCH_REQUIRED',
            unbindUsed: inspection.unbindUsed,
            unbindLimit: inspection.unbindLimit,
            unbindRemaining: inspection.unbindRemaining,
            switchCost: inspection.cost,
            oldDeviceName: inspection.oldDeviceNames[0] || '',
            oldDeviceCount: inspection.victimFps.length,
          }
        );
      }
    }
  }

  const quota = await claimDeviceSlot(account, input);

  account.lockCount = 0;
  account.lockedUntil = null;
  if (account.status === 3) account.status = 1;
  account.lastLoginAt = new Date();
  account.lastLoginIp = input.ip || null;
  await accountRepo().save(account);

  await upsertDevice(account.id, input);

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sessionRepo().save(
    sessionRepo().create({
      accountId: account.id,
      tokenHash: hashToken(token),
      machineFp: input.deviceFp?.trim() || null,
      clientIp: input.ip || null,
      userAgent: input.userAgent?.slice(0, 255) || null,
      expiresAt,
      lastSeenAt: new Date(),
    })
  );

  const result: LoginResult = { token, expiresAt, account };
  if (quota) {
    result.unbindUsed = quota.unbindUsed;
    result.unbindLimit = quota.unbindLimit;
    result.unbindRemaining = quota.unbindRemaining;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
export async function authenticateToken(token: string): Promise<{ account: Account; session: AccountSession } | null> {
  if (!token) return null;
  const session = await sessionRepo().findOneBy({ tokenHash: hashToken(token) });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  const account = await accountRepo().findOneBy({ id: session.accountId });
  if (!account || account.status === 2) return null;

  // 轻量续期：最后活跃时间最多每分钟写一次
  const last = session.lastSeenAt ? session.lastSeenAt.getTime() : 0;
  if (Date.now() - last > 60 * 1000) {
    session.lastSeenAt = new Date();
    await sessionRepo().save(session);
  }
  return { account, session };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await sessionRepo().update({ id: sessionId }, { revokedAt: new Date() });
}

/** 吊销账号会话；传 keepSessionId 时保留当前会话（用于本人改密后保持登录） */
export async function revokeAccountSessions(accountId: string, keepSessionId?: string): Promise<void> {
  const qb = sessionRepo()
    .createQueryBuilder()
    .update(AccountSession)
    .set({ revokedAt: new Date() })
    .where('account_id = :accountId AND revoked_at IS NULL', { accountId });
  if (keepSessionId) qb.andWhere('id != :keepSessionId', { keepSessionId });
  await qb.execute();
}

// ---------------------------------------------------------------------------
// 设备
// ---------------------------------------------------------------------------
export async function listDevices(accountId: string): Promise<AccountDevice[]> {
  return deviceRepo().find({
    where: { accountId, status: 1 },
    order: { lastActiveAt: 'DESC' },
  });
}

export async function removeDevice(accountId: string, deviceId: string): Promise<void> {
  const device = await deviceRepo().findOneBy({ id: deviceId, accountId });
  if (!device) throw new ApiError('设备不存在', 1008);
  device.status = 0;
  await deviceRepo().save(device);
  await sessionRepo()
    .createQueryBuilder()
    .update(AccountSession)
    .set({ revokedAt: new Date() })
    .where('account_id = :accountId AND machine_fp = :fp AND revoked_at IS NULL', {
      accountId,
      fp: device.machineFp,
    })
    .execute();
}

// ---------------------------------------------------------------------------
// 资料
// ---------------------------------------------------------------------------
export interface ProfilePayload {
  id: string;
  login: string;
  loginMasked: string;
  nickname: string | null;
  email: string | null;
  phoneMasked: string | null;
  role: number;
  status: number;
  everEnterprise: boolean;
  enterpriseId: string | null;
  enterpriseCode: string | null;
  enterpriseName: string | null;
  enterpriseSeats: number | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export async function getProfile(account: Account): Promise<ProfilePayload> {
  let enterpriseCode: string | null = null;
  let enterpriseName: string | null = null;
  let enterpriseSeats: number | null = null;
  if (account.enterpriseId) {
    const ent = await enterpriseRepo().findOneBy({ id: account.enterpriseId });
    if (ent) {
      enterpriseCode = ent.code;
      enterpriseName = ent.name;
      enterpriseSeats = ent.seats;
    }
  }
  const member = account.enterpriseId
    ? await memberRepo().findOneBy({ accountId: account.id, enterpriseId: account.enterpriseId })
    : null;
  const role = member ? (member.role === 1 ? 2 : 3) : account.role;
  return {
    id: account.id,
    login: account.login,
    loginMasked: maskLogin(account.login),
    nickname: account.nickname,
    email: account.email ? maskLogin(account.email) : null,
    phoneMasked: account.phone ? maskPhone(account.phone) : null,
    role,
    status: account.status,
    everEnterprise: account.everEnterprise === 1,
    enterpriseId: account.enterpriseId,
    enterpriseCode,
    enterpriseName,
    enterpriseSeats,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
  };
}

// ---------------------------------------------------------------------------
// 账号配置（app_configs）
// ---------------------------------------------------------------------------
export async function getAppConfigValue(key: string): Promise<string> {
  const row = await appConfigRepo().findOneBy({ cfgKey: key });
  return row?.cfgValue ?? '';
}

export interface ClientConfigPayload {
  disclaimerVersion: number;
  upgradeLinks: Record<string, string>;
  seatAddonMallUrl: string;
  ipResourceVersion: number;
}

export async function getClientConfig(): Promise<ClientConfigPayload> {
  const [linksRaw, disclaimerRaw, ipVersionRaw, seatAddonMallUrl] = await Promise.all([
    getAppConfigValue('upgrade_links'),
    getAppConfigValue('disclaimer_version'),
    getAppConfigValue('ip_resource_version'),
    getAppConfigValue('seat_addon_mall_url'),
  ]);
  let upgradeLinks: Record<string, string> = {};
  if (linksRaw) {
    try {
      const parsed = JSON.parse(linksRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        upgradeLinks = parsed as Record<string, string>;
      }
    } catch {
      upgradeLinks = {};
    }
  }
  return {
    disclaimerVersion: Math.max(1, Number(disclaimerRaw) || 1),
    upgradeLinks,
    seatAddonMallUrl,
    ipResourceVersion: Math.max(1, Number(ipVersionRaw) || 1),
  };
}

// ---------------------------------------------------------------------------
// 密码：已登录修改 / 邮箱重置码找回
// ---------------------------------------------------------------------------
export const RESET_CODE_MINUTES = 10;
export const RESET_CODE_MAX_ATTEMPTS = 5;

export interface ResetRequestResult {
  sent: boolean;
  expireMinutes: number;
}

/** 已登录修改密码（本人）；keepSessionId 为当前会话，保留登录状态，其余设备全部下线 */
export async function changePassword(
  account: Account,
  oldPassword: string,
  newPassword: string,
  keepSessionId?: string
): Promise<void> {
  if (!(await verifyPassword(oldPassword, account.passwordHash))) {
    throw new ApiError('原密码错误', 1017);
  }
  if (oldPassword === newPassword) throw new ApiError('新密码不能与原密码相同', 1018);
  assertPasswordStrength(newPassword);
  account.passwordHash = await hashPassword(newPassword);
  await accountRepo().save(account);
  // 改密后吊销其他设备会话（保留当前会话，避免本人被立即踢下线）
  await revokeAccountSessions(account.id, keepSessionId);
  void sendTemplate('PASSWORD_CHANGED', { username: account.nickname || account.login });
}

/**
 * 发送 6 位邮箱重置码（10 分钟有效、最多 5 次尝试）。
 * - 未配置 SMTP：直接返回“联系客服”提示（不区分账号是否存在，避免枚举）
 * - 账号不存在 / 无邮箱：静默返回 sent=true，防止账号枚举
 */
export async function requestPasswordReset(input: { login: string; ip?: string }): Promise<ResetRequestResult> {
  const smtp = await loadSmtpConfig();
  if (!smtp) {
    throw new ApiError('当前未配置邮件服务，请联系客服重置密码', 1013);
  }
  const login = normalizeLogin(input.login);
  // 客户端支持用户名 / 邮箱 / 手机号登录，找回密码也必须按同一规则定位账号，
  // 否则用邮箱或手机号会静默返回“已发送”却永远收不到验证码。
  const account = await findAccountByIdentifier(login);
  const email = account?.email || (account && isEmailLike(login) ? login : null);
  if (!account || !email) return { sent: true, expireMinutes: RESET_CODE_MINUTES };

  const code = generateResetCode();
  account.resetCodeHash = hashResetCode(code);
  account.resetCodeExpire = new Date(Date.now() + RESET_CODE_MINUTES * 60 * 1000);
  account.resetCodeAttempts = 0;
  await accountRepo().save(account);

  try {
    await sendTemplateToEmail('PASSWORD_RESET_CODE', email, {
      username: account.nickname || maskLogin(login),
      code,
      minutes: RESET_CODE_MINUTES,
    });
  } catch (e) {
    // 发送失败不保留验证码，避免用户拿到一个“已发送但收不到”的码
    account.resetCodeHash = null;
    account.resetCodeExpire = null;
    account.resetCodeAttempts = 0;
    await accountRepo().save(account);
    throw new ApiError(`验证码发送失败：${(e as Error).message || '请稍后重试'}`, 1014);
  }
  return { sent: true, expireMinutes: RESET_CODE_MINUTES };
}

/** 重置码 + 新密码；成功后清空重置码、解锁账号并吊销全部会话 */
export async function resetPasswordByCode(input: { login: string; code: string; newPassword: string }): Promise<void> {
  const login = normalizeLogin(input.login);
  // 与找回密码入口保持一致：用户名 / 邮箱 / 手机号都能重置
  const account = await findAccountByIdentifier(login);
  const invalid = new ApiError('重置码无效或已过期，请重新获取', 1015);
  if (!account || !account.resetCodeHash || !account.resetCodeExpire) throw invalid;

  if (account.resetCodeExpire.getTime() <= Date.now()) {
    account.resetCodeHash = null;
    account.resetCodeExpire = null;
    account.resetCodeAttempts = 0;
    await accountRepo().save(account);
    throw invalid;
  }
  if (account.resetCodeAttempts >= RESET_CODE_MAX_ATTEMPTS) {
    throw new ApiError('尝试次数过多，请重新获取重置码', 1016);
  }
  if (hashResetCode(input.code.trim()) !== account.resetCodeHash) {
    account.resetCodeAttempts = (account.resetCodeAttempts || 0) + 1;
    await accountRepo().save(account);
    throw new ApiError('重置码不正确', 1015);
  }

  assertPasswordStrength(input.newPassword);
  account.passwordHash = await hashPassword(input.newPassword);
  account.resetCodeHash = null;
  account.resetCodeExpire = null;
  account.resetCodeAttempts = 0;
  account.lockCount = 0;
  account.lockedUntil = null;
  if (account.status === 3) account.status = 1;
  await accountRepo().save(account);
  await revokeAccountSessions(account.id);
  const displayName = account.nickname || account.login;
  // 用户侧：密码已重置；管理员侧：安全提醒
  void sendTemplate('PASSWORD_RESET_SUCCESS', { username: displayName, email: account.email || '' });
  void sendTemplate('ADMIN_PASSWORD_RESET', {
    username: displayName,
    login: account.login,
    account: account.login,
    email: account.email || '未填写',
  });
}
