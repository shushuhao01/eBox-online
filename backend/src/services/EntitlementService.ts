import { AppDataSource } from '../config/database';
import { Account } from '../entities/account/Account';
import { Enterprise } from '../entities/account/Enterprise';
import { EnterpriseMember } from '../entities/account/EnterpriseMember';
import { LicenseKey } from '../entities/LicenseKey';
import { Sku } from '../entities/account/Sku';

/**
 * 统一权益计算（唯一出口）
 * 客户端只按 caps 渲染，禁止散落版本判断。
 * 数据来源：账号归属 + 生效卡密（到期最晚）+ 企业席位。
 */

export interface EntitlementCaps {
  maxEnvs: number;
  proxy: boolean;
  importExport: boolean;
  cloudBackup: boolean;
  teamManage: boolean;
  ipResources: boolean;
}

export interface EntitlementTier {
  code: string;
  duration: string;
  label: string;
}

export interface Entitlements {
  version: 'none' | 'personal' | 'enterprise';
  level: 'none' | 'normal' | 'pro';
  role: 'user' | 'admin' | 'member';
  expireAt: string | null;
  permanent: boolean;
  seats: number;
  tier: EntitlementTier | null;
  caps: EntitlementCaps;
  entitlementsVersion: string;
  activeKeyId: string | null;
}

const keyRepo = () => AppDataSource.getRepository(LicenseKey);
const enterpriseRepo = () => AppDataSource.getRepository(Enterprise);
const memberRepo = () => AppDataSource.getRepository(EnterpriseMember);
const skuRepo = () => AppDataSource.getRepository(Sku);

const NONE_CAPS: EntitlementCaps = {
  maxEnvs: 0,
  proxy: false,
  importExport: false,
  cloudBackup: false,
  teamManage: false,
  ipResources: false,
};

/** 卡密真实到期（Unix 秒；0=永久） */
export function keyExpireSeconds(key: LicenseKey): number {
  // 账号体系续费顺延后的权威到期时间（可空，兼容存量卡密）
  const override = (key as LicenseKey & { accountExpireAt?: Date | null }).accountExpireAt;
  if (override) return Math.floor(override.getTime() / 1000);
  if (key.type === 2) return Number(key.expireAt || 0);
  if (key.durationSec === '0') return 0;
  const base = key.usedAt ? Math.floor(key.usedAt.getTime() / 1000) : Math.floor(Date.now() / 1000);
  return base + Number(key.durationSec || 0);
}

/** 0 表示永久 */
export function keyIsPermanent(key: LicenseKey): boolean {
  if (key.type === 2) return false;
  return key.durationSec === '0';
}

function isKeyExpired(key: LicenseKey, nowSec: number): boolean {
  if (key.status !== 1) return true;
  if (keyIsPermanent(key)) return false;
  const exp = keyExpireSeconds(key);
  return exp > 0 && exp < nowSec;
}

/** 账号可用的生效卡密（个人卡按 account_id；企业卡按 enterprise_id 或企业主账号） */
export async function findActiveKeys(account: Account): Promise<LicenseKey[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  let keys: LicenseKey[] = [];
  if (account.enterpriseId) {
    const ent = await enterpriseRepo().findOneBy({ id: account.enterpriseId });
    if (ent) {
      keys = await keyRepo()
        .createQueryBuilder('k')
        .where('k.enterprise_id = :entId', { entId: ent.id })
        .andWhere('k.status = 1')
        .getMany();
    }
  }
  if (!keys.length) {
    keys = await keyRepo()
      .createQueryBuilder('k')
      .where('k.account_id = :accountId', { accountId: account.id })
      .andWhere('k.status = 1')
      .getMany();
  }
  return keys
    .filter((k) => !isKeyExpired(k, nowSec))
    .sort((a, b) => {
      const ea = keyIsPermanent(a) ? Number.MAX_SAFE_INTEGER : keyExpireSeconds(a);
      const eb = keyIsPermanent(b) ? Number.MAX_SAFE_INTEGER : keyExpireSeconds(b);
      return eb - ea;
    });
}

/** 当前生效卡密（到期最晚）；无有效卡密返回 null */
export async function findEffectiveKey(account: Account): Promise<LicenseKey | null> {
  const list = await findActiveKeys(account);
  return list[0] ?? null;
}

/** 企业主账号可看到企业卡（用于我的卡密列表） */
export async function findEnterpriseKey(account: Account): Promise<LicenseKey | null> {
  if (!account.enterpriseId) return null;
  return keyRepo()
    .createQueryBuilder('k')
    .where('k.enterprise_id = :entId', { entId: account.enterpriseId })
    .andWhere('k.status = 1')
    .orderBy('k.activated_at', 'DESC')
    .limit(1)
    .getOne();
}

function capsFor(version: 1 | 2, level: 1 | 2, role: 'user' | 'admin' | 'member'): EntitlementCaps {
  const pro = level === 2;
  if (version === 1) {
    return {
      maxEnvs: pro ? 20 : 5,
      proxy: pro,
      importExport: pro,
      cloudBackup: pro,
      teamManage: false,
      ipResources: pro,
    };
  }
  return {
    maxEnvs: pro ? 50 : 20,
    proxy: pro,
    importExport: pro,
    cloudBackup: pro,
    teamManage: role === 'admin',
    ipResources: role === 'admin' && pro,
  };
}

/** SKU 的 caps_json 覆盖（只允许覆盖已定义的布尔/数值项，非法值忽略） */
function capsFromSku(sku: Sku | null, base: EntitlementCaps): EntitlementCaps {
  if (!sku || !sku.capsJson) return base;
  try {
    const raw = JSON.parse(sku.capsJson) as Record<string, unknown>;
    const caps: EntitlementCaps = { ...base };
    if (typeof raw.maxEnvs === 'number' && Number.isFinite(raw.maxEnvs) && raw.maxEnvs >= 0) {
      caps.maxEnvs = Math.floor(raw.maxEnvs);
    }
    for (const key of ['proxy', 'importExport', 'cloudBackup', 'teamManage', 'ipResources'] as const) {
      if (typeof raw[key] === 'boolean') caps[key] = raw[key] as boolean;
    }
    return caps;
  } catch {
    return base;
  }
}

function tierFromKey(key: LicenseKey | null): EntitlementTier | null {
  if (!key) return null;
  const duration = key.durationDays === 0 ? 'permanent' : key.durationDays >= 365 ? 'year' : key.durationDays >= 90 ? 'quarter' : 'month';
  return {
    code: key.tierCode || `${key.tier === 2 ? 'ent' : 'per'}_${key.level === 2 ? 'pro' : 'normal'}_${duration}`,
    duration,
    label: key.tierCode || '',
  };
}

export async function getEntitlements(account: Account): Promise<Entitlements> {
  const role: 'user' | 'admin' | 'member' = account.enterpriseId
    ? (await memberRepo().findOneBy({ accountId: account.id, enterpriseId: account.enterpriseId }))?.role === 1
      ? 'admin'
      : 'member'
    : 'user';

  const key = await findEffectiveKey(account);
  if (!key) {
    return {
      version: 'none',
      level: 'none',
      role,
      expireAt: null,
      permanent: false,
      seats: 0,
      tier: null,
      caps: { ...NONE_CAPS },
      entitlementsVersion: `none:${role}`,
      activeKeyId: null,
    };
  }

  let seats = key.seats || 0;
  let expireSec = keyExpireSeconds(key);
  let permanent = keyIsPermanent(key);
  if (account.enterpriseId) {
    const ent = await enterpriseRepo().findOneBy({ id: account.enterpriseId });
    if (ent) {
      seats = ent.seats || seats;
      if (ent.expireAt) expireSec = Math.floor(ent.expireAt.getTime() / 1000);
    }
  }

  // 优先使用 SKU 标签（后台配置），缺失时回退由卡密推导
  let tier = tierFromKey(key);
  let sku: Sku | null = null;
  if (key.skuId) {
    sku = await skuRepo().findOneBy({ id: key.skuId });
    if (sku) {
      tier = { code: sku.code, duration: sku.duration, label: sku.label };
    }
  }

  const version: 1 | 2 = key.tier === 2 ? 2 : 1;
  const level: 1 | 2 = key.level === 2 ? 2 : 1;
  const caps = capsFromSku(sku, capsFor(version, level, role));
  const expireAt = permanent ? null : new Date(expireSec * 1000).toISOString();
  const versionKey = `k${key.id}:${version}:${level}:${seats}:${permanent ? 'inf' : expireSec}:${role}`;
  return {
    version: version === 2 ? 'enterprise' : 'personal',
    level: level === 2 ? 'pro' : 'normal',
    role,
    expireAt,
    permanent,
    seats,
    tier,
    caps,
    entitlementsVersion: versionKey,
    activeKeyId: key.id,
  };
}
