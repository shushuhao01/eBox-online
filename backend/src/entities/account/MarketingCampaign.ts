import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * 营销邮件活动
 * audience_type：ALL_USERS 全部注册用户（有邮箱）/ USER_IDS 指定账号 / EMAILS 指定邮箱
 * status：DRAFT 草稿 / SCHEDULED 定时中 / SENT 已发送
 * target_json：受众明细 JSON 数组，USER_IDS → ["账号或邮箱", ...]，EMAILS → ["a@b.com", ...]
 */
@Entity('marketing_campaigns')
export class MarketingCampaign {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 255 })
  title!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject!: string | null;

  @Column({ type: 'mediumtext', nullable: true })
  content!: string | null;

  @Column({ type: 'varchar', length: 32, name: 'audience_type', default: 'ALL_USERS' })
  audienceType!: string;

  @Column({ type: 'text', name: 'target_json', nullable: true })
  targetJson!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'DRAFT' })
  status!: string;

  @Column({ type: 'int', name: 'sent_count', default: 0 })
  sentCount!: number;

  @Column({ type: 'int', name: 'failed_count', default: 0 })
  failedCount!: number;

  @Column({ name: 'send_at', type: 'datetime', nullable: true })
  sendAt!: Date | null;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
