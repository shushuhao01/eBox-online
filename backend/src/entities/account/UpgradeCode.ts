import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** 升级/续费码（预留：套餐升级核销） */
@Entity('upgrade_codes')
export class UpgradeCode {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 64, unique: true })
  code!: string;

  @Column({ type: 'bigint', name: 'from_sku_id', unsigned: true, nullable: true })
  fromSkuId!: string | null;

  @Column({ type: 'bigint', name: 'to_sku_id', unsigned: true, nullable: true })
  toSkuId!: string | null;

  /** 升级目标时长档位（价格 SKU 已移除，升级码只按档位生成） */
  @Column({ type: 'varchar', length: 16, nullable: true, comment: '升级目标时长档位 month/quarter/year/permanent' })
  duration!: string | null;

  @Column({ type: 'bigint', name: 'account_id', unsigned: true, nullable: true, comment: '核销时锁定' })
  accountId!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, comment: '订单金额（元，仅记录）' })
  amount!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=未使用 2=已使用 3=作废' })
  status!: number;

  @Column({ name: 'valid_until', type: 'datetime', nullable: true })
  validUntil!: Date | null;

  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt!: Date | null;

  @Column({ type: 'bigint', name: 'used_by', unsigned: true, nullable: true })
  usedBy!: string | null;

  @Column({ type: 'bigint', name: 'created_by', unsigned: true, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
