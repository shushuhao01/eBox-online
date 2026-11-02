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

async function assertDeviceSlot(account: Account, deviceFp?: string): Promise<void> {
  const limit = await resolveSeatLimit(account);
  if (!limit || limit <= 0) return;
  const since = new Date(Date.now() - ONLINE_DEVICE_WINDOW_MINUTES * 60 * 1000);
  const qb = deviceRepo()
    .createQueryBuilder('d')
    .where('d.account_id = :accountId', { accountId: account.id })
    .andWhere('d.status = 1')
    .andWhere('d.last_active_at >= :since', { since });
  if (deviceFp) qb.andWhere('d.machine_fp <> :fp', { fp: deviceFp });
  const online = await qb.getCount();
  if (online >= limit) {
    throw new ApiError('在线设备已达席位上限，请在个人中心移除设备或购买席位', 1005);
  }
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

  await assertDeviceSlot(account, input.deviceFp);

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

  return { token, expiresAt, account };
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

export async function revokeAccountSessions(accountId: string): Promise<void> {
  await sessionRepo()
    .createQueryBuilder()
    .update(AccountSession)
    .set({ revokedAt: new Date() })
    .where('account_id = :accountId AND revoked_at IS NULL', { accountId })
    .execute();
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

/** 已登录修改密码（本人） */
export async function changePassword(account: Account, oldPassword: string, newPassword: string): Promise<void> {
  if (!(await verifyPassword(oldPassword, account.passwordHash))) {
    throw new ApiError('原密码错误', 1017);
  }
  if (oldPassword === newPassword) throw new ApiError('新密码不能与原密码相同', 1018);
  assertPasswordStrength(newPassword);
  account.passwordHash = await hashPassword(newPassword);
  await accountRepo().save(account);
  // 改密后吊销其他设备会话（保留当前会话由路由层决定，这里不处理）
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
  const account = await accountRepo().findOneBy({ login });
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
  const account = await accountRepo().findBy({ login }).then((list) => list[0] || null);
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
