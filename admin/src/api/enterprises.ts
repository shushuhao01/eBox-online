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
  role: number
  hint: string | null
  remark: string | null
  status: number
  accountStatus: number | null
  lastLoginAt: string | null
  createdAt: string
}

export interface EnterpriseDetail {
  enterprise: Omit<EnterpriseItem, 'usedSeats'>
  members: EnterpriseMemberItem[]
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
