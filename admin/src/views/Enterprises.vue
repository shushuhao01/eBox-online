<template>
  <div class="page-container">
    <div class="toolbar-card">
      <span class="page-title">企业管理</span>
      <div class="toolbar-right">
        <el-input
          v-model="query.keyword"
          placeholder="企业码 / 企业名称"
          clearable
          style="width: 220px"
          :prefix-icon="Search"
          @keyup.enter="search"
        />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px">
          <el-option label="正常" :value="1" />
          <el-option label="停用" :value="2" />
          <el-option label="到期" :value="3" />
        </el-select>
        <el-button type="primary" :icon="Search" @click="search">查询</el-button>
        <el-button :icon="Refresh" @click="reset">重置</el-button>
      </div>
    </div>

    <div class="table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="ID" prop="id" width="80" />
        <el-table-column label="企业码" width="110">
          <template #default="{ row }">
            <span class="code-font">{{ row.code }}</span>
          </template>
        </el-table-column>
        <el-table-column label="企业名称" min-width="180" prop="name" show-overflow-tooltip />
        <el-table-column label="企业管理员" min-width="130">
          <template #default="{ row }">
            <span v-if="row.ownerLogin">{{ row.ownerLogin }}</span>
            <span v-else class="text-secondary">账号#{{ row.ownerAccountId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="席位（已用 / 总数）" width="160" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.usedSeats >= row.seats ? 'warning' : 'success'" effect="plain">
              {{ row.usedSeats }} / {{ row.seats }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="ENT_STATUS[row.status]?.type || 'info'">
              {{ ENT_STATUS[row.status]?.label || row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="到期时间" width="160">
          <template #default="{ row }"><TimeCell :value="row.expireAt" /></template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
            <el-button
              v-if="store.isSuperAdmin"
              link
              type="warning"
              size="small"
              @click="openSeatDialog(row)"
            >调整席位</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无企业" :image-size="80" /></template>
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

    <!-- 企业详情 -->
    <el-drawer v-model="detailVisible" :title="`企业详情：${detail?.enterprise.name || ''}`" size="640px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="企业码">
            <span class="code-font">{{ detail.enterprise.code }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ ENT_STATUS[detail.enterprise.status]?.label || detail.enterprise.status }}
          </el-descriptions-item>
          <el-descriptions-item label="企业管理员">{{ detail.enterprise.ownerLogin || '-' }}</el-descriptions-item>
          <el-descriptions-item label="席位">{{ detail.members.filter((m) => m.status !== 3).length }} / {{ detail.enterprise.seats }}</el-descriptions-item>
          <el-descriptions-item label="到期时间">{{ renderTime(detail.enterprise.expireAt) }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ renderTime(detail.enterprise.createdAt) }}</el-descriptions-item>
        </el-descriptions>

        <div class="detail-title">
          成员（{{ detail.members.length }}）
          <el-button
            v-if="store.isSuperAdmin"
            link
            type="warning"
            size="small"
            @click="openSeatDialog(detail.enterprise, true)"
          >调整席位</el-button>
        </div>
        <el-table :data="detail.members" size="small" stripe max-height="440">
          <el-table-column label="账号" min-width="140">
            <template #default="{ row }">
              <div>{{ row.login || `账号#${row.accountId}` }}</div>
              <div v-if="row.nickname" class="text-secondary">{{ row.nickname }}</div>
            </template>
          </el-table-column>
          <el-table-column label="角色" width="110" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.role === 2 ? 'warning' : 'info'" effect="plain">
                {{ row.role === 2 ? '企业管理员' : '企业成员' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 1 ? 'success' : row.status === 3 ? 'danger' : 'info'">
                {{ MEMBER_STATUS[row.status] || row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="120" prop="remark" show-overflow-tooltip>
            <template #default="{ row }">{{ row.remark || '-' }}</template>
          </el-table-column>
          <el-table-column label="加入时间" width="150">
            <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
          </el-table-column>
        </el-table>
      </template>
    </el-drawer>

    <!-- 调整席位（仅超管，只增不减） -->
    <el-dialog v-model="seatVisible" title="调整企业席位" width="440px" :close-on-click-modal="false">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="席位仅支持人工增加，增加后立即生效并推送在线成员权益。"
        style="margin-bottom: 16px"
      />
      <el-form label-width="90px">
        <el-form-item label="企业">{{ seatForm.name }}</el-form-item>
        <el-form-item label="当前席位">{{ seatForm.current }}</el-form-item>
        <el-form-item label="目标席位">
          <el-input-number v-model="seatForm.seats" :min="seatForm.current + 1" :max="10000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="seatVisible = false">取消</el-button>
        <el-button type="primary" :loading="seatSaving" @click="submitSeats">确认增加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Refresh } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import TimeCell from '@/components/TimeCell.vue'
import { useUserStore } from '@/stores/user'
import {
  getEnterprises,
  getEnterpriseDetail,
  updateEnterpriseSeats,
  type EnterpriseItem,
  type EnterpriseDetail,
} from '@/api/enterprises'

const store = useUserStore()

const ENT_STATUS: Record<number, { label: string; type: 'success' | 'info' | 'danger' }> = {
  1: { label: '正常', type: 'success' },
  2: { label: '停用', type: 'info' },
  3: { label: '到期', type: 'danger' },
}
const MEMBER_STATUS: Record<number, string> = { 1: '正常', 2: '停用', 3: '已退出' }

const query = reactive({ page: 1, pageSize: 20, keyword: '', status: '' as number | '' })
const list = ref<EnterpriseItem[]>([])
const total = ref(0)
const loading = ref(false)

function renderTime(v: string | null) {
  return v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'
}

async function load() {
  loading.value = true
  try {
    const res = await getEnterprises(query)
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
  query.status = ''
  search()
}

// ============ 详情 ============
const detailVisible = ref(false)
const detail = ref<EnterpriseDetail | null>(null)

async function openDetail(row: { id: string }) {
  detailVisible.value = true
  detail.value = null
  try {
    detail.value = await getEnterpriseDetail(row.id)
  } catch {
    detailVisible.value = false
  }
}

// ============ 调整席位 ============
const seatVisible = ref(false)
const seatSaving = ref(false)
const seatForm = reactive({ id: '', name: '', current: 1, seats: 2 })
const seatFromDrawer = ref(false)

function openSeatDialog(ent: { id: string; name: string; seats: number }, fromDrawer = false) {
  seatFromDrawer.value = fromDrawer
  seatForm.id = ent.id
  seatForm.name = ent.name
  seatForm.current = ent.seats
  seatForm.seats = ent.seats + 1
  seatVisible.value = true
}

async function submitSeats() {
  if (seatForm.seats <= seatForm.current) {
    ElMessage.warning('席位只允许增加')
    return
  }
  seatSaving.value = true
  try {
    await updateEnterpriseSeats(seatForm.id, seatForm.seats)
    ElMessage.success(`已增加至 ${seatForm.seats} 个席位，权益推送已触发`)
    seatVisible.value = false
    load()
    if (seatFromDrawer.value && detail.value?.enterprise.id === seatForm.id) {
      await openDetail(detail.value.enterprise)
    }
  } finally {
    seatSaving.value = false
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
.text-secondary {
  color: var(--text-secondary);
  font-size: 12px;
}
.detail-title {
  margin: 18px 0 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
}
</style>
