import { AppDataSource } from '../config/database';
import { Account } from '../entities/account/Account';
import { AccountDevice } from '../entities/account/AccountDevice';
import { ProxyBlockEvent } from '../entities/account/ProxyBlockEvent';

/**
 * 断网保护事件上报（M5 团队仪表盘统计）
 * - 客户端本地断网保护触发后调用，服务端按账号/企业落库
 * - 5 分钟内同账号同环境重复上报去重（与客户端排障日志节奏一致）
 */

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export interface ProxyBlockedInput {
  machineFp?: string;
  envId?: string;
  detail?: string;
}

export async function reportProxyBlocked(account: Account, input: ProxyBlockedInput): Promise<void> {
  const repo = AppDataSource.getRepository(ProxyBlockEvent);
  const envId = String(input.envId || '').slice(0, 64);

  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const recent = await repo
    .createQueryBuilder('e')
    .where('e.account_id = :accountId', { accountId: account.id })
    .andWhere('e.env_id = :envId', { envId })
    .andWhere('e.created_at >= :since', { since })
    .getCount();
  if (recent > 0) return;

  let deviceId = '0';
  const fp = String(input.machineFp || '').trim();
  if (fp) {
    const device = await AppDataSource.getRepository(AccountDevice).findOneBy({
      accountId: account.id,
      machineFp: fp,
    });
    if (device) deviceId = device.id;
  }

  await repo.save(
    repo.create({
      accountId: account.id,
      enterpriseId: account.enterpriseId || '0',
      deviceId,
      envId,
      eventType: 'block',
      detail: String(input.detail || '').slice(0, 512) || null,
    })
  );
}
