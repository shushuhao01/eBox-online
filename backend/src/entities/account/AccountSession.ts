import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** 账号会话（token 仅存哈希，支持吊销） */
@Entity('account_sessions')
export class AccountSession {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'bigint', name: 'account_id', unsigned: true })
  accountId!: string;

  @Column({ length: 64, name: 'token_hash', unique: true })
  tokenHash!: string;

  @Column({ type: 'varchar', length: 64, name: 'machine_fp', nullable: true })
  machineFp!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'client_ip', nullable: true })
  clientIp!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  @Column({ name: 'last_seen_at', type: 'datetime', nullable: true })
  lastSeenAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
