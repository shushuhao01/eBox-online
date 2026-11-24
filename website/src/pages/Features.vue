<template>
  <div class="features">
    <section class="page-hero">
      <div class="container">
        <h1 class="page-title">功能介绍</h1>
        <p class="page-sub">{{ siteName }} 为需要在同一台电脑上运行多个应用实例的个人与团队设计：正式版覆盖办公、多账号运营与团队协作；游戏版包含正式版全部能力，并针对游戏多开增强隔离与稳定性。</p>
      </div>
    </section>

    <!-- 版本能力 -->
    <section class="section">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">正式版与游戏版，能力一脉相承</h2>
          <p class="section-sub">
            两个版本独立发版、可同时安装。游戏版包含正式版全部能力，并针对游戏多开再做增强。
          </p>
        </div>

        <div class="edition-grid">
          <div class="card edition-card">
            <div class="edition-head">
              <span class="edition-tag">正式版</span>
              <span class="edition-file">eBox.exe</span>
            </div>
            <h3 class="edition-title">办公、多账号运营与团队协作</h3>
            <p class="edition-desc">日常办公与运营场景的标准版本，轻量环境隔离即可覆盖大多数需求。</p>
            <ul class="edition-list">
              <li>环境独立隔离，免虚拟机，资源占用低</li>
              <li>免扫码自动登录，账号卡密跨设备恢复</li>
              <li>团队面板、成员席位与独立 IP 资源池</li>
              <li>系统状态看板、垃圾清理等内置工具</li>
            </ul>
            <div class="edition-actions">
              <RouterLink class="btn btn-primary" to="/download">下载正式版</RouterLink>
              <RouterLink class="btn btn-ghost" to="/pricing">查看定价</RouterLink>
            </div>
          </div>

          <div class="card edition-card edition-game">
            <div class="edition-head">
              <span class="edition-tag">游戏版</span>
              <span class="edition-file">eBoxGame.exe</span>
            </div>
            <h3 class="edition-title">正式版全部能力 + 游戏增强</h3>
            <p class="edition-desc">面向游戏多开与账号分组运营，在正式版能力之上进一步强化。</p>
            <ul class="edition-list">
              <li>包含正式版全部能力，办公与团队功能同样可用</li>
              <li>游戏场景优化：启动、切换更顺畅，长时间挂机更稳</li>
              <li>轻量隔离 + 内置虚拟机，整机级隔离更强、更隔绝</li>
              <li>独立更新通道，与正式版互不影响、可同时安装</li>
            </ul>
            <div class="edition-actions">
              <RouterLink class="btn btn-primary" to="/game">下载游戏版</RouterLink>
              <RouterLink class="btn btn-ghost" to="/game-intro">了解游戏版</RouterLink>
            </div>
          </div>
        </div>

        <div class="compare-wrap">
          <table class="compare">
            <thead>
              <tr>
                <th class="compare-item-col">能力对照</th>
                <th>正式版</th>
                <th class="highlight">游戏版</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in editionRows" :key="row.name">
                <td class="compare-name">{{ row.name }}</td>
                <td>{{ row.formal }}</td>
                <td class="highlight">{{ row.game }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div v-for="group in groups" :key="group.title" class="feature-group">
          <div class="group-head">
            <h2 class="group-title">{{ group.title }}</h2>
            <p class="group-sub">{{ group.sub }}</p>
          </div>
          <div class="grid grid-3">
            <div v-for="item in group.items" :key="item.title" class="card feature-card">
              <div class="feature-icon">{{ item.icon }}</div>
              <h3 class="feature-title">{{ item.title }}</h3>
              <p class="feature-desc">{{ item.desc }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <BrandWall
      title="支持多开的电脑客户端应用"
      subtitle="以下应用均提供 Windows 客户端，都能创建多个独立环境同时运行。"
      grouped
    />

    <section class="section section-soft">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">使用流程</h2>
          <p class="section-sub">五步完成部署，无需复杂配置。</p>
        </div>
        <div class="steps">
          <div v-for="(step, index) in steps" :key="step.title" class="step">
            <div class="step-index">{{ index + 1 }}</div>
            <h3 class="step-title">{{ step.title }}</h3>
            <p class="step-desc">{{ step.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container center">
        <h2 class="section-title">准备开始了吗？</h2>
        <p class="section-sub">下载安装包，立即体验环境隔离带来的多开便利。</p>
        <div class="cta-actions">
          <RouterLink class="btn btn-primary btn-lg" to="/download">免费下载</RouterLink>
          <RouterLink class="btn btn-ghost btn-lg" to="/pricing">查看定价</RouterLink>
          <RouterLink class="btn btn-ghost btn-lg" to="/docs">查看使用手册</RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import BrandWall from '@/components/BrandWall.vue'
import { useSite } from '@/composables/useSite'
import { usePageHead } from '@/composables/usePageHead'

const { siteName } = useSite()
usePageHead(
  '功能介绍',
  '了解 eBox 正式版与游戏版的功能：环境隔离、账号权益同步、团队面板、成员席位、独立 IP 资源池；游戏版包含正式版全部能力，并增强游戏隔离与稳定性。',
)

// 正式版 / 游戏版能力对照
const editionRows = [
  { name: '环境隔离', formal: '轻量环境隔离', game: '轻量隔离 + 内置虚拟机，更强、更隔绝' },
  { name: '游戏场景优化', formal: '—', game: '启动、切换更顺畅，长时间挂机更稳' },
  { name: '账号与自动登录', formal: '支持', game: '同正式版，完整支持' },
  { name: '团队面板与独立 IP', formal: '支持', game: '同正式版，完整支持' },
  { name: '系统工具', formal: '状态看板、垃圾清理等', game: '同正式版，完整支持' },
  { name: '更新通道', formal: '独立版本号与更新源', game: '独立版本号与更新源' },
  { name: '安装包', formal: 'eBox.exe', game: 'eBoxGame.exe' },
]

const groups = [
  {
    title: '核心能力',
    sub: '围绕环境隔离打造的多开能力，稳定且易用。',
    items: [
      { icon: '🔒', title: '环境独立隔离', desc: '每个环境拥有独立的运行空间，配置与数据互不干扰，避免相互影响。' },
      { icon: '⚡', title: '免扫码自动登录', desc: '环境登录状态可保存复用，省去反复扫码的繁琐步骤。' },
      { icon: '🧩', title: '可视化管理', desc: '以卡片方式展示所有环境，启动、停止与状态查看一目了然。' },
      { icon: '🪶', title: '轻量低占用', desc: '无需虚拟机，资源占用低，多个环境同时运行依然流畅。' },
      { icon: '🗂️', title: '数据集中管理', desc: '所有环境的数据统一存放，便于备份、迁移与维护。' },
      { icon: '🔄', title: '在线更新', desc: '支持在线检查并更新到最新版本，持续获得功能与稳定性改进。' },
    ],
  },
  {
    title: '账号与权益',
    sub: '卡密从「写在本机」升级为「绑定账号」，换机、重装都不怕。',
    items: [
      { icon: '🔑', title: '卡密绑定账号', desc: '激活后卡密归属账号，不再依赖某一台电脑；老用户登录会自动绑定本机卡密。' },
      { icon: '💻', title: '跨设备恢复', desc: '换电脑或重装系统后，登录同一账号即可恢复时长、档位与全部权益。' },
      { icon: '🔄', title: '权益实时同步', desc: '续费、升级、扩容后通过实时推送更新，无需重启客户端；推送丢失也会在心跳时补齐。' },
      { icon: '🎫', title: '升级码 / 扩容码', desc: '个人普通可升级高级，企业可按需增加席位；核销后立即生效，记录可追溯。' },
    ],
  },
  {
    title: '团队协作',
    sub: '把多开从个人工具，变成团队可管理、可交付的工作台。',
    items: [
      { icon: '👥', title: '团队面板', desc: '席位、在线成员、空闲 IP 与到期时间集中展示；管理员看全团队，成员只看自己。' },
      { icon: '🧑‍💼', title: '用户管理', desc: '创建子账户、停用 / 启用、重置密码、解除锁定、删除成员，操作留痕。' },
      { icon: '🪑', title: '席位与扩容', desc: '企业版默认 10 席（含管理员），扩容码 +5 / +10 / +20 / +50，席位只增不减。' },
      { icon: '🛡️', title: '权限隔离', desc: '管理员、企业成员、个人用户按角色展示菜单与数据，越权入口直接隐藏。' },
    ],
  },
  {
    title: '网络与独立 IP',
    sub: '统一管理出口资源，让每个环境拥有稳定的网络身份。',
    items: [
      { icon: '🌐', title: 'IP 资源池', desc: '支持 socks5 / http 代理，单条添加或 Excel、CSV、TXT 批量导入，统一测试与分组。' },
      { icon: '📶', title: '状态管理', desc: '空闲、已分配、待启动、使用中、已停用五种状态清晰可见，避免误删正在使用的 IP。' },
      { icon: '🔗', title: '绑定环境出口', desc: '把 IP 绑定到指定环境，启动后流量走该出口；按平台绑定 ID 或 host + port 精确匹配。' },
      { icon: '🎯', title: '按成员分配', desc: '管理员可从成员或资源两个入口分配 IP，成员只看到自己的资源，支持回收与换绑。' },
    ],
  },
  {
    title: '系统工具',
    sub: '内置实用工具，随时掌握电脑状态，保持系统整洁。',
    items: [
      { icon: '🧹', title: '全盘垃圾清理', desc: '一键清理系统临时文件、浏览器与应用缓存、聊天图片视频等全盘垃圾，并清空回收站，释放磁盘空间。' },
      { icon: '🎯', title: '改名与一键置前', desc: '环境可随时重命名；已运行的环境点击启动即把窗口快速切换到前台，无需在任务栏中翻找。' },
      { icon: '📊', title: '系统状态看板', desc: '实时查看 CPU、内存、GPU、显存与各磁盘的使用率曲线，快速掌握电脑运行情况。' },
    ],
  },
  {
    title: '使用体验',
    sub: '从细节出发，降低多开操作的门槛。',
    items: [
      { icon: '🚀', title: '安装即用', desc: '下载安装包后按引导完成安装，无需额外环境配置。' },
      { icon: '📦', title: '按需多开', desc: '根据需要创建任意数量的环境，随时增减。' },
      { icon: '🛡️', title: '稳定运行', desc: '环境之间相互独立，单个环境异常不影响其他环境。' },
    ],
  },
]

const steps = [
  { title: '下载安装', desc: '从下载中心获取最新版本，解压即可运行。' },
  { title: '注册登录', desc: '注册账号并登录，权益跟随账号走。' },
  { title: '激活卡密', desc: '输入卡密完成激活；企业版需登录后再激活。' },
  { title: '创建环境', desc: '在软件中创建所需数量的独立环境并命名。' },
  { title: '开始多开', desc: '同时启动多个环境，独立运行互不干扰。' },
]
</script>

<style scoped>
.page-hero {
  padding: 64px 0 20px;
  background: linear-gradient(160deg, #eef4ff 0%, #ffffff 70%);
  text-align: center;
}

.page-title {
  font-size: 40px;
  letter-spacing: -1px;
}

.page-sub {
  margin: 16px auto 0;
  max-width: 680px;
  color: var(--text-2);
  font-size: 17px;
}

.feature-group {
  margin-bottom: 56px;
}

.feature-group:last-child {
  margin-bottom: 0;
}

.group-head {
  margin-bottom: 28px;
}

.group-title {
  font-size: 24px;
}

.group-sub {
  margin-top: 8px;
  color: var(--text-3);
  font-size: 15px;
}

.feature-card {
  padding: 26px 22px;
}

.feature-icon {
  font-size: 28px;
}

.feature-title {
  margin-top: 14px;
  font-size: 17px;
}

.feature-desc {
  margin-top: 8px;
  color: var(--text-2);
  font-size: 14px;
}

/* ---------- 版本能力 ---------- */
.edition-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 22px;
  margin-bottom: 32px;
}

.edition-card {
  display: flex;
  flex-direction: column;
  padding: 28px 26px;
}

.edition-game {
  border-color: #ffe2bd;
  background: linear-gradient(160deg, #fff8ef 0%, #ffffff 62%);
}

.edition-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.edition-tag {
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--primary-light);
  color: var(--primary-color);
  font-size: 13px;
  font-weight: 600;
}

.edition-game .edition-tag {
  background: #fff3e4;
  color: #f59e0b;
}

.edition-file {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  color: var(--text-3);
}

.edition-title {
  margin-top: 16px;
  font-size: 20px;
}

.edition-desc {
  margin-top: 10px;
  color: var(--text-2);
  font-size: 14px;
}

.edition-list {
  margin-top: 16px;
  padding-left: 20px;
  list-style: disc;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-2);
  font-size: 14px;
}

.edition-actions {
  margin-top: auto;
  padding-top: 24px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.compare-wrap {
  overflow-x: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}

.compare {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
}

.compare th,
.compare td {
  padding: 14px 18px;
  text-align: left;
  font-size: 15px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.compare thead th {
  background: var(--bg-soft);
  font-size: 14px;
  color: var(--text-2);
}

.compare tbody tr:last-child td {
  border-bottom: none;
}

.compare-name {
  color: var(--text-2);
  font-weight: 600;
  white-space: nowrap;
}

.compare .highlight {
  background: #fff7ec;
  color: var(--text-1);
  font-weight: 600;
}

.steps {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 22px;
}

.step {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 26px 22px;
  box-shadow: var(--shadow-sm);
}

.step-index {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--primary-color);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.step-title {
  margin-top: 16px;
  font-size: 17px;
}

.step-desc {
  margin-top: 8px;
  color: var(--text-2);
  font-size: 14px;
}

.cta-actions {
  margin-top: 26px;
  display: flex;
  gap: 14px;
  justify-content: center;
  flex-wrap: wrap;
}

@media (max-width: 1100px) {
  .steps {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 900px) {
  .edition-grid {
    grid-template-columns: 1fr;
  }
  .steps {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .page-title {
    font-size: 30px;
  }
  .steps {
    grid-template-columns: 1fr;
  }
}
</style>
