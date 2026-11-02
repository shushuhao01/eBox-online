import { AppDataSource } from '../config/database';
import { AppConfig } from '../entities/account/AppConfig';
import { ApiError } from '../middleware/errorHandler';
import { buildSkuRows } from '../config/ensureAccountSchema';
import { broadcastConfig } from './AccountEventService';

/**
 * 客户端档位与商城升级链接
 * - 价格 SKU 已移除：档位固定为 个人/企业 × 普通/高级 × 月/季/年/永久 共 16 个 code。
 * - 商城链接保存在 app_configs.upgrade_links（code → URL），变更后 SSE 推送 config 事件。
 */

const configRepo = () => AppDataSource.getRepository(AppConfig);

export interface ClientTierView {
  code: string;
  version: number;
  level: number;
  duration: string;
  durationDays: number;
  label: string;
  seats: number;
  mallUrl: string;
}

export interface ClientConfigView {
  disclaimerVersion: number;
  upgradeLinks: Record<string, string>;
  seatAddonMallUrl: string;
  ipResourceVersion: number;
  configVersion: number;
  tiers: ClientTierView[];
}

/** 固定档位列表（code 与历史 SKU 一致，客户端按 code 取商城链接） */
export function listClientTiers(): ClientTierView[] {
  return buildSkuRows().map(([code, version, level, duration, durationDays, label]) => ({
    code,
    version,
    level,
    duration,
    durationDays,
    label,
    seats: 1,
    mallUrl: '',
  }));
}

async function getConfigValue(cfgKey: string, fallback = ''): Promise<string> {
  const row = await configRepo().findOneBy({ cfgKey });
  return row?.cfgValue ?? fallback;
}

async function saveConfigValue(cfgKey: string, cfgValue: string, remark?: string): Promise<void> {
  let row = await configRepo().findOneBy({ cfgKey });
  if (!row) {
    row = configRepo().create({ cfgKey, cfgValue, remark: remark ?? null });
  } else {
    row.cfgValue = cfgValue;
  }
  await configRepo().save(row);
}

export async function getUpgradeLinks(): Promise<Record<string, string>> {
  const raw = await getConfigValue('upgrade_links', '{}');
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** 扩容码商城链接（客户端「去商城购买」跳转，空=不展示按钮） */
export async function getSeatAddonMallUrl(): Promise<string> {
  return getConfigValue('seat_addon_mall_url', '');
}

function parsePositive(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 客户端配置整包（/api/config/client 与 SSE config 事件同构） */
export async function buildClientConfig(): Promise<ClientConfigView> {
  const [links, seatAddonMallUrl, disclaimerRaw, ipVersionRaw, configVersionRaw] = await Promise.all([
    getUpgradeLinks(),
    getSeatAddonMallUrl(),
    getConfigValue('disclaimer_version', '1'),
    getConfigValue('ip_resource_version', '1'),
    getConfigValue('config_version', '1'),
  ]);
  return {
    disclaimerVersion: parsePositive(disclaimerRaw, 1),
    upgradeLinks: links,
    seatAddonMallUrl,
    ipResourceVersion: parsePositive(ipVersionRaw, 1),
    configVersion: parsePositive(configVersionRaw, 1),
    tiers: listClientTiers().map((t) => ({ ...t, mallUrl: links[t.code] || '' })),
  };
}

export interface SaveMallConfigInput {
  upgradeLinks?: Record<string, unknown>;
  seatAddonMallUrl?: string;
}

export interface SaveMallConfigResult {
  config: ClientConfigView;
  delivered: number;
}

/** 保存商城链接：仅接受固定档位 code，URL 必须 http(s) 或空（空=联系客服） */
export async function saveMallConfig(input: SaveMallConfigInput): Promise<SaveMallConfigResult> {
  if (input.upgradeLinks === undefined && input.seatAddonMallUrl === undefined) {
    throw new ApiError('至少需要提交升级链接或扩容码商城链接', 400, 400);
  }
  if (input.upgradeLinks !== undefined) {
    const codeSet = new Set(listClientTiers().map((t) => t.code));
    const links: Record<string, string> = {};
    for (const [code, raw] of Object.entries(input.upgradeLinks)) {
      if (!codeSet.has(code)) throw new ApiError(`未知档位编码：${code}`, 400, 400);
      const url = String(raw ?? '').trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) throw new ApiError(`档位 ${code} 的链接必须以 http(s):// 开头`, 400, 400);
      links[code] = url;
    }
    await saveConfigValue('upgrade_links', JSON.stringify(links), '商城升级链接 JSON（按档位 code 配置）');
  }
  if (input.seatAddonMallUrl !== undefined) {
    const url = String(input.seatAddonMallUrl ?? '').trim();
    if (url && !/^https?:\/\//i.test(url)) {
      throw new ApiError('扩容码商城链接必须以 http(s):// 开头', 400, 400);
    }
    await saveConfigValue('seat_addon_mall_url', url, '扩容码商城链接');
  }
  const nextVersion = parsePositive(await getConfigValue('config_version', '1'), 1) + 1;
  await saveConfigValue('config_version', String(nextVersion), '客户端配置版本号');
  const config = await buildClientConfig();
  const delivered = broadcastConfig({ ...config, serverTime: Math.floor(Date.now() / 1000) });
  return { config, delivered };
}

export interface SaveUpgradeLinksResult {
  config: ClientConfigView;
  delivered: number;
}

/** 兼容旧调用：仅保存升级链接 */
export async function saveUpgradeLinks(input: Record<string, unknown>): Promise<SaveUpgradeLinksResult> {
  return saveMallConfig({ upgradeLinks: input });
}
