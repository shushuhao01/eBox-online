import { Router } from 'express';
import Joi from 'joi';
import { ok, fail, clientIp } from '../../middleware/helpers';
import { ApiError } from '../../middleware/errorHandler';
import { writeOperationLog } from '../../services/LogService';
import {
  getUpgradeLinks,
  getSeatAddonMallUrl,
  saveMallConfig,
  buildClientConfig,
} from '../../services/SkuService';
import { getTierEnvLimits, saveTierEnvLimits, TIER_ENV_META } from '../../services/TierEnvService';
import {
  createUpgradeCodes,
  listUpgradeCodes,
  voidUpgradeCode,
  createSeatAddons,
  listSeatAddons,
  voidSeatAddon,
} from '../../services/VoucherService';
import { broadcastConfig, refreshAllEntitlements } from '../../services/AccountEventService';

const router = Router();

/**
 * 管理后台 · 套餐与商城链接 / 升级码 / 席位扩容码（M6）
 * 全部写操作落 operation_logs；商城链接保存后立即 SSE 推送在线客户端。
 */

function sendError(res: Parameters<typeof fail>[0], e: unknown): boolean {
  if (e instanceof ApiError) {
    fail(res, e.message, e.code ?? 1, e.status || 400);
    return true;
  }
  return false;
}

// ==================== 档位环境管理 ====================

// GET /api/admin/tier-env-limits
router.get('/tier-env-limits', async (_req, res) => {
  ok(res, { limits: await getTierEnvLimits(), tiers: TIER_ENV_META });
});

// PUT /api/admin/tier-env-limits（保存即刷新在线账号权益）
router.put('/tier-env-limits', async (req, res) => {
  const envSchema = Joi.number().integer().min(0).max(100000).required();
  const { error, value } = Joi.object({
    v1l1: envSchema,
    v1l2: envSchema,
    v2l1: envSchema,
    v2l2: envSchema,
  }).validate(req.body);
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  try {
    const limits = await saveTierEnvLimits(value as Record<string, unknown>);
    // 环境上限属于系统级配置：已签发卡密未自带 maxEnvs 的账号立即按新配置生效
    await refreshAllEntitlements();
    await writeOperationLog(
      req.auth!.userId,
      '修改档位环境数量',
      '档位环境管理',
      JSON.stringify(limits),
      clientIp(req)
    );
    ok(res, { limits });
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// GET /api/admin/upgrade-links
router.get('/upgrade-links', async (_req, res) => {
  ok(res, {
    links: await getUpgradeLinks(),
    seatAddonMallUrl: await getSeatAddonMallUrl(),
    config: await buildClientConfig(),
  });
});

// PUT /api/admin/upgrade-links（保存即推送）
router.put('/upgrade-links', async (req, res) => {
  const { error, value } = Joi.object({
    links: Joi.object().pattern(Joi.string(), Joi.string().allow('').max(512)).optional(),
    seatAddonMallUrl: Joi.string().allow('').max(512).optional(),
  })
    .or('links', 'seatAddonMallUrl')
    .validate(req.body);
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  try {
    const result = await saveMallConfig({
      upgradeLinks: value.links as Record<string, unknown> | undefined,
      seatAddonMallUrl: value.seatAddonMallUrl as string | undefined,
    });
    await writeOperationLog(
      req.auth!.userId,
      '修改商城链接',
      '套餐与档位',
      JSON.stringify({ links: value.links ?? null, seatAddonMallUrl: value.seatAddonMallUrl ?? null }),
      clientIp(req)
    );
    ok(res, { ...result.config, delivered: result.delivered });
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/admin/push-config（仅重新广播当前客户端配置，不修改链接）
router.post('/push-config', async (req, res) => {
  const config = await buildClientConfig();
  const delivered = broadcastConfig({ ...config, serverTime: Math.floor(Date.now() / 1000) });
  await writeOperationLog(
    req.auth!.userId,
    '重推客户端配置',
    '套餐与档位',
    `delivered=${delivered}`,
    clientIp(req)
  );
  ok(res, { delivered });
});

// ==================== 升级码 ====================

const upgradeCodeSchema = Joi.object({
  // 只按时长档位生成（同档位普通 → 高级）
  duration: Joi.string().valid('month', 'quarter', 'year', 'permanent').required(),
  fromSkuId: Joi.alternatives().try(Joi.string(), Joi.number()).allow(null, '').optional(),
  accountId: Joi.alternatives().try(Joi.string(), Joi.number()).allow(null, '').optional(),
  amount: Joi.number().min(0).max(1000000).allow(null).optional(),
  remark: Joi.string().allow('').max(255).optional(),
  validUntil: Joi.alternatives().try(Joi.date().iso(), Joi.number().integer().positive()).allow(null, '').optional(),
  count: Joi.number().integer().min(1).max(200).default(1),
});

// GET /api/admin/upgrade-codes
router.get('/upgrade-codes', async (req, res) => {
  const status = req.query.status === undefined || req.query.status === '' ? undefined : Number(req.query.status);
  ok(
    res,
    await listUpgradeCodes({
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      status: Number.isFinite(status) ? status : undefined,
      keyword: String(req.query.keyword || ''),
    })
  );
});

// POST /api/admin/upgrade-codes
router.post('/upgrade-codes', async (req, res) => {
  const { error, value } = upgradeCodeSchema.validate(req.body);
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  try {
    const rows = await createUpgradeCodes({
      duration: value.duration,
      fromSkuId: value.fromSkuId ? String(value.fromSkuId) : null,
      accountId: value.accountId ? String(value.accountId) : null,
      amount: value.amount ?? null,
      remark: value.remark || null,
      validUntil: value.validUntil ?? null,
      count: value.count,
      createdBy: req.auth!.userId,
    });
    await writeOperationLog(
      req.auth!.userId,
      '生成升级码',
      '档位环境管理',
      JSON.stringify({ duration: value.duration, count: rows.length, accountId: value.accountId || null }),
      clientIp(req)
    );
    ok(res, rows);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/admin/upgrade-codes/:id/void
router.post('/upgrade-codes/:id/void', async (req, res) => {
  try {
    await voidUpgradeCode(String(req.params.id));
    await writeOperationLog(req.auth!.userId, '作废升级码', '套餐与档位', `id=${req.params.id}`, clientIp(req));
    ok(res, { voided: true });
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// ==================== 席位扩容码 ====================

const seatAddonSchema = Joi.object({
  seatDelta: Joi.number().integer().min(1).max(500).required(),
  count: Joi.number().integer().min(1).max(200).default(1),
  enterpriseId: Joi.alternatives().try(Joi.string(), Joi.number()).allow(null, '').optional(),
  remark: Joi.string().allow('').max(255).optional(),
  validUntil: Joi.alternatives().try(Joi.date().iso(), Joi.number().integer().positive()).allow(null, '').optional(),
});

// GET /api/admin/seat-addons
router.get('/seat-addons', async (req, res) => {
  const status = req.query.status === undefined || req.query.status === '' ? undefined : Number(req.query.status);
  ok(
    res,
    await listSeatAddons({
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      status: Number.isFinite(status) ? status : undefined,
      keyword: String(req.query.keyword || ''),
    })
  );
});

// POST /api/admin/seat-addons
router.post('/seat-addons', async (req, res) => {
  const { error, value } = seatAddonSchema.validate(req.body);
  if (error) return fail(res, `参数错误：${error.message}`, 400);
  try {
    const rows = await createSeatAddons({
      seatDelta: value.seatDelta,
      count: value.count,
      enterpriseId: value.enterpriseId ? String(value.enterpriseId) : null,
      remark: value.remark || null,
      validUntil: value.validUntil ?? null,
      createdBy: req.auth!.userId,
    });
    await writeOperationLog(
      req.auth!.userId,
      '生成席位扩容码',
      '席位扩容码',
      JSON.stringify({ seatDelta: value.seatDelta, count: rows.length, enterpriseId: value.enterpriseId || null }),
      clientIp(req)
    );
    ok(res, rows);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/admin/seat-addons/:id/void
router.post('/seat-addons/:id/void', async (req, res) => {
  try {
    await voidSeatAddon(String(req.params.id));
    await writeOperationLog(req.auth!.userId, '作废席位扩容码', '席位扩容码', `id=${req.params.id}`, clientIp(req));
    ok(res, { voided: true });
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

export default router;
