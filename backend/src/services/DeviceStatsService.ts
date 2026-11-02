import { AppDataSource } from '../config/database';
import { Account } from '../entities/account/Account';
import { AccountDevice } from '../entities/account/AccountDevice';

/**
 * 设备环境统计（M5 团队仪表盘数据来源）
 * - 客户端心跳携带 envTotal / envRunning / boundResourceIds
 * - boundResourceIds 需按账号归属校验：只保留当前账号仍在占用（已分配/使用中）的资源
 * - 未登录设备不新建记录（登录时已建档），旧客户端不传字段则保持原值
 */

const MAX_ENV_COUNT = 100000;
const MAX_BOUND_RESOURCES = 500;

export interface EnvStatsInput {
  machineFp: string;
  envTotal?: number;
  envRunning?: number;
  boundResourceIds?: string[];
}

function clampCount(value: number | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MAX_ENV_COUNT, Math.floor(n)));
}

async function filterOwnedResources(account: Account, ids: string[]): Promise<string[]> {
  const unique = Array.from(
    new Set(ids.map((s) => String(s ?? '').trim()).filter((s) => /^\d+$/.test(s)))
  ).slice(0, MAX_BOUND_RESOURCES);
  if (!unique.length) return [];
  const entId = account.enterpriseId ? String(account.enterpriseId) : '0';
  const placeholders = unique.map(() => '?').join(',');
  const rows: Array<{ resource_id: string | number }> = await AppDataSource.query(
    `SELECT DISTINCT ia.resource_id AS resource_id
       FROM ip_assignments ia
       JOIN ip_resources r ON r.id = ia.resource_id
      WHERE ia.member_account_id = ? AND ia.status IN (1, 2)
        AND ia.resource_id IN (${placeholders})
        AND ((? <> '0' AND r.scope = 2 AND r.enterprise_id = ?)
             OR (? = '0' AND r.scope = 1 AND r.owner_account_id = ?))`,
    [account.id, ...unique, entId, entId, entId, account.id]
  );
  return rows.map((r) => String(r.resource_id));
}

export async function updateDeviceEnvStats(account: Account, input: EnvStatsInput): Promise<void> {
  const fp = String(input.machineFp || '').trim();
  if (!fp) return;
  const repo = AppDataSource.getRepository(AccountDevice);
  const device = await repo.findOneBy({ accountId: account.id, machineFp: fp });
  if (!device) return;

  device.envTotal = clampCount(input.envTotal, Number(device.envTotal || 0));
  device.envRunning = Math.min(
    device.envTotal,
    clampCount(input.envRunning, Number(device.envRunning || 0))
  );
  if (Array.isArray(input.boundResourceIds)) {
    device.boundResourceIds = await filterOwnedResources(account, input.boundResourceIds);
  }
  device.lastActiveAt = new Date();
  await repo.save(device);
}
