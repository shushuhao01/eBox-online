import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 64, unique: true })
  username!: string;

  @Column({ length: 128, name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  nickname!: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=超管 0=普通' })
  role!: number;

  @Column({ type: 'tinyint', default: 1, comment: '1=启用 0=停用' })
  status!: number;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ type: 'varchar', name: 'last_login_ip', length: 64, nullable: true })
  lastLoginIp!: string | null;

  /** 令牌版本：改密 / 退出登录时自增，旧 JWT 立即失效 */
  @Column({ type: 'int', name: 'token_version', default: 0 })
  tokenVersion!: number;

  /** 连续登录失败次数（成功登录后清零） */
  @Column({ type: 'int', name: 'lock_count', default: 0 })
  lockCount!: number;

  /** 锁定截止时间（为空表示未锁定） */
  @Column({ type: 'datetime', name: 'locked_until', nullable: true })
  lockedUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
