import { get, post, put, type PageResult } from './request'

export interface SkuItem {
  id: string
  code: string
  version: number
  level: number
  duration: string
  durationDays: number
  label: string
  seats: number
  mallUrl: string | null
  capsJson: string | null
  enabled: boolean
  sort: number
}

export interface UpgradeLinksState {
  links: Record<string, string>
  seatAddonMallUrl: string
  config: {
    disclaimerVersion: number
    upgradeLinks: Record<string, string>
    seatAddonMallUrl: string
    ipResourceVersion: number
    configVersion: number
    tiers: Array<{
      code: string
      version: number
      level: number
      duration: string
      durationDays: number
      label: string
      seats: number
      mallUrl: string
    }>
  }
}

export interface UpgradeCodeRow {
  id: string
  code: string
  toSkuCode: string | null
  toSkuLabel: string | null
  toDuration: string | null
  accountId: string | null
  amount: string | null
  remark: string | null
  status: number
  validUntil: string | null
  usedAt: string | null
  usedBy: string | null
  createdAt: string
}

export interface SeatAddonRow {
  id: string
  code: string
  seatDelta: number
  enterpriseId: string | null
  remark: string | null
  status: number
  validUntil: string | null
  usedAt: string | null
  usedBy: string | null
  createdAt: string
}

// ==================== SKU / 商城链接 ====================

export function getSkus() {
  return get<SkuItem[]>('/skus')
}

export function updateSku(id: string, data: Partial<SkuItem> & { capsJson?: string | null }) {
  return put<SkuItem>(`/skus/${id}`, data)
}

export function toggleSku(id: string, enabled: boolean) {
  return post<SkuItem>(`/skus/${id}/toggle`, { enabled })
}

export function getUpgradeLinks() {
  return get<UpgradeLinksState>('/upgrade-links')
}

/** 保存商城链接（保存即 SSE 推送；返回推送到的在线客户端数） */
export function saveUpgradeLinks(data: { links?: Record<string, string>; seatAddonMallUrl?: string }) {
  return put<UpgradeLinksState['config'] & { delivered: number }>('/upgrade-links', data)
}

/** 仅重新广播当前客户端配置（不修改任何链接） */
export function pushClientConfig() {
  return post<{ delivered: number }>('/push-config')
}

// ==================== 升级码 ====================

export function getUpgradeCodes(params: {
  page?: number
  pageSize?: number
  status?: number | ''
  keyword?: string
}) {
  return get<PageResult<UpgradeCodeRow>>('/upgrade-codes', params)
}

export function createUpgradeCodes(data: {
  duration: string
  toSkuId?: string | null
  fromSkuId?: string | null
  accountId?: string | null
  remark?: string
  validUntil?: string | null
  count: number
}) {
  return post<UpgradeCodeRow[]>('/upgrade-codes', data)
}

export function voidUpgradeCode(id: string) {
  return post(`/upgrade-codes/${id}/void`)
}

// ==================== 席位扩容码 ====================

export function getSeatAddons(params: {
  page?: number
  pageSize?: number
  status?: number | ''
  keyword?: string
}) {
  return get<PageResult<SeatAddonRow>>('/seat-addons', params)
}

export function createSeatAddons(data: {
  seatDelta: number
  count: number
  enterpriseId?: string | null
  remark?: string
  validUntil?: string | null
}) {
  return post<SeatAddonRow[]>('/seat-addons', data)
}

export function voidSeatAddon(id: string) {
  return post(`/seat-addons/${id}/void`)
}
