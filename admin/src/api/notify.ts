import { get, post, put, del, type PageResult } from './request'

/** 通知配置（敏感字段读到已有值时返回 __SET__） */
export interface NotifyConfig {
  mail_enabled: string
  smtp_host: string
  smtp_port: string
  smtp_user: string
  smtp_pass: string
  smtp_from: string
  mail_from_name: string
  mail_site_url: string
  sms_enabled: string
  sms_provider: string
  sms_access_key_id: string
  sms_access_key_secret: string
  sms_sign_name: string
  sms_region: string
  sms_tpl_verify_code: string
  sms_admin_phone: string
  notify_dingtalk_url: string
  notify_dingtalk_secret: string
  notify_wecom_url: string
  notify_email_to: string
  notify_sms_phone: string
  notify_global_enabled: string
}

export interface NotificationTemplateRow {
  id: string
  code: string
  name: string
  category: string | null
  title: string | null
  content: string | null
  channels: string
  smsTemplateCode: string | null
  isEnabled: number
  autoTrigger: number
  sortOrder: number
  createdAt: string
  updatedAt: string | null
}

export interface TemplatePayload {
  code?: string
  name: string
  category?: string
  title?: string
  content?: string
  channels: string[]
  sms_template_code?: string
  is_enabled: number
  auto_trigger: number
  sort_order: number
}

export interface NotifyChannelResult {
  channel: string
  status: 'ok' | 'fail' | 'skipped'
  message: string
}

export interface SystemMessageRow {
  id: string
  title: string
  content: string | null
  category: string | null
  isRead: number
  createdAt: string
}

export interface TemplateQuery {
  page?: number
  pageSize?: number
  keyword?: string
  category?: string
}

/** 读取邮件 / 短信 / 通知渠道配置 */
export function getNotifyConfig() {
  return get<NotifyConfig>('/notify/config')
}

/** 保存通知配置（敏感字段留空或 __SET__ 表示不修改） */
export function updateNotifyConfig(data: Partial<NotifyConfig>) {
  return put<NotifyConfig>('/notify/config', data)
}

/** 发送测试邮件 */
export function testMail(to: string) {
  return post<{ ok: boolean }>('/notify/mail/test', { to })
}

/** 发送测试短信 */
export function testSms(data: { phone: string; template_code?: string }) {
  return post<Record<string, unknown>>('/notify/sms/test', data)
}

/** 只读校验阿里云 AccessKey */
export function testSmsConnection() {
  return post<{ ok: boolean; request_id: string; total: number }>('/notify/sms/test-connection')
}

/** 模板分页列表 */
export function getTemplates(params: TemplateQuery = {}) {
  return get<PageResult<NotificationTemplateRow>>('/notify/templates', params as Record<string, unknown>)
}

/** 新建模板 */
export function createTemplate(data: TemplatePayload) {
  return post<NotificationTemplateRow>('/notify/templates', data)
}

/** 更新模板（code 不可修改） */
export function updateTemplate(id: string, data: Partial<TemplatePayload>) {
  return put<NotificationTemplateRow>(`/notify/templates/${id}`, data)
}

/** 删除模板 */
export function deleteTemplate(id: string) {
  return del<{ id: string }>(`/notify/templates/${id}`)
}

/** 按模板编码测试全部渠道 */
export function testTemplate(templateCode: string) {
  return post<{ items: NotifyChannelResult[] }>('/notify/test', { template_code: templateCode })
}

/** 站内信分页列表 */
export function getMessages(params: { page?: number; pageSize?: number; category?: string } = {}) {
  return get<PageResult<SystemMessageRow>>('/notify/messages', params as Record<string, unknown>)
}

/** 未读站内信数量 */
export function getUnreadCount() {
  return get<{ count: number }>('/notify/messages/unread-count')
}

/** 标记单条已读 */
export function readMessage(id: string) {
  return post<{ id: string }>(`/notify/messages/${id}/read`)
}

/** 全部标记已读 */
export function readAllMessages() {
  return post<{ affected: number }>('/notify/messages/read-all')
}
