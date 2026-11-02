<template>
  <div class="page-container">
    <!-- 工具栏 -->
    <div class="toolbar-card">
      <el-select v-model="filters.action" placeholder="动作" clearable filterable style="width: 220px" @change="handleSearch">
        <el-option v-for="a in actionOptions" :key="a.value" :label="a.label" :value="a.value" />
      </el-select>
      <el-input
        v-model="filters.userId"
        placeholder="操作人ID"
        clearable
        style="width: 150px"
        :prefix-icon="Search"
        @keyup.enter="handleSearch"
        @clear="handleSearch"
      />
      <div class="toolbar-right">
        <el-button :icon="Refresh" @click="handleSearch">刷新</el-button>
      </div>
    </div>

    <!-- 表格 -->
    <div class="table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="时间" width="110">
          <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
        </el-table-column>
        <el-table-column label="用户ID" prop="userId" width="100" align="center" />
        <el-table-column label="动作" min-width="150" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" class="action-tag">{{ formatLogAction(row.action) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="目标" min-width="180">
          <template #default="{ row }">
            <span class="wrap-cell">{{ formatLogTarget(row.target) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="详情" min-width="280">
          <template #default="{ row }">
            <span class="wrap-cell">{{ formatLogDetail(row.detail) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="IP" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ formatIp(row.ip) }}</template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无操作日志" :image-size="80" />
        </template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="load"
          @size-change="handleSizeChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Search, Refresh } from '@element-plus/icons-vue'
import { getOperationLogs, getOperationLogActions, type OperationLog } from '@/api/logs'
import TimeCell from '@/components/TimeCell.vue'
import { formatIp } from '@/utils/format'
import { formatLogAction, formatLogDetail, formatLogTarget } from '@/utils/logFormat'

/** 动作筛选项由后端 distinct 结果生成，避免新增动作后筛不到 */
const actionOptions = ref<Array<{ value: string; label: string }>>([])

const filters = reactive<{ action: string; userId: string }>({ action: '', userId: '' })
const list = ref<OperationLog[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await getOperationLogs({
      page: page.value,
      pageSize: pageSize.value,
      action: filters.action,
      userId: filters.userId,
    })
    list.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}

async function loadActions() {
  try {
    const rows = await getOperationLogActions()
    actionOptions.value = rows
      .filter((a) => a && a !== 'all')
      .map((a) => ({ value: a, label: formatLogAction(a) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
  } catch {
    actionOptions.value = []
  }
}

function handleSearch() {
  page.value = 1
  load()
}

function handleSizeChange() {
  page.value = 1
  load()
}

onMounted(() => {
  loadActions()
  load()
})
</script>

<style scoped lang="scss">
.toolbar-right {
  margin-left: auto;
}

/* 动作完整显示：标签允许换行，长动作不再被省略号截断 */
.action-tag {
  white-space: normal;
  height: auto;
  line-height: 18px;
  padding: 2px 6px;
  text-align: left;
}

/* 目标 / 详情完整展示：长文本自动换行 */
.wrap-cell {
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}
</style>
