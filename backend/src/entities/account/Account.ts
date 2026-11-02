import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * 账号（身份主体）
 * login 全局唯一：个人为手机号/邮箱，子账户为 `企业码前6位-序号`。
 */
@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 64, unique: true })
  login!: string;

  @Column({ length: 128, name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  nickname!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=正常 2=停用 3=锁定' })
  status!: number;

  @Column({ type: 'int', name: 'lock_count', default: 0, comment: '连续密码错误次数' })
  lockCount!: number;

  @Column({ name: 'locked_until', type: 'datetime', nullable: true })
  lockedUntil!: Date | null;

  @Column({ type: 'tinyint', name: 'ever_enterprise', default: 0, comment: '曾经是企业版（不可回退个人）' })
  everEnterprise!: number;

  @Column({ type: 'tinyint', default: 1, comment: '1=个人 2=企业管理员 3=企业成员' })
  role!: number;

  @Column({ type: 'bigint', name: 'enterprise_id', unsigned: true, nullable: true })
  enterpriseId!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'reset_code_hash', nullable: true })
  resetCodeHash!: string | null;

  @Column({ name: 'reset_code_expire', type: 'datetime', nullable: true })
  resetCodeExpire!: Date | null;

  @Column({ type: 'int', name: 'reset_code_attempts', default: 0 })
  resetCodeAttempts!: number;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ type: 'varchar', length: 64, name: 'last_login_ip', nullable: true })
  lastLoginIp!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
