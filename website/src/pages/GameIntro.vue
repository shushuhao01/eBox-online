<template>
  <div class="game-intro">
    <!-- 首屏 -->
    <section class="game-hero">
      <div class="container game-hero-inner">
        <div class="game-hero-copy">
          <span class="game-badge">eBox 游戏版 · 正式版全部能力 + 游戏增强</span>
          <h1 class="game-title">为游戏多开而生的独立版本</h1>
          <p class="game-sub">
            {{ siteName }} 游戏版包含正式版全部能力，并针对游戏多开、账号分组运营再做增强：
            内置轻量隔离与虚拟机两种环境方案，多开更多、运行更稳、隔离更彻底，整体更强、更稳、更隔绝。
            两种方案同样适用于非游戏程序；独立更新通道，与正式版互不影响，可同时使用。
          </p>
          <div class="game-actions">
            <RouterLink class="btn btn-primary btn-lg" to="/game">下载游戏版</RouterLink>
            <RouterLink class="btn btn-ghost btn-lg" to="/download">下载正式版</RouterLink>
          </div>
          <p v-if="release" class="game-version">
            最新游戏版 {{ release.latestVersion }}
            <span v-if="release.releaseDate">· 更新于 {{ formatDate(release.releaseDate) }}</span>
          </p>
        </div>

        <div class="game-hero-visual">
          <div v-if="heroImages.length" class="game-carousel">
            <div
              class="game-carousel-track"
              :style="{ transform: `translateX(-${current * 100}%)` }"
            >
              <img
                v-for="(img, i) in heroImages"
                :key="img + i"
                :src="img"
                :alt="`游戏版专题图 ${i + 1}`"
                class="game-carousel-img"
                @click="openLightbox(i)"
              />
            </div>
            <div v-if="heroImages.length > 1" class="game-carousel-dots">
              <button
                v-for="(img, i) in heroImages"
                :key="i"
                type="button"
                :class="{ active: i === current }"
                :aria-label="`第 ${i + 1} 张`"
                @click="current = i"
              ></button>
            </div>
          </div>

          <div v-else class="game-window">
            <div class="game-window-bar"><span></span><span></span><span></span></div>
            <div class="game-envs">
              <div v-for="i in 4" :key="i" class="game-env">
                <div class="game-env-avatar">G{{ i }}</div>
                <div class="game-env-lines"><span></span><span></span></div>
              </div>
            </div>
            <div class="game-window-foot">
              <span class="game-foot-dot"></span>
              4 个游戏环境同时运行 · 相互隔离
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 核心卖点 -->
    <section class="section">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">在正式版之上，为游戏多开再增强</h2>
          <p class="section-sub">
            游戏版不是精简版：正式版的多开、环境隔离、账号与团队协作等能力全部保留，
            并叠加游戏场景优化、更强的隔离方案与更稳的长期运行表现。
          </p>
        </div>
        <div class="grid grid-4">
          <div v-for="f in features" :key="f.title" class="card game-feature">
            <div class="game-feature-icon">{{ f.icon }}</div>
            <h3 class="game-feature-title">{{ f.title }}</h3>
            <p class="game-feature-desc">{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 隔离方案详解 -->
    <section class="section section-soft">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">轻量隔离 + 内置虚拟机，两种方案都给你</h2>
          <p class="section-sub">
            游戏版不是只有一种隔离方式：日常多开用轻量隔离，省资源、开得多；需要整机级隔离的游戏，
            直接切换到内置虚拟机，无需另装 VMware / VirtualBox。两种方案不限于游戏，非游戏程序同样可以
            放进独立环境运行，隔离更强，环境之间互不影响。
          </p>
        </div>

        <div class="iso-grid">
          <div class="card iso-card">
            <span class="iso-tag">默认方案</span>
            <h3 class="iso-title">轻量隔离</h3>
            <p class="iso-desc">复用本机系统内核，只为每个环境隔离注册表、文件、进程与网络视图。</p>
            <ul class="iso-list">
              <li><strong>免开虚拟化</strong>：不用进 BIOS 开启 VT-x，也不用安装 Hyper-V 等组件。</li>
              <li><strong>秒级启动</strong>：环境创建、启动、切换都在几秒内完成。</li>
              <li><strong>占用更低</strong>：单环境只额外占用百 MB 级内存，磁盘只保存差异数据。</li>
              <li><strong>多开更多</strong>：同样一台机器可以同时跑更多游戏窗口。</li>
              <li><strong>互不干扰</strong>：不同环境的登录状态、存档与配置各自保存。</li>
            </ul>
          </div>

          <div class="card iso-card">
            <span class="iso-tag">整机隔离</span>
            <h3 class="iso-title">内置虚拟机</h3>
            <p class="iso-desc">
              游戏版自带虚拟机引擎与基础镜像，每个环境是一台独立客机，通过程序内的窗口直接操作。
            </p>
            <ul class="iso-list">
              <li><strong>整机级隔离</strong>：独立系统环境，适合对运行环境敏感的游戏与工具。</li>
              <li><strong>无需另装</strong>：引擎随安装包分发，不用单独安装 VMware、VirtualBox。</li>
              <li><strong>差量磁盘</strong>：基础镜像共享，每个环境只增加差量数据，节省磁盘。</li>
              <li><strong>桌面直连</strong>：客机桌面嵌入程序窗口，鼠标键盘与剪贴板互通。</li>
              <li><strong>一键重置</strong>：环境被改乱时可重置客机，快速恢复到干净状态。</li>
            </ul>
          </div>
        </div>

        <div class="compare-wrap iso-table">
          <table class="compare">
            <thead>
              <tr>
                <th class="compare-item-col">对比项</th>
                <th class="highlight">轻量隔离（游戏版）</th>
                <th>内置虚拟机（游戏版）</th>
                <th>第三方虚拟机</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in isolationRows" :key="row.name">
                <td class="compare-name">{{ row.name }}</td>
                <td class="highlight">{{ row.light }}</td>
                <td>{{ row.vm }}</td>
                <td>{{ row.third }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 版本对比 -->
    <section class="section">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">游戏版与正式版的区别</h2>
          <p class="section-sub">两个版本独立发版、独立更新，卡密与账号体系各自独立，按使用场景选择即可。</p>
        </div>
        <div class="compare-wrap">
          <table class="compare">
            <thead>
              <tr>
                <th class="compare-item-col">对比项</th>
                <th>正式版</th>
                <th class="highlight">游戏版</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in compareRows" :key="row.name">
                <td class="compare-name">{{ row.name }}</td>
                <td>{{ row.formal }}</td>
                <td class="highlight">{{ row.game }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 适用场景 -->
    <section class="section section-soft">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">适合这些使用场景</h2>
        </div>
        <div class="grid grid-3">
          <div v-for="s in scenarios" :key="s.title" class="card scenario-card">
            <div class="scenario-icon">{{ s.icon }}</div>
            <h3 class="scenario-title">{{ s.title }}</h3>
            <p class="scenario-desc">{{ s.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 下载入口 -->
    <section class="section">
      <div class="container">
        <div class="download-card">
          <div>
            <h2 class="download-title">{{ siteName }} 游戏版{{ release ? ` ${release.latestVersion}` : '' }}</h2>
            <p class="download-sub">
              游戏版与正式版安装包不同，请下载对应版本；覆盖升级只替换程序文件，不会删除环境数据与登录状态。
            </p>
            <ul class="download-meta">
              <li v-if="release && release.releaseDate">
                <span>更新日期</span>{{ formatDate(release.releaseDate) }}
              </li>
              <li v-if="release && release.downloadSize">
                <span>文件大小</span>{{ formatSize(release.downloadSize) }}
              </li>
            </ul>
          </div>
          <div class="download-actions">
            <a
              v-if="downloadUrl"
              class="btn btn-primary btn-lg"
              :href="downloadUrl"
              :download="release.downloadFileName || undefined"
              target="_blank"
              rel="noopener"
              @click="onDownload"
            >
              立即下载游戏版
            </a>
            <RouterLink v-else class="btn btn-primary btn-lg" to="/game">前往下载页</RouterLink>
            <RouterLink class="btn btn-ghost" to="/game">其他下载地址</RouterLink>
          </div>
        </div>
      </div>
    </section>

    <!-- 常见问题 -->
    <section class="section section-soft">
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">常见问题</h2>
        </div>
        <div class="faq">
          <div v-for="q in faqs" :key="q.q" class="card faq-item">
            <h3 class="faq-q">{{ q.q }}</h3>
            <p class="faq-a">{{ q.a }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 底部 CTA -->
    <section class="game-cta">
      <div class="container game-cta-inner">
        <div>
          <h2 class="game-cta-title">准备好开始游戏多开了吗？</h2>
          <p class="game-cta-sub">下载游戏版，登录账号并输入游戏版卡密即可激活。</p>
        </div>
        <div class="game-cta-actions">
          <RouterLink class="btn btn-primary btn-lg" to="/game">下载游戏版</RouterLink>
          <RouterLink class="btn btn-ghost btn-lg" to="/contact">联系我们</RouterLink>
        </div>
      </div>
    </section>

    <!-- 专题图放大查看（与首页共用组件） -->
    <ImageLightbox v-model:index="lightboxIndex" :images="heroImages" alt="游戏版专题图" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getLatestRelease, track, type LatestRelease } from '@/api'
import ImageLightbox from '@/components/ImageLightbox.vue'
import { useSite } from '@/composables/useSite'
import { usePageHead } from '@/composables/usePageHead'
import { safeUrl } from '@/utils/safeHtml'

const { siteName, settings } = useSite()
usePageHead(
  '游戏版',
  'eBox 游戏版：包含正式版全部能力，并针对游戏多开增强隔离与稳定性。内置轻量隔离与虚拟机两种环境方案，独立更新通道，更强、更稳、更隔绝。'
)

const release = ref<LatestRelease | null>(null)
/** 下载地址只允许常规协议，阻断后台误填的 javascript: 等链接 */
const downloadUrl = computed(() => safeUrl(release.value?.downloadUrl))

// 游戏版专题轮播图：后台「站点设置 → 游戏版专题轮播图」配置，JSON 字符串数组
const heroImages = computed<string[]>(() => {
  try {
    const raw = settings.value.game_hero_images
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((u) => typeof u === 'string' && u) : []
  } catch {
    return []
  }
})
const current = ref(0)
const lightboxIndex = ref(-1)
let carouselTimer: number | undefined

function openLightbox(idx: number) {
  lightboxIndex.value = idx
}

function stopCarousel() {
  if (carouselTimer) {
    window.clearInterval(carouselTimer)
    carouselTimer = undefined
  }
}

watch(
  () => heroImages.value.length,
  (len) => {
    stopCarousel()
    current.value = 0
    if (len > 1) {
      carouselTimer = window.setInterval(() => {
        current.value = (current.value + 1) % len
      }, 5000)
    }
  },
  { immediate: true }
)

const features = [
  { icon: '✅', title: '完整继承正式版', desc: '正式版的多开、环境隔离、账号同步与团队协作能力全部保留。' },
  { icon: '🎮', title: '游戏场景增强', desc: '针对游戏多开调整运行策略，启动与切换更顺畅，长时间挂机更稳。' },
  { icon: '🧩', title: '两种隔离方案', desc: '轻量隔离 + 内置虚拟机，按游戏要求选择隔离强度，非游戏程序同样适用。' },
  { icon: '🔄', title: '独立更新通道', desc: '游戏版与正式版分别发版、分别更新，升级互不影响。' },
]

const isolationRows = [
  { name: '隔离级别', light: '注册表 / 文件 / 进程 / 网络视图隔离', vm: '完整独立系统（整机隔离）', third: '完整独立系统' },
  { name: '是否需开虚拟化', light: '不需要', vm: '可选硬件加速，未开启时自动降级运行', third: '需要在 BIOS 开启' },
  { name: '启动速度', light: '秒级', vm: '数十秒（含系统引导）', third: '数十秒' },
  { name: '单环境磁盘占用', light: '仅差异数据，几十 MB 起', vm: '共享基础镜像，仅增量磁盘', third: '每个环境独立系统盘，数十 GB' },
  { name: '多开数量', light: '主要受内存限制，可开较多', vm: '受内存与 CPU 限制', third: '受内存与 CPU 限制' },
  { name: '部署与维护', light: '创建即用，无需配置', vm: '程序内置引擎，一键创建 / 重置', third: '需自行安装与维护虚拟机软件' },
]

const compareRows = [
  { name: '产品定位', formal: '办公 / 多账号运营', game: '游戏多开与账号分组' },
  { name: '能力范围', formal: '多开、环境隔离、账号与团队等完整能力', game: '包含正式版全部能力 + 游戏场景增强' },
  { name: '环境方案', formal: '轻量环境隔离', game: '轻量隔离 + 内置虚拟机，更强、更隔绝' },
  { name: '运行稳定性', formal: '常规多开稳定运行', game: '面向长时间游戏挂机优化，更稳' },
  { name: '版本与更新', formal: '独立版本号与更新源', game: '独立版本号与更新源' },
  { name: '安装包', formal: 'eBox.exe', game: 'eBoxGame.exe' },
  { name: '账号与卡密', formal: '正式版账号与卡密', game: '游戏版卡密，独立激活' },
  { name: '是否可共存', formal: '可共存', game: '可共存，互不覆盖' },
]

const scenarios = [
  { icon: '👥', title: '多账号分组', desc: '按账号或服务器分组管理环境，登录状态各自保留。' },
  { icon: '🛡️', title: '环境相互独立', desc: '轻量隔离与虚拟机两种方案，按游戏要求选择隔离强度。' },
  { icon: '⚙️', title: '长期挂机运营', desc: '环境长时间运行更稳定，支持随时手动同步。' },
]

const faqs = [
  {
    q: '游戏版比正式版功能少吗？',
    a: '不少。游戏版包含正式版的全部能力，并在此基础上增加游戏场景优化与更强的隔离方案，整体更强、更稳、更隔绝。',
  },
  {
    q: '游戏版和正式版可以同时安装吗？',
    a: '可以。两个版本使用不同的程序名和独立更新通道，安装在同一个目录也不会互相覆盖。',
  },
  {
    q: '轻量隔离和内置虚拟机怎么选？',
    a: '日常多开优先用轻量隔离，省资源、开得多；游戏对运行环境敏感或需要整机隔离时，切换到内置虚拟机即可。',
  },
  {
    q: '使用内置虚拟机需要另外安装 VMware 或 VirtualBox 吗？',
    a: '不需要。虚拟机引擎随游戏版安装包分发，创建环境后直接在程序窗口里操作客机桌面。',
  },
  {
    q: '游戏版只能运行游戏吗？',
    a: '不是。轻量隔离与内置虚拟机同样适用于非游戏程序，可以把敏感工具、业务软件等放进独立环境运行，隔离更强，互不影响。',
  },
  {
    q: '正式版的卡密能用在游戏版吗？',
    a: '不能。游戏版使用游戏版激活码，请在购买时确认版本类型。',
  },
  {
    q: '游戏版会跟随正式版一起更新吗？',
    a: '不会。游戏版有独立的版本号和更新源，按自己的节奏发布更新。',
  },
]

function formatDate(value: string) {
  if (!value) return ''
  return value.slice(0, 10)
}

function formatSize(bytes: number) {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let i = 0
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i += 1
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function onDownload() {
  track('download')
}

onMounted(async () => {
  try {
    const data = await getLatestRelease('game')
    release.value = data && data.latestVersion ? data : null
  } catch {
    release.value = null
  }
})

onBeforeUnmount(stopCarousel)
</script>

<style scoped>
.game-intro {
  --game-tint: rgba(58, 122, 254, 0.06);
}

/* ---------- 首屏 ---------- */
.game-hero {
  padding: 76px 0 64px;
  background: radial-gradient(900px 360px at 18% 0%, var(--primary-light) 0%, #ffffff 70%);
}

.game-hero-inner {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 48px;
  align-items: center;
}

.game-badge {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--primary-light);
  color: var(--primary-color);
  font-size: 13px;
  font-weight: 600;
}

.game-title {
  margin-top: 18px;
  font-size: 44px;
  letter-spacing: -1px;
}

.game-sub {
  margin-top: 18px;
  max-width: 560px;
  color: var(--text-2);
  font-size: 17px;
}

.game-actions {
  margin-top: 30px;
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.game-version {
  margin-top: 20px;
  color: var(--text-3);
  font-size: 14px;
}

/* 轮播 */
.game-carousel {
  position: relative;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.game-carousel-track {
  display: flex;
  transition: transform 0.45s ease;
}

.game-carousel-img {
  width: 100%;
  flex-shrink: 0;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  display: block;
  cursor: zoom-in;
}

.game-carousel-dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  display: flex;
  justify-content: center;
  gap: 7px;
}

.game-carousel-dots button {
  width: 7px;
  height: 7px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.6);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
  cursor: pointer;
}

.game-carousel-dots button.active {
  width: 18px;
  border-radius: 4px;
  background: #fff;
}

/* 无轮播时的占位示意 */
.game-window {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.game-window-bar {
  display: flex;
  gap: 7px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border);
}

.game-window-bar span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #e3e8f0;
}

.game-window-bar span:first-child {
  background: #ffb3a7;
}

.game-window-bar span:nth-child(2) {
  background: #ffd98a;
}

.game-window-bar span:nth-child(3) {
  background: #a9e3b6;
}

.game-envs {
  padding: 18px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.game-env {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: var(--bg-soft);
}

.game-env-avatar {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: var(--primary-color);
}

.game-env-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.game-env-lines span {
  height: 6px;
  border-radius: 4px;
  background: #dfe6f2;
}

.game-env-lines span:last-child {
  width: 60%;
}

.game-window-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px 16px;
  color: var(--text-3);
  font-size: 13px;
}

.game-foot-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #38c172;
}

/* ---------- 卖点 ---------- */
.game-feature {
  padding: 24px;
}

.game-feature-icon {
  font-size: 26px;
}

.game-feature-title {
  margin-top: 14px;
  font-size: 17px;
}

.game-feature-desc {
  margin-top: 8px;
  color: var(--text-2);
  font-size: 14px;
}

/* ---------- 隔离方案 ---------- */
.iso-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.iso-card {
  padding: 28px;
}

.iso-tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--primary-light);
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 600;
}

.iso-title {
  margin-top: 14px;
  font-size: 21px;
}

.iso-desc {
  margin-top: 10px;
  color: var(--text-2);
  font-size: 14px;
}

.iso-list {
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.iso-list li {
  position: relative;
  padding-left: 20px;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.65;
}

.iso-list li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary-color);
  opacity: 0.55;
}

.iso-list strong {
  color: var(--text-1);
  font-weight: 600;
}

.iso-table {
  margin-top: 20px;
}

/* ---------- 对比表 ---------- */
.compare-wrap {
  overflow-x: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}

.compare {
  width: 100%;
  border-collapse: collapse;
  min-width: 620px;
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
  background: var(--game-tint);
  color: var(--text-1);
  font-weight: 600;
}

/* ---------- 场景 ---------- */
.scenario-card {
  padding: 26px;
}

.scenario-icon {
  font-size: 26px;
}

.scenario-title {
  margin-top: 12px;
  font-size: 17px;
}

.scenario-desc {
  margin-top: 8px;
  color: var(--text-2);
  font-size: 14px;
}

/* ---------- 下载 ---------- */
.download-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 34px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-md);
}

.download-title {
  font-size: 24px;
}

.download-sub {
  margin-top: 10px;
  max-width: 620px;
  color: var(--text-2);
  font-size: 14px;
}

.download-meta {
  margin-top: 16px;
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  color: var(--text-1);
  font-size: 14px;
}

.download-meta span {
  margin-right: 10px;
  color: var(--text-3);
}

.download-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
}

/* ---------- FAQ ---------- */
.faq {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.faq-item {
  padding: 22px;
}

.faq-q {
  font-size: 16px;
}

.faq-a {
  margin-top: 8px;
  color: var(--text-2);
  font-size: 14px;
}

/* ---------- 底部 CTA ---------- */
.game-cta {
  padding: 56px 0;
  background: #fff;
  border-top: 1px solid var(--border);
}

.game-cta-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
}

.game-cta-title {
  font-size: 28px;
}

.game-cta-sub {
  margin-top: 10px;
  color: var(--text-2);
  font-size: 15px;
}

.game-cta-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

@media (max-width: 960px) {
  .game-hero-inner,
  .iso-grid {
    grid-template-columns: 1fr;
  }

  .download-card,
  .game-cta-inner {
    flex-direction: column;
    align-items: flex-start;
  }

  .faq {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .game-title {
    font-size: 32px;
  }

  .game-hero {
    padding: 52px 0 44px;
  }

  .download-actions {
    width: 100%;
  }

  .download-actions .btn {
    width: 100%;
  }
}
</style>
