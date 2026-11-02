import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('license_keys')
export class LicenseKey {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 200, unique: true })
  code!: string;

  @Column({ length: 64, name: 'code_fp', unique: true })
  codeFp!: string;

  @Column({ type: 'tinyint', default: 1, comment: '1=库存(时长制) 2=换机(绝对到期)' })
  type!: number;

  @Column({ type: 'bigint', name: 'duration_sec', default: 0, comment: '时长制有效秒数，0=永久' })
  durationSec!: string;

  @Column({ type: 'bigint', name: 'expire_at', nullable: true, comment: '换机码绝对到期时间戳(Unix秒)' })
  expireAt!: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=绑定 0=通用' })
  bound!: number;

  @Column({ type: 'smallint', name: 'unbind_max', default: 3, comment: '-1=不限 0=禁止 n=每月n次' })
  unbindMax!: number;

  @Column({ type: 'tinyint', default: 0, comment: '0=未用 1=已用 2=作废 3=过期 4=已换机' })
  status!: number;

  @Column({ type: 'bigint', name: 'batch_id', nullable: true })
  batchId!: string | null;

  @Column({ type: 'bigint', name: 'customer_id', nullable: true })
  customerId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;

  @Column({ type: 'bigint', name: 'created_by' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'bigint', name: 'revoked_by', nullable: true })
  revokedBy!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'revoked_reason', nullable: true })
  revokedReason!: string | null;

  @Column({ type: 'bigint', name: 'convert_from_key_id', nullable: true })
  convertFromKeyId!: string | null;

  // ===== 账号体系增量字段（可空/带默认值，兼容存量卡密） =====
  @Column({ type: 'bigint', name: 'account_id', unsigned: true, nullable: true })
  accountId!: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=个人 2=企业' })
  tier!: number;

  @Column({ type: 'tinyint', default: 1, comment: '1=普通 2=高级' })
  level!: number;

  @Column({ type: 'bigint', name: 'sku_id', unsigned: true, nullable: true })
  skuId!: string | null;

  @Column({ type: 'varchar', length: 32, name: 'tier_code', nullable: true })
  tierCode!: string | null;

  @Column({ type: 'int', name: 'duration_days', default: 0, comment: '0=永久' })
  durationDays!: number;

  @Column({ type: 'int', default: 1, comment: '同时在线设备/子账户席位' })
  seats!: number;

  @Column({ type: 'bigint', name: 'enterprise_id', unsigned: true, nullable: true })
  enterpriseId!: string | null;

  @Column({ name: 'activated_at', type: 'datetime', nullable: true })
  activatedAt!: Date | null;

  @Column({ name: 'account_expire_at', type: 'datetime', nullable: true, comment: '账号体系续费顺延后的权威到期时间' })
  accountExpireAt!: Date | null;

  @Column({ type: 'bigint', name: 'replaced_by', unsigned: true, nullable: true, comment: '被哪张卡密覆盖升级' })
  replacedBy!: string | null;
}
