import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** 站内信（通知模板触发时写入，管理端可查看/标记已读） */
@Entity('system_messages')
export class SystemMessage {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  category!: string | null;

  @Column({ type: 'tinyint', name: 'is_read', default: 0 })
  isRead!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
