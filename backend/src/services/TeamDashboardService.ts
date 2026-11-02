import { AppDataSource } from '../config/database';
import { Enterprise } from '../entities/account/Enterprise';

/**
 * 团队仪表盘（M5）
 * 数据来源：
 *  - 成员 / 在线：enterprise_members + accounts + account_devices.last_active_at
 *  - 环境数：客户端心跳上报的 account_devices.env_total / env_running
 *  - IP：ip_resources（企业池） + ip_assignments（已分配 / 使用中）
 *  - 断网：proxy_block_events 按日聚合
 *  - 趋势：team_metrics_daily 日快照（环境数无法回溯，按日 upsert）
 */

const ONLINE_WINDOW_MS = 30 * 60 * 1000;

export interface TeamRankingItem {
  accountId: string;
  login: string;
  nickname: string | null;
  online: boolean;
  lastActiveAt: string | null;
  envTotal: number;
  envRunning: number;
}

export interface TeamSummary {
  members: { total: number; online: number; seats: number; usedSeats: number };
  env: { total: number; running: number };
  ip: { total: number; assigned: number; inUse: number; idle: number; disabled: number };
  block: { last7d: number };
  ranking: TeamRankingItem[];
}

export interface TeamTrendPoint {
  date: string;
  envTotal: number;
  envRunning: number;
  memberOnline: number;
  blockCount: number;
}

interface MemberAggRow {
  accountId: string;
  login: string;
  nickname: string | null;
  lastActiveAt: string | Date | null;
  envTotal: number | string;
  envRunning: number | string;
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeDate(value: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function loadMemberAgg(enterpriseId: string): Promise<MemberAggRow[]> {
  return AppDataSource.query(
    `SELECT m.account_id AS accountId, a.login AS login, a.nickname AS nickname,
            MAX(d.last_active_at) AS lastActiveAt,
            COALESCE(SUM(d.env_total), 0) AS envTotal,
            COALESCE(SUM(d.env_running), 0) AS envRunning
       FROM enterprise_members m
       JOIN accounts a ON a.id = m.account_id
       LEFT JOIN account_devices d ON d.account_id = a.id AND d.status = 1
      WHERE m.enterprise_id = ? AND m.status = 1
      GROUP BY m.account_id, a.login, a.nickname`,
    [enterpriseId]
  );
}

async function loadIpStats(enterpriseId: string): Promise<TeamSummary['ip']> {
  const resourceRows: Array<{ total: number | string; disabled: number | string; enabled: number | string }> =
    await AppDataSource.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 2), 0) AS disabled,
              COALESCE(SUM(status = 1), 0) AS enabled
         FROM ip_resources
        WHERE scope = 2 AND enterprise_id = ?`,
      [enterpriseId]
    );
  const assignRows: Array<{ assigned: number | string; inUse: number | string }> = await AppDataSource.query(
    `SELECT COALESCE(SUM(ia.status = 1), 0) AS assigned,
            COALESCE(SUM(ia.status = 2), 0) AS inUse
       FROM ip_assignments ia
       JOIN ip_resources r ON r.id = ia.resource_id
      WHERE ia.enterprise_id = ? AND ia.status IN (1, 2)`,
    [enterpriseId]
  );
  const total = Number(resourceRows[0]?.total || 0);
  const disabled = Number(resourceRows[0]?.disabled || 0);
  const enabled = Number(resourceRows[0]?.enabled || 0);
  const assigned = Number(assignRows[0]?.assigned || 0);
  const inUse = Number(assignRows[0]?.inUse || 0);
  return {
    total,
    assigned,
    inUse,
    idle: Math.max(0, enabled - assigned - inUse),
    disabled,
  };
}

async function loadBlockCount(enterpriseId: string, since: Date): Promise<number> {
  const rows: Array<{ c: number | string }> = await AppDataSource.query(
    'SELECT COUNT(*) AS c FROM proxy_block_events WHERE enterprise_id = ? AND created_at >= ?',
    [enterpriseId, since]
  );
  return Number(rows[0]?.c || 0);
}

async function upsertTodaySnapshot(
  enterpriseId: string,
  members: TeamSummary['members'],
  env: TeamSummary['env'],
  blockCount: number
): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO team_metrics_daily
       (enterprise_id, stat_date, member_total, member_online, env_total, env_running, block_count)
     VALUES (?, CURDATE(), ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       member_total = VALUES(member_total),
       member_online = VALUES(member_online),
       env_total = VALUES(env_total),
       env_running = VALUES(env_running),
       block_count = VALUES(block_count)`,
    [enterpriseId, members.total, members.online, env.total, env.running, blockCount]
  );
}

export async function getTeamSummary(enterprise: Enterprise): Promise<TeamSummary> {
  const now = Date.now();
  const rows = await loadMemberAgg(enterprise.id);
  let online = 0;
  let envTotal = 0;
  let envRunning = 0;
  const ranking: TeamRankingItem[] = rows.map((r) => {
    const lastActive = normalizeDate(r.lastActiveAt);
    const ts = lastActive ? new Date(lastActive).getTime() : 0;
    const isOnline = !!ts && now - ts <= ONLINE_WINDOW_MS;
    const memberEnvTotal = Number(r.envTotal || 0);
    const memberEnvRunning = Number(r.envRunning || 0);
    if (isOnline) online += 1;
    envTotal += memberEnvTotal;
    envRunning += memberEnvRunning;
    return {
      accountId: String(r.accountId),
      login: r.login || '',
      nickname: r.nickname || null,
      online: isOnline,
      lastActiveAt: lastActive,
      envTotal: memberEnvTotal,
      envRunning: memberEnvRunning,
    };
  });
  ranking.sort((a, b) => {
    if (b.envRunning !== a.envRunning) return b.envRunning - a.envRunning;
    if (b.envTotal !== a.envTotal) return b.envTotal - a.envTotal;
    return String(b.lastActiveAt || '').localeCompare(String(a.lastActiveAt || ''));
  });

  const members = {
    total: rows.length,
    online,
    seats: enterprise.seats,
    usedSeats: rows.length,
  };
  const env = { total: envTotal, running: envRunning };
  const ip = await loadIpStats(enterprise.id);
  const last7d = await loadBlockCount(enterprise.id, new Date(now - 7 * 24 * 3600 * 1000));
  await upsertTodaySnapshot(enterprise.id, members, env, last7d);

  return {
    members,
    env,
    ip,
    block: { last7d },
    ranking: ranking.slice(0, 20),
  };
}

export async function getTeamTrend(enterprise: Enterprise, days: number): Promise<TeamTrendPoint[]> {
  const span = days === 30 ? 30 : 7;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (span - 1));
  const startDate = toDateString(start);

  // 确保今天有快照，趋势末点与 summary 一致
  await getTeamSummary(enterprise);

  const snapshotRows: Array<{
    stat_date: string;
    env_total: number | string;
    env_running: number | string;
    member_online: number | string;
  }> = await AppDataSource.query(
    `SELECT DATE_FORMAT(stat_date, '%Y-%m-%d') AS stat_date,
            env_total, env_running, member_online
       FROM team_metrics_daily
      WHERE enterprise_id = ? AND stat_date >= ?`,
    [enterprise.id, startDate]
  );
  const snapshotMap = new Map(
    snapshotRows.map((r) => [
      String(r.stat_date),
      {
        envTotal: Number(r.env_total || 0),
        envRunning: Number(r.env_running || 0),
        memberOnline: Number(r.member_online || 0),
      },
    ])
  );

  const blockRows: Array<{ day: string; c: number | string }> = await AppDataSource.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS c
       FROM proxy_block_events
      WHERE enterprise_id = ? AND created_at >= ?
      GROUP BY day`,
    [enterprise.id, startDate]
  );
  const blockMap = new Map(blockRows.map((r) => [String(r.day), Number(r.c || 0)]));

  const points: TeamTrendPoint[] = [];
  const cursor = new Date(start);
  for (let i = 0; i < span; i++) {
    const date = toDateString(cursor);
    const snap = snapshotMap.get(date);
    points.push({
      date,
      envTotal: snap?.envTotal || 0,
      envRunning: snap?.envRunning || 0,
      memberOnline: snap?.memberOnline || 0,
      blockCount: blockMap.get(date) || 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}
