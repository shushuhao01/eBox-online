import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** 断网保护触发事件（团队仪表盘统计） */
@Entity('proxy_block_events')
export class ProxyBlockEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'bigint', name: 'account_id', unsigned: true, default: 0 })
  accountId!: string;

  @Column({ type: 'bigint', name: 'enterprise_id', unsigned: true, default: 0 })
  enterpriseId!: string;

  @Column({ type: 'bigint', name: 'device_id', unsigned: true, default: 0 })
  deviceId!: string;

  @Column({ type: 'varchar', length: 64, name: 'env_id', default: '' })
  envId!: string;

  @Column({ type: 'varchar', length: 32, name: 'event_type', default: 'block' })
  eventType!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  detail!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
