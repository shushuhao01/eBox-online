import crypto from 'crypto';
import { SelectQueryBuilder } from 'typeorm';
import { AppDataSource } from '../config/database';
import { MarketingCampaign } from '../entities/account/MarketingCampaign';
import { MarketingRecipient } from '../entities/account/MarketingRecipient';
import { Account } from '../entities/account/Account';
import { ApiError } from '../middleware/errorHandler';
import { log } from '../config/logger';
import { getConfigValue } from './ConfigService';
import { loadSmtpConfig, getMailFromName } from './SmtpConfigService';
import { sendMail } from './MailService';
import { render } from './NotifyService';

/**
 * 营销邮件（对齐 orion-key 的「营销管理 → 营销邮件」）：
 * - 受众：全部注册用户 / 指定账号 / 指定邮箱，按邮箱小写去重
 * - 发送：SMTP 逐封发送，收件人快照落库，支持送达 / 失败 / 打开统计
 * - 定时：send_at 晚于当前时间保存为 SCHEDULED，由每分钟任务到点发送
 */

export type AudienceType = 'ALL_USERS' | 'USER_IDS' | 'EMAILS';

const AUDIENCES: AudienceType[] = ['ALL_USERS', 'USER_IDS', 'EMAILS'];

export interface CampaignPayload {
  title: string;
  subject?: string | null;
  content?: string | null;
  audience_type?: string;
  target_json?: string | null;
  send_at?: string | null;
}

interface Recipient {
  email: string;
  username: string | null;
}

const campaignRepo = () => AppDataSource.getRepository(MarketingCampaign);
const recipientRepo = () => AppDataSource.getRepository(MarketingRecipient);
const accountRepo = () => AppDataSource.getRepository(Account);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDate(raw: string | null | undefined): Date | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const d = new Date(text.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseTargets(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return arr.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    /* 非 JSON 时按换行 / 逗号分隔 */
  }
  return String(raw)
    .split(/[\n,，;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HTML → 纯文本（作为不支持 HTML 客户端的兜底正文） */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeAudience(raw: unknown): AudienceType {
  const value = String(raw || 'ALL_USERS').toUpperCase() as AudienceType;
  return AUDIENCES.includes(value) ? value : 'ALL_USERS';
}

export function campaignMap(c: MarketingCampaign): Record<string, unknown> {
  return {
    id: c.id,
    title: c.title,
    subject: c.subject,
    content: c.content,
    audience_type: c.audienceType,
    target_json: c.targetJson,
    status: c.status,
    sent_count: c.sentCount,
    failed_count: c.failedCount,
    send_at: c.sendAt,
    sent_at: c.sentAt,
    created_at: c.createdAt,
  };
}

async function requireCampaign(id: string): Promise<MarketingCampaign> {
  const row = await campaignRepo().findOneBy({ id });
  if (!row) throw new ApiError('营销邮件不存在', 1002);
  return row;
}

export async function listCampaigns(
  keyword: string,
  status: string,
  page: number,
  pageSize: number
): Promise<{ total: number; page: number; pageSize: number; list: Record<string, unknown>[] }> {
  const qb = campaignRepo().createQueryBuilder('c');
  if (keyword) qb.andWhere('(c.title LIKE :kw OR c.subject LIKE :kw)', { kw: `%${keyword}%` });
  if (status) qb.andWhere('c.status = :status', { status });
  const total = await qb.getCount();
  const rows = await qb
    .orderBy('c.id', 'DESC')
    .skip((page - 1) * pageSize)
    .take(pageSize)
    .getMany();

  // 打开数按收件人快照聚合（列表只做一次分组统计，避免 N+1）
  const ids = rows.map((r) => r.id);
  const opened = new Map<string, number>();
  if (ids.length > 0) {
    const raw = await recipientRepo()
      .createQueryBuilder('r')
      .select('r.campaign_id', 'campaignId')
      .addSelect('COUNT(r.id)', 'count')
      .where('r.campaign_id IN (:...ids)', { ids })
      .andWhere('r.opened_at IS NOT NULL')
      .groupBy('r.campaign_id')
      .getRawMany<{ campaignId: string; count: string }>();
    for (const item of raw) opened.set(String(item.campaignId), Number(item.count) || 0);
  }
  return {
    total,
    page,
    pageSize,
    list: rows.map((r) => ({ ...campaignMap(r), opened_count: opened.get(String(r.id)) || 0 })),
  };
}

export async function createCampaign(body: CampaignPayload): Promise<Record<string, unknown>> {
  const title = String(body.title || '').trim();
  if (!title) throw new ApiError('邮件标题不能为空', 1004);
  const sendAt = parseDate(body.send_at);
  const row = campaignRepo().create({
    title,
    subject: (body.subject || '').trim() || null,
    content: body.content || '',
    audienceType: normalizeAudience(body.audience_type),
    targetJson: body.target_json || null,
    sendAt,
    status: sendAt && sendAt.getTime() > Date.now() ? 'SCHEDULED' : 'DRAFT',
    sentCount: 0,
    failedCount: 0,
  });
  return campaignMap(await campaignRepo().save(row));
}

export async function updateCampaign(id: string, body: CampaignPayload): Promise<Record<string, unknown>> {
  const row = await requireCampaign(id);
  if (row.status === 'SENT') throw new ApiError('已发送的邮件不可修改', 1005);
  const title = String(body.title || '').trim();
  if (!title) throw new ApiError('邮件标题不能为空', 1004);

  row.title = title;
  if (body.subject !== undefined) row.subject = (body.subject || '').trim() || null;
  if (body.content !== undefined) row.content = body.content || '';
  if (body.audience_type !== undefined) row.audienceType = normalizeAudience(body.audience_type);
  if (body.target_json !== undefined) row.targetJson = body.target_json || null;
  if (body.send_at !== undefined) row.sendAt = parseDate(body.send_at);
  row.status = row.sendAt && row.sendAt.getTime() > Date.now() ? 'SCHEDULED' : 'DRAFT';
  return campaignMap(await campaignRepo().save(row));
}

export async function deleteCampaign(id: string): Promise<void> {
  const row = await requireCampaign(id);
  await recipientRepo().delete({ campaignId: row.id });
  await campaignRepo().delete({ id: row.id });
}

/** 解析受众为收件人（按邮箱小写去重） */
async function resolveRecipients(c: MarketingCampaign): Promise<Recipient[]> {
  const list: Recipient[] = [];
  const seen = new Set<string>();
  const push = (email: string | null | undefined, username: string | null) => {
    const normalized = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    list.push({ email: normalized, username });
  };

  if (c.audienceType === 'EMAILS') {
    for (const email of parseTargets(c.targetJson)) push(email, null);
    return list;
  }

  if (c.audienceType === 'USER_IDS') {
    const tokens = parseTargets(c.targetJson);
    for (const token of tokens) {
      const account = await accountRepo()
        .createQueryBuilder('a')
        .where('a.login = :token OR a.email = :token', { token })
        .getOne();
      if (account && account.email) push(account.email, account.nickname || account.login);
      else if (EMAIL_RE.test(token)) push(token, null);
    }
    return list;
  }

  // ALL_USERS：全部有邮箱的注册账号
  const accounts = await accountRepo().find();
  for (const account of accounts) {
    if (!account.email) continue;
    push(account.email, account.nickname || account.login);
  }
  return list;
}

/** 打开追踪像素（需配置邮件站点地址；未配置时不插入） */
async function openPixel(token: string): Promise<string> {
  const base = (await getConfigValue('mail_site_url')).trim().replace(/\/+$/, '');
  if (!base) return '';
  return `<img src="${base}/api/marketing/open/${token}.gif" width="1" height="1" style="display:none" alt="">`;
}

/**
 * 逐封发送（后台执行，不阻塞 HTTP）。
 * 单封失败只记录到收件人快照，不中断整批。
 */
async function dispatch(campaignId: string, snapshot: MarketingCampaign, recipients: { id: string; email: string; username: string | null; token: string }[]): Promise<void> {
  const smtp = await loadSmtpConfig();
  const siteName = (await getConfigValue('site_name')).trim() || 'eBox';
  let sent = 0;
  let failed = 0;

  if (!smtp) {
    const message = '未配置 SMTP 服务';
    for (const r of recipients) {
      await recipientRepo().update({ id: r.id }, { error: message });
    }
    await campaignRepo().update({ id: campaignId }, { failedCount: recipients.length });
    log.error(`营销邮件发送失败：${message}（campaign=${campaignId}）`);
    return;
  }

  const fromName = await getMailFromName();
  for (const r of recipients) {
    const vars = {
      username: r.username || r.email.split('@')[0],
      email: r.email,
      site_name: siteName,
      time: formatDateTime(new Date()),
    };
    try {
      const subject = render(snapshot.subject || snapshot.title, vars);
      const body = render(snapshot.content || '', vars);
      const html = `${body}${await openPixel(r.token)}`;
      await sendMail(smtp, { to: r.email, subject, text: htmlToText(body), html, fromName });
      await recipientRepo().update({ id: r.id }, { delivered: 1, error: null, sentAt: new Date() });
      sent += 1;
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await recipientRepo().update({ id: r.id }, { error: message, delivered: 0 });
      failed += 1;
    }
  }
  await campaignRepo().update({ id: campaignId }, { sentCount: sent, failedCount: failed });
  log.info(`营销邮件发送完成（campaign=${campaignId}）：成功 ${sent}，失败 ${failed}`);
}

/** 立即发送；send_at 在未来时转为定时 */
export async function sendCampaign(id: string): Promise<Record<string, unknown>> {
  const row = await requireCampaign(id);
  if (row.status === 'SENT') throw new ApiError('该邮件已发送，不可重复发送', 1006);

  if (row.sendAt && row.sendAt.getTime() > Date.now()) {
    row.status = 'SCHEDULED';
    await campaignRepo().save(row);
    return { scheduled: true, send_at: row.sendAt };
  }

  const recipients = await resolveRecipients(row);
  if (recipients.length === 0) throw new ApiError('没有可发送的收件人，请检查受众设置', 1007);

  row.status = 'SENT';
  row.sentAt = new Date();
  row.sentCount = recipients.length;
  row.failedCount = 0;
  await campaignRepo().save(row);

  const snapshot = { ...row };
  const saved = await recipientRepo().save(
    recipients.map((r) =>
      recipientRepo().create({
        campaignId: row.id,
        email: r.email,
        username: r.username,
        token: crypto.randomBytes(16).toString('hex'),
        delivered: 0,
      })
    )
  );
  const tasks = saved.map((s) => ({
    id: s.id,
    email: s.email,
    username: s.username,
    token: s.token || '',
  }));

  void dispatch(row.id, snapshot, tasks).catch((e) => log.error('营销邮件发送异常', e));
  return { scheduled: false, sent: recipients.length };
}

export type RecipientFilter = '' | 'opened' | 'unopened' | 'delivered' | 'failed' | 'pending';

function applyRecipientFilter(qb: SelectQueryBuilder<MarketingRecipient>, status: RecipientFilter): void {
  switch (status) {
    case 'opened':
      qb.andWhere('r.openedAt IS NOT NULL');
      break;
    case 'unopened':
      qb.andWhere('r.delivered = 1 AND r.openedAt IS NULL');
      break;
    case 'delivered':
      qb.andWhere('r.delivered = 1');
      break;
    case 'failed':
      qb.andWhere('r.delivered = 0 AND r.error IS NOT NULL');
      break;
    case 'pending':
      qb.andWhere('r.delivered = 0 AND r.error IS NULL');
      break;
    default:
      break;
  }
}

/** 收件人分页（含送达 / 打开状态），status 支持已读 / 未读 / 送达 / 失败 / 待发送筛选 */
export async function listRecipients(
  id: string,
  page: number,
  pageSize: number,
  status: RecipientFilter = ''
): Promise<Record<string, unknown>> {
  await requireCampaign(id);

  const statsRaw = await recipientRepo()
    .createQueryBuilder('r')
    .select('COUNT(*)', 'total')
    .addSelect('SUM(CASE WHEN r.delivered = 1 THEN 1 ELSE 0 END)', 'delivered')
    .addSelect('SUM(CASE WHEN r.opened_at IS NOT NULL THEN 1 ELSE 0 END)', 'opened')
    .addSelect('SUM(CASE WHEN r.delivered = 1 AND r.opened_at IS NULL THEN 1 ELSE 0 END)', 'unopened')
    .addSelect('SUM(CASE WHEN r.delivered = 0 AND r.error IS NOT NULL THEN 1 ELSE 0 END)', 'failed')
    .addSelect('SUM(CASE WHEN r.delivered = 0 AND r.error IS NULL THEN 1 ELSE 0 END)', 'pending')
    .where('r.campaignId = :id', { id })
    .getRawOne<Record<string, string>>();

  const qb = recipientRepo().createQueryBuilder('r').where('r.campaignId = :id', { id });
  applyRecipientFilter(qb, status);
  const [rows, total] = await qb
    .orderBy('r.id', 'DESC')
    .skip((page - 1) * pageSize)
    .take(pageSize)
    .getManyAndCount();

  const stats = {
    total: Number(statsRaw?.total) || 0,
    delivered: Number(statsRaw?.delivered) || 0,
    opened: Number(statsRaw?.opened) || 0,
    unopened: Number(statsRaw?.unopened) || 0,
    failed: Number(statsRaw?.failed) || 0,
    pending: Number(statsRaw?.pending) || 0,
  };
  return {
    total,
    page,
    pageSize,
    stats,
    list: rows.map((r) => ({
      id: r.id,
      email: r.email,
      username: r.username,
      delivered: r.delivered,
      error: r.error,
      sent_at: r.sentAt,
      opened_at: r.openedAt,
    })),
  };
}

/** 受众建议：可投递账号数与邮箱样本，供新建邮件时预览 */
export async function audienceSuggestions(): Promise<Record<string, unknown>> {
  const accounts = await accountRepo().find();
  const emails: string[] = [];
  const usernames: string[] = [];
  for (const a of accounts) {
    if (!a.email || !EMAIL_RE.test(a.email.trim())) continue;
    emails.push(a.email.trim().toLowerCase());
    usernames.push(a.nickname || a.login);
  }
  return {
    all_users: emails.length,
    emails: Array.from(new Set(emails)),
    usernames,
  };
}

/** 定时任务：到点自动发送 SCHEDULED 邮件 */
export async function processScheduledCampaigns(): Promise<number> {
  const due = await campaignRepo()
    .createQueryBuilder('c')
    .where('c.status = :status', { status: 'SCHEDULED' })
    .andWhere('c.send_at IS NOT NULL AND c.send_at <= NOW()')
    .getMany();
  let count = 0;
  for (const row of due) {
    try {
      await sendCampaign(row.id);
      count += 1;
    } catch (e) {
      log.error(`定时营销邮件发送失败（campaign=${row.id}）`, e);
    }
  }
  return count;
}

/** 打开追踪：写入 opened_at（幂等，仅首次记录） */
export async function markOpened(token: string): Promise<void> {
  const key = String(token || '').replace(/\.gif$/i, '').trim();
  if (!key) return;
  await recipientRepo()
    .createQueryBuilder()
    .update()
    .set({ openedAt: () => 'NOW()' })
    .where('token = :key AND opened_at IS NULL', { key })
    .execute();
}
