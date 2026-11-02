<template>
  <div class="page-container">
    <div class="toolbar-card">
      <span class="page-title">IP 资源</span>
      <div class="toolbar-right">
        <el-input
          v-model="query.keyword"
          placeholder="主机 / 备注"
          clearable
          style="width: 200px"
          :prefix-icon="Search"
          @keyup.enter="search"
        />
        <el-select v-model="query.scope" placeholder="资源池" clearable style="width: 120px" @change="search">
          <el-option label="个人池" :value="1" />
          <el-option label="企业池" :value="2" />
        </el-select>
        <el-select v-model="query.health" placeholder="健康状态" clearable style="width: 120px" @change="search">
          <el-option label="未测" :value="1" />
          <el-option label="正常" :value="2" />
          <el-option label="异常" :value="3" />
        </el-select>
        <el-select v-model="query.status" placeholder="启用状态" clearable style="width: 120px" @change="search">
          <el-option label="启用" :value="1" />
          <el-option label="停用" :value="2" />
        </el-select>
        <el-button type="primary" :icon="Search" @click="search">查询</el-button>
        <el-button :icon="Refresh" @click="reset">重置</el-button>
      </div>
    </div>

    <div class="table-card">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="平台不预置、不托管 IP 资源；此处仅供运营排查，账号密码一律掩码展示。"
        style="margin-bottom: 12px"
      />
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="ID" prop="id" width="80" />
        <el-table-column label="资源池" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.scope === 2 ? 'warning' : ''" effect="plain">
              {{ row.scope === 2 ? '企业池' : '个人池' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="归属" min-width="170">
          <template #default="{ row }">
            <template v-if="row.scope === 2">
              <span v-if="row.enterpriseName">{{ row.enterpriseName }}</span>
              <span v-else class="text-secondary">企业#{{ row.enterpriseId }}</span>
            </template>
            <template v-else>
              <span v-if="row.ownerLogin">{{ row.ownerLogin }}</span>
              <span v-else class="text-secondary">账号#{{ row.ownerAccountId }}</span>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="代理地址" min-width="200">
          <template #default="{ row }">
            <span class="code-font">{{ row.proxyType }}://{{ row.host }}:{{ row.port }}</span>
          </template>
        </el-table-column>
        <el-table-column label="用户名" width="120">
          <template #default="{ row }">
            <span class="code-font">{{ row.usernameMasked || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="健康" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="HEALTH[row.health]?.type || 'info'">{{ HEALTH[row.health]?.label || row.health }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="延迟" width="90" align="center">
          <template #default="{ row }">{{ row.latencyMs != null ? `${row.latencyMs} ms` : '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 1 ? 'success' : 'info'" effect="plain">
              {{ row.status === 1 ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后检测" width="160">
          <template #default="{ row }"><TimeCell :value="row.lastCheckAt" /></template>
        </el-table-column>
        <el-table-column label="备注" min-width="140" prop="remark" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
        </el-table-column>
        <template #empty><el-empty description="暂无 IP 资源" :image-size="80" /></template>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="load"
          @size-change="search"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Search, Refresh } from '@element-plus/icons-vue'
import TimeCell from '@/components/TimeCell.vue'
import { getIpResources, type IpResourceItem } from '@/api/ipResources'

const HEALTH: Record<number, { label: string; type: 'info' | 'success' | 'danger' }> = {
  1: { label: '未测', type: 'info' },
  2: { label: '正常', type: 'success' },
  3: { label: '异常', type: 'danger' },
}

const query = reactive({
  page: 1,
  pageSize: 20,
  keyword: '',
  scope: '' as number | '',
  health: '' as number | '',
  status: '' as number | '',
})
const list = ref<IpResourceItem[]>([])
const total = ref(0)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await getIpResources(query)
    list.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}

function search() {
  query.page = 1
  load()
}

function reset() {
  query.keyword = ''
  query.scope = ''
  query.health = ''
  query.status = ''
  search()
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
.text-secondary {
  color: var(--text-secondary);
  font-size: 12px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
}
</style>
