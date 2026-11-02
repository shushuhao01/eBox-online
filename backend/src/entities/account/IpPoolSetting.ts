import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * IP 资源池存储模式设置。
 * owner_type=1 个人（owner_id=accountId），2 企业（owner_id=enterpriseId）。
 * 企业池强制 storage_mode=1（持久化）。
 */
@Entity('ip_pool_settings')
export class IpPoolSetting {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'tinyint', name: 'owner_type', comment: '1=个人 2=企业' })
  ownerType!: number;

  @Column({ type: 'bigint', name: 'owner_id', unsigned: true })
  ownerId!: string;

  @Column({ type: 'tinyint', name: 'storage_mode', default: 1, comment: '1=持久化 2=仅本机' })
  storageMode!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
