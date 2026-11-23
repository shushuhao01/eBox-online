// 已绑定但未激活的卡密修复
// 背景：4.0 账号激活在 clientActivate 之后，用激活前加载的卡密实例再 save 一次，
//       把 clientActivate 写入的 status=1 / used_at 覆盖回 0 / NULL，
//       表现为「账号已绑定、卡密侧有到期时间，但客户端权益与后台都显示未激活」。
// 用法：npm run fix:bound-keys            仅体检，不写库
//       npm run fix:bound-keys -- --apply 实际修复
import { loadEnv } from './loadEnv';
loadEnv();

import 'reflect-metadata';
import { IsNull, Not } from 'typeorm';
import { AppDataSource } from '../config/database';
import { LicenseKey } from '../entities/LicenseKey';
import { maskCode } from '../services/LicenseAccountService';

const APPLY = process.argv.includes('--apply');

async function main() {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(LicenseKey);

  // 仅处理「已绑定账号但从未激活」的码；status 非 0 的（已用/作废/过期/换机）不动
  const rows = await repo.find({
    where: { status: 0, accountId: Not(IsNull()) },
    order: { id: 'DESC' },
  });
  const targets = rows.filter((k) => k.usedAt == null);

  console.log(`扫描已绑定卡密 ${rows.length} 条，命中需修复 ${targets.length} 条`);
  for (const k of targets) {
    console.log(
      `  ${APPLY ? '修复' : '待修复'} ${maskCode(k.code)} 账号=${k.accountId} ` +
        `绑定时间=${k.activatedAt?.toISOString() ?? '-'} ` +
        `到期=${k.accountExpireAt?.toISOString() ?? '永久'}`
    );
  }

  if (!APPLY) {
    console.log('\n未写库。确认无误后执行：npm run fix:bound-keys -- --apply');
    await AppDataSource.destroy();
    return;
  }

  const now = new Date();
  for (const k of targets) {
    k.status = 1;
    k.usedAt = k.activatedAt ?? k.accountStartAt ?? now;
  }
  if (targets.length) await repo.save(targets);
  console.log(`\n已修复 ${targets.length} 条`);
  await AppDataSource.destroy();
}

main().catch((e) => {
  console.error('修复失败：', (e as Error).message);
  process.exit(1);
});
