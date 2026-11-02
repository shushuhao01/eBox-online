import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

/** 账号体系配置（商城升级链接、免责声明版本等） */
@Entity('app_configs')
export class AppConfig {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 64, name: 'cfg_key', unique: true })
  cfgKey!: string;

  @Column({ type: 'text', name: 'cfg_value', nullable: true })
  cfgValue!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
