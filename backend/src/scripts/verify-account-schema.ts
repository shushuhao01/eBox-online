/**
 * M0 结构迁移验证：连续执行两次 ensureAccountSchema（幂等），检查 14 张表、16 个 SKU、
 * app_configs 种子与 license_keys/devices 增量字段。
 * 运行：npx ts-node src/scripts/verify-account-schema.ts（需要可连接的数据库）
 */
import { env } from '../config/env';
import { initializeDatabase, AppDataSource } from '../config/database';
import { ensureAccountSchema } from '../config/ensureAccountSchema';

const TABLES = [
  'accounts', 'account_sessions', 'account_devices',
  'enterprises', 'enterprise_members', 'skus',
  'ip_resources', 'ip_assignments', 'ip_pool_settings',
  'seat_addons', 'upgrade_codes', 'proxy_block_events',
  'agreement_acceptances', 'app_configs',
];

async function colCount(table: string): Promise<number> {
  const rows: Array<{ c: number }> = await AppDataSource.query(
    `SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`
  );
  return Number(rows[0]?.c || 0);
}

async function main(): Promise<void> {
  console.log(`[M0] 目标库：${env.db.host}:${env.db.port}/${env.db.database}`);
  await initializeDatabase();

  await ensureAccountSchema();
  await ensureAccountSchema(); // 幂等复跑

  const found: Array<{ t: string }> = await AppDataSource.query(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (${TABLES.map((t) => `'${t}'`).join(',')})`
  );
  const missing = TABLES.filter((t) => !found.some((f) => f.t === t));
  if (missing.length) throw new Error(`缺少表：${missing.join(', ')}`);

  const skuRows: Array<{ c: number }> = await AppDataSource.query('SELECT COUNT(*) AS c FROM `skus`');
  const skuCount = Number(skuRows[0]?.c || 0);
  if (skuCount < 16) throw new Error(`默认 SKU 不足 16 个，实际 ${skuCount}`);

  const cfgRows: Array<{ c: number }> = await AppDataSource.query(
    "SELECT COUNT(*) AS c FROM `app_configs` WHERE `cfg_key` IN ('upgrade_links','disclaimer_version')"
  );
  if (Number(cfgRows[0]?.c || 0) < 2) throw new Error('app_configs 种子缺失');

  const keyCols = await colCount('license_keys');
  const deviceCols = await colCount('devices');
  const keyNeed = ['account_id', 'tier', 'level', 'sku_id', 'tier_code', 'duration_days', 'seats', 'enterprise_id', 'activated_at', 'replaced_by'];
  const keyHave: Array<{ name: string }> = await AppDataSource.query(
    "SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'license_keys'"
  );
  const keyNames = new Set(keyHave.map((r) => r.name));
  const keyMissing = keyNeed.filter((c) => !keyNames.has(c));
  if (keyMissing.length) throw new Error(`license_keys 缺少字段：${keyMissing.join(', ')}`);

  const deviceHave: Array<{ name: string }> = await AppDataSource.query(
    "SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'devices'"
  );
  if (!deviceHave.some((r) => r.name === 'account_id')) throw new Error('devices.account_id 缺失');

  console.log(`✅ M0 结构验证通过：14 张表齐备、SKU=${skuCount}、license_keys 字段=${keyCols}、devices 字段=${deviceCols}`);
  await AppDataSource.destroy();
}

main().catch(async (e) => {
  console.error('❌ M0 结构验证失败：', e instanceof Error ? e.message : e);
  try {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  } catch {
    // ignore
  }
  process.exit(1);
});
