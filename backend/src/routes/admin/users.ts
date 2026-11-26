import { Router } from 'express';
import Joi from 'joi';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../../config/database';
import { User } from '../../entities/User';
import { ok, fail, authRequired, superAdminRequired, clientIp } from '../../middleware/helpers';
import { ApiError } from '../../middleware/errorHandler';
import { writeOperationLog } from '../../services/LogService';

const router = Router();

/** 创始管理员：最早创建的管理员账号，不允许停用/删除 */
async function founderUserId(): Promise<string> {
  const rows: Array<{ id: string }> = await AppDataSource.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
  return String(rows?.[0]?.id || '');
}

router.get('/', authRequired, superAdminRequired, async (_req, res) => {
  const [rows, founderId] = await Promise.all([
    AppDataSource.getRepository(User).find({ order: { createdAt: 'DESC' } }),
    founderUserId(),
  ]);
  ok(
    res,
    rows.map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      role: u.role,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      lastLoginIp: u.lastLoginIp,
      isFounder: String(u.id) === founderId,
      createdAt: u.createdAt,
    }))
  );
});

router.post('/', authRequired, superAdminRequired, async (req, res) => {
  try {
    const { error, value } = Joi.object({
      username: Joi.string().required().max(64),
      password: Joi.string().required().min(6).max(128),
      nickname: Joi.string().allow('', null).max(64).default(null),
      role: Joi.number().integer().min(0).max(1).default(0),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const repo = AppDataSource.getRepository(User);
    if (await repo.findOneBy({ username: value.username })) return fail(res, '用户名已存在', 1003);
    const row = await repo.save(repo.create({ ...(value as User), passwordHash: bcrypt.hashSync(value.password, 10) }));
    await writeOperationLog(req.auth!.userId, '新建管理员', row.username, null, clientIp(req));
    ok(res, { id: row.id, username: row.username });
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// 修改密码（本人或超管）
router.put('/password', authRequired, async (req, res) => {
  try {
    const { error, value } = Joi.object({
      oldPassword: Joi.string().required().max(128),
      newPassword: Joi.string().required().min(6).max(128),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const repo = AppDataSource.getRepository(User);
    const user = await repo.findOneBy({ id: req.auth!.userId });
    if (!user || !bcrypt.compareSync(value.oldPassword, user.passwordHash)) return fail(res, '原密码错误', 1004);
    user.passwordHash = bcrypt.hashSync(value.newPassword, 10);
    // 改密后令牌版本自增：其他设备上的旧 token 立即失效，当前 token 也需重新登录
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await repo.save(user);
    await writeOperationLog(req.auth!.userId, '修改密码', user.username, null, clientIp(req));
    ok(res, null, '修改成功');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// 停用/启用管理员（仅超管；不允许操作自己）
router.put('/:id/status', authRequired, superAdminRequired, async (req, res) => {
  try {
    const { error, value } = Joi.object({
      status: Joi.number().integer().valid(0, 1).required(),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const repo = AppDataSource.getRepository(User);
    const id = String(req.params.id || '');
    if (!id || !/^\d+$/.test(id)) return fail(res, '参数错误', 400);
    if (id === String(req.auth!.userId)) return fail(res, '不能停用自己', 400);
    if (id === (await founderUserId())) return fail(res, '创始人管理员不可停用', 400);
    const user = await repo.findOneBy({ id });
    if (!user) return fail(res, '管理员不存在', 1003);
    user.status = value.status;
    await repo.save(user);
    await writeOperationLog(req.auth!.userId, value.status === 1 ? '启用管理员' : '停用管理员', user.username, null, clientIp(req));
    ok(res, null, '操作成功');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// 编辑管理员资料（仅超管；创始人角色固定为超管，不能改自己的角色）
router.put('/:id', authRequired, superAdminRequired, async (req, res) => {
  try {
    const { error, value } = Joi.object({
      username: Joi.string().max(64),
      nickname: Joi.string().allow('', null).max(64),
      role: Joi.number().integer().valid(0, 1),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const id = String(req.params.id || '');
    if (!id || !/^\d+$/.test(id)) return fail(res, '参数错误', 400);
    const repo = AppDataSource.getRepository(User);
    const user = await repo.findOneBy({ id });
    if (!user) return fail(res, '管理员不存在', 1003);
    if (value.username && value.username !== user.username) {
      if (await repo.findOneBy({ username: value.username })) return fail(res, '用户名已存在', 1003);
      user.username = value.username;
    }
    if (value.nickname !== undefined) user.nickname = value.nickname || null;
    if (value.role !== undefined && value.role !== user.role) {
      if (id === String(req.auth!.userId)) return fail(res, '不能修改自己的角色', 400);
      if (String(user.id) === (await founderUserId())) return fail(res, '创始人管理员角色不可修改', 400);
      user.role = value.role;
    }
    await repo.save(user);
    await writeOperationLog(req.auth!.userId, '编辑管理员', user.username, null, clientIp(req));
    ok(res, null, '保存成功');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// 重置密码（仅超管，无需原密码；重置后该管理员所有旧 token 失效）
router.put('/:id/password', authRequired, superAdminRequired, async (req, res) => {
  try {
    const { error, value } = Joi.object({
      newPassword: Joi.string().required().min(6).max(128),
    }).validate(req.body);
    if (error) return fail(res, `参数错误：${error.message}`, 400);
    const id = String(req.params.id || '');
    if (!id || !/^\d+$/.test(id)) return fail(res, '参数错误', 400);
    const repo = AppDataSource.getRepository(User);
    const user = await repo.findOneBy({ id });
    if (!user) return fail(res, '管理员不存在', 1003);
    user.passwordHash = bcrypt.hashSync(value.newPassword, 10);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await repo.save(user);
    await writeOperationLog(req.auth!.userId, '重置管理员密码', user.username, null, clientIp(req));
    ok(res, null, '密码已重置');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

// 删除管理员（仅超管；不能删除自己与创始人）
router.delete('/:id', authRequired, superAdminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!id || !/^\d+$/.test(id)) return fail(res, '参数错误', 400);
    if (id === String(req.auth!.userId)) return fail(res, '不能删除自己', 400);
    if (id === (await founderUserId())) return fail(res, '创始人管理员不可删除', 400);
    const repo = AppDataSource.getRepository(User);
    const user = await repo.findOneBy({ id });
    if (!user) return fail(res, '管理员不存在', 1003);
    await repo.remove(user);
    await writeOperationLog(req.auth!.userId, '删除管理员', user.username, null, clientIp(req));
    ok(res, null, '已删除');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

export default router;
