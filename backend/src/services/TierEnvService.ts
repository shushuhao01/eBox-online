import { getConfigValue, setConfigValue } from './ConfigService';

/**
 * 环境与席位管理（系统级配置）
 * 四个版本 × 级别组合，各自配置“单用户环境数量上限”与“单用户席位上限”。
 * 0 或未配置 = 不限制。
 */

export type TierEnvKey = 'v1l1' | 'v1l2' | 'v2l1' | 'v2l2';
export type TierEnvLimits = Record<TierEnvKey, number>;

export const TIER_ENV_META: Array<{ key: TierEnvKey; version: number; level: number; label: string }> = [
  { key: 'v1l1', version: 1, level: 1, label: '个人普通' },
  { key: 'v1l2', version: 1, level: 2, label: '个人高级' },
  { key: 'v2l1', version: 2, level: 1, label: '企业普通' },
  { key: 'v2l2', version: 2, level: 2, label: '企业高级' },
];

const EMPTY: TierEnvLimits = { v1l1: 0, v1l2: 0, v2l1: 0, v2l2: 0 };

export function tierEnvKey(version: number, level: number): TierEnvKey {
  return `v${version === 2 ? 2 : 1}l${level === 2 ? 2 : 1}` as TierEnvKey;
}

function normalize(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100000);
}

async function readLimits(configKey: string): Promise<TierEnvLimits> {
  const text = await getConfigValue(configKey);
  if (!text) return { ...EMPTY };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const limits: TierEnvLimits = { ...EMPTY };
    for (const meta of TIER_ENV_META) limits[meta.key] = normalize(parsed[meta.key]);
    return limits;
  } catch {
    return { ...EMPTY };
  }
}

async function writeLimits(configKey: string, input: Record<string, unknown>): Promise<TierEnvLimits> {
  const limits: TierEnvLimits = { ...EMPTY };
  for (const meta of TIER_ENV_META) limits[meta.key] = normalize(input[meta.key]);
  await setConfigValue(configKey, JSON.stringify(limits));
  return limits;
}

export function getTierEnvLimits(): Promise<TierEnvLimits> {
  return readLimits('tier_env_limits');
}

export function saveTierEnvLimits(input: Record<string, unknown>): Promise<TierEnvLimits> {
  return writeLimits('tier_env_limits', input);
}

export function getTierSeatLimits(): Promise<TierEnvLimits> {
  return readLimits('tier_seat_limits');
}

export function saveTierSeatLimits(input: Record<string, unknown>): Promise<TierEnvLimits> {
  return writeLimits('tier_seat_limits', input);
}

/** 卡密环境上限：码上带值优先；否则取系统档位配置；都没有则 0=不限制 */
export async function resolveMaxEnvs(version: number, level: number, keyMaxEnvs: number): Promise<number> {
  if (keyMaxEnvs > 0) return keyMaxEnvs;
  const limits = await getTierEnvLimits();
  return limits[tierEnvKey(version, level)] || 0;
}

/**
 * 卡密席位：签发时显式指定（含 0=不限制）优先；未指定（null）取系统档位席位配置。
 * 0 表示不限制，不再回退成 1。
 */
export async function resolveSeats(version: number, level: number, keySeats: number | null): Promise<number> {
  if (keySeats !== null && keySeats !== undefined) return normalize(keySeats);
  const limits = await getTierSeatLimits();
  return limits[tierEnvKey(version, level)] || 0;
}
