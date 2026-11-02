import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * IP 分配与绑定（每个资源保留一行，重新分配时复用该行，保证 resource_id 唯一）。
 */
@Entity('ip_assignments')
export class IpAssignment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'bigint', name: 'resource_id', unsigned: true, unique: true })
  resourceId!: string;

  @Column({ type: 'bigint', name: 'enterprise_id', unsigned: true, default: 0 })
  enterpriseId!: string;

  @Column({ type: 'bigint', name: 'member_account_id', unsigned: true })
  memberAccountId!: string;

  @Column({ type: 'bigint', name: 'assigned_by', unsigned: true, default: 0 })
  assignedBy!: string;

  @Column({ type: 'tinyint', name: 'plaintext_visible', default: 0 })
  plaintextVisible!: number;

  @Column({ type: 'varchar', length: 64, name: 'env_id', nullable: true })
  envId!: string | null;

  @Column({ type: 'varchar', length: 128, name: 'env_name', nullable: true })
  envName!: string | null;

  @Column({ name: 'bound_at', type: 'datetime', nullable: true })
  boundAt!: Date | null;

  @Column({ name: 'released_at', type: 'datetime', nullable: true })
  releasedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, name: 'release_reason', nullable: true })
  releaseReason!: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=已分配 2=使用中 3=已回收' })
  status!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
