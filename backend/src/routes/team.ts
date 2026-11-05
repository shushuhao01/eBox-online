import { Router, Response } from 'express';
import Joi from 'joi';
import { ok, clientIp } from '../middleware/helpers';
import { ApiError } from '../middleware/errorHandler';
import { requireAccount, requireEnterpriseAdmin } from '../middleware/accountAuth';
import {
  listTeamMembers,
  createTeamMember,
  updateTeamMember,
  resetTeamMemberPassword,
  unlockTeamMember,
  deleteTeamMember,
  restoreTeamMember,
  getEnterpriseInfo,
} from '../services/EnterpriseService';
import { assignResources, listEnterprisePool, recycleResource, setAssignmentPlaintext } from '../services/IpResourceService';
import { getTeamSummary, getTeamTrend } from '../services/TeamDashboardService';
import { listEnterpriseSeatAddons, redeemSeatAddon } from '../services/VoucherService';
import { pushKick } from '../services/AccountEventService';

const router = Router();

/**
 * 企业团队管理（M3）
 * - 全部接口需登录且为企业管理员：企业隔离由 requireEnterpriseAdmin 按登录账号的
 *   enterpriseId 解析上下文，成员读写再按 enterpriseId 过滤，跨企业一律 403。
 * - 子账户（企业成员）访问任意 /api/team/* 均返回 403。
 */
router.use('/team', requireAccount, requireEnterpriseAdmin);

/** 统一错误出口：保留 ApiError 的结构化 data（如资源占用清单） */
function sendError(res: Response, e: unknown): boolean {
  if (e instanceof ApiError) {
    res.status(e.status || 200).json({ code: e.code, msg: e.message, data: e.data ?? null });
    return true;
  }
  return false;
}

// GET /api/team/info（企业信息：企业码 / 名称 / 席位 / 到期）
router.get('/team/info', async (req, res) => {
  try {
    const info = await getEnterpriseInfo(req.accountAuth!.account);
    if (!info) throw new ApiError('企业不存在', 4004, 403);
    ok(res, info);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// GET /api/team/members?page=&pageSize=&keyword=&status=
router.get('/team/members', async (req, res) => {
  try {
    const status =
      req.query.status === undefined || req.query.status === '' ? undefined : Number(req.query.status);
    const result = await listTeamMembers(req.enterpriseAuth!.enterprise, {
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      keyword: String(req.query.keyword || ''),
      status: Number.isFinite(status) ? status : undefined,
      includeDeleted: req.query.includeDeleted === '1' || req.query.includeDeleted === 'true',
    });
    ok(res, result);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

const createSchema = Joi.object({
  nickname: Joi.string().allow('').max(64).default(''),
  hint: Joi.string().allow('').max(255).default(''),
  remark: Joi.string().allow('').max(255).default(''),
});

// POST /api/team/members（创建子账户，返回一次性密码）
router.post('/team/members', async (req, res) => {
  try {
    const { error, value } = createSchema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const result = await createTeamMember(req.accountAuth!.account, req.enterpriseAuth!, {
      ...value,
      ip: clientIp(req),
    });
    ok(res, result, '子账户创建成功，请立即保存一次性密码');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

const updateSchema = Joi.object({
  nickname: Joi.string().allow('').max(64),
  hint: Joi.string().allow('').max(255),
  remark: Joi.string().allow('').max(255),
  status: Joi.number().integer().valid(1, 2),
}).min(1);

// PATCH /api/team/members/:id（昵称 / 配置提示词 / 备注 / 启停用）
router.patch('/team/members/:id', async (req, res) => {
  try {
    const { error, value } = updateSchema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const result = await updateTeamMember(req.accountAuth!.account, req.enterpriseAuth!, String(req.params.id), {
      ...value,
      ip: clientIp(req),
    });
    if (result.disabled) pushKick(result.accountId, '您的账号已被企业管理员停用');
    ok(res, null, '成员资料已更新');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/team/members/:id/reset-password（重置密码并吊销该成员全部会话）
router.post('/team/members/:id/reset-password', async (req, res) => {
  try {
    const result = await resetTeamMemberPassword(
      req.accountAuth!.account,
      req.enterpriseAuth!,
      String(req.params.id),
      clientIp(req)
    );
    pushKick(result.accountId, '账号密码已被管理员重置，请重新登录');
    ok(res, result, '密码已重置，请立即保存并告知成员');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/team/members/:id/restore（恢复已注销成员，占用一个席位）
router.post('/team/members/:id/restore', async (req, res) => {
  try {
    const result = await restoreTeamMember(
      req.accountAuth!.account,
      req.enterpriseAuth!,
      String(req.params.id),
      clientIp(req)
    );
    ok(res, result, '成员已恢复');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/team/members/:id/unlock（解除密码错误锁定）
router.post('/team/members/:id/unlock', async (req, res) => {
  try {
    await unlockTeamMember(
      req.accountAuth!.account,
      req.enterpriseAuth!,
      String(req.params.id),
      clientIp(req)
    );
    ok(res, null, '成员账号已解锁');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// DELETE /api/team/members/:id（释放席位；占用中的资源返回清单并拒绝）
// permanent=1 表示彻底删除（账号一并清除，不可恢复）
router.delete('/team/members/:id', async (req, res) => {
  try {
    const permanent = req.query.permanent === '1' || req.query.permanent === 'true';
    const result = await deleteTeamMember(
      req.accountAuth!.account,
      req.enterpriseAuth!,
      String(req.params.id),
      clientIp(req),
      permanent
    );
    pushKick(result.accountId, permanent ? '您的账号已被企业管理员彻底删除' : '您的账号已被企业管理员移除');
    ok(res, null, permanent ? '成员已彻底删除' : '成员已删除，席位已释放');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// ==================== 仪表盘（M5） ====================

// GET /api/team/summary（汇总卡 + 成员活跃排行）
router.get('/team/summary', async (req, res) => {
  try {
    const result = await getTeamSummary(req.enterpriseAuth!.enterprise);
    ok(res, result);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// GET /api/team/trend?days=7|30（按日趋势）
router.get('/team/trend', async (req, res) => {
  try {
    const days = Number(req.query.days) === 30 ? 30 : 7;
    const points = await getTeamTrend(req.enterpriseAuth!.enterprise, days);
    ok(res, { days, points });
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// ==================== IP 资源分配（M4） ====================

// GET /api/team/ips?page=&pageSize=&keyword=&status=&memberId=&health=&proxyType=&bound=（企业资源池）
router.get('/team/ips', async (req, res) => {
  try {
    const status =
      req.query.status === undefined || req.query.status === '' ? undefined : Number(req.query.status);
    const health =
      req.query.health === undefined || req.query.health === '' ? undefined : Number(req.query.health);
    const bound =
      req.query.bound === undefined || req.query.bound === '' ? undefined : Number(req.query.bound);
    const result = await listEnterprisePool(req.accountAuth!.account, req.enterpriseAuth!, {
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      keyword: String(req.query.keyword || ''),
      status: Number.isFinite(status) ? status : undefined,
      memberId: req.query.memberId ? String(req.query.memberId) : undefined,
      health: Number.isFinite(health) ? health : undefined,
      proxyType: req.query.proxyType ? String(req.query.proxyType) : undefined,
      bound: Number.isFinite(bound) ? bound : undefined,
    });
    ok(res, result);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

const assignIpSchema = Joi.object({
  resourceIds: Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.number())).min(1).max(500).required(),
  plaintextVisible: Joi.boolean().default(false),
});

// POST /api/team/members/:id/ips（分配资源给成员，可开启明文可见）
router.post('/team/members/:id/ips', async (req, res) => {
  try {
    const { error, value } = assignIpSchema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const result = await assignResources(
      req.accountAuth!.account,
      req.enterpriseAuth!,
      String(req.params.id),
      value.resourceIds.map(String),
      value.plaintextVisible,
      clientIp(req)
    );
    ok(res, result, `已分配 ${result.assigned} 个资源`);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// DELETE /api/team/members/:id/ips/:resourceId（回收；使用中拒绝）
router.delete('/team/members/:id/ips/:resourceId', async (req, res) => {
  try {
    await recycleResource(
      req.accountAuth!.account,
      req.enterpriseAuth!,
      String(req.params.id),
      String(req.params.resourceId),
      clientIp(req)
    );
    ok(res, null, '资源已回收');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/team/members/:id/ips/:resourceId/plaintext（逐条设置明文凭据可见性）
router.post('/team/members/:id/ips/:resourceId/plaintext', async (req, res) => {
  try {
    const schema = Joi.object({ visible: Joi.boolean().required() });
    const { error, value } = schema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const result = await setAssignmentPlaintext(
      req.accountAuth!.account,
      String(req.params.id),
      String(req.params.resourceId),
      value.visible,
      clientIp(req)
    );
    ok(res, result, value.visible ? '已开放明文凭据' : '已关闭明文凭据');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// ==================== 席位扩容码（M6） ====================

// POST /api/team/seat-addons/redeem（仅企业管理员；核销后席位即时生效）
router.post('/team/seat-addons/redeem', async (req, res) => {
  try {
    const { error, value } = Joi.object({ code: Joi.string().trim().max(64).required() }).validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const result = await redeemSeatAddon(
      req.accountAuth!.account,
      req.enterpriseAuth!.enterprise,
      value.code
    );
    ok(res, result, '席位已增加');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// GET /api/team/seat-addons（本企业已核销记录）
router.get('/team/seat-addons', async (req, res) => {
  try {
    ok(res, await listEnterpriseSeatAddons(req.enterpriseAuth!.enterprise.id));
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

export default router;
