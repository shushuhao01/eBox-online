// 永久卡 / 换机码权益判定回归脚本（纯函数，不连数据库）
// 用法：npm run verify:permanent
// 覆盖：永久原卡、永久换机码、永久企业卡、月/季/年卡及其换机码，
//       并校验 4.0 激活写库时 account_expire_at 的取值决策。
import { keyIsPermanent, keyExpireSeconds } from '../services/EntitlementService';
import { keyDurationDays, toKeySummary } from '../services/LicenseAccountService';

const MAX = Number.MAX_SAFE_INTEGER;
const DAY = 86400;
const nowSec = Math.floor(Date.now() / 1000);

interface MockKey {
  id: number;
  code: string;
  type: number;
  durationSec: string;
  durationDays: number;
  expireAt: string | null;
  status: number;
  tier: number;
  level: number;
  seats: number;
  usedAt: Date | null;
  activatedAt: Date | null;
  accountExpireAt: Date | null;
  accountStartAt: Date | null;
  accountId: number | null;
  enterpriseId: number | null;
}

function mkKey(patch: Partial<MockKey>): MockKey {
  return {
    id: 1,
    code: 'EBOX-TEST-CODE',
    type: 1,
    durationSec: '0',
    durationDays: 0,
    expireAt: null,
    status: 1,
    tier: 1,
    level: 1,
    seats: 1,
    usedAt: new Date((nowSec - DAY) * 1000),
    activatedAt: new Date((nowSec - DAY) * 1000),
    accountExpireAt: null,
    accountStartAt: null,
    accountId: 1,
    enterpriseId: null,
    ...patch,
  };
}

function summarize(key: MockKey): { expireAt: string | null; permanent: boolean } {
  return toKeySummary(key as never, null);
}

/** 4.0 激活写库决策（与 LicenseAccountService 第 299 行保持一致） */
function activationExpireAt(key: MockKey): Date | null {
  const permanent = keyIsPermanent(key as never);
  const newExpireSec = nowSec + keyDurationDays(key as never) * DAY;
  return permanent ? null : new Date(newExpireSec * 1000);
}

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
}

const cases: Array<{
  name: string;
  key: MockKey;
  permanent: boolean;
  days: number;
  summaryExpireAt: string | null;
  activatedExpireAt: Date | null;
}> = [
  {
    name: '永久原卡 type=1',
    key: mkKey({}),
    permanent: true,
    days: 0,
    summaryExpireAt: null,
    activatedExpireAt: null,
  },
  {
    name: '永久换机码 type=2 expire=MAX',
    key: mkKey({ type: 2, expireAt: String(MAX) }),
    permanent: true,
    days: 0,
    summaryExpireAt: null,
    activatedExpireAt: null,
  },
  {
    name: '永久换机码 type=2 expire=null',
    key: mkKey({ type: 2, expireAt: null }),
    permanent: true,
    days: 0,
    summaryExpireAt: null,
    activatedExpireAt: null,
  },
  {
    name: '永久换机码 已被写入错误到期(今天)',
    key: mkKey({ type: 2, expireAt: String(MAX), accountExpireAt: new Date() }),
    permanent: true,
    days: 0,
    summaryExpireAt: null,
    activatedExpireAt: null,
  },
  {
    name: '永久企业卡 type=1 tier=2',
    key: mkKey({ tier: 2, seats: 10 }),
    permanent: true,
    days: 0,
    summaryExpireAt: null,
    activatedExpireAt: null,
  },
  {
    name: '永久企业换机码 type=2 tier=2',
    key: mkKey({ type: 2, tier: 2, seats: 10, expireAt: String(MAX) }),
    permanent: true,
    days: 0,
    summaryExpireAt: null,
    activatedExpireAt: null,
  },
  {
    name: '月卡原卡',
    key: mkKey({ durationSec: String(30 * DAY), durationDays: 30 }),
    permanent: false,
    days: 30,
    summaryExpireAt: new Date((nowSec - DAY + 30 * DAY) * 1000).toISOString(),
    activatedExpireAt: new Date((nowSec + 30 * DAY) * 1000),
  },
  {
    name: '月卡换机码 duration_days=30',
    key: mkKey({ type: 2, durationDays: 30, expireAt: String(nowSec + 20 * DAY) }),
    permanent: false,
    days: 30,
    summaryExpireAt: new Date((nowSec + 20 * DAY) * 1000).toISOString(),
    activatedExpireAt: new Date((nowSec + 30 * DAY) * 1000),
  },
  {
    name: '季卡换机码 duration_days=90',
    key: mkKey({ type: 2, durationDays: 90, expireAt: String(nowSec + 45 * DAY) }),
    permanent: false,
    days: 90,
    summaryExpireAt: new Date((nowSec + 45 * DAY) * 1000).toISOString(),
    activatedExpireAt: new Date((nowSec + 90 * DAY) * 1000),
  },
  {
    name: '年卡原卡',
    key: mkKey({ durationSec: String(365 * DAY), durationDays: 365 }),
    permanent: false,
    days: 365,
    summaryExpireAt: new Date((nowSec - DAY + 365 * DAY) * 1000).toISOString(),
    activatedExpireAt: new Date((nowSec + 365 * DAY) * 1000),
  },
  {
    name: '日卡换机码 duration_days=1',
    key: mkKey({ type: 2, durationDays: 1, expireAt: String(nowSec + DAY) }),
    permanent: false,
    days: 1,
    summaryExpireAt: new Date((nowSec + DAY) * 1000).toISOString(),
    activatedExpireAt: new Date((nowSec + DAY) * 1000),
  },
];

console.log('=== 永久卡 / 换机码判定 ===');
for (const c of cases) {
  check(`${c.name} · permanent`, keyIsPermanent(c.key as never), c.permanent);
  check(`${c.name} · durationDays`, keyDurationDays(c.key as never), c.days);
  check(`${c.name} · 列表到期`, summarize(c.key).expireAt, c.summaryExpireAt);
  check(`${c.name} · 激活后到期`, activationExpireAt(c.key), c.activatedExpireAt);
  if (c.permanent) {
    check(`${c.name} · 到期秒数(0=永久)`, keyExpireSeconds(c.key as never), 0);
  }
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) process.exit(1);
