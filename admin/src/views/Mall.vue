<template>
  <div class="page-container">
    <div class="toolbar-card">
      <span class="page-title">档位环境管理</span>
      <div class="toolbar-right">
        <span class="hint">这是系统级配置：创建激活码时按档位自动带出默认环境数量，仍可在创建时自定义</span>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button type="primary" :icon="Check" :loading="saving" @click="handleSave">保存</el-button>
      </div>
    </div>

    <div class="table-card">
      <div class="hint" style="margin-bottom: 12px">
        环境数量即单用户可同时创建的环境数量（服务端 caps.maxEnvs）。填 0 表示不限制；未配置（0）时签发卡密也为不限制。
        保存后，未自带环境数量的已激活账号会立即按新配置生效。
      </div>
      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column label="档位" width="220">
          <template #default="{ row }">
            <el-tag size="small" :type="row.version === 2 ? 'warning' : 'info'" effect="plain">
              {{ row.label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="档位编码" width="120" align="center">
          <template #default="{ row }"><span class="code-font">{{ row.key }}</span></template>
        </el-table-column>
        <el-table-column label="单用户环境数量" width="260" align="center">
          <template #default="{ row }">
            <el-input-number
              v-model="row.value"
              :min="0"
              :max="100000"
              :value-on-clear="0"
              controls-position="right"
              size="small"
              style="width: 160px"
            />
            <span class="hint" style="margin-left: 8px">{{ row.value > 0 ? '' : '不限制' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="240">
          <template #default="{ row }">
            <span class="hint">{{ row.value > 0 ? `单用户最多 ${row.value} 个环境` : '单用户环境数量不限制' }}</span>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无档位" :image-size="80" /></template>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Check } from '@element-plus/icons-vue'
import {
  getTierEnvLimits,
  saveTierEnvLimits,
  type TierEnvLimits,
  type TierEnvMeta,
} from '@/api/mall'

interface Row extends TierEnvMeta {
  value: number
}

const rows = ref<Row[]>([])
const loading = ref(false)
const saving = ref(false)

function toRows(tiers: TierEnvMeta[], limits: TierEnvLimits): Row[] {
  return tiers.map((t) => ({ ...t, value: Number(limits[t.key] || 0) }))
}

async function load() {
  loading.value = true
  try {
    const res = await getTierEnvLimits()
    rows.value = toRows(res.tiers, res.limits)
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  saving.value = true
  try {
    const payload = {} as TierEnvLimits
    for (const row of rows.value) payload[row.key] = Math.max(0, Math.floor(Number(row.value) || 0))
    const res = await saveTierEnvLimits(payload)
    rows.value = toRows(rows.value, res.limits)
    ElMessage.success('档位环境数量已保存，在线客户端已实时生效')
  } finally {
    saving.value = false
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
</style>
