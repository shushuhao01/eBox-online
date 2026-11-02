import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** 企业成员（含 1 个管理员） */
@Entity('enterprise_members')
export class EnterpriseMember {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'bigint', name: 'enterprise_id', unsigned: true })
  enterpriseId!: string;

  @Column({ type: 'bigint', name: 'account_id', unsigned: true })
  accountId!: string;

  @Column({ type: 'tinyint', default: 2, comment: '1=管理员 2=成员' })
  role!: number;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '配置/提示词：姓名、工号、机器名等' })
  hint!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=正常 2=停用 3=注销' })
  status!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt!: Date | null;
}
