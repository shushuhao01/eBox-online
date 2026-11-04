import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import cron from 'node-cron';

import { env } from './config/env';
import { logger, log } from './config/logger';
import { initializeDatabase } from './config/database';
import { ensureSchema } from './config/ensureSchema';
import { ensureAccountSchema } from './config/ensureAccountSchema';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRequired } from './middleware/helpers';

import clientRoutes from './routes/client';
import accountRoutes from './routes/account';
import teamRoutes from './routes/team';
import ipRoutes from './routes/ip';
import noticeRoutes from './routes/notice';
import agencyRoutes from './routes/agency';
import siteRoutes from './routes/site';
import seoRoutes from './routes/seo';
import adminAuthRoutes from './routes/admin/auth';
import adminKeyRoutes from './routes/admin/keys';
import adminCustomerRoutes from './routes/admin/customers';
import adminDeviceRoutes from './routes/admin/devices';
import adminStatsRoutes from './routes/admin/stats';
import adminConfigRoutes from './routes/admin/config';
import adminLogRoutes from './routes/admin/logs';
import adminBatchRoutes from './routes/admin/batches';
import adminUserRoutes from './routes/admin/users';
import adminSiteRoutes from './routes/admin/site';
import adminAgencyRoutes from './routes/admin/agencies';
import adminAccountRoutes from './routes/admin/accounts';
import adminEnterpriseRoutes from './routes/admin/enterprises';
import adminIpResourceRoutes from './routes/admin/ipResources';
import adminMallRoutes from './routes/admin/mall';
import adminNotifyRoutes from './routes/admin/notify';
import adminMarketingRoutes from './routes/admin/marketing';
import { markExpiredKeys } from './services/KeyService';
import { getConfigValue, processScheduledNotice } from './services/ConfigService';
import { cleanExpiredData } from './services/LogService';
import { cleanSiteVisitLogs, cleanSiteOnline } from './services/SiteAnalyticsService';
import { cleanChannelClicks } from './services/ChannelService';
import { cleanAgencyClicks, processScheduledAgencies } from './services/AgencyService';
import { autoReleaseStaleResources } from './services/IpResourceService';
import { markExpiredAccountLicenses } from './services/LicenseAccountService';
import { scanExpiringLicenseNotifications } from './services/NotifyService';
import { markOpened, processScheduledCampaigns } from './services/MarketingService';

const app = express();
const PORT = env.port;
const API_PREFIX = '/api/v1';
const ADMIN_PREFIX = '/api/admin';

// 信任代理（Nginx 反代后取真实 IP）
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: (origin, cb) => {
      // 无 Origin：桌面客户端 / 服务端调用 / 同源请求预检，放行
      if (!origin) return cb(null, true);
      // 白名单内放行；其余拒绝（不返回 CORS 头，浏览器侧拦截）
      if (env.corsOrigin.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: false,
  })
);
// SSE 长连接路径：不压缩（compression 会缓冲流式响应导致事件延迟）
const NOTICE_STREAM_PATH = `${API_PREFIX}/notice/stream`;
const ACCOUNT_STREAM_PATH = `${API_PREFIX}/account/events`;
app.use(
  compression({
    filter: (req, res) => {
      if (req.path === NOTICE_STREAM_PATH || req.path === ACCOUNT_STREAM_PATH) return false;
      return compression.filter(req, res);
    },
  })
);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

if (env.isProduction) {
  app.use(
    morgan('combined', {
      stream: { write: (m: string) => logger.http(m.trim()) },
    })
  );
}

// 通用限流
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: { code: 429, msg: '请求过于频繁，请稍后再试', data: null },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path === '/health' || req.path === NOTICE_STREAM_PATH || req.path === ACCOUNT_STREAM_PATH,
});
app.use(generalLimiter);

// 凭据类接口限流（M7）：登录、注册、找回密码、激活、升级码 / 席位码核销均在 10 分钟内限制次数，
// 防止撞库与核销码暴力枚举；与通用限流叠加，不影响其它接口。
const credentialLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: { code: 429, msg: '操作过于频繁，请稍后再试', data: null },
  standardHeaders: true,
  legacyHeaders: false,
});
for (const p of [
  '/account/login',
  '/account/register',
  '/account/password/forgot',
  '/account/password/reset',
  '/account/phone/send-code',
  '/license/activate',
  '/account/upgrade-code/redeem',
  '/team/seat-addons/redeem',
]) {
  app.use(`${API_PREFIX}${p}`, credentialLimiter);
}

// 管理接口限流（更严格）
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { code: 429, msg: '请求过于频繁，请稍后再试', data: null },
  standardHeaders: true,
  legacyHeaders: false,
});

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ success: true, message: 'eBox License Server OK', timestamp: new Date().toISOString() });
});
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'eBox License Server OK', timestamp: new Date().toISOString() });
});

// ==================== 官网图片静态托管（后台媒体库上传，路径 /api/uploads/...） ====================
const uploadRoot = process.env.SITE_UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
app.use('/api/uploads', express.static(uploadRoot, { maxAge: '7d', fallthrough: true }));

// ==================== 营销邮件打开追踪（无需登录，返回 1x1 透明 GIF） ====================
const OPEN_PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
app.get('/api/marketing/open/:token', async (req, res) => {
  try {
    await markOpened(String(req.params.token || ''));
  } catch {
    /* 打开统计失败不影响像素返回 */
  }
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store');
  res.end(OPEN_PIXEL_GIF);
});

// ==================== 客户端接口（无需登录） ====================
app.use(API_PREFIX, clientRoutes);

// ==================== 账号体系接口（注册/登录/会话/客户端配置） ====================
app.use(API_PREFIX, accountRoutes);

// ==================== 企业团队管理（企业管理员；成员访问 403） ====================
app.use(API_PREFIX, teamRoutes);

// ==================== IP 资源池（个人高级 / 企业管理员导入；成员使用已分配资源） ====================
app.use(API_PREFIX, ipRoutes);

// ==================== 系统公告实时推送（SSE 长连接，无需登录） ====================
app.use(API_PREFIX, noticeRoutes);

// ==================== 客户端代理商点击埋点（无需登录） ====================
app.use(API_PREFIX, agencyRoutes);

// ==================== 官网公开只读接口（无需登录） ====================
app.use('/api/site', siteRoutes);

// ==================== 根级 SEO 路由（/sitemap.xml、IndexNow 密钥文件） ====================
app.use(seoRoutes);

// ==================== 管理面板接口（JWT） ====================
app.use(`${ADMIN_PREFIX}/auth`, adminLimiter, adminAuthRoutes);
app.use(`${ADMIN_PREFIX}`, authRequired, adminKeyRoutes);
app.use(`${ADMIN_PREFIX}`, authRequired, adminCustomerRoutes);
app.use(`${ADMIN_PREFIX}`, authRequired, adminDeviceRoutes);
app.use(`${ADMIN_PREFIX}/stats`, authRequired, adminStatsRoutes);
app.use(`${ADMIN_PREFIX}/config`, authRequired, adminConfigRoutes);
app.use(`${ADMIN_PREFIX}/notify`, authRequired, adminNotifyRoutes);
app.use(`${ADMIN_PREFIX}/marketing`, authRequired, adminMarketingRoutes);
app.use(`${ADMIN_PREFIX}`, authRequired, adminLogRoutes);
app.use(`${ADMIN_PREFIX}`, authRequired, adminBatchRoutes);
app.use(`${ADMIN_PREFIX}/users`, authRequired, adminUserRoutes);
app.use(`${ADMIN_PREFIX}/site`, authRequired, adminSiteRoutes);
app.use(`${ADMIN_PREFIX}/agencies`, authRequired, adminAgencyRoutes);
app.use(`${ADMIN_PREFIX}/accounts`, authRequired, adminAccountRoutes);
app.use(`${ADMIN_PREFIX}`, authRequired, adminEnterpriseRoutes);
app.use(`${ADMIN_PREFIX}`, authRequired, adminIpResourceRoutes);
app.use(`${ADMIN_PREFIX}`, authRequired, adminMallRoutes);

// 404 与错误处理
app.use(notFoundHandler);
app.use(errorHandler);

// ==================== 启动 ====================
async function main() {
  try {
    await initializeDatabase();
    log.info(`✅ 数据库连接成功：${env.db.database} @ ${env.db.host}:${env.db.port}`);

    // 结构自愈：自动创建 / 补齐官网访问明细表（无需手动执行建表 SQL）
    await ensureSchema();

    // 账号与团队体系结构自愈（新建账号/企业/SKU/IP 资源表，补列，种子；幂等）
    await ensureAccountSchema();

    // 定时任务：每小时清理过期激活码状态
    cron.schedule('0 * * * *', async () => {
      try {
        const n = await markExpiredKeys();
        if (n > 0) log.info(`定时清理：${n} 个激活码已过期`);
      } catch (e) {
        log.error('定时清理失败', e);
      }
    });

    // 定时任务：每日标记账号体系已到期卡密 / 企业（权益本身按到期时间动态判定，此处用于运营视图）
    cron.schedule('10 0 * * *', async () => {
      try {
        const r = await markExpiredAccountLicenses();
        if (r.keys + r.enterprises > 0) {
          log.info(`账号到期标记：${r.keys} 张卡密、${r.enterprises} 个企业`);
        }
      } catch (e) {
        log.error('账号到期标记失败', e);
      }
      try {
        const sent = await scanExpiringLicenseNotifications(7);
        if (sent > 0) log.info(`临期提醒：已发送 ${sent} 条`);
      } catch (e) {
        log.error('临期提醒失败', e);
      }
    });

    // 定时任务：操作日志 + 心跳日志自动清理（保留天数 + 每日清理时间可配置，避免日志爆盘）。
    // 每分钟触发一次轻量检查，仅当当前时间匹配配置的 log_clean_time 时才执行删除。
    // 加互斥锁：清理耗时较长（分批删除）时，下一次触发直接跳过，避免重叠执行。
    let logCleaning = false;
    cron.schedule('* * * * *', async () => {
      if (logCleaning) return;
      try {
        const [cleanTime, retentionDays] = await Promise.all([
          getConfigValue('log_clean_time'),
          getConfigValue('log_retention_days'),
        ]);
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        if (`${hh}:${mm}` !== cleanTime) return;
        const days = Math.max(1, Number(retentionDays) || 1);
        logCleaning = true;
        try {
          const r = await cleanExpiredData(days);
          if (r.operationLogs + r.heartbeats > 0)
            log.info(`日志清理：删除 ${r.operationLogs} 条操作日志、${r.heartbeats} 条心跳日志（超过 ${days} 天）`);
        } finally {
          logCleaning = false;
        }
      } catch (e) {
        log.error('日志清理失败', e);
      }
    });

    // 定时任务：系统公告定时发送（每分钟检查一次，到点即发布并实时推送）
    cron.schedule('* * * * *', async () => {
      try {
        await processScheduledNotice();
      } catch (e) {
        log.error('定时公告发送失败', e);
      }
    });

    // 定时任务：客户端代理商定时推送（与公告同机制，每分钟检查一次）
    cron.schedule('* * * * *', async () => {
      try {
        await processScheduledAgencies();
      } catch (e) {
        log.error('定时代理商推送失败', e);
      }
    });

    // 定时任务：营销邮件定时发送（send_at 到点即发送）
    cron.schedule('* * * * *', async () => {
      try {
        const n = await processScheduledCampaigns();
        if (n > 0) log.info(`定时营销邮件：已发送 ${n} 个活动`);
      } catch (e) {
        log.error('定时营销邮件发送失败', e);
      }
    });

    // 定时任务：IP 资源兜底释放（绑定超过 10 分钟且设备无心跳）
    cron.schedule('* * * * *', async () => {
      try {
        const n = await autoReleaseStaleResources();
        if (n > 0) log.info(`IP 资源兜底释放：${n} 个绑定已自动释放`);
      } catch (e) {
        log.error('IP 资源兜底释放失败', e);
      }
    });

    // 定时任务：官网访问明细清理（保留 90 天，每日 03:30 执行，避免明细表无限增长爆盘）
    cron.schedule('30 3 * * *', async () => {
      try {
        const n = await cleanSiteVisitLogs(90);
        if (n > 0) log.info(`官网访问明细清理：删除 ${n} 条超过 90 天的记录`);
        const o = await cleanSiteOnline(24);
        if (o > 0) log.info(`官网在线状态清理：删除 ${o} 条超过 24 小时的在线上报记录`);
        const c = await cleanChannelClicks(90);
        if (c > 0) log.info(`官网渠道点击明细清理：删除 ${c} 条超过 90 天的记录`);
        const a = await cleanAgencyClicks(90);
        if (a > 0) log.info(`客户端代理商点击明细清理：删除 ${a} 条超过 90 天的记录`);
      } catch (e) {
        log.error('官网访问明细清理失败', e);
      }
    });

    app.listen(PORT, () => {
      log.info(`🚀 eBox 授权服务平台后端已启动：http://0.0.0.0:${PORT}`);
      log.info(`   客户端接口：${API_PREFIX}   管理接口：${ADMIN_PREFIX}`);
    });
  } catch (e) {
    log.error('启动失败', e);
    process.exit(1);
  }
}

// 优雅退出
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

main();
