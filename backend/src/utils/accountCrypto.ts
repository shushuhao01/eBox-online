import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

/**
 * 账号体系密码学工具（M0）
 * - 密码哈希：bcrypt
 * - 会话 token：随机 32 字节，仅存 SHA-256 哈希
 * - IP 代理密码：AES-256-GCM（密钥由服务端密钥派生，不落库明文）
 * - 重置码：6 位数字，仅存哈希
 */

const BCRYPT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(plain, hash);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateResetCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export function hashResetCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/** 一次性临时密码（企业子账户创建/重置）：10 位，含大小写字母与数字 */
export function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (pool: string) => pool[crypto.randomInt(0, pool.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(upper), pick(digits)];
  for (let i = 0; i < 5; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function secretKey(): Buffer {
  const raw = process.env.ACCOUNT_SECRET_KEY || env.jwtSecret || 'ebox-account-secret';
  // 固定盐派生 32 字节密钥，保证同一部署内可解密
  return crypto.scryptSync(raw, 'ebox-ip-resource-v1', 32);
}

/** AES-256-GCM 加密，返回 `v1:iv:tag:data`（均为 hex） */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${data.toString('hex')}`;
}

/** 解密 `v1:iv:tag:data`；空串或格式异常返回空串 */
export function decryptSecret(encoded: string): string {
  if (!encoded || !encoded.startsWith('v1:')) return '';
  const parts = encoded.split(':');
  if (parts.length !== 4) return '';
  try {
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const data = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** 登录标识脱敏（个人中心展示用） */
export function maskLogin(login: string): string {
  if (!login) return '';
  if (login.includes('@')) {
    const [name, domain] = login.split('@');
    const head = name.slice(0, Math.min(2, name.length));
    return `${head}***@${domain}`;
  }
  if (/^\d{6,}$/.test(login)) {
    return `${login.slice(0, 3)}****${login.slice(-4)}`;
  }
  if (login.length <= 4) return `${login.slice(0, 1)}***`;
  return `${login.slice(0, 2)}***${login.slice(-2)}`;
}

/** 日志脱敏：地址按 a.b.*.* 掩码 */
export function maskHost(host: string): string {
  if (!host) return '';
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;
  const parts = host.split('.');
  if (parts.length >= 2) return `${parts[0]}.***`;
  return '***';
}
