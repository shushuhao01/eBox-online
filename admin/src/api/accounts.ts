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
  /** 客户端版本：账号最近在线设备上报的 version，无设备时为 null */
  clientVersion: string | null
  /** 卡密档位：月卡/季卡/年卡/永久，未绑卡时为 null */
  keyPlan: string | null
  /** 身份版本：1=个人 2=企业（取当前生效卡密，无生效卡密时为 null） */
  tier: number | null
  /** 身份等级：1=普通 2=高级（取当前生效卡密，无生效卡密时为 null） */
  level: number | null
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

// ==================== 用户完整档案 ====================

export interface AccountKeyRow {
  id: string
  code: string
  type: number
  tier: number
  level: number
  tierCode: string | null
  durationDays: number
  seats: number
  status: number
  bound: boolean | number
  unbindMax: number
  enterpriseId: string | null
  activatedAt: string | null
  permanent: boolean
  effectiveExpireAt: string | null
  accountExpireAt: string | null
  expireAt: string | null
  usedAt: string | null
  createdAt: string
  remark: string | null
}

export interface AccountActivationRow {
  id: string
  keyId: string
  keyCode: string | null
  tier: number | null
  level: number | null
  machineFp: string
  status: number
  firstActivateAt: string | null
  lastOnlineAt: string | null
  lastHeartbeatAt: string | null
  lastIp: string | null
  region: string | null
  osInfo: string | null
  appVersion: string | null
  online: boolean
}

export interface AccountDeviceRow {
  id: string
  machineFp: string
  deviceName: string | null
  osInfo: string | null
  appVersion: string | null
  status: number
  envTotal: number
  envRunning: number
  boundResourceIds: string[]
  firstLoginAt: string | null
  lastActiveAt: string | null
  online: boolean
}

export interface AccountSessionRow {
  id: string
  machineFp: string | null
  clientIp: string | null
  region: string | null
  userAgent: string | null
  createdAt: string
  lastSeenAt: string | null
  expiresAt: string
  revokedAt: string | null
  online: boolean
}

export interface AccountIpRow {
  id: string
  resourceId: string
  proxyType: string | null
  host: string | null
  port: number | null
  remark: string | null
  health: number | null
  status: number
  envId: string | null
  envName: string | null
  boundAt: string | null
  releasedAt: string | null
  releaseReason: string | null
}

export interface AccountDetail {
  account: AccountItem & { lastLoginIp: string | null; lastLoginRegion: string | null; updatedAt: string | null }
  enterprise: {
    id: string; code: string; name: string; status: number
    seats: number; expireAt: string | null; createdAt: string
  } | null
  entitlements: {
    version: string
    level: string
    role: string
    expireAt: string | null
    permanent: boolean
    seats: number
    tier: string | null
    activeKeyId: string | null
  }
  currentKey: {
    id: string; codeMasked: string; tier: number; level: number; tierCode: string | null
    seats: number; status: number; permanent: boolean; activatedAt: string | null
    expireAt: string | null; enterpriseId: string | null; replacedBy: string | null
  } | null
  keys: AccountKeyRow[]
  devices: AccountDeviceRow[]
  activations: AccountActivationRow[]
  sessions: AccountSessionRow[]
  ipResources: AccountIpRow[]
}

export function getAccountDetail(id: string) {
  return get<AccountDetail>(`/accounts/${id}/detail`)
}
