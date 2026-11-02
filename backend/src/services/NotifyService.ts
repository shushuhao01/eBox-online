import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { AppDataSource } from '../config/database';
import { NotificationTemplate } from '../entities/account/NotificationTemplate';
import { SystemMessage } from '../entities/account/SystemMessage';
import { log } from '../config/logger';
import { getConfigValue } from './ConfigService';
import { sendMail } from './MailService';
import { loadSmtpConfig, getMailFromName, isMailEnabled } from './SmtpConfigService';
import { loadAliyunSmsConfig, sendSms, isSmsEnabled, isValidMainlandPhone } from './AliyunSmsService';

/**
 * 通知编排：
 * - 邮件 / 短信 / 钉钉 / 企业微信 / 站内信
 * - 模板占位符为单花括号（{username}），发送前统一注入 site_name / time
 * - 业务通知失败只记日志，不影响主流程；验证码邮件由调用方决定是否向用户提示失败
 */

export type NotifyChannel = 'DINGTALK' | 'WECOM' | 'EMAIL' | 'SMS' | 'SYSTEM';

export type NotifyVars = Record<string, string | number | null | undefined>;

export interface NotifyChannelResult {
  channel: string;
  status: 'ok' | 'fail' | 'skipped';
  message: string;
}

const CHANNELS: NotifyChannel[] = ['DINGTALK', 'WECOM', 'EMAIL', 'SMS', 'SYSTEM'];

const templateRepo = () => AppDataSource.getRepository(NotificationTemplate);
const messageRepo = () => AppDataSource.getRepository(SystemMessage);

/** 单花括号逐键替换；未提供的键保持原样 */
export function render(text: string | null | undefined, vars: NotifyVars): string {
  if (!text) return '';
  return String(text).replace(/\{(\w+)\}/g, (raw, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return raw;
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 注入公共变量；调用方传入的变量优先覆盖 */
async function buildVars(vars: NotifyVars): Promise<Record<string, string>> {
  const siteName = (await getConfigValue('site_name')).trim() || 'eBox';
  const out: Record<string, string> = {
    site_name: siteName,
    time: formatDateTime(new Date()),
  };
  for (const [k, v] of Object.entries(vars)) {
    out[k] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

function parseChannels(raw: string | null | undefined): NotifyChannel[] {
  const list = String(raw || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is NotifyChannel => (CHANNELS as string[]).includes(s));
  return list.filter((c, i) => list.indexOf(c) === i);
}

function channelResult(channel: string, status: NotifyChannelResult['status'], message: string): NotifyChannelResult {
  return { channel, status, message };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 邮件 HTML 排版：品牌头 + 标题卡片 + 正文 + 页脚（表格布局，兼容主流邮箱客户端） */
function wrapHtml(title: string, content: string, siteName = 'eBox'): string {
  const site = escapeHtml(siteName || 'eBox');
  const safeTitle = escapeHtml(title || site);
  const body = escapeHtml(content).replace(/\r?\n/g, '<br>');
  const year = new Date().getFullYear();
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${safeTitle}</title></head>`,
    '<body style="margin:0;padding:0;background:#eef2f9;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f9;padding:32px 12px;">',
    '<tr><td align="center">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(23,43,77,0.08);font-family:-apple-system,\'Segoe UI\',\'Microsoft YaHei\',Arial,sans-serif;">',
    '<tr><td style="background:#2563eb;padding:22px 32px;">',
    `<div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:.5px;">${site}</div>`,
    '<div style="margin-top:4px;font-size:12px;color:rgba(255,255,255,.78);">授权服务通知</div>',
    '</td></tr>',
    '<tr><td style="padding:32px 32px 8px;">',
    `<div style="font-size:19px;font-weight:700;color:#17203a;line-height:1.5;">${safeTitle}</div>`,
    '<div style="margin-top:18px;height:3px;width:44px;background:#2563eb;border-radius:2px;"></div>',
    `<div style="margin-top:20px;font-size:14px;line-height:1.9;color:#3c4661;word-break:break-word;">${body}</div>`,
    '</td></tr>',
    '<tr><td style="padding:24px 32px 32px;">',
    '<div style="height:1px;background:#edf0f7;"></div>',
    '<div style="margin-top:16px;font-size:12px;line-height:1.8;color:#98a1b8;">',
    `此邮件由 ${site} 授权服务系统自动发送，请勿直接回复。<br>`,
    `如非本人操作或存在疑问，请及时联系客服。© ${year} ${site}`,
    '</div></td></tr>',
    '</table></td></tr></table></body></html>',
  ].join('');
}

function firstRecipient(raw: string): string {
  return String(raw || '')
    .split(/[,;，；]/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';
}

/** 短信模板变量只接受字符串键值 */
function toStringVars(vars: NotifyVars): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = v === undefined || v === null ? '' : String(v);
  return out;
}

function appendQuery(urlStr: string, params: Record<string, string>): string {
  const u = new URL(urlStr);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** POST JSON（钉钉 / 企业微信 Webhook）；errcode 非 0 视为失败 */
function postJson(urlStr: string, payload: unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      reject(new Error('Webhook 地址无效'));
      return;
    }
    const body = JSON.stringify(payload);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const requester = url.protocol === 'http:' ? http.request : https.request;
    const req = requester(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        raw += chunk;
      });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Webhook 返回 HTTP ${res.statusCode}`));
          return;
        }
        try {
          const data = JSON.parse(raw) as { errcode?: number; errmsg?: string };
          if (typeof data.errcode === 'number' && data.errcode !== 0) {
            reject(new Error(`Webhook 返回错误（${data.errcode}）：${data.errmsg || ''}`));
            return;
          }
        } catch {
          // 非 JSON 响应按成功处理
        }
        resolve();
      });
    });
    req.on('timeout', () => req.destroy(new Error('Webhook 请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendDingtalk(title: string, content: string): Promise<NotifyChannelResult> {
  const url = (await getConfigValue('notify_dingtalk_url')).trim();
  if (!url) return channelResult('DINGTALK', 'skipped', '未配置钉钉 Webhook');
  const secret = (await getConfigValue('notify_dingtalk_secret')).trim();
  let target = url;
  if (secret) {
    const timestamp = Date.now();
    const sign = crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
    target = appendQuery(url, { timestamp: String(timestamp), sign });
  }
  await postJson(target, { msgtype: 'markdown', markdown: { title, text: `### ${title}\n\n${content}` } });
  return channelResult('DINGTALK', 'ok', '已发送');
}

async function sendWecom(title: string, content: string): Promise<NotifyChannelResult> {
  const url = (await getConfigValue('notify_wecom_url')).trim();
  if (!url) return channelResult('WECOM', 'skipped', '未配置企业微信 Webhook');
  await postJson(url, { msgtype: 'markdown', markdown: { content: `### ${title}\n\n${content}` } });
  return channelResult('WECOM', 'ok', '已发送');
}

function isAdminAudience(template: NotificationTemplate): boolean {
  return String(template.audience || '').toLowerCase() === 'admin';
}

/** 管理员收件邮箱：优先 notify_admin_email，兼容旧的 notify_email_to */
async function adminEmailRecipient(): Promise<string> {
  const dedicated = firstRecipient(await getConfigValue('notify_admin_email'));
  return dedicated || firstRecipient(await getConfigValue('notify_email_to'));
}

/** 管理员收件手机号：优先 notify_admin_phone，兼容旧的 notify_sms_phone */
async function adminSmsRecipient(): Promise<string> {
  const dedicated = firstRecipient(await getConfigValue('notify_admin_phone'));
  return dedicated || firstRecipient(await getConfigValue('notify_sms_phone'));
}

async function sendEmailChannel(
  template: NotificationTemplate,
  title: string,
  content: string,
  vars: NotifyVars,
  force: boolean
): Promise<NotifyChannelResult> {
  if (!force && !(await isMailEnabled())) return channelResult('EMAIL', 'skipped', '未启用邮件发件');
  const admin = isAdminAudience(template);
  // 测试发送统一投递到管理员邮箱，便于运营验证模板效果
  let to = admin || force ? await adminEmailRecipient() : firstRecipient(String(vars.email ?? ''));
  if (!to && force) to = firstRecipient(String(vars.email ?? ''));
  if (!to) {
    return channelResult('EMAIL', 'skipped', admin ? '未配置管理员收件邮箱' : '缺少用户邮箱地址');
  }
  const smtp = await loadSmtpConfig();
  if (!smtp) return channelResult('EMAIL', 'skipped', '未配置 SMTP 服务');
  const siteName = (await getConfigValue('site_name')).trim() || 'eBox';
  await sendMail(smtp, {
    to,
    subject: title,
    text: content,
    html: wrapHtml(title, content, siteName),
    fromName: await getMailFromName(),
  });
  return channelResult('EMAIL', 'ok', `已发送至 ${to}`);
}

async function sendSmsChannel(
  template: NotificationTemplate,
  smsVars: NotifyVars,
  force: boolean
): Promise<NotifyChannelResult> {
  if (!force && !(await isSmsEnabled())) return channelResult('SMS', 'skipped', '未启用短信');
  const templateCode = (template.smsTemplateCode || '').trim();
  if (!templateCode) return channelResult('SMS', 'skipped', '模板未配置短信模板 CODE');
  const admin = isAdminAudience(template);
  let phone = admin || force ? await adminSmsRecipient() : firstRecipient(String(smsVars.phone ?? ''));
  if (!phone && force) phone = firstRecipient(String(smsVars.phone ?? ''));
  if (!phone) {
    return channelResult('SMS', 'skipped', admin ? '未配置管理员手机号' : '缺少用户手机号');
  }
  if (!isValidMainlandPhone(phone)) return channelResult('SMS', 'fail', '通知手机号格式不正确');
  const smsConfig = await loadAliyunSmsConfig();
  if (!smsConfig) return channelResult('SMS', 'skipped', '未配置阿里云 AccessKey');
  const signName = (await getConfigValue('sms_sign_name')).trim();
  if (!signName) return channelResult('SMS', 'skipped', '未配置短信签名');
  await sendSms(smsConfig, { phone, signName, templateCode, templateParam: toStringVars(smsVars) });
  return channelResult('SMS', 'ok', `已发送至 ${phone}`);
}

async function dispatchChannels(
  template: NotificationTemplate,
  channels: NotifyChannel[],
  title: string,
  content: string,
  smsVars: NotifyVars,
  force: boolean
): Promise<NotifyChannelResult[]> {
  const results: NotifyChannelResult[] = [];
  for (const channel of channels) {
    if (channel === 'SYSTEM') {
      results.push(channelResult('SYSTEM', 'ok', '已写入站内信'));
      continue;
    }
    try {
      if (channel === 'DINGTALK') results.push(await sendDingtalk(title, content));
      else if (channel === 'WECOM') results.push(await sendWecom(title, content));
      else if (channel === 'EMAIL') results.push(await sendEmailChannel(template, title, content, smsVars, force));
      else if (channel === 'SMS') results.push(await sendSmsChannel(template, smsVars, force));
    } catch (e) {
      const message = errorMessage(e);
      log.error(`通知渠道发送失败（${template.code}/${channel}）：${message}`);
      results.push(channelResult(channel, 'fail', message));
    }
  }
  return results;
}

async function findTemplate(code: string): Promise<NotificationTemplate | null> {
  return templateRepo().findOneBy({ code });
}

/** 写站内信；category 存模板 code（截断 32 位），用于临期提醒按日去重 */
async function writeSystemMessage(template: NotificationTemplate, title: string, content: string): Promise<void> {
  try {
    await messageRepo().save(
      messageRepo().create({
        title: (title || template.name).slice(0, 255),
        content,
        category: String(template.code || '').slice(0, 32),
        isRead: 0,
      })
    );
  } catch (e) {
    log.error(`站内信写入失败（${template.code}）：${errorMessage(e)}`);
  }
}

/** 当天是否已写过同 code 且包含指定标记的站内信（临期提醒去重） */
async function wasNotifiedToday(code: string, ...markers: string[]): Promise<boolean> {
  const qb = messageRepo()
    .createQueryBuilder('m')
    .where('m.category = :code', { code: code.slice(0, 32) })
    .andWhere('m.createdAt >= CURDATE()');
  markers.forEach((marker, i) => {
    if (!marker) return;
    qb.andWhere(`m.content LIKE :marker${i}`, { [`marker${i}`]: `%${marker}%` });
  });
  return (await qb.getCount()) > 0;
}

/**
 * 业务通知：模板启用且允许自动触发时才外发；始终写一条站内信。
 * 任何异常都被吞掉，避免影响注册/激活等主流程。
 */
export async function sendTemplate(code: string, vars: NotifyVars = {}): Promise<NotifyChannelResult[]> {
  try {
    const template = await findTemplate(code);
    if (!template) {
      log.warn(`通知模板不存在：${code}`);
      return [];
    }
    const finalVars = await buildVars(vars);
    const title = render(template.title || template.name, finalVars) || template.name;
    const content = render(template.content || '', finalVars);
    await writeSystemMessage(template, title, content);

    if (template.isEnabled !== 1 || template.autoTrigger !== 1) return [];
    if ((await getConfigValue('notify_global_enabled')) !== '1') return [];
    return dispatchChannels(template, parseChannels(template.channels), title, content, finalVars, false);
  } catch (e) {
    log.error(`通知发送失败（${code}）：${errorMessage(e)}`);
    return [];
  }
}

/** 功能性邮件（验证码等）：忽略模板 enabled/channels，直接走 SMTP；失败抛错由调用方提示 */
export async function sendTemplateToEmail(code: string, to: string, vars: NotifyVars = {}): Promise<void> {
  const template = await findTemplate(code);
  const finalVars = await buildVars(vars);
  const title = render(template?.title || template?.name || 'eBox 通知', finalVars);
  const fallback = vars.code ? `您的验证码为 ${vars.code}` : '';
  const content = template?.content ? render(template.content, finalVars) : fallback;
  const smtp = await loadSmtpConfig();
  if (!smtp) throw new Error('未配置邮件服务');
  await sendMail(smtp, {
    to,
    subject: title,
    text: content,
    html: wrapHtml(title, content, finalVars.site_name),
    fromName: await getMailFromName(),
  });
}

/** 功能性短信：短信启用且模板配置了 sms_template_code 才发送；失败仅记日志 */
export async function sendTemplateToSms(code: string, to: string, vars: NotifyVars = {}): Promise<void> {
  try {
    if (!(await isSmsEnabled())) return;
    if (!isValidMainlandPhone(to)) return;
    const template = await findTemplate(code);
    const templateCode = (template?.smsTemplateCode || '').trim();
    if (!templateCode) return;
    const smsConfig = await loadAliyunSmsConfig();
    if (!smsConfig) return;
    const signName = (await getConfigValue('sms_sign_name')).trim();
    if (!signName) return;
    await sendSms(smsConfig, { phone: to, signName, templateCode, templateParam: toStringVars(vars) });
  } catch (e) {
    log.error(`功能性短信发送失败（${code}）：${errorMessage(e)}`);
  }
}

/** 版本升级通知：只发渠道 + 站内信，不遍历账号群发邮件 */
export async function notifyVersionUpgrade(version: string, changelog: string | string[]): Promise<void> {
  const text = Array.isArray(changelog) ? changelog.join('\n') : String(changelog || '');
  await sendTemplate('VERSION_UPGRADE', { version, changelog: text });
}

/** 管理端「测试发送」：忽略全局开关与模板启用状态，逐渠道返回结果 */
export async function testTemplateChannels(code: string): Promise<NotifyChannelResult[]> {
  const template = await findTemplate(code);
  if (!template) throw new Error('模板不存在');
  const sampleVars: NotifyVars = {
    username: '测试用户',
    login: 'test_user',
    account: 'test_user',
    email: 'test@example.com',
    phone: '13800000000',
    code: '123456',
    minutes: 10,
    version: '1.0.0',
    expire_at: formatDate(new Date(Date.now() + 7 * 86400000)),
    days: 7,
    tier_text: '个人版普通',
    changelog: '测试更新内容',
    ip: '127.0.0.1',
  };
  const finalVars = await buildVars(sampleVars);
  const title = render(template.title || template.name, finalVars) || template.name;
  const content = render(template.content || '', finalVars);
  return dispatchChannels(template, parseChannels(template.channels), title, content, sampleVars, true);
}

/**
 * 每日临期扫描：到期前 N 天且当天未提醒过的账号，发送 LICENSE_EXPIRING。
 * 用 system_messages 按日去重，不新增表。
 */
export async function scanExpiringLicenseNotifications(withinDays = 7): Promise<number> {
  let sent = 0;
  try {
    const days = Math.max(1, Math.floor(withinDays));
    const rows: Array<{ login: string; nickname: string | null; email: string | null; expire_at: string | Date }> =
      await AppDataSource.query(
        `SELECT a.login AS login, a.nickname AS nickname, a.email AS email, MAX(k.account_expire_at) AS expire_at
           FROM accounts a
           JOIN license_keys k ON k.account_id = a.id
          WHERE k.status = 1
            AND k.account_expire_at IS NOT NULL
            AND k.account_expire_at > NOW()
            AND k.account_expire_at <= DATE_ADD(NOW(), INTERVAL ? DAY)
          GROUP BY a.id, a.login, a.nickname, a.email`,
        [days]
      );
    for (const row of rows) {
      const expireAt = new Date(row.expire_at);
      if (Number.isNaN(expireAt.getTime())) continue;
      const expireText = formatDate(expireAt);
      const username = row.nickname || row.login;
      if (await wasNotifiedToday('LICENSE_EXPIRING', username, expireText)) continue;
      await sendTemplate('LICENSE_EXPIRING', {
        username,
        email: row.email || '',
        days: Math.max(1, Math.ceil((expireAt.getTime() - Date.now()) / 86400000)),
        expire_at: expireText,
      });
      sent += 1;
    }
    // 管理员侧：临期授权汇总（当天有临期授权才发）
    if (sent > 0 && !(await wasNotifiedToday('ADMIN_LICENSE_EXPIRING', String(days)))) {
      await sendTemplate('ADMIN_LICENSE_EXPIRING', { count: sent, days });
    }
  } catch (e) {
    log.error(`临期提醒扫描失败：${errorMessage(e)}`);
  }
  return sent;
}
