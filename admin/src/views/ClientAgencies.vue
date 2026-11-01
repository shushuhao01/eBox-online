<template>
  <div class="page-container agency-page">
    <div class="sub-toolbar">
      <el-radio-group v-model="days" size="default" @change="onQuickRange">
        <el-radio-button :value="7">近 7 天</el-radio-button>
        <el-radio-button :value="30">近 30 天</el-radio-button>
        <el-radio-button :value="90">近 90 天</el-radio-button>
      </el-radio-group>
      <el-button :type="dateMode === 'custom' ? 'primary' : 'default'" plain @click="toggleCustomPicker">
        <template #icon>
          <el-icon><Calendar /></el-icon>
        </template>
        {{ isCustomRange && customRange ? `${customRange[0]} ~ ${customRange[1]}` : '自定义日期' }}
      </el-button>
      <el-date-picker
        v-if="dateMode === 'custom'"
        ref="customPickerRef"
        v-model="customRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        style="width: 240px"
        @change="onCustomRange"
      />
      <el-button @click="reload">
        <template #icon>
          <el-icon :class="{ spinning: refreshing }"><Refresh /></el-icon>
        </template>
        刷新
      </el-button>
      <span class="range-tip" v-if="analytics">统计区间：{{ analytics.range.start }} ~ {{ analytics.range.end }}</span>
      <div class="sub-toolbar-right">
        <span class="online-badge" :title="`代理商列表已推送的在线客户端连接数`">
          <span class="online-dot"></span>在线客户端 {{ state?.agency_stream_clients ?? 0 }}
        </span>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="stats-tabs" @tab-change="onTabChange">
      <!-- ==================== 数据分析 ==================== -->
      <el-tab-pane label="数据分析" name="analytics">
        <el-tabs v-model="analysisTab" class="stats-tabs inner-tabs" @tab-change="onAnalysisTabChange">
          <!-- ---------- 流量分析 ---------- -->
          <el-tab-pane label="流量分析" name="overview">
            <el-row :gutter="12" class="stat-cards">
              <el-col v-for="c in cards" :key="c.label" :xs="12" :sm="8" :md="6" :lg="3">
                <div class="stat-card">
                  <div class="stat-num">{{ c.value }}</div>
                  <div class="stat-lbl">{{ c.label }}</div>
                </div>
              </el-col>
            </el-row>

            <el-row :gutter="16">
              <el-col :xs="24" :md="16">
                <el-card shadow="never" class="chart-card">
                  <template #header>
                    <span class="chart-title">点击趋势</span>
                    <span class="chart-sub">{{ analytics?.range.days || 0 }} 天 · 点击次数 / 独立设备</span>
                  </template>
                  <div ref="trendRef" class="chart-box" v-loading="loading" />
                </el-card>
              </el-col>
              <el-col :xs="24" :md="8">
                <el-card shadow="never" class="chart-card">
                  <template #header><span class="chart-title">设备类型</span></template>
                  <div ref="deviceRef" class="chart-box" v-loading="loading" />
                </el-card>
              </el-col>
            </el-row>

            <el-row :gutter="16">
              <el-col :xs="24" :md="16">
                <el-card shadow="never" class="chart-card">
                  <template #header>
                    <span class="chart-title">时段分布（0-23 时）</span>
                    <span class="chart-sub" v-if="summary.peakHourClicks">
                      高峰 {{ padHour(summary.peakHour) }} · {{ summary.peakHourClicks }} 次
                    </span>
                  </template>
                  <div ref="hourRef" class="chart-box" v-loading="loading" />
                </el-card>
              </el-col>
              <el-col :xs="24" :md="8">
                <el-card shadow="never" class="chart-card">
                  <template #header><span class="chart-title">客户端环境分布</span></template>
                  <div ref="envRef" class="chart-box" v-loading="loading" />
                </el-card>
              </el-col>
            </el-row>

            <el-row :gutter="16">
              <el-col :xs="24" :md="12">
                <el-card shadow="never" class="chart-card">
                  <template #header><span class="chart-title">地区分布 Top 10</span></template>
                  <div ref="regionRef" class="chart-box" v-loading="loading" />
                </el-card>
              </el-col>
              <el-col :xs="24" :md="12">
                <el-card shadow="never" class="chart-card">
                  <template #header><span class="chart-title">网络运营商 Top 10</span></template>
                  <div ref="ispRef" class="chart-box" v-loading="loading" />
                </el-card>
              </el-col>
            </el-row>

            <el-row :gutter="16">
              <el-col :xs="24" :md="12">
                <el-card shadow="never" class="chart-card">
                  <template #header><span class="chart-title">操作系统</span></template>
                  <div ref="osRef" class="chart-box" v-loading="loading" />
                </el-card>
              </el-col>
              <el-col :xs="24" :md="12">
                <el-card shadow="never" class="chart-card">
                  <template #header><span class="chart-title">浏览器</span></template>
                  <div ref="browserRef" class="chart-box" v-loading="loading" />
                </el-card>
              </el-col>
            </el-row>

            <el-row :gutter="16">
              <el-col :xs="24" :md="12">
                <el-card shadow="never" class="chart-card">
                  <template #header><span class="chart-title">代理商点击排行 Top 20</span></template>
                  <div ref="agencyRef" class="chart-box chart-box-lg" v-loading="loading" />
                </el-card>
              </el-col>
              <el-col :xs="24" :md="12">
                <el-card shadow="never" class="chart-card">
                  <template #header>
                    <span class="chart-title">代理商效果明细</span>
                    <span class="chart-sub">按点击排序 · Top 20</span>
                  </template>
                  <el-table :data="analytics?.agencies || []" size="small" stripe height="340">
                    <el-table-column type="index" label="#" width="48" />
                    <el-table-column label="代理商" min-width="150" show-overflow-tooltip>
                      <template #default="{ row }">{{ row.name || '（已下架）' }}</template>
                    </el-table-column>
                    <el-table-column label="点击" prop="clicks" width="80" align="right" />
                    <el-table-column label="独立设备" prop="devices" width="90" align="right" />
                    <el-table-column label="占比" width="120">
                      <template #default="{ row }">
                        <el-progress :percentage="percent(row.clicks)" :stroke-width="8" :show-text="false" />
                      </template>
                    </el-table-column>
                  </el-table>
                </el-card>
              </el-col>
            </el-row>

            <el-card shadow="never" class="chart-card">
              <template #header>
                <span class="chart-title">每日汇总</span>
                <span class="chart-sub">点击次数 / 独立设备 · 默认最新 10 天，可翻页查看更早日期</span>
              </template>
              <el-table :data="dailyRows" size="small" stripe>
                <el-table-column label="日期" prop="date" width="120" />
                <el-table-column label="点击次数" prop="clicks" width="120" align="right" />
                <el-table-column label="独立设备" prop="devices" width="120" align="right" />
                <el-table-column label="趋势" min-width="200">
                  <template #default="{ row }">
                    <el-progress :percentage="percent(row.clicks)" :stroke-width="8" />
                  </template>
                </el-table-column>
              </el-table>
              <div class="visit-pager">
                <el-pagination
                  v-model:current-page="dailyPage"
                  v-model:page-size="dailyPageSize"
                  :total="dailyRowsAll.length"
                  :page-sizes="[10, 20, 30]"
                  layout="total, sizes, prev, pager, next"
                  background
                />
              </div>
            </el-card>
          </el-tab-pane>

          <!-- ---------- 点击明细 ---------- -->
          <el-tab-pane label="点击明细" name="clicks">
            <div class="visit-filter">
              <el-date-picker
                v-model="clickFilters.dateRange"
                type="daterange"
                value-format="YYYY-MM-DD"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                style="width: 250px"
              />
              <el-select v-model="clickFilters.agencyId" placeholder="代理商" clearable filterable style="width: 170px">
                <el-option v-for="a in agencyOptions" :key="a.value" :label="a.label" :value="a.value" />
              </el-select>
              <el-select v-model="clickFilters.envName" placeholder="客户端环境" clearable filterable style="width: 150px">
                <el-option v-for="e in envOptions" :key="e" :label="e" :value="e" />
              </el-select>
              <el-select v-model="clickFilters.device" placeholder="设备" clearable style="width: 120px">
                <el-option v-for="d in deviceOptions" :key="d.value" :label="d.label" :value="d.value" />
              </el-select>
              <el-input
                v-model="clickFilters.keyword"
                placeholder="代理商 / 激活码 / IP / 设备指纹 / 地区"
                clearable
                style="width: 230px"
                @keyup.enter="searchClicks"
              />
              <el-button type="primary" :icon="Search" @click="searchClicks">查询</el-button>
              <el-button @click="resetClickFilters">重置</el-button>
            </div>

            <el-table v-loading="clickLoading" :data="clicks" stripe>
              <el-table-column label="时间" width="110">
                <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
              </el-table-column>
              <el-table-column label="代理商" min-width="140" show-overflow-tooltip>
                <template #default="{ row }">{{ row.agencyName || '（已下架）' }}</template>
              </el-table-column>
              <el-table-column label="激活码" width="150" show-overflow-tooltip>
                <template #default="{ row }">{{ row.code || '-' }}</template>
              </el-table-column>
              <el-table-column label="设备指纹" width="130">
                <template #default="{ row }">
                  <span class="mono" :title="row.machineFp">{{ shortFp(row.machineFp) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="环境 / 版本" min-width="140" show-overflow-tooltip>
                <template #default="{ row }">
                  <div>{{ row.envName || '-' }}</div>
                  <div class="dim">{{ versionLabel(row.appVersion) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="IP" width="140">
                <template #default="{ row }">{{ formatIp(row.ip) }}</template>
              </el-table-column>
              <el-table-column label="归属地" min-width="150">
                <template #default="{ row }">
                  {{ [row.country, row.province, row.city].filter((v) => v && v !== '中国').join(' ') || '-' }}
                </template>
              </el-table-column>
              <el-table-column label="运营商" prop="isp" min-width="100" show-overflow-tooltip />
              <el-table-column label="设备 / 系统 / 浏览器" min-width="190">
                <template #default="{ row }">
                  <el-tag size="small" type="info" class="mr4">{{ deviceLabel(row.device) }}</el-tag>
                  <span class="dim">{{ [row.os, row.browser].filter(Boolean).join(' · ') || '-' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="客户端系统" prop="clientOs" width="110" show-overflow-tooltip />
              <el-table-column label="点击 ID" prop="clickId" width="150" show-overflow-tooltip />
              <el-table-column label="User-Agent" min-width="200" show-overflow-tooltip>
                <template #default="{ row }">{{ row.userAgent || '-' }}</template>
              </el-table-column>
            </el-table>
            <el-empty v-if="!clicks.length && !clickLoading" description="暂无点击明细" />

            <div class="visit-pager">
              <el-pagination
                v-model:current-page="clickPage"
                v-model:page-size="clickPageSize"
                :total="clickTotal"
                :page-sizes="[20, 50, 100]"
                layout="total, sizes, prev, pager, next, jumper"
                background
                @current-change="loadClicks"
                @size-change="searchClicks"
              />
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-tab-pane>

      <!-- ==================== 代理商配置 ==================== -->
      <el-tab-pane label="代理商配置" name="config">
        <el-alert type="info" :closable="false" show-icon class="config-tip">
          <template #title>
            客户端「网络配置 → 代理商」弹窗展示下方列表（仅启用项，按排序值升序）。保存仅写入草稿，立即推送 / 定时推送后才会下发到客户端；点击数据通过客户端埋点回传，可在「数据分析 → 点击明细」查看。
          </template>
        </el-alert>

        <div class="config-status">
          <span class="status-item">
            已发布 <b>{{ state?.published.length ?? 0 }}</b> 个
          </span>
          <el-divider direction="vertical" />
          <span class="status-item">
            当前草稿 <b>{{ list.length }}</b> 个
          </span>
          <el-divider direction="vertical" />
          <span class="status-item">
            在线客户端 <b>{{ state?.agency_stream_clients ?? 0 }}</b>
          </span>
          <template v-if="state?.pending">
            <el-divider direction="vertical" />
            <span class="status-item pending">
              定时推送：{{ formatTime(state.pending.publishAt) }}
              <el-button link type="primary" size="small" @click="cancelSchedule">取消</el-button>
            </span>
          </template>
        </div>

        <div class="config-actions">
          <el-button type="primary" :icon="Plus" @click="addAgency">添加代理商</el-button>
          <el-button :icon="Check" :loading="saving" @click="saveDraft">保存设置</el-button>
          <el-button type="success" :icon="Promotion" :loading="publishing" @click="pushNow">立即推送</el-button>
          <el-button type="warning" :icon="Timer" plain @click="openSchedule">定时推送</el-button>
          <el-button type="danger" :icon="Bottom" plain :loading="withdrawing" @click="withdrawAll">撤下全部</el-button>
          <div class="config-actions-right">
            <el-button link :icon="RefreshLeft" @click="reloadState">重置为已保存</el-button>
          </div>
        </div>

        <el-table :data="list" stripe class="agency-table" row-key="id">
          <el-table-column label="#" type="index" width="48" />
          <el-table-column label="代理商名称" width="150">
            <template #default="{ row }">
              <el-input v-model="row.name" placeholder="必填，如：XX 加速" maxlength="64" />
            </template>
          </el-table-column>
          <el-table-column label="连接地址" min-width="230">
            <template #default="{ row }">
              <el-input v-model="row.url" placeholder="https://example.com/register" maxlength="512" />
            </template>
          </el-table-column>
          <el-table-column label="简介" min-width="200">
            <template #default="{ row }">
              <el-input v-model="row.intro" placeholder="一句话介绍（选填）" maxlength="255" />
            </template>
          </el-table-column>
          <el-table-column label="标签" width="130">
            <template #default="{ row }">
              <el-input v-model="row.tags" placeholder="逗号分隔" maxlength="128" />
            </template>
          </el-table-column>
          <el-table-column label="评分 / 人数" width="170">
            <template #default="{ row }">
              <div class="rating-cell">
                <el-rate v-model="row.rating" allow-half :max="5" size="small" />
                <el-input-number v-model="row.ratingCount" :min="0" :max="999999" :controls="false" size="small" class="rating-count" />
              </div>
            </template>
          </el-table-column>
          <el-table-column label="排序" width="100">
            <template #default="{ row }">
              <el-input-number v-model="row.sort" :min="-9999" :max="9999" size="small" :controls="false" class="sort-input" />
            </template>
          </el-table-column>
          <el-table-column label="启用" width="76" align="center">
            <template #default="{ row }">
              <el-switch v-model="row.enabled" :active-value="1" :inactive-value="0" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="76" align="center" fixed="right">
            <template #default="{ $index }">
              <el-button link type="danger" :icon="Delete" @click="removeAgency($index)" />
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!list.length" description="暂无代理商，点击「添加代理商」开始配置" />
      </el-tab-pane>
    </el-tabs>

    <!-- 定时推送 -->
    <el-dialog v-model="scheduleVisible" title="定时推送代理商" width="420px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="推送时间">
          <el-date-picker
            v-model="scheduleTime"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="选择推送时间"
            style="width: 100%"
            :disabled-date="disablePastDate"
          />
        </el-form-item>
        <el-form-item label="推送内容">
          <span class="dim">当前列表共 {{ list.length }} 个（仅启用项会下发）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="scheduleVisible = false">取消</el-button>
        <el-button type="primary" :loading="scheduling" @click="submitSchedule">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Calendar,
  Check,
  Bottom,
  Delete,
  Plus,
  Promotion,
  Refresh,
  RefreshLeft,
  Search,
  Timer,
} from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import {
  getAgencyState,
  saveAgencyDraft,
  publishAgencies,
  scheduleAgencies,
  cancelScheduledAgencies,
  withdrawAgencies,
  getAgencyAnalytics,
  getAgencyClicks,
  type AgencyAnalytics,
  type AgencyClickLog,
  type AgencyItem,
  type AgencyState,
  type NameValue,
} from '@/api/agencies'
import { initChart, setChartOption, disposeChart, PALETTE, AXIS_TEXT, type EChartsOption } from '@/utils/echarts'
import { formatIp, formatTime } from '@/utils/format'
import TimeCell from '@/components/TimeCell.vue'

// ==================== 日期区间 ====================

const days = ref(30)
const customRange = ref<[string, string] | null>(null)
const dateMode = ref<'quick' | 'custom'>('quick')
const customPickerRef = ref()
const refreshing = ref(false)

function fmtYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10))
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}
function diffDays(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000)
}

const isCustomRange = computed(
  () => Array.isArray(customRange.value) && customRange.value.length === 2 && !!customRange.value[0] && !!customRange.value[1],
)

const effectiveRange = computed(() => {
  if (isCustomRange.value && customRange.value) {
    const [start, end] = customRange.value
    return { days: Math.max(1, diffDays(start, end) + 1), start, end }
  }
  const d = Math.max(1, days.value)
  const end = fmtYmd(new Date())
  const start = fmtYmd(addDays(new Date(), -(d - 1)))
  return { days: d, start, end }
})

function onQuickRange() {
  dateMode.value = 'quick'
  customRange.value = null
  reload()
}
function toggleCustomPicker() {
  if (dateMode.value === 'custom') {
    dateMode.value = 'quick'
    customRange.value = null
    days.value = 30
    reload()
    return
  }
  dateMode.value = 'custom'
  days.value = 0
  nextTick(() => customPickerRef.value?.focus?.())
}
function onCustomRange() {
  if (isCustomRange.value) {
    dateMode.value = 'custom'
    days.value = 0
  } else {
    dateMode.value = 'quick'
    days.value = 30
  }
  reload()
}

// ==================== 数据分析 ====================

const activeTab = ref<'analytics' | 'config'>('analytics')
const analysisTab = ref<'overview' | 'clicks'>('overview')
const loading = ref(false)
const analytics = ref<AgencyAnalytics | null>(null)

const EMPTY_SUMMARY = {
  clicks: 0, devices: 0, ips: 0, agencies: 0,
  todayClicks: 0, avgClicks: 0, peakHour: 0, peakHourClicks: 0,
}
const summary = computed(() => analytics.value?.summary ?? EMPTY_SUMMARY)

function padHour(h: number): string {
  return `${String(Number(h) || 0).padStart(2, '0')}:00`
}

const cards = computed(() => {
  const s = summary.value
  return [
    { label: '区间点击', value: s.clicks },
    { label: '独立设备', value: s.devices },
    { label: '独立 IP', value: s.ips },
    { label: '覆盖代理商', value: s.agencies },
    { label: '今日点击', value: s.todayClicks },
    { label: '日均点击', value: s.avgClicks },
    { label: '高峰时段', value: padHour(s.peakHour) },
    { label: '高峰点击', value: s.peakHourClicks },
  ]
})

const DEVICE_LABEL: Record<string, string> = {
  desktop: '桌面端',
  mobile: '移动端',
  tablet: '平板',
  bot: '机器人',
  unknown: '未知',
}
const deviceOptions = [
  { label: '桌面端', value: 'desktop' },
  { label: '移动端', value: 'mobile' },
  { label: '平板', value: 'tablet' },
  { label: '机器人', value: 'bot' },
  { label: '未知', value: 'unknown' },
]
function deviceLabel(v: string): string {
  return DEVICE_LABEL[v] || v || '未知'
}

/** 排名占比：相对当前区间点击最高值 */
function percent(v: number): number {
  const max = Math.max(1, ...(analytics.value?.agencies || []).map((x) => x.clicks), summary.value.clicks)
  return Math.min(100, Math.round((v / max) * 100))
}

/** 每日汇总：按日期倒序（最新在前），默认每页 10 天，翻页查看更早日期 */
const dailyRowsAll = computed(() => (analytics.value?.daily || []).slice().reverse())
const dailyPage = ref(1)
const dailyPageSize = ref(10)
const dailyRows = computed(() => {
  const start = (dailyPage.value - 1) * dailyPageSize.value
  return dailyRowsAll.value.slice(start, start + dailyPageSize.value)
})
watch(dailyPageSize, () => {
  dailyPage.value = 1
})

/** 版本号统一加一个 v 前缀（客户端上报的 appVersion 本身可能已带 v） */
function versionLabel(v: string | undefined | null): string {
  const s = String(v || '').trim()
  if (!s) return '-'
  return /^v/i.test(s) ? s : `v${s}`
}

// ==================== 图表 ====================

const trendRef = ref<HTMLElement>()
const hourRef = ref<HTMLElement>()
const deviceRef = ref<HTMLElement>()
const osRef = ref<HTMLElement>()
const browserRef = ref<HTMLElement>()
const regionRef = ref<HTMLElement>()
const ispRef = ref<HTMLElement>()
const envRef = ref<HTMLElement>()
const agencyRef = ref<HTMLElement>()

const charts: Record<string, echarts.ECharts | null> = {}

function upsert(key: string, el: HTMLElement | undefined, option: EChartsOption) {
  if (!el) return
  if (!charts[key]) charts[key] = initChart(el, option)
  else setChartOption(charts[key], option)
}

function emptyOption(text = '暂无数据'): EChartsOption {
  return {
    title: { text, left: 'center', top: 'center', textStyle: { color: '#9CA3AF', fontSize: 13, fontWeight: 'normal' } },
  }
}

function pieOption(list: NameValue[]): EChartsOption {
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, type: 'scroll', textStyle: { color: AXIS_TEXT, fontSize: 11 } },
    color: PALETTE,
    series: [
      {
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        data: list.map((x) => ({ name: x.name, value: x.value })),
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
      },
    ],
  }
}

function hbarOption(list: NameValue[], left = 96): EChartsOption {
  if (!list.length) return emptyOption()
  const items = list.slice().reverse()
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left, right: 32, top: 16, bottom: 16 },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f2f7' } }, axisLabel: { color: AXIS_TEXT } },
    yAxis: {
      type: 'category',
      data: items.map((x) => x.name),
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisLabel: { color: AXIS_TEXT, fontSize: 11 },
    },
    series: [
      {
        type: 'bar',
        data: items.map((x) => x.value),
        barMaxWidth: 16,
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [{ offset: 0, color: '#3A7AFE' }, { offset: 1, color: '#93B5FE' }],
          },
        },
      },
    ],
  }
}

function renderCharts() {
  const a = analytics.value
  if (!a) return

  if (!a.trend.dates.length) upsert('trend', trendRef.value, emptyOption())
  else {
    upsert('trend', trendRef.value, {
      tooltip: { trigger: 'axis' },
      legend: { data: ['点击次数', '独立设备'], top: 0, left: 'center', textStyle: { color: AXIS_TEXT } },
      grid: { left: 48, right: 24, top: 40, bottom: 24 },
      xAxis: {
        type: 'category', data: a.trend.dates, boundaryGap: false,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: AXIS_TEXT, fontSize: 11 },
      },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f2f7' } }, axisLabel: { color: AXIS_TEXT } },
      series: [
        {
          name: '点击次数', type: 'line', smooth: true, showSymbol: false, data: a.trend.clicks,
          itemStyle: { color: '#3A7AFE' }, areaStyle: { color: 'rgba(58,122,254,0.12)' },
        },
        {
          name: '独立设备', type: 'line', smooth: true, showSymbol: false, data: a.trend.devices,
          itemStyle: { color: '#22C55E' }, areaStyle: { color: 'rgba(34,197,94,0.10)' },
        },
      ],
    })
  }

  const hourTotal = a.hours.clicks.reduce((s, v) => s + v, 0)
  if (!hourTotal) upsert('hour', hourRef.value, emptyOption())
  else {
    upsert('hour', hourRef.value, {
      tooltip: { trigger: 'axis' },
      grid: { left: 44, right: 16, top: 24, bottom: 28 },
      xAxis: {
        type: 'category', data: a.hours.labels,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: AXIS_TEXT, fontSize: 10, interval: 2 },
      },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f2f7' } }, axisLabel: { color: AXIS_TEXT } },
      series: [
        {
          name: '点击次数', type: 'bar', data: a.hours.clicks, barMaxWidth: 22,
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: '#3A7AFE' }, { offset: 1, color: '#93B5FE' }],
            },
          },
        },
      ],
    })
  }

  const devices = a.devices.map((d) => ({ name: deviceLabel(d.name), value: d.value }))
  upsert('device', deviceRef.value, devices.length ? pieOption(devices) : emptyOption())
  upsert('os', osRef.value, a.os.length ? pieOption(a.os) : emptyOption())
  upsert('browser', browserRef.value, a.browsers.length ? pieOption(a.browsers) : emptyOption())
  upsert('env', envRef.value, a.environments.length ? pieOption(a.environments) : emptyOption())
  upsert('region', regionRef.value, hbarOption(a.regions))
  upsert('isp', ispRef.value, hbarOption(a.isps))
  upsert(
    'agency',
    agencyRef.value,
    hbarOption(a.agencies.map((x) => ({ name: x.name || '（已下架）', value: x.clicks })), 130),
  )
}

function resizeCharts() {
  Object.values(charts).forEach((c) => c?.resize())
}

function onTabChange(name: string | number) {
  if (name === 'analytics') nextTick(() => resizeCharts())
}

function onAnalysisTabChange(name: string | number) {
  if (name === 'overview') nextTick(() => resizeCharts())
  if (name === 'clicks') nextTick(() => loadClicks())
}

watch(
  () => analytics.value,
  async () => {
    await nextTick()
    renderCharts()
  },
)

async function loadAnalytics() {
  loading.value = true
  try {
    const r = effectiveRange.value
    analytics.value = await getAgencyAnalytics(r.days, r.start || undefined, r.end || undefined)
    dailyPage.value = 1
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}

// ==================== 点击明细 ====================

const clicks = ref<AgencyClickLog[]>([])
const clickLoading = ref(false)
const clickPage = ref(1)
const clickPageSize = ref(20)
const clickTotal = ref(0)
const clickFilters = ref<{ dateRange: [string, string] | null; agencyId: string; envName: string; device: string; keyword: string }>({
  dateRange: null,
  agencyId: '',
  envName: '',
  device: '',
  keyword: '',
})

const agencyOptions = computed(() => {
  const map = new Map<string, string>()
  for (const a of analytics.value?.agencies || []) map.set(a.id, a.name || '（已下架）')
  for (const a of list.value) if (a.id && !map.has(a.id)) map.set(a.id, a.name || a.id)
  return Array.from(map, ([value, label]) => ({ value, label }))
})

const envOptions = computed(() => (analytics.value?.environments || []).map((e) => e.name).filter(Boolean))

function shortFp(v: string): string {
  if (!v) return '-'
  return v.length > 12 ? `${v.slice(0, 12)}…` : v
}

async function loadClicks() {
  clickLoading.value = true
  try {
    const r = effectiveRange.value
    const res = await getAgencyClicks({
      page: clickPage.value,
      pageSize: clickPageSize.value,
      agencyId: clickFilters.value.agencyId || undefined,
      envName: clickFilters.value.envName || undefined,
      device: clickFilters.value.device || undefined,
      keyword: clickFilters.value.keyword.trim() || undefined,
      start: clickFilters.value.dateRange?.[0] || r.start || undefined,
      end: clickFilters.value.dateRange?.[1] || r.end || undefined,
    })
    clicks.value = res.list
    clickTotal.value = res.total
  } catch {
    // 拦截器已提示
  } finally {
    clickLoading.value = false
  }
}

function searchClicks() {
  clickPage.value = 1
  loadClicks()
}

function resetClickFilters() {
  clickFilters.value = { dateRange: null, agencyId: '', envName: '', device: '', keyword: '' }
  searchClicks()
}

// ==================== 代理商配置 ====================

const state = ref<AgencyState | null>(null)
const list = ref<AgencyItem[]>([])
const saving = ref(false)
const publishing = ref(false)
const withdrawing = ref(false)
const scheduling = ref(false)
const scheduleVisible = ref(false)
const scheduleTime = ref('')

function newId(): string {
  return `ag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function applyState(s: AgencyState) {
  state.value = s
  list.value = (s.draft || []).map((a) => ({ ...a }))
}

async function loadState() {
  try {
    applyState(await getAgencyState())
  } catch {
    // 拦截器已提示
  }
}

async function reloadState() {
  await loadState()
  ElMessage.success('已恢复为最近一次保存的配置')
}

function addAgency() {
  list.value.push({
    id: newId(),
    name: '',
    url: '',
    intro: '',
    tags: '',
    rating: 0,
    ratingCount: 0,
    sort: list.value.length * 10,
    enabled: 1,
  })
}

async function removeAgency(index: number) {
  const item = list.value[index]
  try {
    await ElMessageBox.confirm(`确定删除代理商「${item?.name || '未命名'}」吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  list.value.splice(index, 1)
}

/** 提交前校验：名称必填、地址必须 http(s) */
function validateList(): boolean {
  for (let i = 0; i < list.value.length; i += 1) {
    const a = list.value[i]
    const name = a.name.trim()
    const url = a.url.trim()
    if (!name) {
      ElMessage.warning(`第 ${i + 1} 行：请填写代理商名称`)
      return false
    }
    if (!/^https?:\/\/[^\s]+$/i.test(url)) {
      ElMessage.warning(`「${name}」的连接地址需以 http:// 或 https:// 开头，且不能包含空格`)
      return false
    }
    a.name = name
    a.url = url
  }
  return true
}

function normalizeList(): AgencyItem[] {
  return list.value.map((a) => ({
    ...a,
    name: a.name.trim(),
    url: a.url.trim(),
    intro: (a.intro || '').trim(),
    tags: (a.tags || '').trim(),
  }))
}

async function saveDraft() {
  if (!validateList()) return
  saving.value = true
  try {
    applyState(await saveAgencyDraft(normalizeList()))
    ElMessage.success('配置已保存（尚未推送客户端）')
  } catch {
    // 拦截器已提示
  } finally {
    saving.value = false
  }
}

async function pushNow() {
  if (!validateList()) return
  try {
    await ElMessageBox.confirm(
      `将把当前列表（${list.value.filter((a) => a.enabled === 1).length} 个启用项）立即推送到所有在线客户端，确定继续吗？`,
      '立即推送',
      { type: 'warning', confirmButtonText: '推送', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  publishing.value = true
  try {
    const res = await publishAgencies(normalizeList())
    applyState(res)
    ElMessage.success(`已推送，送达 ${res.agency_delivered ?? 0} 个在线客户端`)
  } catch {
    // 拦截器已提示
  } finally {
    publishing.value = false
  }
}

function disablePastDate(d: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}

function openSchedule() {
  if (!validateList()) return
  scheduleTime.value = ''
  scheduleVisible.value = true
}

async function submitSchedule() {
  if (!scheduleTime.value) {
    ElMessage.warning('请选择推送时间')
    return
  }
  const sendAt = new Date(scheduleTime.value).getTime()
  if (!sendAt || sendAt <= Date.now()) {
    ElMessage.warning('推送时间需晚于当前时间')
    return
  }
  scheduling.value = true
  try {
    applyState(await scheduleAgencies(normalizeList(), sendAt))
    scheduleVisible.value = false
    ElMessage.success('已设置定时推送')
  } catch {
    // 拦截器已提示
  } finally {
    scheduling.value = false
  }
}

async function cancelSchedule() {
  try {
    await ElMessageBox.confirm('确定取消已设置的定时推送吗？', '取消定时推送', {
      type: 'warning',
      confirmButtonText: '取消定时',
      cancelButtonText: '返回',
    })
  } catch {
    return
  }
  try {
    applyState(await cancelScheduledAgencies())
    ElMessage.success('定时推送已取消')
  } catch {
    // 拦截器已提示
  }
}

async function withdrawAll() {
  try {
    await ElMessageBox.confirm(
      '撤下后所有客户端将立即看不到任何代理商（弹窗显示空态），确定继续吗？',
      '撤下全部代理商',
      { type: 'warning', confirmButtonText: '撤下', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  withdrawing.value = true
  try {
    const res = await withdrawAgencies()
    applyState(res)
    ElMessage.success(`已撤下，送达 ${res.agency_delivered ?? 0} 个在线客户端`)
  } catch {
    // 拦截器已提示
  } finally {
    withdrawing.value = false
  }
}

// ==================== 加载 / 生命周期 ====================

async function reload() {
  refreshing.value = true
  try {
    await Promise.all([loadAnalytics(), loadState(), loadClicks()])
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  await reload()
  window.addEventListener('resize', resizeCharts)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCharts)
  Object.values(charts).forEach((c) => disposeChart(c))
})
</script>

<style scoped lang="scss">
@keyframes refresh-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.agency-page {
  min-width: 0;

  :deep(.el-tabs__content) {
    overflow: visible;
  }
}

.sub-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  row-gap: 8px;

  .spinning {
    animation: refresh-spin 0.8s linear infinite;
  }

  .range-tip {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .sub-toolbar-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .online-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--el-border-color);
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-regular);
    font-size: 14px;
    line-height: 1;
    white-space: nowrap;

    .online-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15);
    }
  }
}

.stats-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 14px;
  }
}

.inner-tabs {
  :deep(.el-tabs__header) {
    margin-top: -6px;
  }
}

.stat-cards {
  margin-bottom: 4px;
}

.stat-card {
  background: #f7f9fc;
  border-radius: 8px;
  padding: 14px 10px;
  text-align: center;
  margin-bottom: 12px;

  .stat-num {
    font-size: 24px;
    font-weight: 700;
    color: var(--primary-color);
    line-height: 1.2;
  }

  .stat-lbl {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }
}

.chart-card {
  margin-bottom: 16px;

  .chart-title {
    font-weight: 600;
  }

  .chart-sub {
    margin-left: 8px;
    font-size: 12px;
    color: var(--text-secondary);
  }
}

.chart-box {
  height: 300px;
}

.chart-box-lg {
  height: 340px;
}

.visit-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.visit-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.mr4 {
  margin-right: 4px;
}

.dim {
  color: var(--text-secondary);
}

.mono {
  font-family: 'Consolas', 'Menlo', monospace;
  font-size: 12px;
}

.config-tip {
  margin-bottom: 12px;
}

.config-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;

  .status-item b {
    color: var(--primary-color);
    font-size: 15px;
    margin: 0 2px;
  }

  .pending {
    color: var(--el-color-warning);
  }
}

.config-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;

  .config-actions-right {
    margin-left: auto;
  }
}

.agency-table {
  :deep(.el-input__wrapper) {
    padding: 1px 8px;
  }

  .rating-cell {
    display: flex;
    align-items: center;
    gap: 4px;

    .rating-count {
      width: 62px;
    }
  }

  .sort-input {
    width: 100%;
  }
}
</style>
