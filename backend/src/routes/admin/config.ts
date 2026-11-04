import { Router } from 'express';
import Joi from 'joi';
import { ok, fail, clientIp } from '../../middleware/helpers';
import {
  getConfigAll,
  getConfigValue,
  setConfigValue,
  getNoticeDraft,
  getNoticePayload,
  getPendingNotice,
  saveNoticeDraft,
  publishNotice,
  scheduleNotice,
  cancelScheduledNotice,
  withdrawNotice,
  maskSecrets,
  SECRET_KEYS,
  type NoticeDraft,
} from '../../services/ConfigService';
import { writeOperationLog, cleanExpiredData } from '../../services/LogService';
import { onlineCount } from '../../services/NoticeBroadcaster';

const router = Router();

const schema = Joi.object({
  heartbeat_interval_hours: Joi.number().integer().min(1).max(24).optional(),
  offline_grace_days: Joi.number().integer().min(1).max(30).optional(),
  force_online_activate: Joi.string().valid('0', '1').optional(),
  notice: Joi.string().allow('').max(500).optional(),
  // 公告草稿（保存不推送，发送/定时由下方专用接口触发）
  notice_title: Joi.string().allow('').max(80).optional(),
  notice_content: Joi.string().allow('').max(2000).optional(),
  notice_strong: Joi.string().valid('0', '1').optional(),
  notice_link: Joi.string().allow('').max(500).uri({ scheme: ['http', 'https'] }).optional(),
  online_threshold_minutes: Joi.number().integer().min(1).max(1440).optional(),
  // 操作日志自动清理：保留天数 + 每日清理时间（HH:mm）
  log_retention_days: Joi.number().integer().min(1).max(365).optional(),
  log_clean_time: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  // 邮件发件
  mail_enabled: Joi.string().valid('0', '1').optional(),
  smtp_host: Joi.string().allow('').max(255).optional(),
  smtp_port: Joi.number().integer().min(1).max(65535).optional(),
  smtp_user: Joi.string().allow('').max(255).optional(),
  smtp_pass: Joi.string().allow('').max(512).optional(),
  smtp_from: Joi.string().allow('').max(255).optional(),
  mail_from_name: Joi.string().allow('').max(128).optional(),
  mail_site_url: Joi.string().allow('').max(500).optional(),
  // 短信（阿里云）
  sms_enabled: Joi.string().valid('0', '1').optional(),
  sms_provider: Joi.string().valid('aliyun').optional(),
  sms_access_key_id: Joi.string().allow('').max(128).optional(),
  sms_access_key_secret: Joi.string().allow('').max(256).optional(),
  sms_sign_name: Joi.string().allow('').max(128).optional(),
  sms_region: Joi.string()
    .valid('cn-hangzhou', 'cn-shanghai', 'cn-beijing', 'cn-shenzhen')
    .optional(),
  sms_tpl_verify_code: Joi.string().allow('').max(64).optional(),
  sms_admin_phone: Joi.string().allow('').max(64).optional(),
  // 通知渠道
  notify_dingtalk_url: Joi.string().allow('').max(500).optional(),
  notify_dingtalk_secret: Joi.string().allow('').max(256).optional(),
  notify_wecom_url: Joi.string().allow('').max(500).optional(),
  notify_email_to: Joi.string().allow('').max(500).optional(),
  notify_sms_phone: Joi.string().allow('').max(500).optional(),
  notify_global_enabled: Joi.string().valid('0', '1').optional(),
});

// 公告发送/定时发送请求体（携带草稿内容，一次提交即发布，避免“保存后再发送”的两步不一致）
const noticeBodySchema = Joi.object({
  title: Joi.string().allow('').max(80).optional(),
  content: Joi.string().allow('').max(2000).optional(),
  strong: Joi.boolean().optional(),
  link: Joi.string().allow('').max(500).uri({ scheme: ['http', 'https'] }).optional(),
  sendAt: Joi.alternatives().try(Joi.date().iso(), Joi.number().integer().positive()).optional(),
});

/** 当前公告状态（已发布 + 待定时任务），供列表与操作后回显 */
async function noticeState(): Promise<{
  notice_published: Awaited<ReturnType<typeof getNoticePayload>>;
  notice_pending_task: Awaited<ReturnType<typeof getPendingNotice>>;
}> {
  return {
    notice_published: await getNoticePayload(),
    notice_pending_task: await getPendingNotice(),
  };
}

/** 请求体是否携带草稿字段（未携带则沿用已保存草稿） */
function hasDraftFields(body: Record<string, unknown>): boolean {
  return ['title', 'content', 'strong', 'link'].some((k) => Object.prototype.hasOwnProperty.call(body, k));
}

function pickDraft(body: Record<string, unknown>): NoticeDraft {
  return {
    title: typeof body.title === 'string' ? body.title : '',
    content: typeof body.content === 'string' ? body.content : '',
    strong: body.strong === true,
    link: typeof body.link === 'string' ? body.link : '',
  };
}

router.get('/', async (_req, res) => {
  // 密钥类配置脱敏后再下发，前端显示 __SET__，不暴露明文
  const all = maskSecrets(await getConfigAll());
  // 发布态/定时任务以结构化对象返回，隐藏内部 JSON 字符串键，避免前端误用
  delete all.notice_payload;
  delete all.notice_pending;
  ok(res, { ...all, ...(await noticeState()), notice_stream_clients: onlineCount() });
});

router.put('/', async (req, res) => {
  const { error, value } = schema.validate(req.body);
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  // 密钥类配置只允许超管修改（role === 1）
  if (req.auth!.role !== 1) {
    for (const [k, v] of Object.entries(value)) {
      const text = String(v);
      if (SECRET_KEYS.has(k) && text !== '' && text !== '__SET__') {
        return fail(res, '仅超级管理员可修改密钥类配置', 403);
      }
    }
  }
  const changed: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const text = String(v);
    if (SECRET_KEYS.has(k) && (text === '' || text === '__SET__')) continue;
    await setConfigValue(k, text);
    // 操作日志只记录变更键名，密钥类不落明文
    changed.push(SECRET_KEYS.has(k) ? `${k}=***` : `${k}=${text}`);
  }
  await writeOperationLog(req.auth!.userId, '修改系统设置', '系统设置', changed.join('\n'), clientIp(req));
  const all = maskSecrets(await getConfigAll());
  delete all.notice_payload;
  delete all.notice_pending;
  ok(res, { ...all, ...(await noticeState()) });
});

// ==================== 系统公告：立即发送 / 定时发送 / 取消 / 撤销 ====================

// 立即发送：先保存草稿，再推送到所有在线客户端
router.post('/notice/send', async (req, res) => {
  const { error, value } = noticeBodySchema.validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  const draft = hasDraftFields(value) ? pickDraft(value) : await getNoticeDraft();
  if (!draft.title.trim() && !draft.content.trim()) return fail(res, '请填写公告标题或内容', 400);
  await saveNoticeDraft(draft);
  const { event, delivered } = await publishNotice();
  await writeOperationLog(
    req.auth!.userId,
    '发送系统公告',
    '系统设置',
    JSON.stringify({ title: draft.title, strong: draft.strong, link: draft.link, notice: event.notice, delivered }),
    clientIp(req)
  );
  ok(res, { ...(await noticeState()), notice_delivered: delivered });
});

// 定时发送：先保存草稿与定时任务，到点由后台定时任务自动推送
router.post('/notice/schedule', async (req, res) => {
  const { error, value } = noticeBodySchema.validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  const sendAt = value.sendAt ? new Date(value.sendAt).getTime() : 0;
  if (!sendAt || Number.isNaN(sendAt)) return fail(res, '请选择发送时间', 400);
  if (sendAt <= Date.now() + 10 * 1000) return fail(res, '发送时间需晚于当前时间', 400);
  const draft = hasDraftFields(value) ? pickDraft(value) : await getNoticeDraft();
  if (!draft.title.trim() && !draft.content.trim()) return fail(res, '请填写公告标题或内容', 400);
  await saveNoticeDraft(draft);
  const pending = await scheduleNotice(sendAt);
  await writeOperationLog(
    req.auth!.userId,
    '定时发送系统公告',
    '系统设置',
    JSON.stringify({ title: draft.title, strong: draft.strong, link: draft.link, sendAt }),
    clientIp(req)
  );
  ok(res, { ...(await noticeState()), notice_pending_task: pending });
});

// 取消定时发送
router.post('/notice/cancel', async (req, res) => {
  await cancelScheduledNotice();
  await writeOperationLog(req.auth!.userId, '取消定时公告', '系统设置', '', clientIp(req));
  ok(res, await noticeState());
});

// 撤销公告：立即让所有客户端隐藏公告栏
router.post('/notice/withdraw', async (req, res) => {
  await withdrawNotice();
  await writeOperationLog(req.auth!.userId, '撤销系统公告', '系统设置', '', clientIp(req));
  ok(res, await noticeState());
});

// 立即清理过期日志（操作日志 + 心跳日志，按配置的保留天数）
router.post('/clean-logs', async (req, res) => {
  const days = Math.max(1, Number(await getConfigValue('log_retention_days')) || 1);
  const r = await cleanExpiredData(days);
  await writeOperationLog(
    req.auth!.userId,
    '清理过期日志',
    '操作日志',
    `删除 ${r.operationLogs} 条操作日志、${r.heartbeats} 条心跳日志（超过 ${days} 天）`,
    clientIp(req)
  );
  ok(res, r);
});

export default router;
