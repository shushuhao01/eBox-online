import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/** 客户端代理商点击明细（客户端弹窗内点击「访问注册」时逐条记录） */
@Entity('client_agency_click')
export class ClientAgencyClick {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64, name: 'agency_id', default: '' })
  agencyId!: string;

  /** 点击时的代理商名称快照（代理商后续改名/下架后排行与明细仍可读） */
  @Column({ type: 'varchar', length: 64, name: 'agency_name', default: '' })
  agencyName!: string;

  @Column({ type: 'varchar', length: 64, name: 'click_id', default: '' })
  clickId!: string;

  @Index()
  @Column({ type: 'varchar', length: 200, default: '' })
  code!: string;

  @Index()
  @Column({ type: 'varchar', length: 32, name: 'machine_fp', default: '' })
  machineFp!: string;

  @Column({ type: 'varchar', length: 64, name: 'env_name', default: '' })
  envName!: string;

  @Column({ type: 'varchar', length: 32, name: 'app_version', default: '' })
  appVersion!: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  ip!: string;

  @Column({ type: 'varchar', length: 16, default: '' })
  country!: string;

  @Column({ type: 'varchar', length: 32, default: '' })
  province!: string;

  @Column({ type: 'varchar', length: 32, default: '' })
  city!: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  isp!: string;

  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  device!: string;

  @Column({ type: 'varchar', length: 32, default: '' })
  os!: string;

  @Column({ type: 'varchar', length: 32, default: '' })
  browser!: string;

  /** 客户端自报的系统平台（如 Windows），UA 不可解析时用于兜底展示 */
  @Column({ type: 'varchar', length: 64, name: 'client_os', default: '' })
  clientOs!: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  referer!: string;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', default: '' })
  userAgent!: string;

  @Index()
  @Column({ type: 'datetime', name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
}
