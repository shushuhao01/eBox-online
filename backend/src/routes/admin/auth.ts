import { Router } from 'express';
import Joi from 'joi';
import bcrypt from 'bcryptjs';
import { AppDataSource } from '../../config/database';
import { User } from '../../entities/User';
import { ok, fail, signToken, authRequired, clientIp } from '../../middleware/helpers';
import { ApiError } from '../../middleware/errorHandler';

const router = Router();

/** 与普通用户登录口径一致：连续失败 5 次锁定 10 分钟 */
const MAX_ADMIN_LOGIN_FAILS = 5;
const ADMIN_LOCK_MINUTES = 10;

router.post('/login', async (req, res) => {
  try {
    const { error, value } = Joi.object({
      username: Joi.string().required().max(64),
      password: Joi.string().required().max(128),
    }).validate(req.body);
    if (error) return fail(res, '参数错误', 400);

    const repo = AppDataSource.getRepository(User);
    const user = await repo.findOneBy({ username: value.username });
    const invalid = '用户名或密码错误';
    if (!user) return fail(res, invalid, 1001);

    // 锁定期内直接拒绝；锁定期已过自动恢复
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
      return fail(res, `账号已锁定，请 ${mins} 分钟后再试或联系超级管理员解锁`, 1006);
    }
    if (user.lockedUntil) {
      user.lockedUntil = null;
      user.lockCount = 0;
    }

    if (!bcrypt.compareSync(value.password, user.passwordHash)) {
      user.lockCount = (user.lockCount || 0) + 1;
      if (user.lockCount > MAX_ADMIN_LOGIN_FAILS) user.lockCount = MAX_ADMIN_LOGIN_FAILS;
      if (user.lockCount >= MAX_ADMIN_LOGIN_FAILS) {
        user.lockedUntil = new Date(Date.now() + ADMIN_LOCK_MINUTES * 60 * 1000);
      }
      await repo.save(user);
      if (user.lockCount >= MAX_ADMIN_LOGIN_FAILS) {
        return fail(res, `密码错误次数过多，账号已锁定 ${ADMIN_LOCK_MINUTES} 分钟`, 1006);
      }
      return fail(res, invalid, 1001);
    }
    if (user.status !== 1) return fail(res, '账号已停用', 1002);

    user.lockCount = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    user.lastLoginIp = clientIp(req);
    await repo.save(user);

    const token = signToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      ver: user.tokenVersion || 0,
    });
    ok(res, {
      token,
      user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role },
    }, '登录成功');
  } catch (e) {
    if (e instanceof ApiError) return fail(res, e.message, e.code);
    throw e;
  }
});

router.get('/profile', authRequired, async (req, res) => {
  const user = await AppDataSource.getRepository(User).findOneBy({ id: req.auth!.userId });
  if (!user) return fail(res, '用户不存在', 401, 401);
  ok(res, {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    lastLoginAt: user.lastLoginAt,
    lastLoginIp: user.lastLoginIp,
  });
});

// POST /api/admin/auth/logout（退出登录：令牌版本自增，旧 token 立即失效）
router.post('/logout', authRequired, async (req, res) => {
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOneBy({ id: req.auth!.userId });
  if (user) {
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await repo.save(user);
  }
  ok(res, null, '已退出登录');
});

export default router;
