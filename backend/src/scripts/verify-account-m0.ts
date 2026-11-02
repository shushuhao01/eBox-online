/**
 * M0 自检：密码哈希、会话 token、AES-256-GCM、重置码、脱敏、16 个默认 SKU
 * 运行：npx ts-node src/scripts/verify-account-m0.ts（不依赖数据库）
 */
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashToken,
  generateResetCode,
  hashResetCode,
  encryptSecret,
  decryptSecret,
  maskLogin,
  maskHost,
} from '../utils/accountCrypto';
import { buildSkuRows } from '../config/ensureAccountSchema';

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(`断言失败：${message}`);
}

async function main(): Promise<void> {
  // 1. 密码哈希
  const hash = await hashPassword('Abc12345678');
  assert(hash !== 'Abc12345678', '密码不得明文保存');
  assert(await verifyPassword('Abc12345678', hash), '正确密码应校验通过');
  assert(!(await verifyPassword('Abc12345679x', hash)), '错误密码应校验失败');

  // 2. 会话 token
  const token = generateSessionToken();
  assert(/^[0-9a-f]{64}$/.test(token), 'token 应为 64 位 hex');
  assert(hashToken(token) !== token, 'token 入库必须哈希');
  assert(hashToken(token).length === 64, 'token 哈希应为 64 位');

  // 3. 重置码
  for (let i = 0; i < 20; i++) {
    const code = generateResetCode();
    assert(/^\d{6}$/.test(code), '重置码应为 6 位数字');
    assert(hashResetCode(code).length === 64, '重置码哈希应为 64 位');
  }

  // 4. AES-256-GCM
  const plain = 'p@ss-代理-123';
  const enc = encryptSecret(plain);
  assert(enc.startsWith('v1:'), '密文应带 v1 前缀');
  assert(!enc.includes(plain), '密文不得包含明文');
  assert(decryptSecret(enc) === plain, '解密应还原明文');
  const tampered = `${enc.slice(0, -2)}00`;
  assert(decryptSecret(tampered) === '', '篡改密文应解密失败');
  assert(decryptSecret('') === '', '空密文应返回空串');

  // 5. 脱敏
  assert(maskLogin('someone@example.com').includes('***'), '邮箱需脱敏');
  assert(maskLogin('13800138000') === '138****8000', '手机号需脱敏');
  assert(maskHost('1.2.3.4') === '1.2.*.*', 'IPv4 需掩码');
  assert(maskHost('proxy.example.com') === 'proxy.***', '域名需掩码');

  // 6. 默认 SKU：个人/企业 × 普通/高级 × 月/季/年/永久 = 16
  const skus = buildSkuRows();
  assert(skus.length === 16, `默认 SKU 应为 16 个，实际 ${skus.length}`);
  const codes = new Set(skus.map((s) => s[0]));
  assert(codes.size === 16, 'SKU code 必须唯一');
  const durations = new Set(skus.map((s) => s[3]));
  assert(durations.size === 4, 'SKU 时长应为 4 档');
  assert(skus.every((s) => s[6] > 0), 'SKU 排序值应递增非零');

  console.log('✅ M0 自检通过：密码哈希 / token / 重置码 / AES-GCM / 脱敏 / 16 SKU');
}

main().catch((e) => {
  console.error('❌ M0 自检失败：', e instanceof Error ? e.message : e);
  process.exit(1);
});
