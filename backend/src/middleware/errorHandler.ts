import { Request, Response, NextFunction } from 'express';
import { log } from '../config/logger';

export class ApiError extends Error {
  status: number;
  code: number;
  /** 需要随错误一起返回给客户端的结构化数据（如占用清单） */
  data?: unknown;
  constructor(message: string, code = 1, status = 200, data?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ code: 404, msg: '接口不存在', data: null });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ code: err.code, msg: err.message, data: err.data ?? null });
    return;
  }
  const message = err instanceof Error ? err.message : '服务器内部错误';
  log.error(`[${req.method}] ${req.path} -> ${message}`, { stack: err instanceof Error ? err.stack : undefined });
  res.status(500).json({ code: 500, msg: '服务器内部错误', data: null });
}
