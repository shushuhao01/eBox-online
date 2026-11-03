import { Router, Response } from 'express';
import Joi from 'joi';
import { ok } from '../middleware/helpers';
import { ApiError } from '../middleware/errorHandler';
import { requireAccount } from '../middleware/accountAuth';
import {
  bindResource,
  commitIpRows,
  deleteResource,
  getPoolMode,
  getResourceCredentials,
  listAvailable,
  listResources,
  parseIpFile,
  parseIpRows,
  releaseResource,
  reportResourceProbe,
  setPoolMode,
  setResourceStatus,
} from '../services/IpResourceService';

const router = Router();

/**
 * IP 资源池（M4）
 * - 归属按登录身份自动判定（个人池 / 企业池），接口不接收客户端指定归属
 * - 成员可读自己已分配的资源、绑定 / 释放；导入与池管理仅个人高级或企业管理员
 */
router.use('/ip', requireAccount);

function sendError(res: Response, e: unknown): boolean {
  if (e instanceof ApiError) {
    res.status(e.status || 200).json({ code: e.code, msg: e.message, data: e.data ?? null });
    return true;
  }
  return false;
}

const rowSchema = Joi.object({
  line: Joi.number().integer().min(0).default(0),
  proxyType: Joi.string().allow('', 'socks5', 'socks', 'http', 'https').default('socks5'),
  host: Joi.string().allow('').max(128).default(''),
  port: Joi.alternatives().try(Joi.number(), Joi.string().allow('')).default(0),
  username: Joi.string().allow('').max(128).default(''),
  password: Joi.string().allow('').max(256).default(''),
  remark: Joi.string().allow('').max(255).default(''),
  testedOk: Joi.boolean().default(false),
  overwrite: Joi.boolean().default(false),
  latencyMs: Joi.number().min(0).default(0),
});

// POST /api/ip/resources/parse（预览：逐行校验 + 重复标记，不入库）
router.post('/ip/resources/parse', async (req, res) => {
  try {
    const schema = Joi.object({ text: Joi.string().allow('').max(200000).required() });
    const { error, value } = schema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const result = await parseIpRows(req.accountAuth!.account, value.text);
    ok(res, result);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/ip/resources/parse-file（文件导入：xlsx / csv / txt 转文本后走同一套解析）
router.post('/ip/resources/parse-file', async (req, res) => {
  try {
    const schema = Joi.object({
      name: Joi.string().allow('').max(255).default(''),
      // 原始文件 ≤3MB，base64 后约 4MB；上限留足余量，真实大小由解析端校验
      content: Joi.string().max(6 * 1024 * 1024).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const buffer = Buffer.from(value.content, 'base64');
    if (!buffer.length) throw new ApiError('文件内容为空', 400);
    const result = await parseIpFile(req.accountAuth!.account, value.name, buffer);
    ok(res, result);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/ip/resources/commit（仅提交测试通过的行）
router.post('/ip/resources/commit', async (req, res) => {
  try {
    const schema = Joi.object({
      rows: Joi.array().items(rowSchema).min(1).max(500).required(),
      storageMode: Joi.number().integer().valid(1, 2).default(1),
    });
    const { error, value } = schema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const result = await commitIpRows(req.accountAuth!.account, value.rows, value.storageMode);
    ok(res, result, `已入库：新增 ${result.created} 条、覆盖 ${result.updated} 条`);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// GET /api/ip/pool/mode（存储模式）
router.get('/ip/pool/mode', async (req, res) => {
  try {
    ok(res, await getPoolMode(req.accountAuth!.account));
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/ip/pool/mode（个人池 1↔2；企业池固定 1）
router.post('/ip/pool/mode', async (req, res) => {
  try {
    const schema = Joi.object({ storageMode: Joi.number().integer().valid(1, 2).required() });
    const { error, value } = schema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const result = await setPoolMode(req.accountAuth!.account, value.storageMode);
    ok(res, result, value.storageMode === 1 ? '已切换为持久化存储' : '已切换为仅本机存储');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// GET /api/ip/resources?page=&pageSize=&keyword=&status=&bound=
router.get('/ip/resources', async (req, res) => {
  try {
    const num = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v));
    const result = await listResources(req.accountAuth!.account, {
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 20,
      keyword: String(req.query.keyword || ''),
      status: num(req.query.status),
      bound: num(req.query.bound),
    });
    ok(res, result);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// GET /api/ip/available（个人池未占用 / 成员已分配未占用）
router.get('/ip/available', async (req, res) => {
  try {
    ok(res, { list: await listAvailable(req.accountAuth!.account) });
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/ip/bind（绑定到环境；凭据仅在本次响应下发明文）
router.post('/ip/bind', async (req, res) => {
  try {
    const schema = Joi.object({
      resourceId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      envId: Joi.string().allow('').max(64).default(''),
      envName: Joi.string().allow('').max(128).default(''),
    });
    const { error, value } = schema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    const result = await bindResource(
      req.accountAuth!.account,
      String(value.resourceId),
      value.envId,
      value.envName
    );
    ok(res, result, '资源已绑定');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/ip/release（释放：清除代理 / 环境删除 / 退出登录）
router.post('/ip/release', async (req, res) => {
  try {
    const schema = Joi.object({
      resourceId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      reason: Joi.string().allow('').max(255).default(''),
    });
    const { error, value } = schema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    await releaseResource(req.accountAuth!.account, String(value.resourceId), value.reason);
    ok(res, null, '资源已释放');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// GET /api/ip/resources/:id/credentials（本机测试用：下发一次明文凭据，仅所有者 / 企业管理员 / 明文可见成员）
router.get('/ip/resources/:id/credentials', async (req, res) => {
  try {
    const data = await getResourceCredentials(req.accountAuth!.account, String(req.params.id));
    ok(res, data);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/ip/resources/:id/probe-result（客户端本机探测结果回传，服务端不再重复探测）
router.post('/ip/resources/:id/probe-result', async (req, res) => {
  try {
    const schema = Joi.object({
      ok: Joi.boolean().required(),
      latencyMs: Joi.number().integer().min(0).max(600000).default(0),
    });
    const { error, value } = schema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    await reportResourceProbe(req.accountAuth!.account, String(req.params.id), value.ok, value.latencyMs);
    ok(res, null);
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// POST /api/ip/resources/:id/status（启用 / 停用）
router.post('/ip/resources/:id/status', async (req, res) => {
  try {
    const schema = Joi.object({ status: Joi.number().integer().valid(1, 2).required() });
    const { error, value } = schema.validate(req.body);
    if (error) throw new ApiError(`参数错误：${error.message}`, 400, 400);
    await setResourceStatus(req.accountAuth!.account, String(req.params.id), value.status);
    ok(res, null, value.status === 1 ? '资源已启用' : '资源已停用');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

// DELETE /api/ip/resources/:id（使用中拒绝）
router.delete('/ip/resources/:id', async (req, res) => {
  try {
    await deleteResource(req.accountAuth!.account, String(req.params.id));
    ok(res, null, '资源已删除');
  } catch (e) {
    if (sendError(res, e)) return;
    throw e;
  }
});

export default router;
