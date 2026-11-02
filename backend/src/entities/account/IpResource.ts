import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * IP 资源（用户自行导入；平台不预置）
 * scope=1 个人池，owner_account_id 为属主；scope=2 企业池，enterprise_id 为归属。
 * 未使用的归属字段以 0 表示（保证唯一键生效）。
 */
@Entity('ip_resources')
export class IpResource {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'tinyint', default: 1, comment: '1=个人池 2=企业池' })
  scope!: number;

  @Column({ type: 'bigint', name: 'owner_account_id', unsigned: true, default: 0 })
  ownerAccountId!: string;

  @Column({ type: 'bigint', name: 'enterprise_id', unsigned: true, default: 0 })
  enterpriseId!: string;

  @Column({ type: 'varchar', length: 8, name: 'proxy_type', default: 'socks5', comment: 'socks5/http' })
  proxyType!: string;

  @Column({ length: 128 })
  host!: string;

  @Column({ type: 'int' })
  port!: number;

  @Column({ type: 'varchar', length: 128, default: '' })
  username!: string;

  @Column({ type: 'varchar', length: 512, name: 'password_enc', default: '', comment: 'AES-256-GCM 密文' })
  passwordEnc!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=启用 2=停用' })
  status!: number;

  @Column({ type: 'tinyint', default: 1, comment: '1=未测 2=正常 3=异常' })
  health!: number;

  @Column({ type: 'int', name: 'latency_ms', nullable: true })
  latencyMs!: number | null;

  @Column({ name: 'last_check_at', type: 'datetime', nullable: true })
  lastCheckAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
