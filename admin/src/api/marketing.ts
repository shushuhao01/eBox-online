import { get, post, put, del, type PageResult } from './request'

/** 营销邮件活动 */
export interface MarketingCampaignRow {
  id: string
  title: string
  subject: string | null
  content: string | null
  audience_type: 'ALL_USERS' | 'USER_IDS' | 'EMAILS'
  target_json: string | null
  status: 'DRAFT' | 'SCHEDULED' | 'SENT'
  sent_count: number
  failed_count: number
  opened_count?: number
  send_at: string | null
  sent_at: string | null
  created_at: string
}

/** 收件人快照 */
export interface MarketingRecipientRow {
  id: string
  email: string
  username: string | null
  delivered: number
  error: string | null
  sent_at: string | null
  opened_at: string | null
}

export interface CampaignPayload {
  title: string
  subject?: string | null
  content?: string | null
  audience_type?: string
  target_json?: string | null
  send_at?: string | null
}

export interface AudienceSuggestions {
  all_users: number
  emails: string[]
  usernames: string[]
}

export function getCampaigns(params: { page?: number; pageSize?: number; keyword?: string; status?: string } = {}) {
  return get<PageResult<MarketingCampaignRow>>('/marketing/campaigns', params as Record<string, unknown>)
}

export function createCampaign(data: CampaignPayload) {
  return post<MarketingCampaignRow>('/marketing/campaigns', data)
}

export function updateCampaign(id: string, data: CampaignPayload) {
  return put<MarketingCampaignRow>(`/marketing/campaigns/${id}`, data)
}

export function deleteCampaign(id: string) {
  return del<{ id: string }>(`/marketing/campaigns/${id}`)
}

export function sendCampaign(id: string) {
  return post<{ scheduled: boolean; sent?: number; send_at?: string }>(`/marketing/campaigns/${id}/send`)
}

export function getRecipients(id: string, params: { page?: number; pageSize?: number } = {}) {
  return get<PageResult<MarketingRecipientRow>>(`/marketing/campaigns/${id}/recipients`, params as Record<string, unknown>)
}

export function getAudienceSuggestions() {
  return get<AudienceSuggestions>('/marketing/audience-suggestions')
}
