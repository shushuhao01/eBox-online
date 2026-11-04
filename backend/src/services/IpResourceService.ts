import zlib from 'zlib';
import { TextDecoder } from 'util';
import { SelectQueryBuilder } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Account } from '../entities/account/Account';
import { AccountDevice } from '../entities/account/AccountDevice';
import { Enterprise } from '../entities/account/Enterprise';
import { EnterpriseMember } from '../entities/account/EnterpriseMember';
import { IpAssignment } from '../entities/account/IpAssignment';
import { IpPoolSetting } from '../entities/account/IpPoolSetting';
import { IpResource } from '../entities/account/IpResource';
import { ApiError } from '../middleware/errorHandler';
import { decryptSecret, encryptSecret } from '../utils/accountCrypto';
import { pushAccountNotice } from './AccountEventService';
import { getEntitlements } from './EntitlementService';
import { EnterpriseContext, requireEnterpriseAdmin } from './EnterpriseService';
import { writeOperationLog } from './LogService';

/**
 * IP 资源池与分配（M4）
 * - 平台不预置任何资源，池子初始为空，全部由用户自行导入
 * - 归属：个人池 scope=1 + owner_account_id；企业池 scope=2 + enterprise_id
 * - 导入分三段：parse（预览校验）→ test（连通测试）→ commit（仅提交通过行）
 * - 唯一占用：ip_assignments.resource_id 唯一 + 事务，并发绑定只有一个成功
 */

const resourceRepo = () => AppDataSource.getRepository(IpResource);
const assignmentRepo = () => AppDataSource.getRepository(IpAssignment);
const settingRepo = () => AppDataSource.getRepository(IpPoolSetting);
const memberRepo = () => AppDataSource.getRepository(EnterpriseMember);
const enterpriseRepo = () => AppDataSource.getRepository(Enterprise);
const accountRepo = () => AppDataSource.getRepository(Account);
const deviceRepo = () => AppDataSource.getRepository(AccountDevice);

const STALE_BIND_MS = 10 * 60 * 1000;
const MAX_COMMIT_ROWS = 500;

export type IpProxyType = 'socks5' | 'http';

export interface IpRowInput {
  line?: number;
  proxyType?: string;
  host?: string;
  port?: number | string;
  username?: string;
  password?: string;
  remark?: string;
  /** 客户端已通过连通测试 */
  testedOk?: boolean;
  /** 重复资源是否覆盖 */
  overwrite?: boolean;
  latencyMs?: number;
}

export interface IpRowPreview {
  line: number;
  proxyType: IpProxyType | '';
  host: string;
  port: number;
  username: string;
  password: string;
  remark: string;
  valid: boolean;
  error: string;
  duplicate: boolean;
  duplicateId: string | null;
  duplicateAction: 'skip' | 'overwrite';
}

export interface IpPoolContext {
  scope: 1 | 2;
  ownerAccountId: string;
  enterpriseId: string;
  role: 'user' | 'admin' | 'member';
  storageMode: number;
  enterprise: Enterprise | null;
}

/** 资源列表展示（密码永不下发；成员开启明文可见时下发解密后的账号密码） */
export interface IpResourceView {
  id: string;
  scope: number;
  proxyType: string;
  host: string;
  port: number;
  username: string;
  usernameMasked: string;
  password: string;
  hasPassword: boolean;
  remark: string;
  status: number;
  health: number;
  latencyMs: number | null;
  lastCheckAt: string | null;
  createdAt: string | null;
  plaintextVisible: boolean;
  assigned: boolean;
  inUse: boolean;
  envId: string | null;
  envName: string | null;
  boundAt: string | null;
  memberAccountId: string | null;
  memberLogin: string | null;
  memberNickname: string | null;
}

function maskAccountName(name: string): string {
  if (!name) return '';
  if (name.length <= 2) return '***';
  return `${name.slice(0, 1)}***${name.slice(-1)}`;
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

const PROXY_TYPES = new Set(['socks5', 'http']);

function normalizeProxyType(raw: string): IpProxyType | '' {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'socks5' || v === 'socks' || v === 'socks5h') return 'socks5';
  if (v === 'http' || v === 'https') return 'http';
  return '';
}

// 系统只支持 socks5 与 http(CONNECT)；命中这些常见协议名时明确拒绝，避免被当成主机名静默导入
const UNSUPPORTED_PROXY_TYPES = new Set([
  'socks4', 'socks4a', 'socks6', 'http2', 'h2', 'trojan', 'vmess', 'vless',
  'shadowsocks', 'ss', 'ssr', 'hysteria', 'hysteria2', 'tuic', 'wireguard',
  'mtproto', 'ssh', 'ftp', 'sftp', 'quic', 'naive', 'brook', 'juicity',
]);

function isValidHost(host: string): boolean {
  if (!host || host.length > 128) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return host.split('.').every((p) => Number(p) >= 0 && Number(p) <= 255);
  }
  // 域名：字母数字与 - .，不能以 - 开头结尾
  return /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host);
}

/** 拆分一行：支持英文逗号 / 中文逗号 / Tab，最多 6 列 */
function splitRow(line: string): string[] {
  const parts = line.split(/\t|,|，/).map((s) => s.trim());
  return parts.slice(0, 6);
}

// ---------------------------------------------------------------------------
// 文件导入：xlsx = ZIP + XML。客户端不做 inflate，原始字节 base64 上行后在这里解包。
// ---------------------------------------------------------------------------

function xmlDecode(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 解 zip：按中央目录定位每个文件，stored 直接取，deflate 用 zlib.inflateRaw 还原 */
function unzipEntries(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return entries;
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return entries;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (localOff + 30 <= buf.length && buf.readUInt32LE(localOff) === 0x04034b50) {
      const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
      const raw = buf.subarray(dataStart, dataStart + compSize);
      try {
        if (method === 0) entries.set(name, raw);
        else if (method === 8) entries.set(name, zlib.inflateRawSync(raw));
      } catch {
        // 单个 part 解压失败不影响其它 part
      }
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 列号：A→0，B→1，AA→26 */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref || '');
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** sharedStrings.xml → 索引表（富文本取所有 <t> 拼接） */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const texts = [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlDecode(t[1]));
    out.push(texts.join(''));
  }
  return out;
}

/** sheet1.xml → 单元格矩阵（按 r 属性定位列，容忍缺列） */
function parseSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] ?? cm[2] ?? '';
      const inner = cm[3] ?? '';
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1] || '';
      const idx = ref ? columnIndex(ref) : cells.length;
      if (idx < 0) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || '';
      let value = '';
      if (type === 'inlineStr') {
        value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlDecode(t[1])).join('');
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        if (v) value = type === 's' ? shared[Number(v[1])] ?? '' : xmlDecode(v[1]);
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = value.trim();
    }
    rows.push(cells);
  }
  return rows;
}

/** 文本文件解码：优先严格 UTF-8，失败回退 GBK（Excel 在中文系统另存的 csv 常为 GBK） */
function decodeTextFile(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  const text = utf8.includes('\uFFFD') ? (() => {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return utf8;
    }
  })() : utf8;
  return text.replace(/^\uFEFF/, '');
}

/** 上传文件 → Tab 分隔的逐行文本（与粘贴导入共用 parseIpRows 的校验与去重） */
export function extractIpLines(name: string, content: Buffer): string {
  const lower = String(name || '').toLowerCase();
  const isZip = content.length >= 4 && content.readUInt32LE(0) === 0x04034b50;
  if (isZip || lower.endsWith('.xlsx')) {
    const entries = unzipEntries(content);
    const sheet = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k)).sort()[0];
    if (!sheet) throw new ApiError('无法读取 Excel 内容，请下载模板填写后上传', 400);
    const shared = entries.get('xl/sharedStrings.xml');
    const rows = parseSheetRows(entries.get(sheet)!.toString('utf8'), shared ? parseSharedStrings(shared.toString('utf8')) : []);
    const lines: string[] = [];
    for (const cells of rows) {
      const values = cells.map((c) => (c || '').trim());
      if (!values.some((v) => v.length > 0)) continue;
      // 跳过模板表头与示例行
      if (values[0].includes('类型') || values.some((v) => v === '地址')) continue;
      if (values.some((v) => v.includes('示例行'))) continue;
      while (values.length > 0 && values[values.length - 1] === '') values.pop();
      // 类型列可留空；空首列去掉，避免被 parseIpRows 当成“内容为空”
      if (values.length > 1 && values[0] === '') values.shift();
      lines.push(values.join('\t'));
    }
    if (!lines.length) throw new ApiError('表格中没有可导入的数据，请按模板第一行的格式填写', 400);
    return lines.join('\n');
  }
  const text = decodeTextFile(content).trim();
  if (!text) throw new ApiError('文件内容为空', 400);
  return text;
}

/** 文件解析入口：xlsx / csv / txt 统一转换成文本后走 parseIpRows */
export async function parseIpFile(
  account: Account,
  name: string,
  content: Buffer
): Promise<{ rows: IpRowPreview[]; validCount: number; errorCount: number; duplicateCount: number }> {
  return parseIpRows(account, extractIpLines(name, content));
}

function buildRow(raw: string, lineNo: number): IpRowPreview {
  const cols = splitRow(raw);
  const row: IpRowPreview = {
    line: lineNo,
    proxyType: '',
    host: '',
    port: 0,
    username: '',
    password: '',
    remark: '',
    valid: false,
    error: '',
    duplicate: false,
    duplicateId: null,
    duplicateAction: 'skip',
  };
  if (!cols.length || !cols[0]) {
    row.error = '内容为空';
    return row;
  }
  // 允许省略“类型”列：首列不是 socks5/http 时按 地址,端口,账号,密码,备注 解析
  const first = normalizeProxyType(cols[0]);
  if (!first && UNSUPPORTED_PROXY_TYPES.has(cols[0].trim().toLowerCase())) {
    row.error = `不支持的类型「${cols[0]}」，仅支持 socks5 或 http`;
    return row;
  }
  let rest: string[];
  if (first) {
    row.proxyType = first;
    rest = cols.slice(1);
  } else if (cols[0].includes('.') || cols[0].includes(':') || /^[a-zA-Z]/.test(cols[0])) {
    row.proxyType = 'socks5';
    rest = cols;
  } else {
    row.error = '类型只能为 socks5 或 http';
    return row;
  }
  if (rest.length < 2) {
    row.error = '格式应为：类型,地址,端口,账号,密码,备注';
    return row;
  }
  row.host = rest[0] || '';
  row.port = Number(rest[1] || 0);
  row.username = rest[2] || '';
  row.password = rest[3] || '';
  row.remark = rest[4] || '';

  if (!isValidHost(row.host)) {
    row.error = '地址格式不正确（只填 IP 或域名）';
  } else if (!Number.isInteger(row.port) || row.port < 1 || row.port > 65535) {
    row.error = '端口必须是 1-65535 的整数';
  } else if (row.username.length > 128) {
    row.error = '账号长度不能超过 128';
  } else if (row.password.length > 256) {
    row.error = '密码长度不能超过 256';
  } else if (row.remark.length > 255) {
    row.error = '备注长度不能超过 255';
  } else {
    row.valid = true;
  }
  return row;
}

/** 读取/初始化资源池设置（企业固定持久化） */
async function getPoolSetting(ownerType: 1 | 2, ownerId: string): Promise<IpPoolSetting> {
  const repo = settingRepo();
  let row = await repo.findOneBy({ ownerType, ownerId });
  if (!row) {
    row = await repo.save(repo.create({ ownerType, ownerId, storageMode: 1 }));
  }
  if (ownerType === 2 && row.storageMode !== 1) {
    row.storageMode = 1;
    row = await repo.save(row);
  }
  return row;
}

/** 管理侧上下文：个人高级 / 企业管理员 */
async function resolvePoolForManage(account: Account): Promise<IpPoolContext> {
  if (account.enterpriseId) {
    const ctx = await requireEnterpriseAdmin(account);
    await getPoolSetting(2, ctx.enterprise.id);
    return {
      scope: 2,
      ownerAccountId: '0',
      enterpriseId: ctx.enterprise.id,
      role: 'admin',
      storageMode: 1,
      enterprise: ctx.enterprise,
    };
  }
  const ent = await getEntitlements(account);
  if (!ent.caps.ipResources) {
    throw new ApiError('当前套餐不支持 IP 资源管理，请升级后使用', 4030, 403, { cap: 'ipResources' });
  }
  const setting = await getPoolSetting(1, account.id);
  return {
    scope: 1,
    ownerAccountId: account.id,
    enterpriseId: '0',
    role: 'user',
    storageMode: setting.storageMode,
    enterprise: null,
  };
}

/** 读取侧上下文：企业成员也可（只能看分配给自己的资源） */
async function resolvePoolForRead(account: Account): Promise<IpPoolContext> {
  if (account.enterpriseId) {
    const member = await memberRepo().findOneBy({ accountId: account.id, enterpriseId: account.enterpriseId });
    if (!member || member.status !== 1) throw new ApiError('企业成员不存在或已停用', 4004, 403);
    const enterprise = await enterpriseRepo().findOneBy({ id: account.enterpriseId });
    return {
      scope: 2,
      ownerAccountId: '0',
      enterpriseId: account.enterpriseId,
      role: member.role === 1 ? 'admin' : 'member',
      storageMode: 1,
      enterprise: enterprise ?? null,
    };
  }
  const ent = await getEntitlements(account);
  if (!ent.caps.ipResources) {
    throw new ApiError('当前套餐不支持 IP 资源，请升级后使用', 4030, 403, { cap: 'ipResources' });
  }
  const setting = await getPoolSetting(1, account.id);
  return {
    scope: 1,
    ownerAccountId: account.id,
    enterpriseId: '0',
    role: 'user',
    storageMode: setting.storageMode,
    enterprise: null,
  };
}

/** 当前账号可见的资源查询（不含分页） */
function visibleResourceQuery(ctx: IpPoolContext, account: Account) {
  const qb = resourceRepo().createQueryBuilder('r');
  if (ctx.scope === 1) {
    qb.where('r.scope = 1 AND r.owner_account_id = :ownerId', { ownerId: ctx.ownerAccountId });
  } else if (ctx.role === 'member') {
    qb.innerJoin(IpAssignment, 'a', 'a.resource_id = r.id')
      .where('r.scope = 2 AND r.enterprise_id = :entId', { entId: ctx.enterpriseId })
      .andWhere('a.member_account_id = :memberId', { memberId: account.id })
      .andWhere('a.status IN (1,2)');
  } else {
    qb.where('r.scope = 2 AND r.enterprise_id = :entId', { entId: ctx.enterpriseId });
  }
  return qb;
}

/** 存量资源去重键集合 */
async function existingResourceMap(ctx: IpPoolContext): Promise<Map<string, IpResource>> {
  const rows = await resourceRepo()
    .createQueryBuilder('r')
    .where('r.scope = :scope', { scope: ctx.scope })
    .andWhere('r.owner_account_id = :ownerId', { ownerId: ctx.ownerAccountId })
    .andWhere('r.enterprise_id = :entId', { entId: ctx.enterpriseId })
    .getMany();
  return new Map(rows.map((r) => [`${r.host}|${r.port}|${r.username}`, r]));
}

function keyOf(host: string, port: number, username: string): string {
  return `${host}|${port}|${username}`;
}

/** 三段式第 1 段：解析 + 逐行校验 + 重复标记（不入库） */
export async function parseIpRows(
  account: Account,
  text: string
): Promise<{ rows: IpRowPreview[]; validCount: number; errorCount: number; duplicateCount: number }> {
  const ctx = await resolvePoolForManage(account);
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (!lines.length) throw new ApiError('请粘贴或上传资源内容', 400);
  if (lines.length > MAX_COMMIT_ROWS) throw new ApiError(`单次最多导入 ${MAX_COMMIT_ROWS} 条`, 400);

  const existing = await existingResourceMap(ctx);
  const seen = new Set<string>();
  const rows = lines.map((line, idx) => {
    const row = buildRow(line, idx + 1);
    if (row.valid) {
      const key = keyOf(row.host, row.port, row.username);
      const hit = existing.get(key);
      if (hit) {
        row.duplicate = true;
        row.duplicateId = hit.id;
        row.duplicateAction = 'skip';
      } else if (seen.has(key)) {
        // 同一批次内的重复行：过滤掉，只保留第一条
        row.duplicate = true;
        row.duplicateId = null;
        row.duplicateAction = 'skip';
      } else {
        seen.add(key);
      }
    }
    return row;
  });
  return {
    rows,
    validCount: rows.filter((r) => r.valid).length,
    errorCount: rows.filter((r) => !r.valid).length,
    duplicateCount: rows.filter((r) => r.duplicate).length,
  };
}

export interface IpCommitResult {
  created: number;
  updated: number;
  skipped: number;
  failed: Array<{ line: number; host: string; port: number; reason: string }>;
  storageMode: number;
}

/** 三段式第 3 段：仅提交测试通过的行 */
export async function commitIpRows(
  account: Account,
  rows: IpRowInput[],
  storageMode?: number
): Promise<IpCommitResult> {
  const ctx = await resolvePoolForManage(account);
  if (ctx.scope === 1 && storageMode === 2) {
    throw new ApiError('「仅本机」模式不上传资源，请在本地保存', 4031, 200);
  }
  const list = Array.isArray(rows) ? rows.slice(0, MAX_COMMIT_ROWS) : [];
  if (!list.length) throw new ApiError('没有可提交的资源', 400);

  const existing = await existingResourceMap(ctx);
  const result: IpCommitResult = { created: 0, updated: 0, skipped: 0, failed: [], storageMode: ctx.storageMode };

  for (const input of list) {
    const preview = buildRow(
      [input.proxyType || 'socks5', input.host || '', String(input.port || ''), input.username || '', input.password || '', input.remark || ''].join(','),
      Number(input.line || 0)
    );
    if (!preview.valid) {
      result.failed.push({ line: preview.line, host: preview.host, port: preview.port, reason: preview.error });
      continue;
    }
    if (!input.testedOk) {
      result.failed.push({ line: preview.line, host: preview.host, port: preview.port, reason: '未通过连通测试' });
      continue;
    }
    const key = keyOf(preview.host, preview.port, preview.username);
    const hit = existing.get(key);
    if (hit) {
      if (!input.overwrite) {
        result.skipped += 1;
        continue;
      }
      hit.proxyType = preview.proxyType || hit.proxyType;
      if (preview.password) hit.passwordEnc = encryptSecret(preview.password);
      hit.remark = preview.remark || hit.remark;
      hit.status = 1;
      hit.health = 2;
      hit.latencyMs = Number.isFinite(input.latencyMs) ? Number(input.latencyMs) : hit.latencyMs;
      hit.lastCheckAt = new Date();
      await resourceRepo().save(hit);
      result.updated += 1;
      continue;
    }
    const saved = await resourceRepo().save(
      resourceRepo().create({
        scope: ctx.scope,
        ownerAccountId: ctx.ownerAccountId,
        enterpriseId: ctx.enterpriseId,
        proxyType: preview.proxyType || 'socks5',
        host: preview.host,
        port: preview.port,
        username: preview.username,
        passwordEnc: encryptSecret(preview.password),
        remark: preview.remark || null,
        status: 1,
        health: 2,
        latencyMs: Number.isFinite(input.latencyMs) ? Number(input.latencyMs) : null,
        lastCheckAt: new Date(),
      })
    );
    existing.set(key, saved);
    result.created += 1;
  }

  await writeOperationLog(
    account.id,
    'ip.resource.commit',
    ctx.scope === 2 ? `enterprise:${ctx.enterpriseId}` : `account:${account.id}`,
    `导入 IP 资源：新增 ${result.created}、覆盖 ${result.updated}、跳过 ${result.skipped}、失败 ${result.failed.length}`,
    ''
  );
  return result;
}

/** 资源列表（个人池 / 企业池 / 成员自己的资源） */
export async function listResources(
  account: Account,
  opts: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    status?: number;
    bound?: number;
    health?: number;
    proxyType?: string;
  }
): Promise<{
  total: number;
  page: number;
  pageSize: number;
  storageMode: number;
  list: IpResourceView[];
  stats: { total: number; idle: number; assigned: number; inUse: number; abnormal: number; avgLatency: number };
}> {
  const ctx = await resolvePoolForRead(account);
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20));
  const keyword = String(opts.keyword || '').trim();

  const qb = visibleResourceQuery(ctx, account);
  // 汇总卡片统计整个资源池（不受 keyword / 状态 / 连通性 / 分配 / 分页影响）
  const stats = await poolStats(visibleResourceQuery(ctx, account));
  if (keyword) {
    qb.andWhere('(r.host LIKE :kw OR r.username LIKE :kw OR r.remark LIKE :kw)', { kw: `%${keyword}%` });
  }
  if (opts.status === 1 || opts.status === 2) {
    qb.andWhere('r.status = :status', { status: opts.status });
  }
  if (opts.bound === 1) {
    qb.andWhere('EXISTS (SELECT 1 FROM ip_assignments ba WHERE ba.resource_id = r.id AND ba.status IN (1,2))');
  } else if (opts.bound === 0) {
    qb.andWhere('NOT EXISTS (SELECT 1 FROM ip_assignments ba WHERE ba.resource_id = r.id AND ba.status IN (1,2))');
  }
  if (opts.health === 1 || opts.health === 2 || opts.health === 3) {
    qb.andWhere('r.health = :health', { health: opts.health });
  }
  if (opts.proxyType === 'socks5' || opts.proxyType === 'http') {
    qb.andWhere('r.proxy_type = :proxyType', { proxyType: opts.proxyType });
  }
  const total = await qb.getCount();
  const rows = await qb.orderBy('r.id', 'DESC').skip((page - 1) * pageSize).take(pageSize).getMany();
  const list = await decorateResources(rows, ctx, account);
  return { total, page, pageSize, storageMode: ctx.storageMode, list, stats };
}

/** 资源池汇总：总数 / 空闲 / 已分配（含使用中） / 使用中 / 异常 / 平均延迟，不受筛选与分页影响 */
async function poolStats(base: SelectQueryBuilder<IpResource>): Promise<{
  total: number;
  idle: number;
  assigned: number;
  inUse: number;
  abnormal: number;
  avgLatency: number;
}> {
  const row = await base
    .clone()
    .leftJoin(IpAssignment, 'sa', 'sa.resource_id = r.id AND sa.status IN (1,2)')
    .select('COUNT(r.id)', 'total')
    .addSelect('COALESCE(SUM(CASE WHEN sa.id IS NULL THEN 1 ELSE 0 END), 0)', 'idle')
    .addSelect('COALESCE(SUM(CASE WHEN sa.id IS NOT NULL THEN 1 ELSE 0 END), 0)', 'assigned')
    .addSelect('COALESCE(SUM(CASE WHEN sa.status = 2 THEN 1 ELSE 0 END), 0)', 'inUse')
    .addSelect('COALESCE(SUM(CASE WHEN r.health = 3 THEN 1 ELSE 0 END), 0)', 'abnormal')
    .addSelect('AVG(r.latency_ms)', 'avgLatency')
    .getRawOne<{
      total: string;
      idle: string;
      assigned: string;
      inUse: string;
      abnormal: string;
      avgLatency: string | null;
    }>();
  return {
    total: Number(row?.total || 0),
    idle: Number(row?.idle || 0),
    assigned: Number(row?.assigned || 0),
    inUse: Number(row?.inUse || 0),
    abnormal: Number(row?.abnormal || 0),
    avgLatency: row?.avgLatency === null || row?.avgLatency === undefined ? -1 : Math.round(Number(row.avgLatency)),
  };
}

/** 批量补充分配信息与掩码 */
async function decorateResources(rows: IpResource[], ctx: IpPoolContext, account: Account): Promise<IpResourceView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const assignments = await assignmentRepo()
    .createQueryBuilder('a')
    .where('a.resource_id IN (:...ids)', { ids })
    .andWhere('a.status IN (1,2)')
    .getMany();
  const memberIds = [...new Set(assignments.map((a) => a.memberAccountId))];
  const members = memberIds.length ? await accountRepo().createQueryBuilder('ac').where('ac.id IN (:...ids)', { ids: memberIds }).getMany() : [];
  const memberMap = new Map(members.map((m) => [String(m.id), m]));
  const assignmentMap = new Map(assignments.map((a) => [String(a.resourceId), a]));

  return rows.map((r) => {
    const a = assignmentMap.get(String(r.id));
    const member = a ? memberMap.get(String(a.memberAccountId)) : undefined;
    const plaintext = !!a && a.plaintextVisible === 1 && String(a.memberAccountId) === String(account.id);
    return {
      id: String(r.id),
      scope: r.scope,
      proxyType: r.proxyType,
      host: r.host,
      port: r.port,
      username: plaintext ? r.username : maskAccountName(r.username),
      usernameMasked: maskAccountName(r.username),
      password: plaintext ? decryptSecret(r.passwordEnc) : '',
      hasPassword: !!r.passwordEnc,
      remark: r.remark || '',
      status: r.status,
      health: r.health,
      latencyMs: r.latencyMs,
      lastCheckAt: toIso(r.lastCheckAt),
      createdAt: toIso(r.createdAt),
      plaintextVisible: !!a && a.plaintextVisible === 1,
      assigned: !!a,
      inUse: !!a && a.status === 2,
      envId: a?.envId ?? null,
      envName: a?.envName ?? null,
      boundAt: toIso(a?.boundAt),
      memberAccountId: a ? String(a.memberAccountId) : null,
      memberLogin: member?.login ?? null,
      memberNickname: member?.nickname ?? null,
    };
  });
}

/** 资源池存储模式 */
export async function getPoolMode(account: Account): Promise<{ ownerType: number; storageMode: number }> {
  const ctx = await resolvePoolForRead(account);
  if (ctx.scope === 2) return { ownerType: 2, storageMode: 1 };
  return { ownerType: 1, storageMode: ctx.storageMode };
}

/** 切换存储模式：个人池 1↔2；企业池固定 1 */
export async function setPoolMode(account: Account, mode: number): Promise<{ storageMode: number; removed: number }> {
  if (mode !== 1 && mode !== 2) throw new ApiError('存储模式参数错误', 400);
  const ctx = await resolvePoolForManage(account);
  if (ctx.scope === 2) throw new ApiError('企业资源池固定为持久化模式', 4032);
  if (mode === ctx.storageMode) return { storageMode: mode, removed: 0 };

  let removed = 0;
  if (mode === 2) {
    // 持久化 → 仅本机：服务端删除，客户端保留本地副本
    const rows = await resourceRepo()
      .createQueryBuilder('r')
      .where('r.scope = 1 AND r.owner_account_id = :ownerId', { ownerId: ctx.ownerAccountId })
      .getMany();
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await assignmentRepo()
        .createQueryBuilder()
        .update(IpAssignment)
        .set({ status: 3, releasedAt: new Date(), releaseReason: '切换为仅本机存储' })
        .where('resource_id IN (:...ids) AND status IN (1,2)', { ids })
        .execute();
      await assignmentRepo().createQueryBuilder().delete().where('resource_id IN (:...ids)', { ids }).execute();
      await resourceRepo().createQueryBuilder().delete().where('id IN (:...ids)', { ids }).execute();
      removed = ids.length;
    }
  }
  const repo = settingRepo();
  const row = await repo.findOneBy({ ownerType: 1, ownerId: account.id });
  if (row) {
    row.storageMode = mode;
    await repo.save(row);
  } else {
    await repo.save(repo.create({ ownerType: 1, ownerId: account.id, storageMode: mode }));
  }
  await writeOperationLog(account.id, 'ip.pool.mode', `account:${account.id}`, `存储模式切换为 ${mode === 1 ? '持久化' : '仅本机'}`, '');
  return { storageMode: mode, removed };
}

/** 校验资源归属（管理侧） */
async function getManageableResource(account: Account, ctx: IpPoolContext, resourceId: string): Promise<IpResource> {
  const r = await resourceRepo().findOneBy({ id: resourceId });
  if (!r) throw new ApiError('资源不存在', 4004, 404);
  if (ctx.scope === 1) {
    if (r.scope !== 1 || String(r.ownerAccountId) !== String(account.id)) throw new ApiError('无权操作该资源', 4003, 403);
  } else if (r.scope !== 2 || String(r.enterpriseId) !== String(ctx.enterpriseId)) {
    throw new ApiError('无权操作该资源', 4003, 403);
  }
  return r;
}

/** 删除资源（使用中拒绝） */
export async function deleteResource(account: Account, resourceId: string): Promise<void> {
  const ctx = await resolvePoolForManage(account);
  const r = await getManageableResource(account, ctx, resourceId);
  const active = await assignmentRepo().findOneBy({ resourceId: r.id, status: 2 });
  if (active) {
    throw new ApiError('资源使用中，请先在环境里清除后再删除', 4006, 200, {
      occupied: [{ resourceId: r.id, host: r.host, port: r.port, envName: active.envName }],
    });
  }
  await assignmentRepo().createQueryBuilder().delete().where('resource_id = :id', { id: r.id }).execute();
  await resourceRepo().delete(r.id);
  await writeOperationLog(account.id, 'ip.resource.delete', `${r.host}:${r.port}`, '删除 IP 资源', '');
}

/** 停用 / 启用；停用已分配给成员的资源必须填写原因，并即时通知该成员 */
export async function setResourceStatus(
  account: Account,
  resourceId: string,
  status: number,
  reason = ''
): Promise<void> {
  if (status !== 1 && status !== 2) throw new ApiError('状态参数错误', 400);
  const ctx = await resolvePoolForManage(account);
  const r = await getManageableResource(account, ctx, resourceId);
  const assignment = await assignmentRepo().findOneBy({ resourceId: r.id });
  const notifyMemberId =
    status === 2 && assignment && (assignment.status === 1 || assignment.status === 2) &&
    String(assignment.memberAccountId) !== String(account.id)
      ? String(assignment.memberAccountId)
      : '';
  if (status === 2 && notifyMemberId && !reason.trim()) {
    throw new ApiError('停用已分配给成员的 IP 必须填写原因', 400, 400);
  }
  // 使用中的资源允许停用（客户端会二次确认并提示首页对应环境将不可用）
  r.status = status;
  await resourceRepo().save(r);
  const detail = reason.trim() ? `${status === 1 ? '启用资源' : '停用资源'}（原因：${reason.trim()}）` : status === 1 ? '启用资源' : '停用资源';
  await writeOperationLog(account.id, 'ip.resource.status', `${r.host}:${r.port}`, detail, '');
  if (notifyMemberId) {
    const title = 'IP 资源已停用';
    const content = `管理员停用了 IP ${r.host}:${r.port}${reason.trim() ? `，原因：${reason.trim()}` : ''}。如该 IP 已绑定到你的环境，请更换可用 IP 后重新启动。`;
    pushAccountNotice(notifyMemberId, {
      notice: title,
      noticeData: { title, content, strong: false, link: '' },
    });
  }
}

/** 管理员逐条设置某条已分配资源是否向成员开放明文凭据（默认关闭） */
export async function setAssignmentPlaintext(
  admin: Account,
  memberId: string,
  resourceId: string,
  visible: boolean,
  ip?: string
): Promise<{ plaintextVisible: boolean }> {
  const ctx = await requireEnterpriseAdmin(admin);
  const member = await memberRepo().findOneBy({ id: memberId, enterpriseId: ctx.enterprise.id });
  if (!member || member.status !== 1) throw new ApiError('成员不存在或已停用', 4004, 404);
  const a = await assignmentRepo().findOneBy({ resourceId, memberAccountId: member.accountId });
  if (!a || (a.status !== 1 && a.status !== 2)) throw new ApiError('该资源未分配给该成员', 4004, 404);
  a.plaintextVisible = visible ? 1 : 0;
  await assignmentRepo().save(a);
  const r = await resourceRepo().findOneBy({ id: resourceId });
  const address = r ? `${r.host}:${r.port}` : resourceId;
  await writeOperationLog(admin.id, 'ip.assign.plaintext', `member:${member.accountId}`,
    `${visible ? '开放' : '关闭'}明文凭据（${address}）`, ip || '');
  return { plaintextVisible: visible };
}

/** 读取资源并校验当前账号的访问权限（下发凭据 / 回传测试结果共用） */
async function loadResourceForAccount(
  account: Account,
  resourceId: string
): Promise<{ ctx: IpPoolContext; r: IpResource }> {
  const ctx = await resolvePoolForRead(account);
  const r = await resourceRepo().findOneBy({ id: resourceId });
  if (!r) throw new ApiError('资源不存在', 4004, 404);
  if (ctx.scope === 2) {
    if (String(r.scope) !== '2' || String(r.enterpriseId) !== String(ctx.enterpriseId)) {
      throw new ApiError('无权操作该资源', 4003, 403);
    }
    if (ctx.role === 'member') {
      const a = await assignmentRepo().findOneBy({ resourceId: r.id, memberAccountId: account.id, status: 1 });
      const a2 = await assignmentRepo().findOneBy({ resourceId: r.id, memberAccountId: account.id, status: 2 });
      if (!a && !a2) throw new ApiError('无权操作该资源', 4003, 403);
    }
  } else if (String(r.ownerAccountId) !== String(account.id)) {
    throw new ApiError('无权操作该资源', 4003, 403);
  }
  return { ctx, r };
}

/**
 * 本机连通测试用的明文凭据
 * 服务端探测走机房出口，会被按授权 IP 放行的代理拒绝，故测试在客户端本机执行；
 * 只有资源所有者 / 企业管理员 / 已分配且允许明文可见的成员才能取到。
 */
export async function getResourceCredentials(
  account: Account,
  resourceId: string
): Promise<{ proxyType: IpProxyType; host: string; port: number; username: string; password: string }> {
  const { ctx, r } = await loadResourceForAccount(account, resourceId);
  // C-4 第二道防线：出口凭据只在权益仍含网络出口时下发（企业成员到期后同样拦截）
  const ent = await getEntitlements(account);
  if (!ent.caps.proxy) {
    throw new ApiError('当前套餐不支持网络出口，请升级后使用', 4030, 403, { cap: 'proxy' });
  }
  if (ctx.scope === 2 && ctx.role === 'member') {
    const a = await assignmentRepo().findOneBy({ resourceId: r.id, memberAccountId: account.id });
    if (!a || a.plaintextVisible !== 1) {
      throw new ApiError('该资源未向你开放明文凭据', 4003, 403);
    }
  }
  return {
    proxyType: (r.proxyType === 'http' ? 'http' : 'socks5') as IpProxyType,
    host: r.host,
    port: r.port,
    username: r.username,
    password: decryptSecret(r.passwordEnc),
  };
}

/** 客户端本机测试结果回传：只更新健康度、延迟与检查时间 */
export async function reportResourceProbe(
  account: Account,
  resourceId: string,
  probeOk: boolean,
  latencyMs: number
): Promise<void> {
  const { r } = await loadResourceForAccount(account, resourceId);
  r.health = probeOk ? 2 : 3;
  r.latencyMs = Math.max(0, Math.min(600000, Math.round(latencyMs)));
  r.lastCheckAt = new Date();
  await resourceRepo().save(r);
}

/** 可用资源：个人池未占用 / 成员已分配未占用 */
export async function listAvailable(account: Account): Promise<IpResourceView[]> {
  const ctx = await resolvePoolForRead(account);

  if (ctx.scope === 1) {
    const rows = await resourceRepo()
      .createQueryBuilder('r')
      .where('r.scope = 1 AND r.owner_account_id = :ownerId AND r.status = 1', { ownerId: ctx.ownerAccountId })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM ip_assignments a WHERE a.resource_id = r.id AND a.status = 2)'
      )
      .orderBy('r.id', 'DESC')
      .getMany();
    return decorateResources(rows, ctx, account);
  }

  const qb = resourceRepo()
    .createQueryBuilder('r')
    .innerJoin(IpAssignment, 'a', 'a.resource_id = r.id')
    .where('r.scope = 2 AND r.enterprise_id = :entId AND r.status = 1', { entId: ctx.enterpriseId })
    .andWhere('a.status = 1');
  if (ctx.role === 'member') {
    qb.andWhere('a.member_account_id = :memberId', { memberId: account.id });
  }
  const rows = await qb.orderBy('r.id', 'DESC').getMany();
  return decorateResources(rows, ctx, account);
}

/** 绑定（事务 + 唯一约束，防并发抢占） */
export async function bindResource(
  account: Account,
  resourceId: string,
  envId: string,
  envName: string
): Promise<{
  resourceId: string;
  proxyType: string;
  host: string;
  port: number;
  username: string;
  password: string;
  plaintextVisible: boolean;
}> {
  const ctx = await resolvePoolForRead(account);

  return AppDataSource.transaction(async (manager) => {
    const r = await manager.getRepository(IpResource).findOne({ where: { id: resourceId }, lock: { mode: 'pessimistic_write' } });
    if (!r) throw new ApiError('资源不存在', 4004, 404);
    if (r.status !== 1) throw new ApiError('资源已停用，请联系管理员', 4008);
    if (ctx.scope === 1) {
      if (r.scope !== 1 || String(r.ownerAccountId) !== String(account.id)) throw new ApiError('无权使用该资源', 4003, 403);
    } else if (r.scope !== 2 || String(r.enterpriseId) !== String(ctx.enterpriseId)) {
      throw new ApiError('无权使用该资源', 4003, 403);
    }

    const repo = manager.getRepository(IpAssignment);
    let a = await repo.findOne({ where: { resourceId: r.id }, lock: { mode: 'pessimistic_write' } });
    if (a && a.status === 2) throw new ApiError('该资源已被占用，请选择其他资源', 4007);
    if (ctx.role === 'member') {
      if (!a || String(a.memberAccountId) !== String(account.id)) throw new ApiError('该资源未分配给你', 4003, 403);
      if (a.status !== 1) throw new ApiError('该资源未分配给你', 4003, 403);
    }

    if (!a) {
      a = repo.create({
        resourceId: r.id,
        enterpriseId: ctx.enterpriseId,
        memberAccountId: account.id,
        assignedBy: account.id,
        plaintextVisible: 0,
        status: 2,
        envId,
        envName,
        boundAt: new Date(),
      });
    } else {
      a.status = 2;
      a.envId = envId;
      a.envName = envName;
      a.boundAt = new Date();
      a.releasedAt = null;
      a.releaseReason = null;
      if (ctx.scope === 1 && String(a.memberAccountId) !== String(account.id)) {
        a.memberAccountId = account.id;
      }
    }
    await repo.save(a);

    return {
      resourceId: String(r.id),
      proxyType: r.proxyType,
      host: r.host,
      port: r.port,
      username: r.username,
      password: decryptSecret(r.passwordEnc),
      plaintextVisible: a.plaintextVisible === 1,
    };
  });
}

/** 释放（客户端清除代理 / 环境删除 / 退出登录 / 兜底） */
export async function releaseResource(account: Account, resourceId: string, reason: string): Promise<void> {
  const a = await assignmentRepo().findOneBy({ resourceId });
  if (!a) return;
  if (a.status !== 2) return;

  const ctx = await resolvePoolForRead(account);
  const isOwner =
    ctx.scope === 1
      ? String(a.memberAccountId) === String(account.id)
      : String(a.enterpriseId) === String(ctx.enterpriseId) &&
        (ctx.role === 'admin' || String(a.memberAccountId) === String(account.id));
  if (!isOwner) throw new ApiError('无权释放该资源', 4003, 403);

  a.status = ctx.scope === 1 ? 3 : 1;
  a.releasedAt = new Date();
  a.releaseReason = (reason || '客户端释放').slice(0, 255);
  a.boundAt = null;
  a.envId = null;
  a.envName = null;
  await assignmentRepo().save(a);
}

export interface TeamPoolQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: number;
  memberId?: string;
  health?: number;
  proxyType?: string;
  bound?: number;
}

/** 企业资源池列表（管理员） */
export async function listEnterprisePool(
  account: Account,
  ctx: EnterpriseContext,
  opts: TeamPoolQuery
): Promise<{
  total: number;
  page: number;
  pageSize: number;
  seats: number;
  usedSeats: number;
  list: IpResourceView[];
  stats: { total: number; idle: number; assigned: number; inUse: number; abnormal: number; avgLatency: number };
}> {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20));
  const keyword = String(opts.keyword || '').trim();
  const poolCtx: IpPoolContext = {
    scope: 2,
    ownerAccountId: '0',
    enterpriseId: ctx.enterprise.id,
    role: 'admin',
    storageMode: 1,
    enterprise: ctx.enterprise,
  };

  const qb = resourceRepo().createQueryBuilder('r').where('r.scope = 2 AND r.enterprise_id = :entId', {
    entId: ctx.enterprise.id,
  });
  const stats = await poolStats(qb);
  if (keyword) qb.andWhere('(r.host LIKE :kw OR r.username LIKE :kw OR r.remark LIKE :kw)', { kw: `%${keyword}%` });
  if (opts.status === 1 || opts.status === 2) qb.andWhere('r.status = :status', { status: opts.status });
  if (opts.health === 1 || opts.health === 2 || opts.health === 3) {
    qb.andWhere('r.health = :health', { health: opts.health });
  }
  if (opts.proxyType === 'socks5' || opts.proxyType === 'http') {
    qb.andWhere('r.proxy_type = :proxyType', { proxyType: opts.proxyType });
  }
  if (opts.bound === 1) {
    qb.andWhere('EXISTS (SELECT 1 FROM ip_assignments ba WHERE ba.resource_id = r.id AND ba.status IN (1,2))');
  } else if (opts.bound === 0) {
    qb.andWhere('NOT EXISTS (SELECT 1 FROM ip_assignments ba WHERE ba.resource_id = r.id AND ba.status IN (1,2))');
  }
  if (opts.memberId) {
    qb.innerJoin(IpAssignment, 'fa', 'fa.resource_id = r.id')
      .andWhere('fa.member_account_id = :memberId', { memberId: opts.memberId })
      .andWhere('fa.status IN (1,2)');
  }
  const total = await qb.getCount();
  const rows = await qb.orderBy('r.id', 'DESC').skip((page - 1) * pageSize).take(pageSize).getMany();
  const list = await decorateResources(rows, poolCtx, account);
  const usedSeats = await memberRepo().count({ where: { enterpriseId: ctx.enterprise.id, status: 1 } });
  return { total, page, pageSize, seats: ctx.enterprise.seats, usedSeats, list, stats };
}

/** 分配（管理员 → 成员）；支持批量与「允许查看明文」 */
export async function assignResources(
  admin: Account,
  ctx: EnterpriseContext,
  memberId: string,
  resourceIds: string[],
  plaintextVisible: boolean,
  ip?: string
): Promise<{ assigned: number; failed: Array<{ resourceId: string; reason: string }> }> {
  const member = await memberRepo().findOneBy({ id: memberId, enterpriseId: ctx.enterprise.id });
  if (!member || member.status !== 1) throw new ApiError('成员不存在或已停用', 4004, 404);
  const ids = [...new Set((resourceIds || []).map(String))].slice(0, MAX_COMMIT_ROWS);
  if (!ids.length) throw new ApiError('请选择要分配的资源', 400);

  const resources = await resourceRepo()
    .createQueryBuilder('r')
    .where('r.id IN (:...ids)', { ids })
    .andWhere('r.scope = 2 AND r.enterprise_id = :entId', { entId: ctx.enterprise.id })
    .getMany();
  const found = new Map(resources.map((r) => [String(r.id), r]));
  const result: { assigned: number; failed: Array<{ resourceId: string; reason: string }> } = { assigned: 0, failed: [] };

  for (const id of ids) {
    const r = found.get(id);
    if (!r) {
      result.failed.push({ resourceId: id, reason: '资源不存在或不属于本企业' });
      continue;
    }
    let a = await assignmentRepo().findOneBy({ resourceId: r.id });
    if (a && a.status === 2) {
      result.failed.push({ resourceId: id, reason: '资源使用中，请先回收' });
      continue;
    }
    if (!a) {
      a = assignmentRepo().create({
        resourceId: r.id,
        enterpriseId: ctx.enterprise.id,
        memberAccountId: member.accountId,
        assignedBy: admin.id,
        plaintextVisible: plaintextVisible ? 1 : 0,
        status: 1,
      });
    } else {
      a.memberAccountId = member.accountId;
      a.assignedBy = admin.id;
      a.plaintextVisible = plaintextVisible ? 1 : 0;
      a.status = 1;
      a.envId = null;
      a.envName = null;
      a.boundAt = null;
      a.releasedAt = null;
      a.releaseReason = null;
    }
    await assignmentRepo().save(a);
    result.assigned += 1;
  }

  await writeOperationLog(
    admin.id,
    'ip.assign',
    `member:${member.accountId}`,
    `分配 IP 资源 ${result.assigned} 个（明文可见=${plaintextVisible ? '是' : '否'}）`,
    ip || ''
  );
  return result;
}

/** 回收（管理员）；使用中拒绝 */
export async function recycleResource(
  admin: Account,
  ctx: EnterpriseContext,
  memberId: string,
  resourceId: string,
  ip?: string
): Promise<void> {
  const member = await memberRepo().findOneBy({ id: memberId, enterpriseId: ctx.enterprise.id });
  if (!member) throw new ApiError('成员不存在', 4004, 404);
  const r = await resourceRepo().findOneBy({ id: resourceId, scope: 2, enterpriseId: ctx.enterprise.id });
  if (!r) throw new ApiError('资源不存在或不属于本企业', 4004, 404);
  const a = await assignmentRepo().findOneBy({ resourceId: r.id });
  if (!a || String(a.memberAccountId) !== String(member.accountId) || a.status === 3) {
    throw new ApiError('该资源未分配给此成员', 4004);
  }
  if (a.status === 2) {
    throw new ApiError('资源使用中，请成员在客户端清除后再回收', 4006, 200, {
      occupied: [{ resourceId: r.id, host: r.host, port: r.port, envName: a.envName }],
    });
  }
  a.status = 3;
  a.releasedAt = new Date();
  a.releaseReason = '管理员回收';
  a.envId = null;
  a.envName = null;
  a.boundAt = null;
  await assignmentRepo().save(a);
  await writeOperationLog(admin.id, 'ip.recycle', `${r.host}:${r.port}`, `回收成员 ${member.accountId} 的资源`, ip || '');
}

/** 兜底释放：绑定超过 10 分钟且设备无心跳 */
export async function autoReleaseStaleResources(): Promise<number> {
  const now = Date.now();
  const rows = await assignmentRepo()
    .createQueryBuilder('a')
    .where('a.status = 2 AND a.bound_at IS NOT NULL AND a.bound_at < :limit', {
      limit: new Date(now - STALE_BIND_MS),
    })
    .limit(200)
    .getMany();
  if (!rows.length) return 0;

  const memberIds = [...new Set(rows.map((a) => a.memberAccountId))];
  const devices = await deviceRepo()
    .createQueryBuilder('d')
    .where('d.account_id IN (:...ids)', { ids: memberIds })
    .andWhere('d.status = 1')
    .getMany();
  const lastActive = new Map<string, number>();
  for (const d of devices) {
    const t = d.lastActiveAt ? d.lastActiveAt.getTime() : 0;
    lastActive.set(String(d.accountId), Math.max(lastActive.get(String(d.accountId)) || 0, t));
  }

  let released = 0;
  for (const a of rows) {
    const active = lastActive.get(String(a.memberAccountId)) || 0;
    const bound = a.boundAt ? a.boundAt.getTime() : 0;
    if (active && active > bound) continue; // 设备有心跳，保留绑定
    a.status = a.enterpriseId && String(a.enterpriseId) !== '0' ? 1 : 3;
    a.releasedAt = new Date();
    a.releaseReason = '设备超过 10 分钟无心跳，自动释放';
    a.boundAt = null;
    a.envId = null;
    a.envName = null;
    await assignmentRepo().save(a);
    released += 1;
  }
  return released;
}
