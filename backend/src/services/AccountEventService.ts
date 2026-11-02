import { Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { Account } from '../entities/account/Account';
import { LicenseKey } from '../entities/LicenseKey';
import { Entitlements, getEntitlements } from './EntitlementService';

// ============================================================
// 账号实时事件推送（SSE）连接池
//   权益变更（激活/续费/升级/停用/到期/席位调整）后，向该账号的在线长连接
//   即时推送 account.entitlements 事件，客户端无需重启即可刷新权益。
//   心跳仍会随响应下发 entitlements 作为兜底，两条通道互不依赖。
// ============================================================

/** 按账号聚合的长连接集合（同一账号可同时登录多台设备） */
const clients = new Map<string, Set<Response>>();

/** 连接 -> 机器指纹（admin 设备踢下线时按指纹精确投递） */
const clientMeta = new WeakMap<Response, { machineFp: string }>();

// 保活：每 25s 写一行 SSE 注释，避免中间代理按空闲超时断开
const KEEPALIVE_MS = 25 * 1000;
let keepaliveTimer: NodeJS.Timeout | null = null;

function ensureKeepalive(): void {
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(() => {
    for (const set of clients.values()) {
      for (const res of set) {
        try {
          res.write(': ping\n\n');
        } catch {
          set.delete(res);
        }
      }
    }
    for (const [accountId, set] of clients) {
      if (set.size === 0) clients.delete(accountId);
    }
  }, KEEPALIVE_MS);
  keepaliveTimer.unref?.();
}

function stopKeepaliveIfIdle(): void {
  if (keepaliveTimer && clients.size === 0) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function writeEntitlements(res: Response, entitlements: Entitlements): void {
  const payload = { type: 'account.entitlements', entitlements };
  res.write(`event: account.entitlements\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** 新连接接入：登记并立即下发当前权益快照，避免等待下一次变更。 */
export function addAccountClient(accountId: string, res: Response, initial: Entitlements, machineFp?: string): void {
  let set = clients.get(accountId);
  if (!set) {
    set = new Set();
    clients.set(accountId, set);
  }
  set.add(res);
  const fp = String(machineFp || '').trim().toLowerCase();
  if (fp) clientMeta.set(res, { machineFp: fp });
  ensureKeepalive();
  writeEntitlements(res, initial);
}

/** 连接断开：注销。 */
export function removeAccountClient(accountId: string, res: Response): void {
  const set = clients.get(accountId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(accountId);
  stopKeepaliveIfIdle();
}

/** 向指定账号推送权益快照，返回实际写入成功的连接数。 */
export function pushEntitlements(accountId: string, entitlements: Entitlements): number {
  const set = clients.get(accountId);
  if (!set || set.size === 0) return 0;
  let sent = 0;
  for (const res of set) {
    try {
      writeEntitlements(res, entitlements);
      sent++;
    } catch {
      set.delete(res);
    }
  }
  if (set.size === 0) clients.delete(accountId);
  return sent;
}

/** 重新计算指定账号权益并推送（账号不存在或已无会话时静默跳过）。 */
export async function pushEntitlementsForAccountId(accountId: string): Promise<number> {
  if (!clients.has(accountId)) return 0;
  const account = await AppDataSource.getRepository(Account).findOneBy({ id: accountId });
  if (!account) return 0;
  const entitlements = await getEntitlements(account);
  const sent = pushEntitlements(accountId, entitlements);
  if (sent > 0) logger.info(`SSE 权益推送：账号 ${accountId} 已更新到 ${entitlements.entitlementsVersion}（${sent} 个连接）`);
  return sent;
}

/** 套餐能力（如 caps.maxEnvs）变更后，刷新全部在线账号的权益快照。 */
export async function refreshAllEntitlements(): Promise<number> {
  let total = 0;
  for (const accountId of [...clients.keys()]) {
    total += await pushEntitlementsForAccountId(accountId);
  }
  return total;
}

/** 受影响账号：个人卡为持卡账号；企业卡为企业下全部账号（管理员 + 成员）。 */
async function affectedAccountIds(key: LicenseKey): Promise<string[]> {
  const ids = new Set<string>();
  if (key.accountId) ids.add(String(key.accountId));
  if (key.enterpriseId) {
    const rows = await AppDataSource.getRepository(Account)
      .createQueryBuilder('a')
      .select('a.id', 'id')
      .where('a.enterprise_id = :entId', { entId: key.enterpriseId })
      .getRawMany<{ id: string }>();
    for (const r of rows) ids.add(String(r.id));
  }
  return [...ids];
}

/**
 * 强制下线：向指定账号的在线长连接推送 account.kicked 并断开。
 * machineFp 非空时只投递给该设备（设备管理「踢下线」）；为空则踢掉该账号全部设备。
 * 返回实际投递的连接数。
 */
export function pushKick(accountId: string, reason: string, machineFp?: string): number {
  const set = clients.get(accountId);
  if (!set || set.size === 0) return 0;
  const fp = String(machineFp || '').trim().toLowerCase();
  let sent = 0;
  for (const res of [...set]) {
    if (fp) {
      const meta = clientMeta.get(res);
      if (!meta || meta.machineFp !== fp) continue;
    }
    try {
      const payload = { type: 'account.kicked', reason: reason || '账号已下线' };
      res.write(`event: account.kicked\ndata: ${JSON.stringify(payload)}\n\n`);
      res.end();
      sent++;
    } catch {
      // 连接已断开，忽略
    }
    set.delete(res);
  }
  if (set.size === 0) clients.delete(accountId);
  stopKeepaliveIfIdle();
  if (sent > 0) logger.info(`SSE 强制下线：账号 ${accountId}${fp ? ` 设备 ${fp}` : ''}（${sent} 个连接）`);
  return sent;
}

/** 向多个账号推送强制下线。 */
export function pushKickForAccounts(accountIds: string[], reason: string, machineFp?: string): number {
  let sent = 0;
  for (const id of accountIds) sent += pushKick(id, reason, machineFp);
  return sent;
}

/** 卡密设备被踢下线：找到该卡密关联的账号并按其机器指纹精确投递。 */
export async function kickKeyDevices(key: LicenseKey | null, reason: string, machineFp?: string): Promise<number> {
  if (!key) return 0;
  return pushKickForAccounts(await affectedAccountIds(key), reason, machineFp);
}

/** 卡密状态/权益变化后广播（作废、恢复、人工续期等）；无在线连接时静默。 */
export async function notifyKeyChange(key: LicenseKey | null): Promise<void> {
  if (!key) return;
  const ids = await affectedAccountIds(key);
  await Promise.all(ids.map((id) => pushEntitlementsForAccountId(id)));
}

/**
 * 配置变更广播（M6）：商城链接 / 档位列表等变更后推送给全部在线客户端。
 * 事件名固定为 config，data 与 /api/config/client 同构，客户端可整包替换缓存。
 */
export function broadcastConfig(payload: Record<string, unknown>): number {
  const data = { type: 'config', ...payload };
  let sent = 0;
  for (const set of clients.values()) {
    for (const res of set) {
      try {
        res.write(`event: config\ndata: ${JSON.stringify(data)}\n\n`);
        sent++;
      } catch {
        set.delete(res);
      }
    }
  }
  return sent;
}

/** 当前在线账号数 / 连接数（供诊断）。 */
export function onlineStats(): { accounts: number; connections: number } {
  let connections = 0;
  for (const set of clients.values()) connections += set.size;
  return { accounts: clients.size, connections };
}
