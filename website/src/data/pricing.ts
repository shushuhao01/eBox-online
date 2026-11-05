export interface PricingPlan {
  name: string
  price: string
  unit: string
  meta: string
  desc: string
  features: string[]
  featured?: boolean
  cta: string
  to: string
  external?: boolean
}

export const plans: PricingPlan[] = [
  {
    name: '普通版',
    price: '9.9',
    unit: '元起 / 月',
    meta: '季卡 29.9 元 · 年卡 59.9 元 · 永久 89.9 元',
    desc: '适合单账号日常多开，先把环境隔离用起来。',
    features: ['不限多开环境数量', '环境独立隔离，互不干扰', '免扫码自动登录', '系统看板与全盘清理'],
    cta: '立即购买',
    to: 'purchase',
    external: true,
  },
  {
    name: '高级版',
    price: '29.9',
    unit: '元 / 月',
    meta: '季卡 89.9 元 · 年卡 179.9 元 · 永久 269.9 元',
    desc: '适合个人多账号运营，每个环境都能走独立出口。',
    features: [
      '包含普通版全部能力',
      '网络出口代理（socks5 / http）',
      '个人 IP 资源池',
      '独立 IP 绑定到指定环境',
    ],
    cta: '立即购买',
    to: 'purchase',
    external: true,
  },
  {
    name: '企业版',
    price: '299.9',
    unit: '元起 / 月',
    meta: '含 10 个席位 · 管理员占 1 席 · 支持按需扩容',
    desc: '适合团队协作，统一管理成员、席位与企业 IP 池。',
    features: [
      '包含高级版全部能力',
      '团队面板与仪表盘',
      '子账户、停用与密码管理',
      '企业 IP 资源池与分配回收',
      '席位数按需扩容（+5 / +10 / +20 / +50）',
    ],
    featured: true,
    cta: '咨询企业采购',
    to: '/contact',
  },
]

export interface EntitlementRow {
  name: string
  normal: string
  pro: string
  enterprise: string
  member: string
}

export const entitlementRows: EntitlementRow[] = [
  { name: '席位数量', normal: '1', pro: '1', enterprise: '10 席起，按需加购', member: '占用企业席位' },
  { name: '多开环境', normal: '不限', pro: '不限', enterprise: '不限', member: '不限' },
  { name: '环境隔离', normal: '✓', pro: '✓', enterprise: '✓', member: '✓' },
  { name: '网络出口代理', normal: '—', pro: '✓', enterprise: '✓', member: '✓' },
  { name: 'IP 资源池', normal: '—', pro: '个人池', enterprise: '企业池', member: '—' },
  { name: '选择使用 IP', normal: '—', pro: '自己的资源', enterprise: '管理员分配', member: '按管理员分配' },
  { name: '分配 / 回收 IP', normal: '—', pro: '—', enterprise: '仅管理员', member: '—' },
  { name: '团队面板', normal: '—', pro: '—', enterprise: '✓', member: '受管理员管理' },
  {
    name: '价格（月卡）',
    normal: '9.9 元起',
    pro: '29.9 元',
    enterprise: '299.9 元起（含 10 席）',
    member: '—',
  },
]

export const upgradePacks = [
  { card: '月卡', price: '20 元', note: '等同差价，随时升级' },
  { card: '季卡', price: '40 元', note: '约为差价的 6.7 折' },
  { card: '年卡', price: '60 元', note: '约为差价的 5 折' },
  { card: '永久', price: '80 元', note: '约为差价的 4.4 折' },
]

export const seatPacks = [
  { seats: '+5 席', price: '300 元', unit: '60 元 / 席' },
  { seats: '+10 席', price: '550 元', unit: '55 元 / 席' },
  { seats: '+20 席', price: '1,000 元', unit: '50 元 / 席' },
  { seats: '+50 席', price: '2,250 元', unit: '45 元 / 席' },
]

export const pricingFaqs = [
  {
    q: '价格会和商城不一致吗？',
    a: '本页为官方指导价，实际成交价以商城商品页为准；大促期间可能有活动价。',
  },
  {
    q: '换电脑或重装系统后，权益还在吗？',
    a: '在。4.0 起卡密绑定账号，登录同一账号即可恢复权益，不需要重新购买。',
  },
  {
    q: '企业版为什么要先登录再激活？',
    a: '企业卡激活时需要由账号侧创建企业并分配席位，未登录会提示「企业版需登录账号后激活」。',
  },
  {
    q: '升级码会延长到期时间吗？',
    a: '不会。升级码只把个人普通版提升为高级版，时长与到期日保持不变。',
  },
  {
    q: '扩容码可以退，或者把席位减回去吗？',
    a: '不可以。席位只增不减，删除成员只释放席位，不退回已购额度；永久企业卡不支持扩容。',
  },
]
