// 永久卡换机码数据修复
// 背景：换机码（type=2）签发时 duration_sec='0'、duration_days 继承原卡（永久卡为 0），
//       旧版 keyIsPermanent 只认 type=1，导致 4.0 账号激活把这类卡当成 0 天时长卡，
//       写入了 account_expire_at≈激活时刻，随后被判为已过期（客户端显示「未激活」）。
// 用法：npm run fix:permanent-keys            仅体检，不写库
//       npm run fix:permanent-keys -- --apply 实际修复
import { loadEnv } from './loadEnv';
loadEnv();

import 'reflect-metadata';
import { In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { LicenseKey } from '../entities/LicenseKey';
import { keyIsPermanent } from '../services/EntitlementService';
import { maskCode } from '../services/LicenseAccountService';

const APPLY = process.argv.includes('--apply');

async function main() {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(LicenseKey);

  const rows = await repo.find({
    where: { type: 2, durationSec: '0', durationDays: 0, status: In([1, 3]) },
  });

  // 只处理「永久判定成立」却带着错误 account_expire_at 的换机码
  const targets = rows.filter((k) => keyIsPermanent(k) && k.accountExpireAt != null);

  console.log(`扫描换机码 ${rows.length} 条，命中需修复 ${targets.length} 条`);
  for (const k of targets) {
    console.log(
      `  ${APPLY ? '修复' : '待修复'} ${maskCode(k.code)} 账号=${k.accountId ?? '-'} ` +
        `status=${k.status} 错误到期=${k.accountExpireAt?.toISOString() ?? '-'}`
    );
  }

  if (!APPLY) {
    console.log('\n未写库。确认无误后执行：npm run fix:permanent-keys -- --apply');
    await AppDataSource.destroy();
    return;
  }

  for (const k of targets) {
    k.accountExpireAt = null;
    k.accountStartAt = null;
    if (k.status === 3) k.status = 1;
  }
  if (targets.length) await repo.save(targets);
  console.log(`\n已修复 ${targets.length} 条`);
  await AppDataSource.destroy();
}

main().catch((e) => {
  console.error('修复失败：', (e as Error).message);
  process.exit(1);
});
