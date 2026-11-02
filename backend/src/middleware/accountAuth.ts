import { Request, Response, NextFunction } from 'express';
import { Account } from '../entities/account/Account';
import { AccountSession } from '../entities/account/AccountSession';
import { authenticateToken } from '../services/AccountService';
import { EntitlementCaps, Entitlements, getEntitlements } from '../services/EntitlementService';
import { EnterpriseContext, requireEnterpriseAdmin as requireAdminOf } from '../services/EnterpriseService';
import { ApiError } from './errorHandler';

export interface AccountAuthInfo {
  account: Account;
  session: AccountSession;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      accountAuth?: AccountAuthInfo;
      /** requireEnterpriseAdmin 解析出的企业上下文 */
      enterpriseAuth?: EnterpriseContext;
      /** requireCap 计算出的权益快照 */
      entitlements?: Entitlements;
    }
  }
}

/** 从 Authorization: Bearer <token> 解析账号会话 */
export async function requireAccount(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ code: 401, msg: '未登录或登录已过期', data: null });
    return;
  }
  try {
    const auth = await authenticateToken(token);
    if (!auth) {
      res.status(401).json({ code: 401, msg: '未登录或登录已过期', data: null });
      return;
    }
    req.accountAuth = auth;
    next();
  } catch (e) {
    next(e);
  }
}

/** 企业管理员校验（需先经过 requireAccount）；越权统一 403。 */
export async function requireEnterpriseAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.accountAuth) {
      res.status(401).json({ code: 401, msg: '未登录或登录已过期', data: null });
      return;
    }
    req.enterpriseAuth = await requireAdminOf(req.accountAuth.account);
    next();
  } catch (e) {
    if (e instanceof ApiError) {
      res.status(e.status || 403).json({ code: e.code, msg: e.message, data: null });
      return;
    }
    next(e);
  }
}

/** 能力校验（需先经过 requireAccount）：无该能力返回 403 + 升级提示。 */
export function requireCap(cap: keyof EntitlementCaps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.accountAuth) {
        res.status(401).json({ code: 401, msg: '未登录或登录已过期', data: null });
        return;
      }
      const entitlements = await getEntitlements(req.accountAuth.account);
      if (!entitlements.caps[cap]) {
        res.status(403).json({
          code: 4030,
          msg: '当前套餐不支持该功能，请升级后使用',
          data: { cap },
        });
        return;
      }
      req.entitlements = entitlements;
      next();
    } catch (e) {
      next(e);
    }
  };
}
