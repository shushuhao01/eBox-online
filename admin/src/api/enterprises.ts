import { get, patch, type PageResult } from './request'

export interface EnterpriseItem {
  id: string
  code: string
  codePrefix: string
  name: string
  ownerAccountId: string
  ownerLogin: string | null
  seats: number
  usedSeats: number
  skuId: string | null
  status: number
  expireAt: string | null
  createdAt: string
}

export interface EnterpriseMemberItem {
  id: string
  accountId: string
  login: string | null
  nickname: string | null
  email?: string | null
  role: number
  hint: string | null
  remark: string | null
  status: number
  accountStatus: number | null
  lastLoginIp?: string | null
  lastLoginAt: string | null
  createdAt: string
}

export interface EnterpriseKeyItem {
  id: string
  code: string
  tier: number
  level: number
  tierCode: string | null
  durationDays: number
  seats: number
  status: number
  bound: number
  accountId: string | null
  accountLogin: string | null
  activatedAt: string | null
  accountExpireAt: string | null
  usedAt: string | null
  createdAt: string
}

export interface EnterpriseIpResourceItem {
  id: string
  host: string
  port: number
  proxyType: string
  status: number
  health: number
  remark: string | null
  assigned: boolean
}

export interface EnterpriseEntitlements {
  version: string
  level: string
  role: string
  expireAt: string | null
  permanent: boolean
  seats: number
  tier: number | null
  activeKeyId: string | null
}

export interface EnterpriseDetail {
  enterprise: Omit<EnterpriseItem, 'usedSeats'> & {
    ownerNickname: string | null
    ownerEmail: string | null
    ownerLastLoginAt: string | null
    usedSeats: number
    skuLabel: string | null
    updatedAt: string | null
  }
  entitlements: EnterpriseEntitlements | null
  members: EnterpriseMemberItem[]
  keys: EnterpriseKeyItem[]
  ipResources: {
    total: number
    enabled: number
    assigned: number
    using: number
    list: EnterpriseIpResourceItem[]
  }
}

export function getEnterprises(params: {
  page?: number
  pageSize?: number
  keyword?: string
  status?: number | ''
}) {
  return get<PageResult<EnterpriseItem>>('/enterprises', params)
}

export function getEnterpriseDetail(id: string) {
  return get<EnterpriseDetail>(`/enterprises/${id}`)
}

/** 人工加席位（仅超管；只增不减） */
export function updateEnterpriseSeats(id: string, seats: number) {
  return patch<{ id: string; seats: number }>(`/enterprises/${id}/seats`, { seats })
}
