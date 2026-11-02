import { formatTime } from './format'

/**
 * 操作日志展示：把后端写入的英文动作码 / 原始 JSON 详情转成中文可读文本。
 * 历史数据大量是 `JSON.stringify(...)`，新数据也有部分英文动作码，统一在前端做兜底转换，
 * 后端写入逻辑保持不动，避免影响已有日志。
 */

/** 英文动作码 → 中文（历史上 IP 池 / 企业成员相关接口写入的是英文码） */
const ACTION_LABELS: Record<string, string> = {
  'ip.pool.mode': '切换 IP 池存储模式',
  'ip.resource.delete': '删除 IP 资源',
  'ip.resource.status': '启停 IP 资源',
  'ip.resource.update': '修改 IP 资源',
  'ip.resource.import': '导入 IP 资源',
  'ip.recycle': '回收 IP 资源',
  'team.member.create': '创建企业成员',
  'team.member.update': '修改企业成员',
  'team.member.reset_password': '重置成员密码',
  'team.member.unlock': '解锁企业成员',
  'team.member.delete': '删除企业成员',
}

/** 固定目标码 → 中文 */
const TARGET_LABELS: Record<string, string> = {
  site_settings: '站点设置',
  site_security: '网站安全策略',
  'latest-release': '最新版本',
  'account:0': '全部账号',
}

/** 详情 JSON 的键 → 中文标签 */
const KEY_LABELS: Record<string, string> = {
  // 系统设置 / 通知配置
  heartbeat_interval_hours: '心跳间隔（小时）',
  offline_grace_days: '离线宽限（天）',
  force_online_activate: '强制在线激活',
  notice: '公告内容',
  notice_title: '公告标题',
  notice_content: '公告正文',
  notice_strong: '公告加粗',
  notice_link: '公告链接',
  online_threshold_minutes: '在线判定阈值（分钟）',
  log_retention_days: '日志保留天数',
  log_clean_time: '日志清理时间',
  mail_enabled: '邮件发送',
  smtp_host: 'SMTP 服务器',
  smtp_port: 'SMTP 端口',
  smtp_user: 'SMTP 账号',
  smtp_pass: 'SMTP 密码',
  smtp_from: '发件人地址',
  mail_from_name: '发件人名称',
  mail_site_url: '邮件站点地址',
  sms_enabled: '短信发送',
  sms_provider: '短信服务商',
  sms_access_key_id: '短信 AccessKey ID',
  sms_access_key_secret: '短信 AccessKey Secret',
  sms_sign_name: '短信签名',
  sms_region: '短信区域',
  sms_tpl_verify_code: '验证码模板',
  sms_admin_phone: '管理员手机号',
  notify_dingtalk_url: '钉钉机器人地址',
  notify_dingtalk_secret: '钉钉机器人密钥',
  notify_wecom_url: '企业微信机器人地址',
  notify_email_to: '通知收件邮箱',
  notify_sms_phone: '通知收件手机',
  notify_admin_email: '管理员收件邮箱',
  notify_admin_phone: '管理员收件手机',
  notify_global_enabled: '全局通知开关',
  // 公告发送
  title: '标题',
  strong: '加粗',
  link: '链接',
  delivered: '推送数量',
  sendAt: '发送时间',
  // 营销邮件发送结果
  total: '收件人总数',
  sent: '成功',
  failed: '失败',
  skipped: '跳过',
  // 套餐 / 席位 / 通知模板等
  code: '编码',
  label: '名称',
  version: '版本',
  level: '级别',
  seats: '席位',
  duration: '时长',
  mallUrl: '商城链接',
  enabled: '启用',
  audience: '受众',
  channels: '渠道',
  auto: '自动触发',
  name: '名称',
  event: '事件',
  content: '内容',
  // 激活码 / 席位变更
  seatDelta: '席位变化',
  count: '数量',
  enterpriseId: '企业 ID',
  keyId: '激活码 ID',
  reason: '原因',
  status: '状态',
}

/** 0/1 开关类字段的取值文案 */
const FLAG_KEYS = new Set([
  'mail_enabled',
  'sms_enabled',
  'notice_strong',
  'notify_global_enabled',
  'force_online_activate',
  'enabled',
  'strong',
  'auto',
])

/** 敏感字段：不展示明文 */
const SECRET_KEYS = new Set(['smtp_pass', 'sms_access_key_secret', 'notify_dingtalk_secret'])

const VALUE_LABELS: Record<string, Record<string, string>> = {
  sms_provider: { aliyun: '阿里云' },
  sms_region: {
    'cn-hangzhou': '华东 1（杭州）',
    'cn-shanghai': '华东 2（上海）',
    'cn-beijing': '华北 2（北京）',
    'cn-shenzhen': '华南 1（深圳）',
  },
  version: { '1': '个人', '2': '企业' },
  level: { '1': '普通', '2': '高级' },
  audience: { user: '给用户', admin: '给管理员' },
  status: { '0': '停用', '1': '启用' },
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (SECRET_KEYS.has(key)) return '已设置'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') {
    if (key === 'seatDelta') return value > 0 ? `+${value}` : String(value)
    if (key === 'sendAt' && value > 1e12) return formatTime(value)
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.length ? value.map((v) => formatValue(key, v)).join('、') : '—'
  }
  if (isPlainObject(value)) return formatObject(value)
  const text = String(value)
  if (text === '__SET__') return '已设置（不修改）'
  if (text === '') return '（空）'
  if (FLAG_KEYS.has(key) && (text === '0' || text === '1')) return text === '1' ? '开启' : '关闭'
  const mapped = VALUE_LABELS[key]?.[text]
  return mapped || text
}

function formatObject(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([key, value]) => `${KEY_LABELS[key] || key}：${formatValue(key, value)}`)
    .join('；')
}

/** 动作列展示 */
export function formatLogAction(action: string | null | undefined): string {
  if (!action) return '-'
  return ACTION_LABELS[action] || action
}

/** 目标列展示 */
export function formatLogTarget(target: string | null | undefined): string {
  if (!target) return '-'
  const hit = TARGET_LABELS[target]
  if (hit) return hit
  const account = target.match(/^account:(\d+)$/)
  if (account) return `账号 #${account[1]}`
  return target
}

/** 详情列展示：JSON → 中文键值；普通文本原样返回 */
export function formatLogDetail(detail: string | null | undefined): string {
  if (!detail) return '-'
  const text = detail.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return detail
  try {
    const parsed = JSON.parse(text) as unknown
    if (isPlainObject(parsed)) {
      const out = formatObject(parsed)
      return out || '-'
    }
    if (Array.isArray(parsed)) {
      return parsed.map((item) => (isPlainObject(item) ? formatObject(item) : formatValue('', item))).join('；')
    }
  } catch {
    /* 非合法 JSON 时按原文展示 */
  }
  return detail
}
