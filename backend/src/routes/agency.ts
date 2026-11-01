import { Router } from 'express';
import Joi from 'joi';
import { ok, fail, clientIp } from '../middleware/helpers';
import { recordAgencyClick } from '../services/AgencyService';

const router = Router();

const clickSchema = Joi.object({
  code: Joi.string().allow('').max(200).default(''),
  machineFp: Joi.string().allow('').max(64).default(''),
  appVersion: Joi.string().allow('').max(32).default(''),
  os: Joi.string().allow('').max(64).default(''),
  agencyId: Joi.string().required().max(64),
  clickId: Joi.string().allow('').max(64).default(''),
  envName: Joi.string().allow('').max(64).default(''),
  timestamp: Joi.number().integer().optional(),
  nonce: Joi.string().allow('').max(64).optional(),
});

// POST /api/v1/agency/click
//   客户端代理商弹窗内点击「访问注册」时上报一次（授权码 + 机器指纹 + 点击 ID）。
//   返回 { code:0 } 即视为上报成功，客户端不在 UI 上提示失败（跳转不受影响）。
router.post('/agency/click', async (req, res) => {
  const { error, value } = clickSchema.validate(req.body || {});
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  try {
    await recordAgencyClick({
      code: value.code,
      machineFp: value.machineFp,
      appVersion: value.appVersion,
      clientOs: value.os,
      agencyId: value.agencyId,
      clickId: value.clickId,
      envName: value.envName,
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
      referer: String(req.headers.referer || ''),
    });
    ok(res, { recorded: true });
  } catch {
    // 埋点失败不影响客户端跳转，静默返回成功避免客户端重试
    ok(res, { recorded: false });
  }
});

export default router;
