import { AppDataSource } from '../config/database';
import { AppConfig } from '../entities/account/AppConfig';
import { getConfigValue } from './ConfigService';
import type { SmtpConfig } from './MailService';

/**
 * SMTP 配置统一读取。
 * 优先级：system_config（管理端「邮件发件」页）> app_configs（历史键）> 环境变量。
 * 这样既支持新的通知配置页，也兼容存量 app_configs / SMTP_* 部署。
 */

const appConfigRepo = () => AppDataSource.getRepository(AppConfig);

async function pick(key: string, envKey: string): Promise<string> {
  const sys = (await getConfigValue(key)).trim();
  if (sys) return sys;
  const row = await appConfigRepo().findOneBy({ cfgKey: key });
  const app = (row?.cfgValue ?? '').trim();
  if (app) return app;
  return (process.env[envKey] || '').trim();
}

/** 读取 SMTP 配置；未配置主机返回 null */
export async function loadSmtpConfig(): Promise<SmtpConfig | null> {
  const [host, portRaw, user, pass, from] = await Promise.all([
    pick('smtp_host', 'SMTP_HOST'),
    pick('smtp_port', 'SMTP_PORT'),
    pick('smtp_user', 'SMTP_USER'),
    pick('smtp_pass', 'SMTP_PASS'),
    pick('smtp_from', 'SMTP_FROM'),
  ]);
  const smtpHost = host.trim();
  if (!smtpHost) return null;
  const port = Number(portRaw || 465) || 465;
  const smtpUser = user.trim();
  return {
    host: smtpHost,
    port,
    secure: port === 465,
    user: smtpUser,
    pass,
    from: (from || smtpUser || smtpHost).trim(),
  };
}

/** 发件人显示名（默认「eBox 授权服务」） */
export async function getMailFromName(): Promise<string> {
  return (await getConfigValue('mail_from_name')).trim() || 'eBox 授权服务';
}

/** 邮件渠道是否启用（功能性邮件不受此开关限制） */
export async function isMailEnabled(): Promise<boolean> {
  return (await getConfigValue('mail_enabled')) === '1';
}
