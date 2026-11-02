import { AppDataSource } from '../config/database';
import { Account } from '../entities/account/Account';
import { LicenseKey } from '../entities/LicenseKey';
import { Sku } from '../entities/account/Sku';
import { ApiError } from '../middleware/errorHandler';
import { decodeAndVerify } from '../crypto/licenseCodec';
import { clientActivate, findByCode } from './KeyService';
import {
  getEntitlements,
  findEffectiveKey,
  keyExpireSeconds,
  keyIsPermanent,
  type Entitlements,
} from './EntitlementService';
import { recordAgreements } from './AccountService';
import { openEnterpriseForActivation } from './EnterpriseService';
import { writeOperationLog } from './LogService';
import { sendTemplate } from './NotifyService';

const keyRepo = () => AppDataSource.getRepository(LicenseKey);
const skuRepo = () => AppDataSource.getRepository(Sku);

export interface ActivateAccountInput {
  code: string;
  machineFp: string;
  mode?: 'renew' | 'upgrade';
  disclaimerVersion?: number;
  appVersion?: string;
  os?: string;
  ip?: string;
  clientTime?: number;
  enterpriseName?: string;
}

export interface KeySummary {
  id: string;
  codeMasked: string;
  tier: number;
  level: number;
  tierCode: string | null;
  seats: number;
  status: number;
  permanent: boolean;
  activatedAt: Date | null;
  expireAt: string | null;
  enterpriseId: string | null;
  replacedBy: string | null;
  current: boolean;
}

export function maskCode(code: string): string {
  if (!code) return '';
  if (code.length <= 14) return `${code.slice(0, 4)}****${code.slice(-2)}`;
  return `${code.slice(0, 8)}****${code.slice(-4)}`;
}

export function keyDurationDays(key: LicenseKey): number {
  if (key.durationDays > 0) return key.durationDays;
  const sec = Number(key.durationSec || 0);
  if (sec <= 0) return 0;
  return Math.max(1, Math.ceil(sec / 86400));
}

function keyExpireIso(key: LicenseKey): string | null {
  if (keyIsPermanent(key)) return null;
  const sec = keyExpireSeconds(key);
  return sec > 0 ? new Date(sec * 1000).toISOString() : null;
}

export function toKeySummary(key: LicenseKey, currentId: string | null): KeySummary {
  return {
    id: key.id,
    codeMasked: maskCode(key.code),
    tier: key.tier,
    level: key.level,
    tierCode: key.tierCode,
    seats: key.seats,
    status: key.status,
    permanent: keyIsPermanent(key),
    activatedAt: key.activatedAt || key.usedAt,
    expireAt: keyExpireIso(key),
    enterpriseId: key.enterpriseId,
    replacedBy: key.replacedBy,
    current: currentId === key.id,
  };
}

async function matchSku(tier: number, level: number, durationDays: number): Promise<Sku | null> {
  const list = await skuRepo().find({ where: { version: tier, level } });
  if (!list.length) return null;
  if (durationDays === 0) return list.find((s) => s.duration === 'permanent') || null;
  const duration = durationDays >= 365 ? 'year' : durationDays >= 90 ? 'quarter' : 'month';
  return list.find((s) => s.duration === duration) || null;
}

/** 当前账号是否为企业成员（非管理员） */
async function isEnterpriseMember(account: Account): Promise<boolean> {
  if (!account.enterpriseId) return false;
  const rows: Array<{ role: number }> = await AppDataSource.query(
    'SELECT role FROM enterprise_members WHERE enterprise_id = ? AND account_id = ? LIMIT 1',
    [account.enterpriseId, account.id]
  );
  return !rows.length || Number(rows[0].role) !== 1;
}

/** 企业是否已到期（到期期间拒绝核销扩容码/激活企业卡） */
async function enterpriseExpired(enterpriseId: string): Promise<boolean> {
  const rows: Array<{ expire_at: string | null }> = await AppDataSource.query(
    'SELECT expire_at FROM enterprises WHERE id = ? LIMIT 1',
    [enterpriseId]
  );
  if (!rows.length || !rows[0].expire_at) return false;
  return new Date(rows[0].expire_at).getTime() <= Date.now();
}

export interface ActivateAccountResult {
  entitlements: Entitlements;
  key: KeySummary;
  renewed: boolean;
  upgraded: boolean;
  enterpriseCode?: string | null;
}

export async function activateForAccount(account: Account, input: ActivateAccountInput): Promise<ActivateAccountResult> {
  if (await isEnterpriseMember(account)) {
    throw new ApiError('子账户不能激活卡密，请联系企业管理员', 2002);
  }
  const parsed = decodeAndVerify(input.code);
  if (!parsed) throw new ApiError('激活码无效', 1001);
  const key = await findByCode(input.code);
  if (!key) throw new ApiError('该卡密未在平台登记，无法绑定账号', 1009);
  if (key.accountId && key.accountId !== account.id) {
    throw new ApiError('该卡密已绑定其他账号', 1010);
  }
  if (key.status === 2 || key.status === 4 || key.status === 5) throw new ApiError('该卡密已作废或已失效', 1004);
  if (key.status === 3) throw new ApiError('该卡密已过期', 1004);

  const targetTier = key.tier === 2 ? 2 : 1;
  const targetLevel = key.level === 2 ? 2 : 1;
  const targetDays = keyDurationDays(key);
  const targetPermanent = targetTier === 1 && key.durationSec === '0' && key.type !== 2;

  // ===== 方向矩阵（需求 9.4）=====
  if (targetTier === 1) {
    if (account.everEnterprise === 1 || account.enterpriseId) {
      throw new ApiError('企业版不支持降级为个人版，请续费或升级企业版', 2003);
    }
  } else if (account.enterpriseId) {
    throw new ApiError('当前账号已属于企业，请通过席位扩容码增加席位', 2004);
  }

  const currentKey = await findEffectiveKey(account);
  const currentTier = currentKey ? (currentKey.tier === 2 ? 2 : 1) : 0;
  const currentLevel = currentKey ? (currentKey.level === 2 ? 2 : 1) : 0;
  if (currentKey) {
    if (currentLevel === 2 && targetLevel === 1) {
      throw new ApiError('高级版不支持降级，请续费高级或升级', 2005);
    }
    if (currentTier === 2 && targetTier === 1) {
      throw new ApiError('企业版不支持降级为个人版', 2003);
    }
    if (keyIsPermanent(currentKey) && !targetPermanent) {
      throw new ApiError('永久卡不支持被时长卡覆盖', 2006);
    }
  }
  if (account.enterpriseId && (await enterpriseExpired(account.enterpriseId))) {
    throw new ApiError('企业已到期，请先续费后再操作', 2007);
  }

  const upgraded = !!currentKey && (targetTier > currentTier || targetLevel > currentLevel);
  if (upgraded && input.mode !== 'upgrade') {
    const days = currentKey && !keyIsPermanent(currentKey)
      ? Math.max(0, Math.ceil((keyExpireSeconds(currentKey) * 1000 - Date.now()) / 86400000))
      : 0;
    throw new ApiError(
      `升级将覆盖当前卡密，剩余 ${days} 天不再折算，请确认后继续`,
      2001
    );
  }

  const isNewBinding = !key.accountId;
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date();

  // 续费顺延：同版本同级别取当前到期与当前时间的较大值 + 本卡时长；永久不再叠加
  let newExpireSec = 0;
  let permanent = false;
  if (targetPermanent) {
    permanent = true;
  } else if (isNewBinding && currentKey && !upgraded && currentTier === targetTier && currentLevel === targetLevel) {
    const base = keyIsPermanent(currentKey) ? nowSec : Math.max(nowSec, keyExpireSeconds(currentKey));
    newExpireSec = base + targetDays * 86400;
  } else {
    newExpireSec = nowSec + targetDays * 86400;
  }

  // 调用既有客户端激活链路：校验绑定关系、登记设备、写心跳流水（不改变旧逻辑）
  const activated = await clientActivate(input.code, input.machineFp, {
    ip: input.ip,
    os: input.os,
    appVersion: input.appVersion,
    clientTime: input.clientTime || nowSec,
  });
  if (activated.online === false) {
    // 未登记码已在上面拦截，这里仅作防御
    throw new ApiError('该卡密暂不支持账号激活，请联系客服', 1009);
  }
  if (activated.revoked) throw new ApiError('该卡密已作废', 1004);
  if (activated.expired) throw new ApiError('该卡密已过期', 1004);
  if (activated.exceeded) throw new ApiError('该卡密已在其他设备使用，请先解绑', 1011);

  // 覆盖升级：旧卡置为“已覆盖失效”并保留 replaced_by
  if (upgraded || (currentKey && currentTier === targetTier && currentLevel === targetLevel && key.accountId && key.id !== currentKey.id)) {
    const oldKeys = await keyRepo()
      .createQueryBuilder('k')
      .where('k.account_id = :accountId', { accountId: account.id })
      .andWhere('k.status = 1')
      .andWhere('k.id <> :newKeyId', { newKeyId: key.id })
      .getMany();
    for (const old of oldKeys) {
      old.status = 2;
      old.revokedAt = now;
      old.revokedReason = '覆盖升级';
      old.replacedBy = key.id;
      await keyRepo().save(old);
    }
    if (oldKeys.length) {
      // 审计：旧卡号、新卡号、账号、时间（时间由 operation_logs.created_at 记录）
      await writeOperationLog(
        account.id,
        'account.upgrade.cover',
        maskCode(key.code),
        `账号 ${account.login || account.id} 覆盖升级，旧卡 ${oldKeys.map((k) => maskCode(k.code)).join(',')} 已失效`,
        input.ip || ''
      );
    }
  }

  const sku = await matchSku(targetTier, targetLevel, targetDays);
  const seats = Math.max(1, Number(key.seats) || 1);

  key.accountId = account.id;
  key.tier = targetTier;
  key.level = targetLevel;
  key.tierCode = key.tierCode || sku?.code || null;
  key.skuId = key.skuId || sku?.id || null;
  key.durationDays = targetDays;
  key.seats = seats;
  key.activatedAt = key.activatedAt || now;
  key.accountExpireAt = permanent ? null : new Date(newExpireSec * 1000);
  await keyRepo().save(key);

  let enterpriseCode: string | null = null;
  if (targetTier === 2) {
    const result = await openEnterpriseForActivation(account, key, seats, permanent, newExpireSec, input.enterpriseName);
    enterpriseCode = result.code;
  }

  if (input.disclaimerVersion && input.disclaimerVersion > 0) {
    await recordAgreements(
      account.id,
      ['disclaimer'],
      input.disclaimerVersion,
      input.machineFp,
      input.ip || ''
    );
  }

  const freshAccount = (await AppDataSource.getRepository(Account).findOneBy({ id: account.id })) || account;
  const entitlements = await getEntitlements(freshAccount);
  // 激活 / 续费 / 升级通知（失败不影响激活主流程）
  const tierText = sku?.label || `${targetTier === 2 ? '企业版' : '个人版'}${targetLevel === 2 ? '高级' : '普通'}`;
  const expireText = permanent ? '永久有效' : new Date(newExpireSec * 1000).toISOString().slice(0, 10);
  void sendTemplate('LICENSE_ACTIVATED', {
    username: freshAccount.nickname || freshAccount.login,
    tier_text: tierText,
    expire_at: expireText,
  });
  return {
    entitlements,
    key: toKeySummary(key, key.id),
    renewed: !upgraded && !!currentKey,
    upgraded,
    enterpriseCode,
  };
}

export interface BindKeyInput {
  code: string;
  machineFp?: string;
  disclaimerVersion?: number;
  ip?: string;
}

/** 老用户把本机已有卡密绑到当前账号 */
export async function bindExistingKey(account: Account, input: BindKeyInput): Promise<ActivateAccountResult> {
  if (await isEnterpriseMember(account)) {
    throw new ApiError('子账户不能绑定卡密', 2002);
  }
  if (!decodeAndVerify(input.code)) throw new ApiError('激活码无效', 1001);
  const key = await findByCode(input.code);
  if (!key) throw new ApiError('该卡密未在平台登记，无法绑定账号', 1009);
  if (key.accountId && key.accountId !== account.id) throw new ApiError('该卡密已绑定其他账号', 1010);
  if (key.status !== 1) throw new ApiError('仅已激活使用的卡密可绑定账号', 1012);
  if (key.tier === 2 && account.enterpriseId) throw new ApiError('当前账号已属于企业', 2004);
  if (key.tier === 1 && account.enterpriseId) throw new ApiError('企业账号不能绑定个人卡密', 2003);

  key.accountId = account.id;
  key.tier = key.tier === 2 ? 2 : 1;
  key.level = key.level === 2 ? 2 : 1;
  key.durationDays = keyDurationDays(key);
  key.seats = Math.max(1, Number(key.seats) || 1);
  key.activatedAt = key.activatedAt || key.usedAt || new Date();
  await keyRepo().save(key);

  if (key.tier === 2) {
    const permanent = keyIsPermanent(key);
    await openEnterpriseForActivation(
      account,
      key,
      Math.max(1, key.seats || 1),
      permanent,
      permanent ? 0 : keyExpireSeconds(key)
    );
  }

  if (input.disclaimerVersion && input.disclaimerVersion > 0) {
    await recordAgreements(account.id, ['disclaimer'], input.disclaimerVersion, input.machineFp || '', input.ip || '');
  }

  const freshAccount = (await AppDataSource.getRepository(Account).findOneBy({ id: account.id })) || account;
  return {
    entitlements: await getEntitlements(freshAccount),
    key: toKeySummary(key, key.id),
    renewed: false,
    upgraded: false,
    enterpriseCode: null,
  };
}

/** 我的卡密：生效 + 历史 + 覆盖升级关系 */
export async function listAccountKeys(account: Account): Promise<KeySummary[]> {
  const cid = account.enterpriseId;
  const keys = await keyRepo()
    .createQueryBuilder('k')
    .where('k.account_id = :accountId', { accountId: account.id })
    .orWhere(cid ? 'k.enterprise_id = :enterpriseId' : '1 = 0', { enterpriseId: cid })
    .orderBy('k.activated_at', 'DESC')
    .addOrderBy('k.id', 'DESC')
    .getMany();
  const effective = await findEffectiveKey(account);
  const currentId = effective?.id || null;
  return keys.map((k) => toKeySummary(k, currentId));
}

/**
 * 每日任务：把已到期的账号卡密与企业标记为过期（status=3）。
 * 权益计算本身按到期时间动态判定，不依赖该状态；这里只保证运营视图与续费提示准确。
 * 不处理永久卡（account_expire_at / expire_at 为空）。
 */
export async function markExpiredAccountLicenses(): Promise<{ keys: number; enterprises: number }> {
  const keyResult = await AppDataSource.query(
    'UPDATE license_keys SET status = 3 WHERE status = 1 AND account_expire_at IS NOT NULL AND account_expire_at <= NOW()'
  );
  const entResult = await AppDataSource.query(
    'UPDATE enterprises SET status = 3 WHERE status = 1 AND expire_at IS NOT NULL AND expire_at <= NOW()'
  );
  return {
    keys: Number(keyResult?.affectedRows || 0),
    enterprises: Number(entResult?.affectedRows || 0),
  };
}
