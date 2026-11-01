import { Router } from 'express';
import Joi from 'joi';
import { ok, fail, clientIp } from '../../middleware/helpers';
import { writeOperationLog } from '../../services/LogService';
import { onlineCount } from '../../services/NoticeBroadcaster';
import {
  getAgencyState,
  saveAgencyDraft,
  publishAgencies,
  scheduleAgencies,
  cancelScheduledAgencies,
  withdrawAgencies,
  getAgencyAnalytics,
  listAgencyClicks,
} from '../../services/AgencyService';

const router = Router();

const itemSchema = Joi.object({
  id: Joi.string().allow('', null).max(64).default(''),
  name: Joi.string().trim().min(1).max(64).required(),
  url: Joi.string().trim().min(1).max(512).uri({ scheme: ['http', 'https'] }).required(),
  intro: Joi.string().allow('', null).max(255).default(''),
  tags: Joi.string().allow('', null).max(128).default(''),
  rating: Joi.number().min(0).max(5).default(0),
  ratingCount: Joi.number().integer().min(0).max(999999).default(0),
  sort: Joi.number().integer().min(-9999).max(9999).default(0),
  enabled: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.boolean()).default(1),
});

const listSchema = Joi.array().items(itemSchema).max(50);

const bodyWithList = Joi.object({
  list: listSchema.optional(),
  sendAt: Joi.alternatives().try(Joi.date().iso(), Joi.number().integer().positive()).optional(),
});

/** 统一响应：列表 + 已发布 + 定时任务 + 在线连接数 */
async function stateWithOnline() {
  return { ...(await getAgencyState()), agency_stream_clients: onlineCount() };
}

// 当前配置状态（草稿 / 已发布 / 定时任务）
router.get('/', async (_req, res) => {
  ok(res, await stateWithOnline());
});

// 保存配置（仅落库，不推送）
router.put('/draft', async (req, res) => {
  const { error, value } = bodyWithList.validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  await saveAgencyDraft(value.list || []);
  await writeOperationLog(
    req.auth!.userId,
    '客户端代理商-保存配置',
    '客户端代理商',
    `共 ${(value.list || []).length} 个`,
    clientIp(req)
  );
  ok(res, await stateWithOnline());
});

// 立即推送（可携带最新列表，一次提交即发布）
router.post('/publish', async (req, res) => {
  const { error, value } = bodyWithList.validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  const { state, delivered } = await publishAgencies(value.list);
  await writeOperationLog(
    req.auth!.userId,
    '客户端代理商-立即推送',
    '客户端代理商',
    `共 ${state.published.length} 个，送达 ${delivered}`,
    clientIp(req)
  );
  ok(res, { ...state, agency_delivered: delivered, agency_stream_clients: onlineCount() });
});

// 定时推送：保存列表并登记待发布任务
router.post('/schedule', async (req, res) => {
  const { error, value } = bodyWithList.validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  const sendAt = value.sendAt ? new Date(value.sendAt).getTime() : 0;
  if (!sendAt || Number.isNaN(sendAt)) return fail(res, '请选择推送时间', 400);
  if (sendAt <= Date.now() + 10 * 1000) return fail(res, '推送时间需晚于当前时间', 400);
  await scheduleAgencies(sendAt, value.list);
  await writeOperationLog(
    req.auth!.userId,
    '客户端代理商-定时推送',
    '客户端代理商',
    `推送时间=${new Date(sendAt).toISOString()}`,
    clientIp(req)
  );
  ok(res, await stateWithOnline());
});

// 取消定时推送
router.post('/cancel', async (req, res) => {
  await cancelScheduledAgencies();
  await writeOperationLog(req.auth!.userId, '客户端代理商-取消定时', '客户端代理商', '', clientIp(req));
  ok(res, await stateWithOnline());
});

// 撤下全部（客户端弹窗显示空态）
router.post('/withdraw', async (req, res) => {
  const { state, delivered } = await withdrawAgencies();
  await writeOperationLog(
    req.auth!.userId,
    '客户端代理商-撤下全部',
    '客户端代理商',
    `送达 ${delivered}`,
    clientIp(req)
  );
  ok(res, { ...state, agency_delivered: delivered, agency_stream_clients: onlineCount() });
});

// 数据分析（图表聚合）
router.get('/analytics', async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10) || 30));
  const start = String(req.query.start || '').trim();
  const end = String(req.query.end || '').trim();
  ok(res, await getAgencyAnalytics(days, start, end));
});

// 点击明细
router.get('/clicks', async (req, res) => {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  ok(
    res,
    await listAgencyClicks({
      page: parseInt(String(req.query.page || '1'), 10) || 1,
      pageSize: parseInt(String(req.query.pageSize || '20'), 10) || 20,
      keyword: str(req.query.keyword),
      agencyId: str(req.query.agencyId),
      envName: str(req.query.envName),
      device: str(req.query.device),
      start: str(req.query.start),
      end: str(req.query.end),
    })
  );
});

export default router;
