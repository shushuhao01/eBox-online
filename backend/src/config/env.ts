import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// 环境加载：生产加载 .env；开发优先 .env.local，缺失回退 .env（对齐 CRM 做法）
const isProduction = process.env.NODE_ENV === 'production';
let envFile = '.env';
if (!isProduction) {
  const localPath = path.join(__dirname, '../../.env.local');
  if (fs.existsSync(localPath)) envFile = '.env.local';
}
dotenv.config({ path: path.join(__dirname, '../../', envFile) });

// JWT 密钥强校验：生产缺失 / 默认占位 / 强度不足直接拒绝启动；开发自动生成临时密钥
function resolveJwtSecret(): string {
  const configured = (process.env.JWT_SECRET || '').trim();
  const invalid = !configured || configured === 'change-me-please' || configured.length < 32;
  if (!invalid) return configured;
  if (isProduction) {
    throw new Error(
      '[env] JWT_SECRET 未配置或强度不足（至少 32 个字符，且不能使用默认值），已拒绝启动',
    );
  }
  const generated = crypto.randomBytes(32).toString('hex');
  console.warn('[env] 未配置有效的 JWT_SECRET，已生成临时随机密钥（重启后旧 token 失效）');
  return generated;
}

const jwtSecret = resolveJwtSecret();

export const env = {
  isProduction,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3008', 10),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'license_server',
  },

  jwtSecret,
  jwtExpires: process.env.JWT_EXPIRES || '7d',

  // ECDSA P-256 私钥标量 d（hex，64 字符）。必须与 eBox 客户端内置公钥配对！
  // 生成方式：npm run gen:key 查看/回填
  privateKeyD: process.env.LICENSE_PRIVATE_KEY_D || '',

  // 默认配置
  heartbeatIntervalHours: parseInt(process.env.HEARTBEAT_INTERVAL_HOURS || '6', 10),

  // CORS 白名单（逗号分隔）
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
};

if (!env.privateKeyD) {
  // 启动告警但不阻断（避免私钥未配置导致服务不可用；签名接口会返回错误）
  console.warn('[env] 未配置 LICENSE_PRIVATE_KEY_D，签名/换机码接口将不可用，请执行 npm run gen:key');
}

// 密钥指纹（只输出前 8 位，便于核对线上配置是否一致，不泄露密钥本身）
console.log(`[env] JWT_SECRET 指纹: ${crypto.createHash('sha256').update(env.jwtSecret).digest('hex').slice(0, 8)}`);
