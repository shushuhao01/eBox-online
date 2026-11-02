import { get, post, patch, type PageResult } from './request'

export interface AccountItem {
  id: string
  login: string
  nickname: string | null
  email: string | null
  phone: string | null
  role: number
  status: number
  lockCount: number
  lockedUntil: string | null
  everEnterprise: boolean
  enterpriseId: string | null
  enterpriseCode: string | null
  enterpriseName: string | null
  lastLoginAt: string | null
  createdAt: string
}

export interface AccountMetrics {
  accounts: { total: number; todayNew: number; locked: number; lockTotal: number; disabled: number; lockedRate: number }
  enterprises: { total: number; expiring7: number; expired: number }
  ipResources: { total: number; abnormal: number; abnormalRate: number; activeBindings: number }
  vouchers: { upgradeUsed7: number; seatUsed7: number }
}

export function getAccounts(params: {
  page?: number
  pageSize?: number
  keyword?: string
  status?: number | ''
  role?: number | ''
}) {
  return get<PageResult<AccountItem>>('/accounts', params)
}

export function getAccountMetrics() {
  return get<AccountMetrics>('/accounts/metrics')
}

export function unlockAccount(id: string) {
  return post(`/accounts/${id}/unlock`)
}

export function resetAccountPassword(id: string) {
  return post<{ login: string; password: string }>(`/accounts/${id}/reset-password`)
}

export function setAccountStatus(id: string, status: 1 | 2) {
  return patch(`/accounts/${id}/status`, { status })
}
