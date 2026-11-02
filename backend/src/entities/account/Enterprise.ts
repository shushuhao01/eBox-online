import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** 企业（由企业卡密激活自动创建） */
@Entity('enterprises')
export class Enterprise {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ length: 8, unique: true, comment: '8位企业码（去 O/0/I/1）' })
  code!: string;

  @Column({ length: 6, name: 'code_prefix', unique: true, comment: '前6位全局唯一，用于子账户账号' })
  codePrefix!: string;

  @Column({ length: 128 })
  name!: string;

  @Column({ type: 'bigint', name: 'owner_account_id', unsigned: true })
  ownerAccountId!: string;

  @Column({ type: 'int', default: 1, comment: '席位总数（只增不减）' })
  seats!: number;

  @Column({ type: 'bigint', name: 'sku_id', unsigned: true, nullable: true })
  skuId!: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=正常 2=停用 3=到期' })
  status!: number;

  @Column({ name: 'expire_at', type: 'datetime', nullable: true })
  expireAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
