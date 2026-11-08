import crypto from 'crypto';
import { env } from '../config/env';

// ============================================================
// eBox 激活码编解码（与 eBox 客户端 C++ biz::license 完全兼容）
//   激活码 = 载荷(18B) + ECDSA P-256 签名(64B raw r||s)，共 82 字节
//   编码：RFC4648 Base32（无 padding）+ 文本 "EBOX-" + 每 5 字符 "-"（旧码前缀 2BOX- 仍兼容）
//   载荷布局：
//     [0..1] magic "BO"
//     [2]    verMajor = 2
//     [3]    verMinor（8=离线时长制(KeyGen发码,未托管)；9=在线时长制(面板发码,服务端托管)；
//            <=7 旧格式绝对到期）
//     [4..7] LE：时长制=有效时长秒(0=永久)；旧格式=绝对到期时间戳
//     [8]    指纹标志 1=绑定 0=通用
//     [9..16] 机器指纹 8B（生成时置 0，激活时客户端自动绑定本机）
//     [17]   每自然月最大解绑次数（0=禁止 0xFF=不限 n=次数）
// ============================================================

const MAGIC = [0x42, 0x4f]; // "BO"
const VERSION_MAJOR = 2;
const VERSION_MINOR_DURATION = 8; // 离线时长制（与客户端 KeyGen 同款，未托管）
const VERSION_MINOR_ONLINE = 9; // 在线时长制（面板生成，服务端登记托管）
const VERSION_MINOR_LEGACY = 7; // 换机码（绝对到期）

/**
 * 产品线：formal=正式版（v4.x / EBOX 前缀）；game=游戏版（v5.x / GBOX 前缀）。
 * 产品隔离只发生在「签名密钥 + 码前缀 + 数据库 product 列」，
 * 客户端接口不增加必填字段，老客户端请求保持零影响。
 */
export type LicenseProduct = 'formal' | 'game';

const PRODUCTS: LicenseProduct[] = ['formal', 'game'];

// 与客户端一致的 P-256 公钥（X/Y，公开信息，来自 eBox kPublicKeyBlobs）
// 双公钥过渡：验签时逐把尝试，任一通过即有效；旧码归零前不得删除旧公钥
const PUB_OLD = {
  x: Buffer.from('2a8913c461d144a18659bba92fb7962d3807f243a7d2fc3952cb1d1a34adc5a5', 'hex'),
  y: Buffer.from('8164be694723aeeaea4df54fdf6eff09794cce7136875844d112ed23411612f6', 'hex'),
};
const PUB_NEW = {
  x: Buffer.from('91572c6ea68429c82912babdfa26a80f3bd448278ca748a417280b918dc05028', 'hex'),
  y: Buffer.from('bd0a1e8090d7a8e71dadde551676fca142c8d8a244c9d1102ae8563536af0c3c', 'hex'),
};
// 游戏版专用公钥（与 eBox 游戏版客户端 kPublicKeyBlobGame 一致；私钥仅离线/后端 .env 持有）
const PUB_GAME = {
  x: Buffer.from('5748606277acaa09c829330c37c5628459fa9655b9447d883b52ea86732ea904', 'hex'),
  y: Buffer.from('995bbc0339eea69703bc1eb448a643dc3ebb39a54c6454a7924d7bf8744079e8', 'hex'),
};

const PUBLIC_KEYS: Record<LicenseProduct, Array<{ x: Buffer; y: Buffer }>> = {
  formal: [PUB_OLD, PUB_NEW],
  game: [PUB_GAME],
};

// 发码签名所用私钥配套的公钥：过渡期（.env 仍配旧 d）固定为旧公钥，
// P4 切换 LICENSE_PRIVATE_KEY_D_FORMAL 时同步改为 PUB_NEW
const SIGNING_PUB: Record<LicenseProduct, { x: Buffer; y: Buffer }> = {
  formal: PUB_OLD,
  game: PUB_GAME,
};

const CODE_PREFIX: Record<LicenseProduct, string> = {
  formal: 'EBOX',
  game: 'GBOX',
};

function toPublicKeyObject(pub: { x: Buffer; y: Buffer }): crypto.KeyObject {
  return crypto.createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: pub.x.toString('base64url'),
      y: pub.y.toString('base64url'),
    },
    format: 'jwk',
  });
}

const PUBLIC_KEY_OBJECTS: Record<LicenseProduct, crypto.KeyObject[]> = {
  formal: PUBLIC_KEYS.formal.map(toPublicKeyObject),
  game: PUBLIC_KEYS.game.map(toPublicKeyObject),
};

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(data: Buffer): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of data) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 0x1f];
  return out;
}

function base32Decode(text: string): Buffer {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of text) {
    if (c === '=') continue;
    let value = -1;
    if (c >= 'A' && c <= 'Z') value = c.charCodeAt(0) - 65;
    else if (c >= 'a' && c <= 'z') value = c.charCodeAt(0) - 97;
    else if (c >= '2' && c <= '7') value = c.charCodeAt(0) - 50 + 26;
    if (value < 0) continue;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 文本规范化：去空格/'-'/'2BOX'/'EBOX'/'GBOX'前缀，转大写（与客户端 parseAndVerifyCode 一致）
export function normalizeCode(code: string): string {
  let upper = '';
  for (const c of code) {
    if (c === ' ' || c === '-') continue;
    if (c >= 'a' && c <= 'z') upper += c.toUpperCase();
    else if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) upper += c;
  }
  // 兼容旧前缀 2BOX 与正式版 EBOX、游戏版 GBOX（均为 4 字符）
  if (upper.startsWith('2BOX') || upper.startsWith('EBOX') || upper.startsWith('GBOX')) {
    upper = upper.slice(4);
  }
  return upper;
}

export interface ParsedLicense {
  valid: boolean;
  product: LicenseProduct; // 由验签命中的公钥决定：formal / game
  isDurationFormat: boolean;
  onlineManaged: boolean; // verMinor==9 在线托管码（面板生成、服务端登记）
  durationSec: number; // 时长制有效秒数，0=永久
  expire: number; // 旧格式绝对到期时间戳
  bound: boolean;
  unbindMax: number; // -1=不限
}

// 解码并验签（服务端无登记信息时仍可确认"签名有效"）
// product 省略时按 formal → game 顺序自动识别，返回命中的产品线；
// 显式传入时只验该产品线的公钥，避免跨产品误放行。
export function decodeAndVerify(code: string, product?: LicenseProduct): ParsedLicense | null {
  const normalized = normalizeCode(code);
  if (normalized.length < 20) return null;
  const raw = base32Decode(normalized);
  if (raw.length !== 82) return null;
  const payload = raw.subarray(0, 18);
  const signature = raw.subarray(18, 82);

  // magic + 版本
  if (payload[0] !== MAGIC[0] || payload[1] !== MAGIC[1]) return null;
  if (payload[2] !== VERSION_MAJOR || payload[3] > VERSION_MINOR_ONLINE) return null;

  // 验签：crypto.verify('sha256', payload) 内部先对 payload 做一次 SHA-256，是标准 ECDSA 路径，
  // 与客户端 BCryptVerifySignature 完全兼容。
  // 注意：不能用 crypto.verify(null, hash)——null 模式会把传入的 32 字节摘要当作"消息"再次哈希，
  // 导致只对自己二次哈希签名自洽、无法验证标准签名（历史线上问题根因）。
  // 双公钥过渡：逐把公钥尝试，任一通过即有效。
  const candidates: LicenseProduct[] = product ? [product] : PRODUCTS;
  let matched: LicenseProduct | null = null;
  for (const p of candidates) {
    for (const publicKey of PUBLIC_KEY_OBJECTS[p]) {
      try {
        if (crypto.verify('sha256', payload, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)) {
          matched = p;
          break;
        }
      } catch {
        // 该公钥验签异常，继续尝试下一把
      }
    }
    if (matched) break;
  }
  if (!matched) return null;

  let field = 0;
  for (let i = 0; i < 4; i++) field |= payload[4 + i] << (i * 8);
  const isDurationFormat = payload[3] === VERSION_MINOR_DURATION || payload[3] === VERSION_MINOR_ONLINE;
  const onlineManaged = payload[3] === VERSION_MINOR_ONLINE;
  const bound = payload[8] !== 0;
  let unbindMax = payload[17];
  if (unbindMax === 0xff) unbindMax = -1;

  return {
    valid: true,
    product: matched,
    isDurationFormat,
    onlineManaged,
    durationSec: isDurationFormat ? field : 0,
    expire: isDurationFormat ? 0 : field,
    bound,
    unbindMax,
  };
}

// 私钥对象（懒加载，按产品线独立缓存）：用 env 中的 d 标量 + 配套公钥 X/Y 构造
const privateKeyCache: Record<LicenseProduct, crypto.KeyObject | null> = {
  formal: null,
  game: null,
};

function getPrivateKeyD(product: LicenseProduct): string {
  return product === 'game' ? env.gamePrivateKeyD : env.privateKeyD;
}

function getPrivateKey(product: LicenseProduct): crypto.KeyObject | null {
  const d = getPrivateKeyD(product);
  if (!d) return null;
  const cached = privateKeyCache[product];
  if (cached) return cached;
  try {
    const key = crypto.createPrivateKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        d: Buffer.from(d, 'hex').toString('base64url'),
        x: SIGNING_PUB[product].x.toString('base64url'),
        y: SIGNING_PUB[product].y.toString('base64url'),
      },
      format: 'jwk',
    });
    privateKeyCache[product] = key;
    return key;
  } catch {
    return null;
  }
}

// 签名 18 字节载荷，返回 64 字节 raw r||s（标准 ECDSA P-256，与客户端 BCryptSignHash 兼容）。
// 注意：不能用 crypto.sign(null, sha256(payload))——null 模式会对传入摘要再次哈希，
// 生成 e=sha256(sha256(payload)) 的签名，客户端验签将失败（历史线上问题根因）。
function signPayload(payload: Buffer, product: LicenseProduct = 'formal'): Buffer | null {
  const key = getPrivateKey(product);
  if (!key) return null;
  try {
    return crypto.sign('sha256', payload, { key, dsaEncoding: 'ieee-p1363' });
  } catch {
    return null;
  }
}

// 权益快照签名（C-1）：对规范化 JSON 文本签名，输出 base64。
// 与激活码签名同款算法（ECDSA P-256 / SHA-256 / ieee-p1363），客户端 BCryptVerifySignature 可直接校验。
export function signCanonicalString(text: string, product: LicenseProduct = 'formal'): string | null {
  const sig = signPayload(Buffer.from(text, 'utf8'), product);
  return sig ? sig.toString('base64') : null;
}

/**
 * 启动自检：确认已配置的私钥 d 与代码内置公钥 X/Y 匹配。
 * 只校验「已配置」的产品线；未配置游戏版私钥时仅告警，不影响正式版启动。
 * 返回畸形配置列表，调用方决定是否拒绝启动。
 */
export function keyringErrors(): string[] {
  const errors: string[] = [];
  for (const product of PRODUCTS) {
    const d = getPrivateKeyD(product);
    // 未配置时不算硬错误：正式版沿用原有「按需签名」行为，游戏私钥可后置配置
    if (!d) continue;
    if (!/^[0-9a-fA-F]{64}$/.test(d)) {
      errors.push(`${product} 私钥格式错误（需 64 位 hex）`);
      continue;
    }
    try {
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.setPrivateKey(Buffer.from(d, 'hex'));
      const pub = ecdh.getPublicKey(); // 未压缩：04 || X(32) || Y(32)
      const x = pub.subarray(1, 33);
      const y = pub.subarray(33, 65);
      if (!x.equals(SIGNING_PUB[product].x) || !y.equals(SIGNING_PUB[product].y)) {
        errors.push(`${product} 私钥与内置公钥不匹配（签名将无法被客户端验签）`);
      }
    } catch {
      errors.push(`${product} 私钥无法用于 P-256 派生公钥`);
    }
  }
  return errors;
}

// 生成激活码。
//   durationFormat=true：
//     onlineManaged=true（默认，面板库存码）：field=有效时长秒（0=永久），格式 verMinor=9（在线托管）
//     onlineManaged=false（离线码/与客户端 KeyGen 同款）：field=有效时长秒，格式 verMinor=8（未托管）
//   durationFormat=false（换机码）：field=绝对到期时间戳（秒），格式 verMinor=7
export function buildLicenseCode(
  field: number,
  bound: boolean,
  unbindMaxPerMonth: number,
  durationFormat = true,
  onlineManaged = true,
  product: LicenseProduct = 'formal'
): string | null {
  const payload = Buffer.alloc(18, 0);
  payload[0] = MAGIC[0];
  payload[1] = MAGIC[1];
  payload[2] = VERSION_MAJOR;
  payload[3] = durationFormat
    ? (onlineManaged ? VERSION_MINOR_ONLINE : VERSION_MINOR_DURATION)
    : VERSION_MINOR_LEGACY;
  const f = BigInt(field);
  for (let i = 0; i < 4; i++) payload[4 + i] = Number((f >> BigInt(i * 8)) & 0xffn);
  payload[8] = bound ? 1 : 0;
  // [9..16] 指纹留 0；非绑定码 [17]=0
  if (bound) {
    if (unbindMaxPerMonth < 0) payload[17] = 0xff;
    else payload[17] = Math.min(Math.max(unbindMaxPerMonth, 0), 255);
  }
  const signature = signPayload(payload, product);
  if (!signature || signature.length !== 64) return null;

  const raw = Buffer.concat([payload, signature]);
  const b32 = base32Encode(raw);
  let text = CODE_PREFIX[product];
  for (let i = 0; i < b32.length; i++) {
    if (i % 5 === 0) text += '-';
    text += b32[i];
  }
  return text;
}

// 码的 SHA-256 指纹（hex，用于快速查询/防重放）
export function codeFingerprint(code: string): string {
  return crypto.createHash('sha256').update(normalizeCode(code)).digest('hex');
}
