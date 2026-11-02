import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** 套餐 SKU（个人/企业 × 普通/高级 × 月/季/年/永久） */
@Entity('skus')
export class Sku {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 32, unique: true })
  code!: string;

  @Column({ type: 'tinyint', comment: '1=个人 2=企业' })
  version!: number;

  @Column({ type: 'tinyint', comment: '1=普通 2=高级' })
  level!: number;

  @Column({ length: 16, comment: 'month/quarter/year/permanent' })
  duration!: string;

  @Column({ type: 'int', name: 'duration_days', default: 0, comment: '0=永久' })
  durationDays!: number;

  @Column({ length: 64 })
  label!: string;

  @Column({ type: 'int', default: 1 })
  seats!: number;

  @Column({ type: 'varchar', length: 512, name: 'mall_url', nullable: true })
  mallUrl!: string | null;

  /** 能力覆盖（JSON，可空；空则由 version+level 推导） */
  @Column({ type: 'text', name: 'caps_json', nullable: true })
  capsJson!: string | null;

  @Column({ type: 'tinyint', default: 1 })
  enabled!: number;

  @Column({ type: 'int', default: 0 })
  sort!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
