<template>
  <div class="page-container">
    <div class="toolbar-card">
      <span class="page-title">账号管理</span>
      <div class="toolbar-right">
        <el-input v-model="query.keyword" placeholder="账号 / 昵称 / 邮箱" clearable style="width: 220px" @keyup.enter="search" />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px">
          <el-option label="正常" :value="1" />
          <el-option label="停用" :value="2" />
          <el-option label="锁定" :value="3" />
        </el-select>
        <el-select v-model="query.role" placeholder="角色" clearable style="width: 130px">
          <el-option label="个人" :value="1" />
          <el-option label="企业管理员" :value="2" />
          <el-option label="企业成员" :value="3" />
        </el-select>
        <el-button type="primary" :icon="Search" @click="search">查询</el-button>
        <el-button :icon="Refresh" @click="reset">重置</el-button>
      </div>
    </div>

    <!-- 运营指标 -->
    <div v-if="metrics" class="metric-row">
      <div class="metric-card"><span class="metric-label">账号总数</span><span class="metric-value">{{ metrics.accounts.total }}</span></div>
      <div class="metric-card"><span class="metric-label">今日新增</span><span class="metric-value">{{ metrics.accounts.todayNew }}</span></div>
      <div class="metric-card"><span class="metric-label">锁定 / 锁定率</span><span class="metric-value warn">{{ metrics.accounts.locked }} <small>{{ metrics.accounts.lockedRate }}%</small></span></div>
      <div class="metric-card"><span class="metric-label">累计锁定次数</span><span class="metric-value">{{ metrics.accounts.lockTotal }}</span></div>
      <div class="metric-card"><span class="metric-label">企业总数</span><span class="metric-value">{{ metrics.enterprises.total }}</span></div>
      <div class="metric-card"><span class="metric-label">企业 7 天内到期</span><span class="metric-value warn">{{ metrics.enterprises.expiring7 }}</span></div>
      <div class="metric-card"><span class="metric-label">IP 资源异常率</span><span class="metric-value">{{ metrics.ipResources.abnormalRate }}%</span></div>
      <div class="metric-card"><span class="metric-label">7 天升级码 / 席位码核销</span><span class="metric-value">{{ metrics.vouchers.upgradeUsed7 }} / {{ metrics.vouchers.seatUsed7 }}</span></div>
    </div>

    <div class="table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="ID" prop="id" width="80" />
        <el-table-column label="账号" min-width="150">
          <template #default="{ row }">
            <div>{{ row.login }}</div>
            <div v-if="row.nickname" class="text-secondary">{{ row.nickname }}</div>
          </template>
        </el-table-column>
        <el-table-column label="身份" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.role === 2 ? 'warning' : row.role === 3 ? 'info' : ''">
              {{ ROLE_TEXT[row.role] || row.role }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="所属企业" min-width="150">
          <template #default="{ row }">
            <span v-if="row.enterpriseCode">{{ row.enterpriseName }}（{{ row.enterpriseCode }}）</span>
            <span v-else class="text-secondary">-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 1 ? 'success' : row.status === 2 ? 'info' : 'danger'" effect="plain">
              {{ row.status === 1 ? '正常' : row.status === 2 ? '停用' : '锁定' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="锁定到期" width="160">
          <template #default="{ row }">
            <span v-if="row.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now()" class="danger">
              {{ formatTime(row.lockedUntil) }}
            </span>
            <span v-else class="text-secondary">-</span>
          </template>
        </el-table-column>
        <el-table-column label="最后登录" width="160">
          <template #default="{ row }"><TimeCell :value="row.lastLoginAt" /></template>
        </el-table-column>
        <el-table-column label="注册时间" width="160">
          <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleUnlock(row)">解锁</el-button>
            <el-button link type="warning" size="small" @click="handleReset(row)">重置密码</el-button>
            <el-button
              link
              :type="row.status === 2 ? 'success' : 'danger'"
              size="small"
              @click="handleToggle(row)"
            >{{ row.status === 2 ? '启用' : '停用' }}</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无账号" :image-size="80" /></template>
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

    <!-- 一次性密码 -->
    <el-dialog v-model="pwdVisible" title="密码已重置" width="460px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon title="该密码仅展示一次，关闭后无法再次查看" />
      <el-descriptions :column="1" border style="margin-top: 16px">
        <el-descriptions-item label="账号">{{ pwdInfo.login }}</el-descriptions-item>
        <el-descriptions-item label="一次性密码">
          <span class="code-font">{{ pwdInfo.password }}</span>
          <el-button link type="primary" :icon="CopyDocument" @click="copyText(pwdInfo.password)">复制</el-button>
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="pwdVisible = false">我已记录</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, CopyDocument } from '@element-plus/icons-vue'
import TimeCell from '@/components/TimeCell.vue'
import dayjs from 'dayjs'
import {
  getAccounts, getAccountMetrics, unlockAccount, resetAccountPassword, setAccountStatus,
  type AccountItem, type AccountMetrics,
} from '@/api/accounts'

const ROLE_TEXT: Record<number, string> = { 1: '个人', 2: '企业管理员', 3: '企业成员' }

const query = reactive({ page: 1, pageSize: 20, keyword: '', status: '' as number | '', role: '' as number | '' })
const list = ref<AccountItem[]>([])
const total = ref(0)
const loading = ref(false)
const metrics = ref<AccountMetrics | null>(null)

function formatTime(v: string) {
  return dayjs(v).format('YYYY-MM-DD HH:mm')
}

async function load() {
  loading.value = true
  try {
    const res = await getAccounts(query)
    list.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}

async function loadMetrics() {
  try {
    metrics.value = await getAccountMetrics()
  } catch {
    metrics.value = null
  }
}

function search() {
  query.page = 1
  load()
}

function reset() {
  query.keyword = ''
  query.status = ''
  query.role = ''
  search()
}

async function handleUnlock(row: AccountItem) {
  await unlockAccount(row.id)
  ElMessage.success(`账号「${row.login}」已解锁`)
  load()
  loadMetrics()
}

const pwdVisible = ref(false)
const pwdInfo = reactive({ login: '', password: '' })

async function handleReset(row: AccountItem) {
  try {
    await ElMessageBox.confirm(
      `确定重置账号「${row.login}」的密码吗？重置后该账号全部登录会话将被吊销，原密码立即失效。`,
      '重置密码',
      { type: 'warning', confirmButtonText: '确认重置', cancelButtonText: '取消' }
    )
    const res = await resetAccountPassword(row.id)
    pwdInfo.login = res.login
    pwdInfo.password = res.password
    pwdVisible.value = true
    load()
  } catch {
    // 取消或已提示
  }
}

async function handleToggle(row: AccountItem) {
  const enable = row.status === 2
  try {
    await ElMessageBox.confirm(
      enable ? `确定启用账号「${row.login}」吗？` : `确定停用账号「${row.login}」吗？停用后立即吊销其全部会话。`,
      enable ? '启用确认' : '停用确认',
      { type: enable ? 'success' : 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }
    )
    await setAccountStatus(row.id, enable ? 1 : 2)
    ElMessage.success(enable ? '已启用' : '已停用')
    load()
    loadMetrics()
  } catch {
    // 取消或已提示
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

onMounted(() => {
  load()
  loadMetrics()
})
</script>

<style scoped lang="scss">
.toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
.metric-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.metric-card {
  background: #fff;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.06);
}
.metric-label {
  font-size: 13px;
  color: var(--text-secondary);
}
.metric-value {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-main);
  small {
    font-size: 13px;
    font-weight: 400;
    color: var(--text-secondary);
  }
  &.warn {
    color: var(--warning-color, #e6a23c);
  }
}
.text-secondary {
  color: var(--text-secondary);
  font-size: 12px;
}
.danger {
  color: var(--danger-color);
}
.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 0;
}
</style>
