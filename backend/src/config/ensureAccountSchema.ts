import type { QueryRunner } from 'typeorm';
import { AppDataSource } from './database';
import { log } from './logger';

/**
 * 账号与团队体系 · M0 结构自愈（幂等）
 * - 新建账号/会话/设备/企业/成员/SKU/IP 资源/席位扩容码/协议记录/配置表
 * - 为存量 license_keys / devices 补齐账号体系增量字段（可空或带默认值，不影响旧逻辑）
 * - 写入 16 个默认 SKU 与 app_configs 初始配置（INSERT IGNORE，不覆盖运营修改）
 * 表结构由后端自建，synchronize 保持关闭。
 */

const CREATE_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS \`accounts\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`login\` VARCHAR(64) NOT NULL,
  \`password_hash\` VARCHAR(128) NOT NULL,
  \`nickname\` VARCHAR(64) NULL,
  \`email\` VARCHAR(128) NULL,
  \`phone\` VARCHAR(32) NULL,
  \`status\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=正常 2=停用 3=锁定',
  \`lock_count\` INT NOT NULL DEFAULT 0,
  \`locked_until\` DATETIME NULL,
  \`ever_enterprise\` TINYINT NOT NULL DEFAULT 0,
  \`role\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=个人 2=企业管理员 3=企业成员',
  \`enterprise_id\` BIGINT UNSIGNED NULL,
  \`reset_code_hash\` VARCHAR(64) NULL,
  \`reset_code_expire\` DATETIME NULL,
  \`reset_code_attempts\` INT NOT NULL DEFAULT 0,
  \`last_login_at\` DATETIME NULL,
  \`last_login_ip\` VARCHAR(64) NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_accounts_login\` (\`login\`),
  KEY \`idx_accounts_email\` (\`email\`),
  KEY \`idx_accounts_enterprise\` (\`enterprise_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_ACCOUNT_SESSIONS = `
CREATE TABLE IF NOT EXISTS \`account_sessions\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`account_id\` BIGINT UNSIGNED NOT NULL,
  \`token_hash\` VARCHAR(64) NOT NULL,
  \`machine_fp\` VARCHAR(64) NULL,
  \`client_ip\` VARCHAR(64) NULL,
  \`user_agent\` VARCHAR(255) NULL,
  \`expires_at\` DATETIME NOT NULL,
  \`last_seen_at\` DATETIME NULL,
  \`revoked_at\` DATETIME NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_account_sessions_token\` (\`token_hash\`),
  KEY \`idx_account_sessions_account\` (\`account_id\`),
  KEY \`idx_account_sessions_expire\` (\`expires_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_ACCOUNT_DEVICES = `
CREATE TABLE IF NOT EXISTS \`account_devices\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`account_id\` BIGINT UNSIGNED NOT NULL,
  \`machine_fp\` VARCHAR(64) NOT NULL,
  \`device_name\` VARCHAR(128) NULL,
  \`os_info\` VARCHAR(128) NULL,
  \`app_version\` VARCHAR(32) NULL,
  \`status\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=正常 0=已移除',
  \`first_login_at\` DATETIME NULL,
  \`last_active_at\` DATETIME NULL,
  \`env_total\` INT NOT NULL DEFAULT 0 COMMENT '客户端上报环境总数',
  \`env_running\` INT NOT NULL DEFAULT 0 COMMENT '客户端上报运行中环境数',
  \`bound_resource_ids\` TEXT NULL COMMENT '客户端上报已绑定 IP 资源 id（JSON 数组）',
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_account_devices_fp\` (\`account_id\`, \`machine_fp\`),
  KEY \`idx_account_devices_active\` (\`last_active_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_ENTERPRISES = `
CREATE TABLE IF NOT EXISTS \`enterprises\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`code\` VARCHAR(8) NOT NULL,
  \`code_prefix\` VARCHAR(6) NOT NULL,
  \`name\` VARCHAR(128) NOT NULL,
  \`owner_account_id\` BIGINT UNSIGNED NOT NULL,
  \`seats\` INT NOT NULL DEFAULT 1,
  \`sku_id\` BIGINT UNSIGNED NULL,
  \`status\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=正常 2=停用 3=到期',
  \`expire_at\` DATETIME NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_enterprises_code\` (\`code\`),
  UNIQUE KEY \`uk_enterprises_prefix\` (\`code_prefix\`),
  KEY \`idx_enterprises_owner\` (\`owner_account_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_ENTERPRISE_MEMBERS = `
CREATE TABLE IF NOT EXISTS \`enterprise_members\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`enterprise_id\` BIGINT UNSIGNED NOT NULL,
  \`account_id\` BIGINT UNSIGNED NOT NULL,
  \`role\` TINYINT NOT NULL DEFAULT 2 COMMENT '1=管理员 2=成员',
  \`hint\` VARCHAR(255) NULL COMMENT '配置/提示词：姓名、工号、机器名等',
  \`remark\` VARCHAR(255) NULL,
  \`status\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=正常 2=停用 3=注销',
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_enterprise_members\` (\`enterprise_id\`, \`account_id\`),
  KEY \`idx_enterprise_members_account\` (\`account_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_SKUS = `
CREATE TABLE IF NOT EXISTS \`skus\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`code\` VARCHAR(32) NOT NULL,
  \`version\` TINYINT NOT NULL COMMENT '1=个人 2=企业',
  \`level\` TINYINT NOT NULL COMMENT '1=普通 2=高级',
  \`duration\` VARCHAR(16) NOT NULL COMMENT 'month/quarter/year/permanent',
  \`duration_days\` INT NOT NULL DEFAULT 0 COMMENT '0=永久',
  \`label\` VARCHAR(64) NOT NULL,
  \`seats\` INT NOT NULL DEFAULT 1,
  \`mall_url\` VARCHAR(512) NULL,
  \`caps_json\` TEXT NULL,
  \`enabled\` TINYINT NOT NULL DEFAULT 1,
  \`sort\` INT NOT NULL DEFAULT 0,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_skus_code\` (\`code\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_IP_RESOURCES = `
CREATE TABLE IF NOT EXISTS \`ip_resources\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`scope\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=个人池 2=企业池',
  \`owner_account_id\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  \`enterprise_id\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  \`proxy_type\` VARCHAR(8) NOT NULL DEFAULT 'socks5',
  \`host\` VARCHAR(128) NOT NULL,
  \`port\` INT NOT NULL,
  \`username\` VARCHAR(128) NOT NULL DEFAULT '',
  \`password_enc\` VARCHAR(512) NOT NULL DEFAULT '',
  \`remark\` VARCHAR(255) NULL,
  \`status\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=启用 2=停用',
  \`health\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=未测 2=正常 3=异常',
  \`latency_ms\` INT NULL,
  \`last_check_at\` DATETIME NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_ip_resources\` (\`scope\`, \`owner_account_id\`, \`enterprise_id\`, \`host\`, \`port\`, \`username\`),
  KEY \`idx_ip_resources_scope\` (\`scope\`, \`enterprise_id\`),
  KEY \`idx_ip_resources_owner\` (\`owner_account_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_IP_ASSIGNMENTS = `
CREATE TABLE IF NOT EXISTS \`ip_assignments\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`resource_id\` BIGINT UNSIGNED NOT NULL,
  \`enterprise_id\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  \`member_account_id\` BIGINT UNSIGNED NOT NULL,
  \`assigned_by\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  \`plaintext_visible\` TINYINT NOT NULL DEFAULT 0,
  \`env_id\` VARCHAR(64) NULL,
  \`env_name\` VARCHAR(128) NULL,
  \`bound_at\` DATETIME NULL,
  \`released_at\` DATETIME NULL,
  \`release_reason\` VARCHAR(255) NULL,
  \`status\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=已分配 2=使用中 3=已回收',
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_ip_assignments_resource\` (\`resource_id\`),
  KEY \`idx_ip_assignments_member\` (\`member_account_id\`, \`status\`),
  KEY \`idx_ip_assignments_enterprise\` (\`enterprise_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_IP_POOL_SETTINGS = `
CREATE TABLE IF NOT EXISTS \`ip_pool_settings\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`owner_type\` TINYINT NOT NULL COMMENT '1=个人 2=企业',
  \`owner_id\` BIGINT UNSIGNED NOT NULL,
  \`storage_mode\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=持久化 2=仅本机',
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_ip_pool_settings_owner\` (\`owner_type\`, \`owner_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_SEAT_ADDONS = `
CREATE TABLE IF NOT EXISTS \`seat_addons\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`code\` VARCHAR(64) NOT NULL,
  \`seat_delta\` INT NOT NULL,
  \`enterprise_id\` BIGINT UNSIGNED NULL,
  \`remark\` VARCHAR(255) NULL,
  \`status\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=未使用 2=已使用 3=作废',
  \`valid_until\` DATETIME NULL,
  \`used_at\` DATETIME NULL,
  \`used_by\` BIGINT UNSIGNED NULL,
  \`created_by\` BIGINT UNSIGNED NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_seat_addons_code\` (\`code\`),
  KEY \`idx_seat_addons_enterprise\` (\`enterprise_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_UPGRADE_CODES = `
CREATE TABLE IF NOT EXISTS \`upgrade_codes\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`code\` VARCHAR(64) NOT NULL,
  \`from_sku_id\` BIGINT UNSIGNED NULL,
  \`to_sku_id\` BIGINT UNSIGNED NOT NULL,
  \`account_id\` BIGINT UNSIGNED NULL,
  \`amount\` DECIMAL(10,2) NULL,
  \`remark\` VARCHAR(255) NULL,
  \`status\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=未使用 2=已使用 3=作废',
  \`valid_until\` DATETIME NULL,
  \`used_at\` DATETIME NULL,
  \`used_by\` BIGINT UNSIGNED NULL,
  \`created_by\` BIGINT UNSIGNED NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_upgrade_codes_code\` (\`code\`),
  KEY \`idx_upgrade_codes_account\` (\`account_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_PROXY_BLOCK_EVENTS = `
CREATE TABLE IF NOT EXISTS \`proxy_block_events\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`account_id\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  \`enterprise_id\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  \`device_id\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  \`env_id\` VARCHAR(64) NOT NULL DEFAULT '',
  \`event_type\` VARCHAR(32) NOT NULL DEFAULT 'block',
  \`detail\` VARCHAR(512) NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY \`idx_proxy_block_events_ent\` (\`enterprise_id\`, \`created_at\`),
  KEY \`idx_proxy_block_events_account\` (\`account_id\`, \`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_AGREEMENT_ACCEPTANCES = `
CREATE TABLE IF NOT EXISTS \`agreement_acceptances\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`account_id\` BIGINT UNSIGNED NOT NULL,
  \`agreement_type\` VARCHAR(32) NOT NULL,
  \`version\` INT NOT NULL DEFAULT 1,
  \`device_fp\` VARCHAR(64) NOT NULL DEFAULT '',
  \`ip\` VARCHAR(64) NOT NULL DEFAULT '',
  \`accepted_at\` DATETIME NOT NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY \`idx_agreement_account\` (\`account_id\`, \`agreement_type\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

/** 团队指标日快照（趋势图数据源；环境数无法回溯，按日 upsert 当日值） */
const CREATE_TEAM_METRICS_DAILY = `
CREATE TABLE IF NOT EXISTS \`team_metrics_daily\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`enterprise_id\` BIGINT UNSIGNED NOT NULL,
  \`stat_date\` DATE NOT NULL,
  \`member_total\` INT NOT NULL DEFAULT 0,
  \`member_online\` INT NOT NULL DEFAULT 0,
  \`env_total\` INT NOT NULL DEFAULT 0,
  \`env_running\` INT NOT NULL DEFAULT 0,
  \`block_count\` INT NOT NULL DEFAULT 0,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_team_metrics_daily\` (\`enterprise_id\`, \`stat_date\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_APP_CONFIGS = `
CREATE TABLE IF NOT EXISTS \`app_configs\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`cfg_key\` VARCHAR(64) NOT NULL,
  \`cfg_value\` TEXT NULL,
  \`remark\` VARCHAR(255) NULL,
  \`updated_at\` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_app_configs_key\` (\`cfg_key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

/** 存量表增量字段（全部可空或带默认值，旧代码不感知） */
const LICENSE_KEY_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'account_id', ddl: 'BIGINT UNSIGNED NULL' },
  { name: 'tier', ddl: 'TINYINT NOT NULL DEFAULT 1' },
  { name: 'level', ddl: 'TINYINT NOT NULL DEFAULT 1' },
  { name: 'sku_id', ddl: 'BIGINT UNSIGNED NULL' },
  { name: 'tier_code', ddl: 'VARCHAR(32) NULL' },
  { name: 'duration_days', ddl: 'INT NOT NULL DEFAULT 0' },
  { name: 'seats', ddl: 'INT NOT NULL DEFAULT 1' },
  { name: 'enterprise_id', ddl: 'BIGINT UNSIGNED NULL' },
  { name: 'activated_at', ddl: 'DATETIME NULL' },
  { name: 'account_expire_at', ddl: 'DATETIME NULL' },
  { name: 'replaced_by', ddl: 'BIGINT UNSIGNED NULL' },
];

const DEVICE_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'account_id', ddl: 'BIGINT UNSIGNED NULL' },
];

/** skus 增量字段（M6 能力覆盖，可空） */
const SKU_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'caps_json', ddl: 'TEXT NULL' },
];

/** upgrade_codes 增量字段（M6 金额与备注） */
const UPGRADE_CODE_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'amount', ddl: 'DECIMAL(10,2) NULL' },
  { name: 'remark', ddl: 'VARCHAR(255) NULL' },
];

/** seat_addons 增量字段（M6 备注） */
const SEAT_ADDON_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'remark', ddl: 'VARCHAR(255) NULL' },
];

/** account_devices 增量字段（M5 团队仪表盘：客户端心跳上报的环境统计） */
const ACCOUNT_DEVICE_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'env_total', ddl: 'INT NOT NULL DEFAULT 0' },
  { name: 'env_running', ddl: 'INT NOT NULL DEFAULT 0' },
  { name: 'bound_resource_ids', ddl: 'TEXT NULL' },
];

const DURATIONS: Array<{ key: string; days: number; label: string }> = [
  { key: 'month', days: 30, label: '月' },
  { key: 'quarter', days: 90, label: '季' },
  { key: 'year', days: 365, label: '年' },
  { key: 'permanent', days: 0, label: '永久' },
];

export function buildSkuRows(): Array<[string, number, number, string, number, string, number]> {
  const rows: Array<[string, number, number, string, number, string, number]> = [];
  const versions: Array<{ v: number; code: string; label: string }> = [
    { v: 1, code: 'per', label: '个人' },
    { v: 2, code: 'ent', label: '企业' },
  ];
  const levels: Array<{ l: number; code: string; label: string }> = [
    { l: 1, code: 'normal', label: '普通' },
    { l: 2, code: 'pro', label: '高级' },
  ];
  let sort = 0;
  for (const ver of versions) {
    for (const lv of levels) {
      for (const d of DURATIONS) {
        sort += 1;
        rows.push([
          `${ver.code}_${lv.code}_${d.key}`,
          ver.v,
          lv.l,
          d.key,
          d.days,
          `${ver.label}${lv.label} · ${d.label}`,
          sort,
        ]);
      }
    }
  }
  return rows;
}

async function ensureColumns(
  runner: QueryRunner,
  table: string,
  columns: Array<{ name: string; ddl: string }>
): Promise<number> {
  const rows: Array<{ name: string }> = await runner.query(
    'SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
    [table]
  );
  if (!rows.length) return 0; // 表不存在：由 ensureSchema/建表 SQL 负责
  const existing = new Set(rows.map((r) => r.name));
  const missing = columns.filter((c) => !existing.has(c.name));
  for (const col of missing) {
    await runner.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col.name}\` ${col.ddl}`);
  }
  if (missing.length) {
    log.info(`✅ ${table} 表结构已同步（账号体系补齐 ${missing.length} 个字段：${missing.map((c) => c.name).join(', ')}）`);
  }
  return missing.length;
}

async function seedSkus(runner: QueryRunner): Promise<void> {
  const rows = buildSkuRows();
  const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, 1, NULL, 1, ?)').join(',');
  const params: unknown[] = [];
  for (const [code, version, level, duration, days, label, sort] of rows) {
    params.push(code, version, level, duration, days, label, sort);
  }
  await runner.query(
    `INSERT IGNORE INTO \`skus\`
      (\`code\`, \`version\`, \`level\`, \`duration\`, \`duration_days\`, \`label\`, \`seats\`, \`mall_url\`, \`enabled\`, \`sort\`)
     VALUES ${placeholders}`,
    params
  );
}

async function seedAppConfigs(runner: QueryRunner): Promise<void> {
  await runner.query(
    `INSERT IGNORE INTO \`app_configs\` (\`cfg_key\`, \`cfg_value\`, \`remark\`) VALUES
      ('upgrade_links', '{}', '商城升级链接 JSON（按 SKU code 配置）'),
      ('config_version', '1', '客户端配置版本号（任意配置变更自增，用于 SSE 增量推送）'),
      ('disclaimer_version', '1', '免责声明/用户协议版本'),
      ('smtp_host', '', 'SMTP 主机，空则找回密码走人工'),
      ('ip_resource_version', '1', 'IP 资源变更版本号')`
  );
}

/** 幂等执行，失败仅告警不阻断启动（与 ensureSchema 策略一致） */
export async function ensureAccountSchema(): Promise<void> {
  const runner = AppDataSource.createQueryRunner();
  try {
    await runner.query(CREATE_ACCOUNTS);
    await runner.query(CREATE_ACCOUNT_SESSIONS);
    await runner.query(CREATE_ACCOUNT_DEVICES);
    await runner.query(CREATE_ENTERPRISES);
    await runner.query(CREATE_ENTERPRISE_MEMBERS);
    await runner.query(CREATE_SKUS);
    await runner.query(CREATE_IP_RESOURCES);
    await runner.query(CREATE_IP_ASSIGNMENTS);
    await runner.query(CREATE_IP_POOL_SETTINGS);
    await runner.query(CREATE_SEAT_ADDONS);
    await runner.query(CREATE_UPGRADE_CODES);
    await runner.query(CREATE_PROXY_BLOCK_EVENTS);
    await runner.query(CREATE_AGREEMENT_ACCEPTANCES);
    await runner.query(CREATE_TEAM_METRICS_DAILY);
    await runner.query(CREATE_APP_CONFIGS);

    await ensureColumns(runner, 'license_keys', LICENSE_KEY_COLUMNS);
    await ensureColumns(runner, 'devices', DEVICE_COLUMNS);
    await ensureColumns(runner, 'account_devices', ACCOUNT_DEVICE_COLUMNS);
    await ensureColumns(runner, 'skus', SKU_COLUMNS);
    await ensureColumns(runner, 'upgrade_codes', UPGRADE_CODE_COLUMNS);
    await ensureColumns(runner, 'seat_addons', SEAT_ADDON_COLUMNS);

    await seedSkus(runner);
    await seedAppConfigs(runner);

    // 存量卡密回填：仅修正非法座位数，不覆盖已配置的值
    await runner.query('UPDATE `license_keys` SET `seats` = 1 WHERE `seats` IS NULL OR `seats` < 1');
  } catch (e) {
    log.error('账号体系表结构同步失败（请检查数据库权限）', e);
  } finally {
    await runner.release();
  }
}
