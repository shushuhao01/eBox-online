import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** 协议接受记录（用户协议 / 隐私协议 / 免责声明，含版本与设备指纹） */
@Entity('agreement_acceptances')
export class AgreementAcceptance {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'bigint', name: 'account_id', unsigned: true })
  accountId!: string;

  @Column({ type: 'varchar', length: 32, name: 'agreement_type', comment: 'user_agreement/privacy_policy/disclaimer' })
  agreementType!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 64, name: 'device_fp', default: '' })
  deviceFp!: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  ip!: string;

  @Column({ name: 'accepted_at', type: 'datetime' })
  acceptedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
