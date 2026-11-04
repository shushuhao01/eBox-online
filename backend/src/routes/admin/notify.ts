import { Router } from 'express';
import Joi from 'joi';
import { AppDataSource } from '../../config/database';
import { NotificationTemplate } from '../../entities/account/NotificationTemplate';
import { SystemMessage } from '../../entities/account/SystemMessage';
import { ok, fail, clientIp, superAdminRequired } from '../../middleware/helpers';
import { writeOperationLog } from '../../services/LogService';
import { getConfigAll, getConfigValue, setConfigValue } from '../../services/ConfigService';
import { loadSmtpConfig, getMailFromName } from '../../services/SmtpConfigService';
import { sendMail } from '../../services/MailService';
import {
  loadAliyunSmsConfig,
  sendSms,
  queryTemplateList,
  isValidMainlandPhone,
  AliyunSmsError,
} from '../../services/AliyunSmsService';
import { testTemplateChannels } from '../../services/NotifyService';

const router = Router();

const templateRepo = () => AppDataSource.getRepository(NotificationTemplate);
const messageRepo = () => AppDataSource.getRepository(SystemMessage);

const SECRET_KEYS = new Set(['smtp_pass', 'sms_access_key_secret', 'notify_dingtalk_secret']);
const MASK = '__SET__';

const CONFIG_KEYS = [
  'mail_enabled',
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'mail_from_name',
  'mail_site_url',
  'sms_enabled',
  'sms_provider',
  'sms_access_key_id',
  'sms_access_key_secret',
  'sms_sign_name',
  'sms_region',
  'sms_tpl_verify_code',
  'sms_admin_phone',
  'notify_dingtalk_url',
  'notify_dingtalk_secret',
  'notify_wecom_url',
  'notify_email_to',
  'notify_sms_phone',
  'notify_admin_email',
  'notify_admin_phone',
  'notify_global_enabled',
] as const;

const CHANNELS = ['DINGTALK', 'WECOM', 'EMAIL', 'SMS', 'SYSTEM'];

function pickConfig(all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CONFIG_KEYS) {
    const value = all[key] ?? '';
    out[key] = SECRET_KEYS.has(key) && value ? MASK : value;
  }
  return out;
}

function normalizeChannels(value: unknown): string {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  const list = raw
    .map((v) => String(v).trim().toUpperCase())
    .filter((v) => CHANNELS.includes(v));
  return list.filter((v, i) => list.indexOf(v) === i).join(',');
}

// ==================== 邮件 / 短信 / 渠道配置 ====================

router.get('/config', async (_req, res) => {
  ok(res, pickConfig(await getConfigAll()));
});

const configSchema = Joi.object({
  mail_enabled: Joi.string().valid('0', '1').optional(),
  smtp_host: Joi.string().allow('').max(255).optional(),
  smtp_port: Joi.number().integer().min(1).max(65535).optional(),
  smtp_user: Joi.string().allow('').max(255).optional(),
  smtp_pass: Joi.string().allow('').max(512).optional(),
  smtp_from: Joi.string().allow('').max(255).optional(),
  mail_from_name: Joi.string().allow('').max(128).optional(),
  mail_site_url: Joi.string().allow('').max(500).optional(),
  sms_enabled: Joi.string().valid('0', '1').optional(),
  sms_provider: Joi.string().valid('aliyun').optional(),
  sms_access_key_id: Joi.string().allow('').max(128).optional(),
  sms_access_key_secret: Joi.string().allow('').max(256).optional(),
  sms_sign_name: Joi.string().allow('').max(128).optional(),
  sms_region: Joi.string().valid('cn-hangzhou', 'cn-shanghai', 'cn-beijing', 'cn-shenzhen').optional(),
  sms_tpl_verify_code: Joi.string().allow('').max(64).optional(),
  sms_admin_phone: Joi.string().allow('').max(64).optional(),
  notify_dingtalk_url: Joi.string().allow('').max(500).optional(),
  notify_dingtalk_secret: Joi.string().allow('').max(256).optional(),
  notify_wecom_url: Joi.string().allow('').max(500).optional(),
  notify_email_to: Joi.string().allow('').max(500).optional(),
  notify_sms_phone: Joi.string().allow('').max(500).optional(),
  notify_admin_email: Joi.string().allow('').max(500).optional(),
  notify_admin_phone: Joi.string().allow('').max(500).optional(),
  notify_global_enabled: Joi.string().valid('0', '1').optional(),
});

router.put('/config', superAdminRequired, async (req, res) => {
  const { error, value } = configSchema.validate(req.body);
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  for (const [k, v] of Object.entries(value)) {
    const text = String(v);
    // 敏感字段提交空值或占位符时保持原值
    if (SECRET_KEYS.has(k) && (text === '' || text === MASK)) continue;
    await setConfigValue(k, text);
  }
  await writeOperationLog(req.auth!.userId, '修改通知配置', '通知配置', JSON.stringify(value), clientIp(req));
  ok(res, pickConfig(await getConfigAll()));
});

// ==================== 连通性测试 ====================

router.post('/mail/test', superAdminRequired, async (req, res) => {
  const { error, value } = Joi.object({
    to: Joi.string().trim().email().required(),
  }).validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  const smtp = await loadSmtpConfig();
  if (!smtp) return fail(res, '未配置 SMTP 服务', 1001);
  try {
    await sendMail(smtp, {
      to: String(value.to),
      subject: 'eBox 邮件发件测试',
      text: `这是一封测试邮件，发送时间：${new Date().toLocaleString('zh-CN')}。收到即表示 SMTP 配置可用。`,
      fromName: await getMailFromName(),
    });
  } catch (e) {
    return fail(res, `发送失败：${(e as Error).message || '未知错误'}`, 1002);
  }
  ok(res, { ok: true });
});

router.post('/sms/test', superAdminRequired, async (req, res) => {
  const { error, value } = Joi.object({
    phone: Joi.string().trim().required(),
    template_code: Joi.string().trim().allow('').max(64).optional(),
  }).validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  const phone = String(value.phone);
  if (!isValidMainlandPhone(phone)) return fail(res, '手机号格式不正确（需 11 位大陆手机号）', 400);

  const config = await loadAliyunSmsConfig();
  if (!config) return fail(res, '未配置阿里云 AccessKey', 1001);
  const signName = (await getConfigValue('sms_sign_name')).trim();
  if (!signName) return fail(res, '未配置短信签名', 1002);
  const templateCode = String(value.template_code || '').trim() || (await getConfigValue('sms_tpl_verify_code')).trim();
  if (!templateCode) return fail(res, '未配置短信模板 CODE', 1003);

  try {
    const result = await sendSms(config, {
      phone,
      signName,
      templateCode,
      templateParam: { code: '123456' },
    });
    ok(res, result);
  } catch (e) {
    if (e instanceof AliyunSmsError) {
      return fail(res, `${e.code}：${e.message}`, 1004);
    }
    return fail(res, `发送失败：${(e as Error).message || '未知错误'}`, 1004);
  }
});

router.post('/sms/test-connection', superAdminRequired, async (_req, res) => {
  const config = await loadAliyunSmsConfig();
  if (!config) return fail(res, '未配置阿里云 AccessKey', 1001);
  try {
    const result = await queryTemplateList(config, 1, 10);
    ok(res, {
      ok: true,
      request_id: result.RequestId || '',
      total: Number(result.TotalCount ?? 0) || 0,
    });
  } catch (e) {
    if (e instanceof AliyunSmsError) {
      return fail(res, `${e.code}：${e.message}`, 1002);
    }
    return fail(res, `连通性测试失败：${(e as Error).message || '未知错误'}`, 1002);
  }
});

// ==================== 消息模板 ====================

const templateSchema = Joi.object({
  code: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z0-9_]{2,64}$/)
    .required(),
  name: Joi.string().trim().max(128).required(),
  category: Joi.string().allow('', null).max(32).default(''),
  audience: Joi.string().valid('user', 'admin').default('user'),
  title: Joi.string().allow('', null).max(255).default(''),
  content: Joi.string().allow('', null).default(''),
  channels: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string()).default([]),
  sms_template_code: Joi.string().allow('', null).max(64).default(''),
  is_enabled: Joi.number().integer().valid(0, 1).default(1),
  auto_trigger: Joi.number().integer().valid(0, 1).default(1),
  sort_order: Joi.number().integer().min(0).max(9999).default(0),
});

router.get('/templates', async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20));
  const keyword = String(req.query.keyword || '').trim();
  const category = String(req.query.category || '').trim();
  const audience = String(req.query.audience || '').trim();

  const qb = templateRepo().createQueryBuilder('t');
  if (category) qb.andWhere('t.category = :category', { category });
  if (audience === 'user' || audience === 'admin') qb.andWhere('t.audience = :audience', { audience });
  if (keyword) {
    qb.andWhere('(t.code LIKE :kw OR t.name LIKE :kw OR t.title LIKE :kw)', { kw: `%${keyword}%` });
  }
  const total = await qb.getCount();
  const list = await qb
    .orderBy('t.sort_order', 'ASC')
    .addOrderBy('t.id', 'ASC')
    .skip((page - 1) * pageSize)
    .take(pageSize)
    .getMany();
  ok(res, { total, page, pageSize, list });
});

router.post('/templates', superAdminRequired, async (req, res) => {
  const { error, value } = templateSchema.validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  const v = value as Record<string, unknown>;
  const code = String(v.code);
  const exists = await templateRepo().findOneBy({ code });
  if (exists) return fail(res, '模板编码已存在', 1005);

  const row = await templateRepo().save(
    templateRepo().create({
      code,
      name: String(v.name),
      category: (v.category as string) || null,
      audience: String(v.audience) === 'admin' ? 'admin' : 'user',
      title: (v.title as string) || null,
      content: (v.content as string) || '',
      channels: normalizeChannels(v.channels),
      smsTemplateCode: (v.sms_template_code as string) || null,
      isEnabled: Number(v.is_enabled),
      autoTrigger: Number(v.auto_trigger),
      sortOrder: Number(v.sort_order) || 0,
    })
  );
  await writeOperationLog(req.auth!.userId, '新建消息模板', code, String(v.name), clientIp(req));
  ok(res, row);
});

router.put('/templates/:id', superAdminRequired, async (req, res) => {
  const row = await templateRepo().findOneBy({ id: req.params.id });
  if (!row) return fail(res, '模板不存在', 1002);
  const { error, value } = templateSchema
    .fork(['code'], (s) => s.optional())
    .validate(req.body || {}, { noDefaults: true });
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  const v = value as Record<string, unknown>;

  // code 不可修改
  if (v.name !== undefined) row.name = String(v.name);
  if (v.category !== undefined) row.category = (v.category as string) || null;
  if (v.audience !== undefined) row.audience = String(v.audience) === 'admin' ? 'admin' : 'user';
  if (v.title !== undefined) row.title = (v.title as string) || null;
  if (v.content !== undefined) row.content = (v.content as string) || '';
  if (v.channels !== undefined) row.channels = normalizeChannels(v.channels);
  if (v.sms_template_code !== undefined) row.smsTemplateCode = (v.sms_template_code as string) || null;
  if (v.is_enabled !== undefined) row.isEnabled = Number(v.is_enabled);
  if (v.auto_trigger !== undefined) row.autoTrigger = Number(v.auto_trigger);
  if (v.sort_order !== undefined) row.sortOrder = Number(v.sort_order) || 0;

  const saved = await templateRepo().save(row);
  await writeOperationLog(req.auth!.userId, '修改消息模板', row.code, row.name, clientIp(req));
  ok(res, saved);
});

router.delete('/templates/:id', superAdminRequired, async (req, res) => {
  const row = await templateRepo().findOneBy({ id: req.params.id });
  if (!row) return fail(res, '模板不存在', 1002);
  await templateRepo().delete({ id: row.id });
  await writeOperationLog(req.auth!.userId, '删除消息模板', row.code, row.name, clientIp(req));
  ok(res, { id: row.id });
});

router.post('/test', superAdminRequired, async (req, res) => {
  const { error, value } = Joi.object({
    template_code: Joi.string().trim().required(),
  }).validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  try {
    const items = await testTemplateChannels(String(value.template_code));
    ok(res, { items });
  } catch (e) {
    return fail(res, (e as Error).message || '测试发送失败', 1003);
  }
});

// ==================== 站内信 ====================

router.get('/messages', async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20));
  const category = String(req.query.category || '').trim();
  const qb = messageRepo().createQueryBuilder('m');
  if (category) qb.andWhere('m.category = :category', { category });
  const total = await qb.getCount();
  const list = await qb.orderBy('m.id', 'DESC').skip((page - 1) * pageSize).take(pageSize).getMany();
  ok(res, { total, page, pageSize, list });
});

router.get('/messages/unread-count', async (_req, res) => {
  const count = await messageRepo().countBy({ isRead: 0 });
  ok(res, { count });
});

router.post('/messages/:id/read', async (req, res) => {
  const row = await messageRepo().findOneBy({ id: req.params.id });
  if (!row) return fail(res, '消息不存在', 1002);
  if (row.isRead !== 1) {
    row.isRead = 1;
    await messageRepo().save(row);
  }
  ok(res, { id: row.id });
});

router.post('/messages/read-all', async (_req, res) => {
  const result = await messageRepo().createQueryBuilder().update().set({ isRead: 1 }).where('is_read = 0').execute();
  ok(res, { affected: result.affected ?? 0 });
});

export default router;
