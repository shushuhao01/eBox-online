<template>
  <div class="page-container">
    <div class="toolbar-card">
      <span class="page-title">套餐与档位</span>
      <div class="toolbar-right">
        <span class="hint">商城链接保存后立即推送在线客户端</span>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button :icon="Promotion" :loading="pushing" @click="handleRepush">重推配置</el-button>
        <el-button type="primary" :icon="Check" :loading="saving" @click="handleSave">保存并推送</el-button>
      </div>
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
        <el-table-column label="商城链接" min-width="300">
          <template #default="{ row }">
            <el-input
              v-model="row.mallUrl"
              placeholder="留空表示联系客服 / 不展示外链"
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
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Check, Promotion } from '@element-plus/icons-vue'
import { getSkus, updateSku, toggleSku, saveUpgradeLinks, type SkuItem } from '@/api/mall'

type Row = SkuItem & { _originalUrl: string; _toggling?: boolean }

const DURATION_TEXT: Record<string, string> = { month: '月', quarter: '季', year: '年', permanent: '永久' }

const list = ref<Row[]>([])
const loading = ref(false)
const saving = ref(false)
const pushing = ref(false)

async function load() {
  loading.value = true
  try {
    const rows = await getSkus()
    list.value = rows.map((r) => ({ ...r, mallUrl: r.mallUrl || '', _originalUrl: r.mallUrl || '' }))
  } finally {
    loading.value = false
  }
}

/** 保存：变更 SKU 链接 + 推送配置（SSE） */
async function handleSave() {
  const changed = list.value.filter((r) => (r.mallUrl || '') !== r._originalUrl)
  saving.value = true
  try {
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
    const links: Record<string, string> = {}
    for (const r of list.value) {
      if (r.mallUrl) links[r.code] = r.mallUrl
    }
    const res = await saveUpgradeLinks(links)
    ElMessage.success(`已保存 ${changed.length} 项，配置已推送（在线客户端 ${res.delivered} 个）`)
    await load()
  } finally {
    saving.value = false
  }
}

/** 重推：不修改内容，仅重新广播当前配置 */
async function handleRepush() {
  pushing.value = true
  try {
    const links: Record<string, string> = {}
    for (const r of list.value) {
      if (r.mallUrl) links[r.code] = r.mallUrl
    }
    const res = await saveUpgradeLinks(links)
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
.foot-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
