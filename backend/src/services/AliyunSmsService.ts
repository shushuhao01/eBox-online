import crypto from 'crypto';
import https from 'https';
import { getConfigValue } from './ConfigService';

/**
 * 阿里云短信（Dysmsapi 2017-05-25）
 * - 项目未引入 axios / 阿里云 SDK，这里用 Node 内置 https 直连
 * - GET 请求，按阿里云 RPC 签名规范：参数排序 → RFC3986 编码 → HmacSHA1(secret + "&")
 */

const ENDPOINT = 'dysmsapi.aliyuncs.com';
const API_VERSION = '2017-05-25';

export interface AliyunSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
}

export interface AliyunSmsResult {
  Code: string;
  Message: string;
  RequestId?: string;
  BizId?: string;
  [key: string]: unknown;
}

export class AliyunSmsError extends Error {
  code: string;
  requestId?: string;

  constructor(code: string, message: string, requestId?: string) {
    super(`阿里云短信错误（${code}）：${message}`);
    this.name = 'AliyunSmsError';
    this.code = code;
    this.requestId = requestId;
  }
}

/** 大陆手机号基本校验（11 位） */
export function isValidMainlandPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(String(phone || '').trim());
}

/** RFC3986 编码：空格 %20、* → %2A、~ 不编码 */
function percentEncode(value: string): string {
  return encodeURIComponent(String(value))
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

function signParams(params: Record<string, string>, accessKeySecret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k] ?? '')}`)
    .join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;
  return crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64');
}

function aliyunTimestamp(): string {
  // 阿里云要求 ISO8601 UTC：2020-01-01T00:00:00Z
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function requestAliyun(
  config: AliyunSmsConfig,
  action: string,
  bizParams: Record<string, string>
): Promise<AliyunSmsResult> {
  const params: Record<string, string> = {
    AccessKeyId: config.accessKeyId,
    Action: action,
    Format: 'JSON',
    RegionId: config.region || 'cn-hangzhou',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: aliyunTimestamp(),
    Version: API_VERSION,
    ...bizParams,
  };
  const signature = signParams(params, config.accessKeySecret);
  const query = Object.keys(params)
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const path = `/?Signature=${percentEncode(signature)}&${query}`;

  return new Promise<AliyunSmsResult>((resolve, reject) => {
    const req = https.request(
      { hostname: ENDPOINT, path, method: 'GET', timeout: 10000 },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          raw += chunk;
        });
        res.on('end', () => {
          let data: AliyunSmsResult;
          try {
            data = JSON.parse(raw) as AliyunSmsResult;
          } catch {
            reject(new Error(`阿里云短信接口返回异常（HTTP ${res.statusCode}）`));
            return;
          }
          if (!data || data.Code !== 'OK') {
            reject(
              new AliyunSmsError(
                String(data?.Code || `HTTP_${res.statusCode}`),
                String(data?.Message || '未知错误'),
                data?.RequestId
              )
            );
            return;
          }
          resolve(data);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('阿里云短信接口请求超时')));
    req.on('error', reject);
    req.end();
  });
}

/** 读取短信配置；AK 不完整返回 null */
export async function loadAliyunSmsConfig(): Promise<AliyunSmsConfig | null> {
  const [id, secret, region] = await Promise.all([
    getConfigValue('sms_access_key_id'),
    getConfigValue('sms_access_key_secret'),
    getConfigValue('sms_region'),
  ]);
  const accessKeyId = id.trim();
  const accessKeySecret = secret.trim();
  if (!accessKeyId || !accessKeySecret) return null;
  return { accessKeyId, accessKeySecret, region: region.trim() || 'cn-hangzhou' };
}

/** 短信渠道是否启用 */
export async function isSmsEnabled(): Promise<boolean> {
  return (await getConfigValue('sms_enabled')) === '1';
}

export interface SendSmsInput {
  phone: string;
  signName: string;
  templateCode: string;
  templateParam?: Record<string, string | number>;
}

/** 发送短信；Code !== 'OK' 抛 AliyunSmsError */
export async function sendSms(config: AliyunSmsConfig, input: SendSmsInput): Promise<AliyunSmsResult> {
  const phone = String(input.phone || '').trim();
  if (!isValidMainlandPhone(phone)) throw new Error('手机号格式不正确（需 11 位大陆手机号）');
  if (!input.signName) throw new Error('未配置短信签名');
  if (!input.templateCode) throw new Error('未配置短信模板 CODE');
  const templateParam: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.templateParam || {})) {
    templateParam[k] = String(v ?? '');
  }
  return requestAliyun(config, 'SendSms', {
    PhoneNumbers: phone,
    SignName: input.signName,
    TemplateCode: input.templateCode,
    TemplateParam: JSON.stringify(templateParam),
  });
}

/** 查询短信模板列表（用于只读校验 AK 是否可用） */
export async function queryTemplateList(
  config: AliyunSmsConfig,
  pageIndex = 1,
  pageSize = 10
): Promise<AliyunSmsResult> {
  return requestAliyun(config, 'QuerySmsTemplateList', {
    PageIndex: String(pageIndex),
    PageSize: String(pageSize),
  });
}
