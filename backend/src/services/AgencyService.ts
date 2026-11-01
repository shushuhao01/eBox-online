import { Repository, SelectQueryBuilder } from 'typeorm';
import { AppDataSource } from '../config/database';
import { ClientAgencyClick } from '../entities/ClientAgencyClick';
import { getConfigValue, setConfigValue, getNoticeEvent } from './ConfigService';
import { broadcastNotice, type NoticeEvent } from './NoticeBroadcaster';
import { resolveLocation, parseUserAgent } from './SiteAnalyticsService';
import { log } from '../config/logger';

const repo = (): Repository<ClientAgencyClick> => AppDataSource.getRepository(ClientAgencyClick);

// ===========================================================================
// 代理商配置（草稿 / 已发布 / 定时任务）
// 与系统公告一致：列表整体以 JSON 存放在 system_config，发布后实时推送客户端。
//   agency_draft   ：后台编辑态（保存设置）
//   agency_payload ：已发布态（客户端实际展示）
//   agency_pending ：待定时发布任务
// ===========================================================================

export interface AgencyItem {
  id: string;
  name: string;
  url: string;
  intro: string;
  tags: string;
  rating: number;
  ratingCount: number;
  sort: number;
  enabled: number;
}

export interface AgencyPayload {
  list: AgencyItem[];
  publishedAt: number;
}

export interface PendingAgency {
  list: AgencyItem[];
  publishAt: number;
}

const MAX_AGENCIES = 50;

function text(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

function clampNum(v: unknown, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** 归一化单条代理商：截断超长字段、评分限 0~5、地址仅保留 http/https */
export function normalizeAgency(raw: Partial<AgencyItem> | null | undefined, index = 0): AgencyItem | null {
  if (!raw) return null;
  const name = text(raw.name, 64);
  const url = text(raw.url, 512);
  if (!name || !url) return null;
  return {
    id: text(raw.id, 64) || `ag-${Date.now().toString(36)}-${index}`,
    name,
    url,
    intro: text(raw.intro, 255),
    tags: text(raw.tags, 128),
    rating: Math.round(clampNum(raw.rating, 0, 5) * 10) / 10,
    ratingCount: Math.round(clampNum(raw.ratingCount, 0, 999999)),
    sort: Math.round(clampNum(raw.sort, -9999, 9999)),
    enabled: Number(raw.enabled) === 0 ? 0 : 1,
  };
}

/** 归一化列表：逐条校验 + 去重（同 id 保留首条）+ 限制条数 */
export function normalizeAgencyList(raw: unknown): AgencyItem[] {
  if (!Array.isArray(raw)) return [];
  const list: AgencyItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length && list.length < MAX_AGENCIES; i += 1) {
    const item = normalizeAgency(raw[i] as Partial<AgencyItem>, i);
    if (!item || seen.has(item.id)) continue;
    if (item.enabled === 1 && !/^https?:\/\//i.test(item.url)) continue;
    seen.add(item.id);
    list.push(item);
  }
  return list;
}

function parseJson<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as T) : null;
  } catch {
    return null;
  }
}

/** 读取草稿；从未保存过草稿时回退到已发布列表，便于首次进入即有内容 */
export async function getAgencyDraft(): Promise<AgencyItem[]> {
  const raw = await getConfigValue('agency_draft');
  if (raw) {
    const parsed = parseJson<{ list?: unknown }>(raw);
    return normalizeAgencyList(parsed?.list);
  }
  const payload = await getAgencyPayloadAll();
  return payload;
}

/** 保存草稿（不推送、不影响客户端已展示内容） */
export async function saveAgencyDraft(list: unknown): Promise<AgencyItem[]> {
  const normalized = normalizeAgencyList(list);
  await setConfigValue('agency_draft', JSON.stringify({ list: normalized }));
  return normalized;
}

/** 读取已发布列表（含停用条目，供后台回显） */
async function getAgencyPayloadAll(): Promise<AgencyItem[]> {
  const parsed = parseJson<AgencyPayload>(await getConfigValue('agency_payload'));
  return normalizeAgencyList(parsed?.list);
}

/** 下发给客户端的列表：仅启用项，按 sort 升序、名称兜底排序 */
export async function getAgencyPayload(): Promise<AgencyItem[]> {
  const list = await getAgencyPayloadAll();
  return list
    .filter((a) => a.enabled === 1)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/** 心跳/SSE 统一的完整下发事件（公告 + 代理商），保证任一变更都不会覆盖另一侧 */
export async function getClientEvent(): Promise<NoticeEvent> {
  const [notice, agencies] = await Promise.all([getNoticeEvent(), getAgencyPayload()]);
  return { ...notice, agencies };
}

/** 推送当前完整状态到全部在线客户端，返回送达连接数 */
export async function broadcastClientEvent(): Promise<number> {
  return broadcastNotice(await getClientEvent());
}

export async function getPendingAgencies(): Promise<PendingAgency | null> {
  const parsed = parseJson<PendingAgency>(await getConfigValue('agency_pending'));
  const publishAt = Number(parsed?.publishAt) || 0;
  if (!parsed || publishAt <= 0) return null;
  return { list: normalizeAgencyList(parsed.list), publishAt };
}

export async function cancelScheduledAgencies(): Promise<void> {
  await setConfigValue('agency_pending', '');
}

export interface AgencyState {
  draft: AgencyItem[];
  published: AgencyItem[];
  pending: PendingAgency | null;
}

export async function getAgencyState(): Promise<AgencyState> {
  const [draft, published, pending] = await Promise.all([
    getAgencyDraft(),
    getAgencyPayloadAll(),
    getPendingAgencies(),
  ]);
  return { draft, published, pending };
}

export interface AgencyPublishResult {
  state: AgencyState;
  delivered: number;
}

/** 立即发布：可携带最新列表（一次提交即发布），随后实时推送客户端 */
export async function publishAgencies(list?: unknown): Promise<AgencyPublishResult> {
  const items = list === undefined ? await getAgencyDraft() : await saveAgencyDraft(list);
  const payload: AgencyPayload = { list: items, publishedAt: Date.now() };
  await setConfigValue('agency_payload', JSON.stringify(payload));
  await setConfigValue('agency_pending', '');
  const delivered = await broadcastClientEvent();
  log.info(`客户端代理商已发布：${items.length} 个（送达 ${delivered} 个在线连接）`);
  return { state: await getAgencyState(), delivered };
}

/** 定时发布：保存列表并登记待发布任务，到点由每分钟定时任务推送 */
export async function scheduleAgencies(publishAt: number, list?: unknown): Promise<PendingAgency | null> {
  const items = list === undefined ? await getAgencyDraft() : await saveAgencyDraft(list);
  if (!items.length) {
    await setConfigValue('agency_pending', '');
    return null;
  }
  const pending: PendingAgency = { list: items, publishAt };
  await setConfigValue('agency_pending', JSON.stringify(pending));
  log.info(`客户端代理商已登记定时发布：${new Date(publishAt).toISOString()}`);
  return pending;
}

/** 撤下全部代理商：清空已发布列表并实时通知客户端清空本地缓存 */
export async function withdrawAgencies(): Promise<AgencyPublishResult> {
  await setConfigValue('agency_payload', '');
  await setConfigValue('agency_pending', '');
  const delivered = await broadcastClientEvent();
  log.info(`客户端代理商已全部撤下（送达 ${delivered} 个在线连接）`);
  return { state: await getAgencyState(), delivered };
}

/** 定时任务入口：待发布任务到点即发布（每分钟调用一次） */
export async function processScheduledAgencies(): Promise<void> {
  const pending = await getPendingAgencies();
  if (!pending || pending.publishAt > Date.now()) return;
  await setConfigValue('agency_payload', JSON.stringify({ list: pending.list, publishedAt: pending.publishAt }));
  await setConfigValue('agency_pending', '');
  await broadcastClientEvent();
  log.info(`定时客户端代理商已自动发布：${pending.list.length} 个`);
}

// ===========================================================================
// 点击埋点
// ===========================================================================

export interface RecordAgencyClickInput {
  code: string;
  machineFp: string;
  appVersion: string;
  clientOs: string;
  agencyId: string;
  clickId: string;
  envName: string;
  ip: string;
  userAgent: string;
  referer: string;
}

/** 记录一次代理商点击（归属地 + UA 解析入库，名称做快照，便于后续排行/明细展示） */
export async function recordAgencyClick(input: RecordAgencyClickInput): Promise<ClientAgencyClick> {
  const agencyId = text(input.agencyId, 64);
  const [all, loc] = await Promise.all([getAgencyState(), resolveLocation(input.ip)]);
  const found = [...all.published, ...all.draft].find((a) => a.id === agencyId);
  const ua = parseUserAgent(input.userAgent);
  const clientOs = text(input.clientOs, 64);

  const row = repo().create({
    agencyId,
    agencyName: found?.name || '',
    clickId: text(input.clickId, 64),
    code: text(input.code, 200),
    machineFp: text(input.machineFp, 32).toLowerCase(),
    envName: text(input.envName, 64),
    appVersion: text(input.appVersion, 32),
    ip: text(input.ip, 64),
    country: loc.country,
    province: loc.province,
    city: loc.city,
    isp: loc.isp,
    device: ua.device === 'unknown' && clientOs ? 'desktop' : ua.device,
    os: ua.os || clientOs,
    browser: ua.browser,
    clientOs,
    referer: text(input.referer, 512),
    userAgent: text(input.userAgent, 255),
  });
  return repo().save(row);
}

// ===========================================================================
// 数据分析（参考官网「访问统计 → 流量分析 / 访问明细」）
// ===========================================================================

export interface NameValue {
  name: string;
  value: number;
}

export interface AgencyAnalytics {
  range: { days: number; start: string; end: string };
  summary: {
    clicks: number;
    devices: number;
    ips: number;
    agencies: number;
    todayClicks: number;
    avgClicks: number;
    peakHour: number;
    peakHourClicks: number;
  };
  trend: { dates: string[]; clicks: number[]; devices: number[] };
  hours: { labels: string[]; clicks: number[] };
  devices: NameValue[];
  os: NameValue[];
  browsers: NameValue[];
  regions: NameValue[];
  isps: NameValue[];
  environments: NameValue[];
  agencies: Array<{ id: string; name: string; clicks: number; devices: number }>;
  daily: Array<{ date: string; clicks: number; devices: number }>;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function toNum(v: unknown): number {
  return Number(v) || 0;
}

/** 代理商点击分析（趋势 / 时段 / 设备 / 地域 / 运营商 / 环境 / 代理商排行） */
export async function getAgencyAnalytics(days = 30, startDate = '', endDate = ''): Promise<AgencyAnalytics> {
  const now = new Date();
  const today = fmtDate(now);
  let start: string;
  let end: string;
  if (YMD_RE.test(startDate) && YMD_RE.test(endDate) && startDate <= endDate) {
    start = startDate;
    end = endDate;
  } else {
    const d = Math.min(90, Math.max(1, Math.floor(days) || 30));
    start = fmtDate(addDays(now, -(d - 1)));
    end = today;
  }
  let range = Math.round((parseYmd(end).getTime() - parseYmd(start).getTime()) / 86400000) + 1;
  if (range > 366) {
    start = fmtDate(addDays(parseYmd(end), -365));
    range = 366;
  }
  if (range < 1) range = 1;

  const startAt = parseYmd(start);
  const endAt = addDays(parseYmd(end), 1);
  const r = repo();
  const base = (): SelectQueryBuilder<ClientAgencyClick> =>
    r.createQueryBuilder('c').where('c.created_at >= :startAt', { startAt }).andWhere('c.created_at < :endAt', { endAt });

  const [sumRow, trendRows, hourRows, deviceRows, osRows, browserRows, regionRows, ispRows, envRows, agencyRows, todayRow] =
    await Promise.all([
      base()
        .select('COUNT(*)', 'clicks')
        .addSelect('COUNT(DISTINCT c.machine_fp)', 'devices')
        .addSelect('COUNT(DISTINCT c.ip)', 'ips')
        .addSelect('COUNT(DISTINCT c.agency_id)', 'agencies')
        .getRawOne<{ clicks: string; devices: string; ips: string; agencies: string }>(),
      base()
        .select("DATE_FORMAT(c.created_at, '%Y-%m-%d')", 'date')
        .addSelect('COUNT(*)', 'clicks')
        .addSelect('COUNT(DISTINCT c.machine_fp)', 'devices')
        .groupBy('date')
        .orderBy('date', 'ASC')
        .getRawMany<{ date: string; clicks: string; devices: string }>(),
      base()
        .select('HOUR(c.created_at)', 'hour')
        .addSelect('COUNT(*)', 'clicks')
        .groupBy('hour')
        .orderBy('hour', 'ASC')
        .getRawMany<{ hour: number; clicks: string }>(),
      base()
        .select('c.device', 'name')
        .addSelect('COUNT(*)', 'value')
        .groupBy('c.device')
        .orderBy('value', 'DESC')
        .limit(10)
        .getRawMany<{ name: string; value: string }>(),
      base()
        .select('c.os', 'name')
        .addSelect('COUNT(*)', 'value')
        .andWhere("c.os != ''")
        .groupBy('c.os')
        .orderBy('value', 'DESC')
        .limit(10)
        .getRawMany<{ name: string; value: string }>(),
      base()
        .select('c.browser', 'name')
        .addSelect('COUNT(*)', 'value')
        .groupBy('c.browser')
        .orderBy('value', 'DESC')
        .limit(10)
        .getRawMany<{ name: string; value: string }>(),
      base()
        .select('c.province', 'name')
        .addSelect('COUNT(*)', 'value')
        .andWhere("c.province != ''")
        .groupBy('c.province')
        .orderBy('value', 'DESC')
        .limit(10)
        .getRawMany<{ name: string; value: string }>(),
      base()
        .select('c.isp', 'name')
        .addSelect('COUNT(*)', 'value')
        .andWhere("c.isp != ''")
        .groupBy('c.isp')
        .orderBy('value', 'DESC')
        .limit(10)
        .getRawMany<{ name: string; value: string }>(),
      base()
        .select('c.env_name', 'name')
        .addSelect('COUNT(*)', 'value')
        .andWhere("c.env_name != ''")
        .groupBy('c.env_name')
        .orderBy('value', 'DESC')
        .limit(10)
        .getRawMany<{ name: string; value: string }>(),
      base()
        .select('c.agency_id', 'id')
        .addSelect('MAX(c.agency_name)', 'name')
        .addSelect('COUNT(*)', 'clicks')
        .addSelect('COUNT(DISTINCT c.machine_fp)', 'devices')
        .groupBy('c.agency_id')
        .orderBy('clicks', 'DESC')
        .limit(20)
        .getRawMany<{ id: string; name: string; clicks: string; devices: string }>(),
      r.createQueryBuilder('c')
        .select('COUNT(*)', 'clicks')
        .where('c.created_at >= :todayAt', { todayAt: parseYmd(today) })
        .getRawOne<{ clicks: string }>(),
    ]);

  const dates: string[] = [];
  for (let i = 0; i < range; i += 1) dates.push(fmtDate(addDays(parseYmd(start), i)));
  const trendMap = new Map<string, { clicks: number; devices: number }>();
  for (const row of trendRows) {
    trendMap.set(String(row.date), { clicks: toNum(row.clicks), devices: toNum(row.devices) });
  }

  const hourMap = new Map<number, number>();
  for (const row of hourRows) hourMap.set(Number(row.hour), toNum(row.clicks));
  const hours = {
    labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`),
    clicks: Array.from({ length: 24 }, (_, i) => hourMap.get(i) || 0),
  };
  let peakHour = 0;
  let peakHourClicks = 0;
  hours.clicks.forEach((v, i) => {
    if (v > peakHourClicks) {
      peakHourClicks = v;
      peakHour = i;
    }
  });

  const clicks = toNum(sumRow?.clicks);

  return {
    range: { days: range, start, end },
    summary: {
      clicks,
      devices: toNum(sumRow?.devices),
      ips: toNum(sumRow?.ips),
      agencies: toNum(sumRow?.agencies),
      todayClicks: toNum(todayRow?.clicks),
      avgClicks: range > 0 ? Math.round(clicks / range) : 0,
      peakHour,
      peakHourClicks,
    },
    trend: {
      dates,
      clicks: dates.map((d) => trendMap.get(d)?.clicks || 0),
      devices: dates.map((d) => trendMap.get(d)?.devices || 0),
    },
    hours,
    devices: deviceRows.map((x) => ({ name: x.name || '未知', value: toNum(x.value) })),
    os: osRows.map((x) => ({ name: x.name || '未知', value: toNum(x.value) })),
    browsers: browserRows.map((x) => ({ name: x.name || '未知', value: toNum(x.value) })),
    regions: regionRows.map((x) => ({ name: x.name || '未知', value: toNum(x.value) })),
    isps: ispRows.map((x) => ({ name: x.name || '未知', value: toNum(x.value) })),
    environments: envRows.map((x) => ({ name: x.name || '未知', value: toNum(x.value) })),
    agencies: agencyRows.map((x) => ({
      id: x.id || '',
      name: x.name || '（已下架）',
      clicks: toNum(x.clicks),
      devices: toNum(x.devices),
    })),
    daily: dates.map((d) => ({
      date: d,
      clicks: trendMap.get(d)?.clicks || 0,
      devices: trendMap.get(d)?.devices || 0,
    })),
  };
}

// ===========================================================================
// 点击明细查询 / 清理
// ===========================================================================

export interface AgencyClickQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  agencyId?: string;
  envName?: string;
  device?: string;
  start?: string;
  end?: string;
}

export interface AgencyClickListResult {
  total: number;
  page: number;
  pageSize: number;
  list: ClientAgencyClick[];
}

/** 分页查询点击明细（支持关键字 / 代理商 / 环境 / 设备 / 日期区间过滤） */
export async function listAgencyClicks(q: AgencyClickQuery = {}): Promise<AgencyClickListResult> {
  const page = Math.max(1, Math.floor(q.page || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(q.pageSize || 20)));
  const qb = repo().createQueryBuilder('c');

  const kw = (q.keyword || '').trim();
  if (kw) {
    qb.andWhere(
      '(c.agency_name LIKE :kw OR c.code LIKE :kw OR c.ip LIKE :kw OR c.machine_fp LIKE :kw OR c.province LIKE :kw OR c.city LIKE :kw)',
      { kw: `%${kw}%` }
    );
  }
  if (q.agencyId) qb.andWhere('c.agency_id = :agencyId', { agencyId: q.agencyId });
  if (q.envName) qb.andWhere('c.env_name = :envName', { envName: q.envName });
  if (q.device) qb.andWhere('c.device = :device', { device: q.device });
  if (q.start && YMD_RE.test(q.start)) qb.andWhere('c.created_at >= :startAt', { startAt: parseYmd(q.start) });
  if (q.end && YMD_RE.test(q.end)) qb.andWhere('c.created_at < :endAt', { endAt: addDays(parseYmd(q.end), 1) });

  const total = await qb.getCount();
  const list = await qb
    .orderBy('c.id', 'DESC')
    .skip((page - 1) * pageSize)
    .take(pageSize)
    .getMany();
  return { total, page, pageSize, list };
}

/** 删除超过保留期的点击明细 */
export async function cleanAgencyClicks(retentionDays = 90): Promise<number> {
  const days = Math.max(1, Math.floor(retentionDays) || 90);
  const cutoff = addDays(new Date(), -days);
  const res = await repo()
    .createQueryBuilder()
    .delete()
    .where('created_at < :cutoff', { cutoff })
    .execute();
  return res.affected || 0;
}
