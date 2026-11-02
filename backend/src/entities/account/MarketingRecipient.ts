import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/**
 * 营销邮件收件人快照
 * 发送时按受众解析后逐条落库，用于「发送用户」弹窗与送达/打开统计。
 * token 仅用于打开追踪像素（1x1 GIF），不承载业务语义。
 */
@Entity('marketing_recipients')
@Index('idx_marketing_recipients_campaign', ['campaignId'])
export class MarketingRecipient {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'bigint', name: 'campaign_id', unsigned: true })
  campaignId!: string;

  @Column({ length: 128 })
  email!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  token!: string | null;

  @Column({ type: 'tinyint', default: 0, comment: '1=已投递' })
  delivered!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error!: string | null;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'opened_at', type: 'datetime', nullable: true })
  openedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
