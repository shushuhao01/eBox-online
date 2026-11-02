import { Router } from 'express';
import Joi from 'joi';
import { ok, fail, clientIp } from '../../middleware/helpers';
import { writeOperationLog } from '../../services/LogService';
import {
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
  listRecipients,
  audienceSuggestions,
} from '../../services/MarketingService';

/**
 * 管理后台：营销管理 → 营销邮件
 * 与 orion-key 的 /api/admin/marketing/emails 对齐（本项目无优惠券，仅保留营销邮件）
 */
const router = Router();

const campaignSchema = Joi.object({
  title: Joi.string().trim().max(255).required(),
  subject: Joi.string().allow('', null).max(255).optional(),
  content: Joi.string().allow('', null).optional(),
  audience_type: Joi.string().valid('ALL_USERS', 'USER_IDS', 'EMAILS').optional(),
  target_json: Joi.string().allow('', null).optional(),
  send_at: Joi.string().allow('', null).max(32).optional(),
});

function parsePage(raw: unknown, fallback: number): number {
  return Math.max(1, parseInt(String(raw || fallback), 10) || fallback);
}

router.get('/campaigns', async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const pageSize = Math.min(100, parsePage(req.query.pageSize, 10));
  const result = await listCampaigns(
    String(req.query.keyword || '').trim(),
    String(req.query.status || '').trim().toUpperCase(),
    page,
    pageSize
  );
  ok(res, result);
});

router.post('/campaigns', async (req, res) => {
  const { error, value } = campaignSchema.validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  const row = await createCampaign(value);
  await writeOperationLog(req.auth!.userId, '新建营销邮件', String(row.id), String(row.title), clientIp(req));
  ok(res, row);
});

router.put('/campaigns/:id', async (req, res) => {
  const { error, value } = campaignSchema.validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  const row = await updateCampaign(req.params.id, value);
  await writeOperationLog(req.auth!.userId, '修改营销邮件', req.params.id, String(row.title), clientIp(req));
  ok(res, row);
});

router.delete('/campaigns/:id', async (req, res) => {
  await deleteCampaign(req.params.id);
  await writeOperationLog(req.auth!.userId, '删除营销邮件', req.params.id, '', clientIp(req));
  ok(res, { id: req.params.id });
});

router.post('/campaigns/:id/send', async (req, res) => {
  const result = await sendCampaign(req.params.id);
  await writeOperationLog(req.auth!.userId, '发送营销邮件', req.params.id, JSON.stringify(result), clientIp(req));
  ok(res, result);
});

router.get('/campaigns/:id/recipients', async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const pageSize = Math.min(100, parsePage(req.query.pageSize, 10));
  const allowed = ['opened', 'unopened', 'delivered', 'failed', 'pending'];
  const raw = String(req.query.status || '').trim().toLowerCase();
  const status = (allowed.includes(raw) ? raw : '') as '' | 'opened' | 'unopened' | 'delivered' | 'failed' | 'pending';
  ok(res, await listRecipients(req.params.id, page, pageSize, status));
});

router.get('/audience-suggestions', async (_req, res) => {
  ok(res, await audienceSuggestions());
});

export default router;
