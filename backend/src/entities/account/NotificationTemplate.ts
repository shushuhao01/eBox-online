import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * 消息模板
 * channels 为逗号分隔的渠道集合：DINGTALK / WECOM / EMAIL / SMS / SYSTEM
 * 占位符使用单花括号，如 {username}、{code}、{time}
 */
@Entity('notification_templates')
export class NotificationTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 64, unique: true })
  code!: string;

  @Column({ length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  category!: string | null;

  /** 受众：user=发给用户（收件人取用户邮箱/手机号），admin=发给管理员（取管理员收件配置） */
  @Column({ type: 'varchar', length: 16, default: 'user' })
  audience!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'varchar', length: 128, default: '' })
  channels!: string;

  @Column({ type: 'varchar', length: 64, name: 'sms_template_code', nullable: true })
  smsTemplateCode!: string | null;

  @Column({ type: 'tinyint', name: 'is_enabled', default: 1 })
  isEnabled!: number;

  @Column({ type: 'tinyint', name: 'auto_trigger', default: 1 })
  autoTrigger!: number;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
