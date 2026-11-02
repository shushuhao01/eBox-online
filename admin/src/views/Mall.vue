<template>
  <div class="page-container">
    <div class="toolbar-card">
      <span class="page-title">套餐与档位</span>
      <div class="toolbar-right">
        <span class="hint">续费链接保存后立即推送在线客户端；升级码与商城链接请前往「升级与扩容码」</span>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button :icon="Promotion" :loading="pushing" @click="handleRepush">重推配置</el-button>
        <el-button type="primary" :icon="Check" :loading="saving" @click="handleSave">保存并推送</el-button>
      </div>
    </div>

    <div class="table-card">
      <div class="card-head">
        <el-input
          v-model="keyword"
          placeholder="搜索编码 / 名称"
          clearable
          style="width: 200px"
          :prefix-icon="Search"
        />
        <el-select v-model="tierFilter" placeholder="全部档位" clearable style="width: 150px">
          <el-option v-for="t in TIER_FILTERS" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <span class="hint">共 {{ filtered.length }} / {{ list.length }} 个档位；停用的档位不会下发给客户端</span>
      </div>
      <div class="hint" style="margin-bottom: 8px">
        环境上限即客户端可同时创建的环境数量（服务端 caps.maxEnvs），留空则按档位默认：个人普通 5 / 个人高级 20 / 企业普通 20 / 企业高级 50。
      </div>
      <el-table :data="filtered" v-loading="loading" stripe>
        <el-table-column label="编码" width="150">
          <template #default="{ row }">
            <span class="code-font">{{ row.code }}</span>
          </template>
        </el-table-column>
        <el-table-column label="档位" width="120" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.version === 2 ? 'warning' : 'info'" effect="plain">
              {{ tierText(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="套餐名称" min-width="160" prop="label" show-overflow-tooltip />
        <el-table-column label="时长" width="100" align="center">
          <template #default="{ row }">{{ DURATION_TEXT[row.duration] || row.duration }}</template>
        </el-table-column>
        <el-table-column label="席位" width="80" align="center" prop="seats" />
        <el-table-column label="环境上限" width="150" align="center">
          <template #default="{ row }">
            <el-input-number
              v-model="row._maxEnvs"
              :min="0"
              :max="9999"
              :value-on-clear="null"
              :placeholder="`默认 ${defaultMaxEnvs(row)}`"
              controls-position="right"
              size="small"
              style="width: 120px"
            />
          </template>
        </el-table-column>
        <el-table-column label="续费链接" min-width="300">
          <template #default="{ row }">
            <el-input
              v-model="row.mallUrl"
              placeholder="续费按钮跳转的商城链接，留空不显示续费按钮"
              clearable
              size="small"
            />
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled"
              :loading="row._toggling"
              @change="(v: boolean) => handleToggle(row, v)"
            />
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无套餐" :image-size="80" /></template>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Check, Promotion, Search } from '@element-plus/icons-vue'
import { getSkus, updateSku, toggleSku, pushClientConfig, type SkuItem } from '@/api/mall'

type Row = SkuItem & {
  _originalUrl: string
  _maxEnvs: number | null
  _originalMaxEnvs: number | null
  _capsBase: Record<string, unknown>
  _toggling?: boolean
}

const DURATION_TEXT: Record<string, string> = { month: '月', quarter: '季', year: '年', permanent: '永久' }
const TIER_FILTERS: Array<{ label: string; value: string }> = [
  { label: '个人普通版', value: 'v1l1' },
  { label: '个人高级版', value: 'v1l2' },
  { label: '企业普通版', value: 'v2l1' },
  { label: '企业高级版', value: 'v2l2' },
]

const list = ref<Row[]>([])
const loading = ref(false)
const saving = ref(false)
const pushing = ref(false)
const keyword = ref('')
const tierFilter = ref('')

function tierKey(row: SkuItem): string {
  return `v${row.version}l${row.level}`
}

function tierText(row: SkuItem): string {
  return `${row.version === 2 ? '企业' : '个人'}${row.level === 2 ? '高级' : '普通'}`
}

/** 服务端未配置 caps.maxEnvs 时的默认值（与 EntitlementService 保持一致） */
function defaultMaxEnvs(row: SkuItem): number {
  if (row.version === 1) return row.level === 2 ? 20 : 5
  return row.level === 2 ? 50 : 20
}

function parseCaps(capsJson: string | null): Record<string, unknown> {
  if (!capsJson) return {}
  try {
    const obj = JSON.parse(capsJson)
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function maxEnvsOf(caps: Record<string, unknown>): number | null {
  const v = caps.maxEnvs
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return list.value.filter((r) => {
    if (tierFilter.value && tierKey(r) !== tierFilter.value) return false
    if (!kw) return true
    return r.code.toLowerCase().includes(kw) || (r.label || '').toLowerCase().includes(kw)
  })
})

async function load() {
  loading.value = true
  try {
    const rows = await getSkus()
    list.value = rows.map((r) => {
      const caps = parseCaps(r.capsJson)
      const maxEnvs = maxEnvsOf(caps)
      return {
        ...r,
        mallUrl: r.mallUrl || '',
        _originalUrl: r.mallUrl || '',
        _maxEnvs: maxEnvs,
        _originalMaxEnvs: maxEnvs,
        _capsBase: caps,
      }
    })
  } finally {
    loading.value = false
  }
}

/** 保存续费链接与环境上限（SKU.mallUrl / capsJson.maxEnvs），返回变更条数 */
async function persistRenewalLinks(): Promise<number> {
  const changed = list.value.filter(
    (r) => (r.mallUrl || '') !== r._originalUrl || r._maxEnvs !== r._originalMaxEnvs
  )
  for (const row of changed) {
    // 保留 capsJson 里其它能力项，只增删 maxEnvs
    const caps: Record<string, unknown> = { ...row._capsBase }
    if (row._maxEnvs === null || row._maxEnvs === undefined) delete caps.maxEnvs
    else caps.maxEnvs = Math.floor(row._maxEnvs)
    const capsJson = Object.keys(caps).length ? JSON.stringify(caps) : null

    await updateSku(row.id, {
      code: row.code,
      version: row.version,
      level: row.level,
      duration: row.duration,
      durationDays: row.durationDays,
      label: row.label,
      seats: row.seats,
      mallUrl: row.mallUrl || null,
      capsJson,
      sort: row.sort,
      enabled: row.enabled,
    })
  }
  return changed.length
}

/** 保存续费链接并推送配置（SSE） */
async function handleSave() {
  saving.value = true
  try {
    const changed = await persistRenewalLinks()
    const res = await pushConfig()
    ElMessage.success(`已保存 ${changed} 项，配置已推送（在线客户端 ${res.delivered} 个）`)
    await load()
  } finally {
    saving.value = false
  }
}

/** 重推：提交当前续费链接，并重新广播配置 */
async function handleRepush() {
  pushing.value = true
  try {
    await persistRenewalLinks()
    const res = await pushConfig()
    ElMessage.success(`配置已重推（在线客户端 ${res.delivered} 个）`)
  } finally {
    pushing.value = false
  }
}

/** 触发服务端重新构建并广播客户端配置 */
async function pushConfig() {
  return pushClientConfig()
}

async function handleToggle(row: Row, enabled: boolean) {
  row._toggling = true
  try {
    const updated = await toggleSku(row.id, enabled)
    row.enabled = updated.enabled
    ElMessage.success(enabled ? '已启用' : '已停用')
  } finally {
    row._toggling = false
  }
}

onMounted(load)
</script>

<style scoped lang="scss">
.toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
.hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-right: 4px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
</style>
