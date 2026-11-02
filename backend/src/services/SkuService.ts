import { AppDataSource } from '../config/database';
import { Sku } from '../entities/account/Sku';
import { AppConfig } from '../entities/account/AppConfig';
import { ApiError } from '../middleware/errorHandler';
import { broadcastConfig } from './AccountEventService';

/**
 * 套餐 SKU 与商城升级链接（M6）
 * - SKU 由后台维护，16 条为默认种子；客户端只按 code/标签/链接渲染。
 * - 商城链接保存在 app_configs.upgrade_links（code → URL），变更后 SSE 推送 config 事件。
 */

const skuRepo = () => AppDataSource.getRepository(Sku);
const configRepo = () => AppDataSource.getRepository(AppConfig);

export interface SkuView {
  id: string;
  code: string;
  version: number;
  level: number;
  duration: string;
  durationDays: number;
  label: string;
  seats: number;
  mallUrl: string | null;
  enabled: boolean;
  sort: number;
}

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
  ipResourceVersion: number;
  configVersion: number;
  tiers: ClientTierView[];
}

export function toSkuView(sku: Sku): SkuView {
  return {
    id: String(sku.id),
    code: sku.code,
    version: sku.version,
    level: sku.level,
    duration: sku.duration,
    durationDays: sku.durationDays,
    label: sku.label,
    seats: sku.seats,
    mallUrl: sku.mallUrl || null,
    enabled: sku.enabled === 1,
    sort: sku.sort,
  };
}

export async function listSkus(includeDisabled = true): Promise<SkuView[]> {
  const rows = await skuRepo().find({ order: { sort: 'ASC', id: 'ASC' } });
  return rows.filter((s) => includeDisabled || s.enabled === 1).map(toSkuView);
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

function parsePositive(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 客户端配置整包（/api/config/client 与 SSE config 事件同构） */
export async function buildClientConfig(): Promise<ClientConfigView> {
  const [links, disclaimerRaw, ipVersionRaw, configVersionRaw, skus] = await Promise.all([
    getUpgradeLinks(),
    getConfigValue('disclaimer_version', '1'),
    getConfigValue('ip_resource_version', '1'),
    getConfigValue('config_version', '1'),
    listSkus(false),
  ]);
  return {
    disclaimerVersion: parsePositive(disclaimerRaw, 1),
    upgradeLinks: links,
    ipResourceVersion: parsePositive(ipVersionRaw, 1),
    configVersion: parsePositive(configVersionRaw, 1),
    tiers: skus.map((s) => ({
      code: s.code,
      version: s.version,
      level: s.level,
      duration: s.duration,
      durationDays: s.durationDays,
      label: s.label,
      seats: s.seats,
      mallUrl: s.mallUrl || links[s.code] || '',
    })),
  };
}

export interface SaveUpgradeLinksResult {
  config: ClientConfigView;
  delivered: number;
}

/** 保存商城链接：仅接受已存在 SKU 的 code，URL 必须 http(s) 或空（空=联系客服） */
export async function saveUpgradeLinks(input: Record<string, unknown>): Promise<SaveUpgradeLinksResult> {
  const skus = await skuRepo().find();
  const codeSet = new Set(skus.map((s) => s.code));
  const links: Record<string, string> = {};
  for (const [code, raw] of Object.entries(input)) {
    if (!codeSet.has(code)) throw new ApiError(`未知套餐编码：${code}`, 400, 400);
    const url = String(raw ?? '').trim();
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) throw new ApiError(`套餐 ${code} 的链接必须以 http(s):// 开头`, 400, 400);
    links[code] = url;
  }
  await saveConfigValue('upgrade_links', JSON.stringify(links), '商城升级链接 JSON（按 SKU code 配置）');
  const nextVersion = parsePositive(await getConfigValue('config_version', '1'), 1) + 1;
  await saveConfigValue('config_version', String(nextVersion), '客户端配置版本号');
  const config = await buildClientConfig();
  const delivered = broadcastConfig({ ...config, serverTime: Math.floor(Date.now() / 1000) });
  return { config, delivered };
}

export interface SkuInput {
  code: string;
  version: number;
  level: number;
  duration: string;
  durationDays: number;
  label: string;
  seats: number;
  mallUrl?: string | null;
  capsJson?: string | null;
  sort?: number;
  enabled?: boolean;
}

function normalizeSkuInput(input: SkuInput): Partial<Sku> {
  return {
    code: input.code.trim(),
    version: input.version,
    level: input.level,
    duration: input.duration,
    durationDays: input.durationDays,
    label: input.label.trim(),
    seats: Math.max(1, Math.floor(input.seats)),
    mallUrl: input.mallUrl?.trim() || null,
    capsJson: input.capsJson?.trim() || null,
    sort: Number.isFinite(input.sort) ? Math.floor(input.sort as number) : 0,
    enabled: input.enabled === false ? 0 : 1,
  };
}

export async function createSku(input: SkuInput): Promise<SkuView> {
  const repo = skuRepo();
  const exists = await repo.findOneBy({ code: input.code.trim() });
  if (exists) throw new ApiError('套餐编码已存在', 400, 400);
  const row = repo.create(normalizeSkuInput(input));
  await repo.save(row);
  return toSkuView(row);
}

export async function updateSku(id: string, input: SkuInput): Promise<SkuView> {
  const repo = skuRepo();
  const row = await repo.findOneBy({ id });
  if (!row) throw new ApiError('套餐不存在', 4004, 404);
  const patch = normalizeSkuInput(input);
  if (patch.code && patch.code !== row.code) {
    const dup = await repo.findOneBy({ code: patch.code });
    if (dup) throw new ApiError('套餐编码已存在', 400, 400);
  }
  Object.assign(row, patch);
  await repo.save(row);
  return toSkuView(row);
}

export async function toggleSku(id: string, enabled: boolean): Promise<SkuView> {
  const repo = skuRepo();
  const row = await repo.findOneBy({ id });
  if (!row) throw new ApiError('套餐不存在', 4004, 404);
  row.enabled = enabled ? 1 : 0;
  await repo.save(row);
  return toSkuView(row);
}

/** 供其它服务按 id 取 SKU（核销升级码等） */
export async function findSkuById(id: string): Promise<Sku | null> {
  return skuRepo().findOneBy({ id });
}
