import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** 席位扩容码（只增不减，到期跟随企业当前生效卡密） */
@Entity('seat_addons')
export class SeatAddon {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 64, unique: true })
  code!: string;

  @Column({ type: 'int', name: 'seat_delta' })
  seatDelta!: number;

  @Column({ type: 'bigint', name: 'enterprise_id', unsigned: true, nullable: true, comment: '核销时锁定' })
  enterpriseId!: string | null;

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
