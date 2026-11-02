<template>
  <div class="page-container">
    <div class="toolbar-card">
      <span class="page-title">套餐与档位</span>
      <div class="toolbar-right">
        <span class="hint">续费/升级链接保存后立即推送在线客户端</span>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button :icon="Promotion" :loading="pushing" @click="handleRepush">重推配置</el-button>
        <el-button type="primary" :icon="Check" :loading="saving" @click="handleSave">保存并推送</el-button>
      </div>
    </div>

    <div class="table-card">
      <div class="card-head">
        <span class="card-title">升级码商城链接（4 个档位）</span>
        <span class="hint">同一档位不同时长共用此链接；留空则该档位不显示去购买</span>
      </div>
      <el-form label-width="150px" class="upgrade-form">
        <el-form-item v-for="g in UPGRADE_GROUPS" :key="g.key" :label="g.label">
          <el-input
            v-model="upgradeUrls[g.key]"
            placeholder="https://mall.example.com/upgrade"
            clearable
            style="max-width: 480px"
          />
        </el-form-item>
      </el-form>
    </div>

    <div class="table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="编码" width="150">
          <template #default="{ row }"><span class="code-font">{{ row.code }}</span></template>
        </el-table-column>
        <el-table-column label="套餐名称" min-width="150" prop="label" show-overflow-tooltip />
        <el-table-column label="版本" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.version === 2 ? 'warning' : ''" effect="plain">
              {{ row.version === 2 ? '企业' : '个人' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="级别" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.level === 2 ? 'success' : 'info'" effect="plain">
              {{ row.level === 2 ? '高级' : '普通' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时长" width="100" align="center">
          <template #default="{ row }">{{ DURATION_TEXT[row.duration] || row.duration }}</template>
        </el-table-column>
        <el-table-column label="席位" width="80" align="center" prop="seats" />
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
      <div class="foot-hint">共 {{ list.length }} 个档位；停用的档位不会下发给客户端。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Check, Promotion } from '@element-plus/icons-vue'
import { getSkus, updateSku, toggleSku, getUpgradeLinks, saveUpgradeLinks, type SkuItem } from '@/api/mall'

type Row = SkuItem & { _originalUrl: string; _toggling?: boolean }

const DURATION_TEXT: Record<string, string> = { month: '月', quarter: '季', year: '年', permanent: '永久' }

/** 升级链接按 (version, level) 分 4 组，同组内不同时长共用链接 */
const UPGRADE_GROUPS: Array<{ key: string; label: string; version: number; level: number }> = [
  { key: 'v1l1', label: '个人普通版（v1l1）', version: 1, level: 1 },
  { key: 'v1l2', label: '个人高级版（v1l2）', version: 1, level: 2 },
  { key: 'v2l1', label: '企业普通版（v2l1）', version: 2, level: 1 },
  { key: 'v2l2', label: '企业高级版（v2l2）', version: 2, level: 2 },
]

const list = ref<Row[]>([])
const loading = ref(false)
const saving = ref(false)
const pushing = ref(false)
const upgradeUrls = reactive<Record<string, string>>({ v1l1: '', v1l2: '', v2l1: '', v2l2: '' })

async function load() {
  loading.value = true
  try {
    const [rows, state] = await Promise.all([getSkus(), getUpgradeLinks()])
    list.value = rows.map((r) => ({ ...r, mallUrl: r.mallUrl || '', _originalUrl: r.mallUrl || '' }))
    for (const g of UPGRADE_GROUPS) {
      const hit = list.value.find(
        (r) => r.version === g.version && r.level === g.level && !!state.links[r.code]
      )
      upgradeUrls[g.key] = hit ? state.links[hit.code] : ''
    }
  } finally {
    loading.value = false
  }
}

/** 把每组链接展开写入该组全部 SKU code */
function buildUpgradeLinks(): Record<string, string> {
  const links: Record<string, string> = {}
  for (const g of UPGRADE_GROUPS) {
    const url = (upgradeUrls[g.key] || '').trim()
    if (!url) continue
    for (const r of list.value) {
      if (r.version === g.version && r.level === g.level) links[r.code] = url
    }
  }
  return links
}

/** 保存续费链接（SKU.mallUrl），返回变更条数 */
async function persistRenewalLinks(): Promise<number> {
  const changed = list.value.filter((r) => (r.mallUrl || '') !== r._originalUrl)
  for (const row of changed) {
    await updateSku(row.id, {
      code: row.code,
      version: row.version,
      level: row.level,
      duration: row.duration,
      durationDays: row.durationDays,
      label: row.label,
      seats: row.seats,
      mallUrl: row.mallUrl || null,
      sort: row.sort,
      enabled: row.enabled,
    })
  }
  return changed.length
}

/** 保存：续费链接写 SKU，升级链接写 app_configs，推送配置（SSE） */
async function handleSave() {
  saving.value = true
  try {
    const changed = await persistRenewalLinks()
    const res = await saveUpgradeLinks({ links: buildUpgradeLinks() })
    ElMessage.success(`已保存 ${changed} 项，配置已推送（在线客户端 ${res.delivered} 个）`)
    await load()
  } finally {
    saving.value = false
  }
}

/** 重推：提交当前续费与升级链接，并重新广播配置 */
async function handleRepush() {
  pushing.value = true
  try {
    await persistRenewalLinks()
    const res = await saveUpgradeLinks({ links: buildUpgradeLinks() })
    ElMessage.success(`配置已重推（在线客户端 ${res.delivered} 个）`)
  } finally {
    pushing.value = false
  }
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
.card-title {
  font-weight: 600;
}
.upgrade-form :deep(.el-form-item) {
  margin-bottom: 12px;
}
.foot-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
