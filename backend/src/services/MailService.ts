import net from 'net';
import tls from 'tls';

/**
 * 账号体系邮件发送（M1 找回密码）
 * - 项目未引入 nodemailer，这里用 Node 原生 net/tls 实现最小 SMTP 客户端
 * - 支持 465(SSL) 与 25/587(STARTTLS)；未配置 SMTP 时由调用方走“联系客服”分支
 * - 仅发送纯文本邮件，失败抛错由调用方转成统一 ApiError
 */

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

interface SmtpResponse {
  code: number;
  text: string;
}

class SmtpConnection {
  private socket: net.Socket | tls.TLSSocket;
  private buf = '';
  private responseLines: string[] = [];
  private responses: SmtpResponse[] = [];
  private waiter: ((r: SmtpResponse) => void) | null = null;
  private error: Error | null = null;

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    this.attach(socket);
  }

  private attach(socket: net.Socket | tls.TLSSocket): void {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', (e: Error) => this.fail(e));
    socket.on('close', () => this.fail(new Error('SMTP 连接已关闭')));
  }

  private fail(e: Error): void {
    if (!this.error) this.error = e;
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let idx = this.buf.indexOf('\r\n');
    while (idx >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      this.responseLines.push(line);
      // 多行响应的最后一行格式为 "250 xxx"（三位码后跟空格）
      if (/^\d{3} /.test(line)) {
        const resp: SmtpResponse = {
          code: Number(line.slice(0, 3)),
          text: this.responseLines.join('\n'),
        };
        this.responseLines = [];
        if (this.waiter) {
          const w = this.waiter;
          this.waiter = null;
          w(resp);
        } else {
          this.responses.push(resp);
        }
      }
      idx = this.buf.indexOf('\r\n');
    }
  }

  read(timeoutMs = 20000): Promise<SmtpResponse> {
    const queued = this.responses.shift();
    if (queued) return Promise.resolve(queued);
    if (this.error) return Promise.reject(this.error);
    return new Promise<SmtpResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error('SMTP 响应超时'));
      }, timeoutMs);
      this.waiter = (r) => {
        clearTimeout(timer);
        resolve(r);
      };
    });
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  /** 发送已带终止符的原始数据（DATA 正文） */
  async writeRaw(data: string): Promise<SmtpResponse> {
    this.socket.write(data);
    const resp = await this.read();
    if (resp.code !== 250) {
      throw new Error(`SMTP 正文发送失败（${resp.code}）：${resp.text}`);
    }
    return resp;
  }

  async command(line: string, expectCodes: number[]): Promise<SmtpResponse> {
    this.write(line);
    const resp = await this.read();
    if (!expectCodes.includes(resp.code)) {
      throw new Error(`SMTP 错误（期望 ${expectCodes.join('/')}，实际 ${resp.code}）：${resp.text}`);
    }
    return resp;
  }

  /** 587 端口明文连接后升级 STARTTLS */
  async upgradeTls(host: string): Promise<void> {
    const secureSocket = tls.connect({ socket: this.socket, servername: host, rejectUnauthorized: false });
    await new Promise<void>((resolve, reject) => {
      secureSocket.once('secureConnect', () => resolve());
      secureSocket.once('error', (e) => reject(e));
    });
    this.socket = secureSocket;
    this.attach(secureSocket);
  }

  async ehlo(host: string): Promise<SmtpResponse> {
    return this.command(`EHLO ${host}`, [250]);
  }

  close(): void {
    try {
      this.socket.destroy();
    } catch {
      /* ignore */
    }
  }
}

function encodeHeader(value: string): string {
  // 非 ASCII 头按 RFC 2047 编码，避免中文主题乱码
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((l) => (l.startsWith('.') ? `.${l}` : l))
    .join('\r\n');
}

/** 发送纯文本邮件；任一环节失败抛错 */
export async function sendMail(cfg: SmtpConfig, mail: { to: string; subject: string; text: string }): Promise<void> {
  const socket = cfg.secure
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: false })
    : net.connect({ host: cfg.host, port: cfg.port });
  socket.setTimeout(25000, () => socket.destroy(new Error('SMTP 连接超时')));

  const conn = new SmtpConnection(socket);
  try {
    if (cfg.secure) {
      await new Promise<void>((resolve, reject) => {
        socket.once('secureConnect', () => resolve());
        socket.once('error', (e) => reject(e));
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('error', (e) => reject(e));
      });
    }

    const greeting = await conn.read();
    if (greeting.code !== 220) throw new Error(`SMTP 拒绝连接：${greeting.text}`);

    let ehlo = await conn.ehlo('ebox.local');
    if (!cfg.secure && /\bSTARTTLS\b/i.test(ehlo.text)) {
      await conn.command('STARTTLS', [220]);
      await conn.upgradeTls(cfg.host);
      ehlo = await conn.ehlo('ebox.local');
    }

    if (cfg.user) {
      await conn.command('AUTH LOGIN', [334]);
      await conn.command(Buffer.from(cfg.user, 'utf8').toString('base64'), [334]);
      await conn.command(Buffer.from(cfg.pass, 'utf8').toString('base64'), [235]);
    }

    await conn.command(`MAIL FROM:<${cfg.from}>`, [250]);
    await conn.command(`RCPT TO:<${mail.to}>`, [250, 251]);
    await conn.command('DATA', [354]);

    const headers = [
      `From: ${encodeHeader('eBox 授权服务')} <${cfg.from}>`,
      `To: <${mail.to}>`,
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');
    const payload = `${headers}\r\n\r\n${dotStuff(mail.text)}\r\n.\r\n`;
    await conn.writeRaw(payload);
    try {
      await conn.command('QUIT', [221]);
    } catch {
      /* 退出失败不影响已投递结果 */
    }
  } finally {
    conn.close();
  }
}
