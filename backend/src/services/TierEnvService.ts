import { getConfigValue, setConfigValue } from './ConfigService';

/**
 * 档位环境管理（系统级配置）
 * 四个版本 × 级别组合，各自配置“单用户环境数量上限”。
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

export async function getTierEnvLimits(): Promise<TierEnvLimits> {
  const text = await getConfigValue('tier_env_limits');
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

/** 卡密环境上限：码上带值优先；否则取系统档位配置；都没有则 0=不限制 */
export async function resolveMaxEnvs(version: number, level: number, keyMaxEnvs: number): Promise<number> {
  if (keyMaxEnvs > 0) return keyMaxEnvs;
  const limits = await getTierEnvLimits();
  return limits[tierEnvKey(version, level)] || 0;
}

export async function saveTierEnvLimits(input: Record<string, unknown>): Promise<TierEnvLimits> {
  const limits: TierEnvLimits = { ...EMPTY };
  for (const meta of TIER_ENV_META) limits[meta.key] = normalize(input[meta.key]);
  await setConfigValue('tier_env_limits', JSON.stringify(limits));
  return limits;
}
