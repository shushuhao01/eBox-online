import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** 账号设备（同机重装不增加槽位） */
@Entity('account_devices')
export class AccountDevice {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'bigint', name: 'account_id', unsigned: true })
  accountId!: string;

  @Column({ length: 64, name: 'machine_fp' })
  machineFp!: string;

  @Column({ type: 'varchar', length: 128, name: 'device_name', nullable: true })
  deviceName!: string | null;

  @Column({ type: 'varchar', length: 128, name: 'os_info', nullable: true })
  osInfo!: string | null;

  @Column({ type: 'varchar', length: 32, name: 'app_version', nullable: true })
  appVersion!: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=正常 0=已移除' })
  status!: number;

  @Column({ name: 'first_login_at', type: 'datetime', nullable: true })
  firstLoginAt!: Date | null;

  @Column({ name: 'last_active_at', type: 'datetime', nullable: true })
  lastActiveAt!: Date | null;

  /** 设备上报的环境总数（心跳携带，M5 团队仪表盘统计） */
  @Column({ name: 'env_total', type: 'int', default: 0 })
  envTotal!: number;

  /** 设备上报的运行中环境数（心跳携带） */
  @Column({ name: 'env_running', type: 'int', default: 0 })
  envRunning!: number;

  /** 设备当前绑定的 IP 资源 id 列表（心跳携带，服务端校验归属后保存） */
  @Column({ name: 'bound_resource_ids', type: 'simple-json', nullable: true })
  boundResourceIds!: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
