import { get, post, put, type PageResult } from './request'

// ==================== 类型定义 ====================

/** 客户端代理商条目（后台配置 / 下发给客户端） */
export interface AgencyItem {
  id: string
  name: string
  url: string
  intro: string
  tags: string
  rating: number
  ratingCount: number
  sort: number
  enabled: number
}

/** 待定时推送任务 */
export interface AgencyPending {
  list: AgencyItem[]
  publishAt: number
}

/** 配置状态：草稿 / 已发布 / 定时任务 / 客户端在线连接数 */
export interface AgencyState {
  draft: AgencyItem[]
  published: AgencyItem[]
  pending: AgencyPending | null
  agency_stream_clients: number
  agency_delivered?: number
}

export interface NameValue {
  name: string
  value: number
}

/** 代理商点击分析（趋势 / 时段 / 设备 / 地域 / 运营商 / 环境 / 排行） */
export interface AgencyAnalytics {
  range: { days: number; start: string; end: string }
  summary: {
    clicks: number
    devices: number
    ips: number
    agencies: number
    todayClicks: number
    avgClicks: number
    peakHour: number
    peakHourClicks: number
  }
  trend: { dates: string[]; clicks: number[]; devices: number[] }
  hours: { labels: string[]; clicks: number[] }
  devices: NameValue[]
  os: NameValue[]
  browsers: NameValue[]
  regions: NameValue[]
  isps: NameValue[]
  environments: NameValue[]
  agencies: { id: string; name: string; clicks: number; devices: number }[]
  daily: { date: string; clicks: number; devices: number }[]
}

/** 点击明细行 */
export interface AgencyClickLog {
  id: string
  agencyId: string
  agencyName: string
  clickId: string
  code: string
  machineFp: string
  envName: string
  appVersion: string
  ip: string
  country: string
  province: string
  city: string
  isp: string
  device: string
  os: string
  browser: string
  clientOs: string
  referer: string
  userAgent: string
  createdAt: string
}

// ==================== 配置 / 推送 ====================

/** 当前代理人配置状态（草稿 / 已发布 / 定时任务） */
export function getAgencyState() {
  return get<AgencyState>('/agencies')
}

/** 保存配置（仅落库，不推送客户端） */
export function saveAgencyDraft(list: AgencyItem[]) {
  return put<AgencyState>('/agencies/draft', { list })
}

/** 立即推送（携带当前列表，一次提交即发布） */
export function publishAgencies(list: AgencyItem[]) {
  return post<AgencyState>('/agencies/publish', { list })
}

/** 定时推送（保存列表并登记任务） */
export function scheduleAgencies(list: AgencyItem[], sendAt: number) {
  return post<AgencyState>('/agencies/schedule', { list, sendAt })
}

/** 取消定时推送 */
export function cancelScheduledAgencies() {
  return post<AgencyState>('/agencies/cancel')
}

/** 撤下全部代理商（客户端弹窗变为空态） */
export function withdrawAgencies() {
  return post<AgencyState>('/agencies/withdraw')
}

// ==================== 数据分析 / 明细 ====================

/** 代理商点击分析（可传 start/end 自定义日期区间） */
export function getAgencyAnalytics(days = 30, start?: string, end?: string) {
  return get<AgencyAnalytics>('/agencies/analytics', { days, start, end })
}

/** 点击明细分页查询 */
export function getAgencyClicks(params: {
  page?: number
  pageSize?: number
  keyword?: string
  agencyId?: string
  envName?: string
  device?: string
  start?: string
  end?: string
}) {
  return get<PageResult<AgencyClickLog>>('/agencies/clicks', params)
}
