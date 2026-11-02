import { get, type PageResult } from './request'

export interface IpResourceItem {
  id: string
  scope: number
  ownerAccountId: string | null
  ownerLogin: string | null
  enterpriseId: string | null
  enterpriseName: string | null
  proxyType: string
  host: string
  port: number
  usernameMasked: string
  remark: string | null
  status: number
  health: number
  latencyMs: number | null
  lastCheckAt: string | null
  createdAt: string
}

export function getIpResources(params: {
  page?: number
  pageSize?: number
  scope?: number | ''
  health?: number | ''
  status?: number | ''
  keyword?: string
}) {
  return get<PageResult<IpResourceItem>>('/ip-resources', params)
}
