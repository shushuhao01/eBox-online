import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from './env';
import { User } from '../entities/User';
import { LicenseKey } from '../entities/LicenseKey';
import { Customer } from '../entities/Customer';
import { KeyCustomer } from '../entities/KeyCustomer';
import { Device } from '../entities/Device';
import { Heartbeat } from '../entities/Heartbeat';
import { UnbindLog } from '../entities/UnbindLog';
import { RevokeLog } from '../entities/RevokeLog';
import { OperationLog } from '../entities/OperationLog';
import { SystemConfig } from '../entities/SystemConfig';
import { KeyBatch } from '../entities/KeyBatch';
import { SiteSetting } from '../entities/SiteSetting';
import { SiteArticle } from '../entities/SiteArticle';
import { SiteCase } from '../entities/SiteCase';
import { SiteNav } from '../entities/SiteNav';
import { SiteContact } from '../entities/SiteContact';
import { SiteMedia } from '../entities/SiteMedia';
import { SiteDownloadMirror } from '../entities/SiteDownloadMirror';
import { SiteAccessRule } from '../entities/SiteAccessRule';
import { SiteStatsDaily } from '../entities/SiteStatsDaily';
import { SiteVisitLog } from '../entities/SiteVisitLog';
import { SiteOnline } from '../entities/SiteOnline';
import { SiteChannelLink } from '../entities/SiteChannelLink';
import { SiteChannelClick } from '../entities/SiteChannelClick';
import { SiteChannelStatsDaily } from '../entities/SiteChannelStatsDaily';
import { ClientAgencyClick } from '../entities/ClientAgencyClick';
import { Account } from '../entities/account/Account';
import { AccountSession } from '../entities/account/AccountSession';
import { AccountDevice } from '../entities/account/AccountDevice';
import { Enterprise } from '../entities/account/Enterprise';
import { EnterpriseMember } from '../entities/account/EnterpriseMember';
import { Sku } from '../entities/account/Sku';
import { IpResource } from '../entities/account/IpResource';
import { IpAssignment } from '../entities/account/IpAssignment';
import { IpPoolSetting } from '../entities/account/IpPoolSetting';
import { SeatAddon } from '../entities/account/SeatAddon';
import { UpgradeCode } from '../entities/account/UpgradeCode';
import { ProxyBlockEvent } from '../entities/account/ProxyBlockEvent';
import { AgreementAcceptance } from '../entities/account/AgreementAcceptance';
import { AppConfig } from '../entities/account/AppConfig';
import { NotificationTemplate } from '../entities/account/NotificationTemplate';
import { SystemMessage } from '../entities/account/SystemMessage';
import { MarketingCampaign } from '../entities/account/MarketingCampaign';
import { MarketingRecipient } from '../entities/account/MarketingRecipient';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: env.db.host,
  port: env.db.port,
  username: env.db.user,
  password: env.db.password,
  database: env.db.database,
  charset: 'utf8mb4',
  entities: [
    User, LicenseKey, Customer, KeyCustomer, Device,
    Heartbeat, UnbindLog, RevokeLog, OperationLog, SystemConfig, KeyBatch,
    SiteSetting, SiteArticle, SiteCase, SiteNav, SiteContact,
    SiteMedia, SiteDownloadMirror, SiteAccessRule, SiteStatsDaily,
    SiteVisitLog, SiteOnline,
    SiteChannelLink, SiteChannelClick, SiteChannelStatsDaily,
    ClientAgencyClick,
    Account, AccountSession, AccountDevice,
    Enterprise, EnterpriseMember, Sku,
    IpResource, IpAssignment, IpPoolSetting,
    SeatAddon, UpgradeCode, ProxyBlockEvent,
    AgreementAcceptance, AppConfig,
    NotificationTemplate, SystemMessage,
    MarketingCampaign, MarketingRecipient,
  ],
  synchronize: false, // 表结构由 database/schema.sql 管理，禁止自动同步
  logging: false,
  timezone: '+08:00',
  connectTimeout: 10000,
  maxQueryExecutionTime: 5000,
});

export async function initializeDatabase(): Promise<void> {
  await AppDataSource.initialize();
}
