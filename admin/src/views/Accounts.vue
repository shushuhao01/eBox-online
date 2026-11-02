<template>
  <div class="page-container">
    <div class="toolbar-card">
      <span class="page-title">用户管理</span>
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
        <el-table-column label="ID" prop="id" width="64" />
        <el-table-column label="账号" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.login }}</span>
            <span v-if="row.nickname" class="text-secondary"> · {{ row.nickname }}</span>
          </template>
        </el-table-column>
        <el-table-column label="邮箱" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.email">{{ row.email }}</span>
            <span v-else class="text-secondary">-</span>
          </template>
        </el-table-column>
        <el-table-column label="身份" width="92" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.role === 2 ? 'warning' : row.role === 3 ? 'info' : ''">
              {{ ROLE_TEXT[row.role] || row.role }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="所属企业" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.enterpriseCode">{{ row.enterpriseName }}（{{ row.enterpriseCode }}）</span>
            <span v-else class="text-secondary">-</span>
          </template>
        </el-table-column>
        <el-table-column label="客户端版本" width="110" align="center">
          <template #default="{ row }">
            <span v-if="row.clientVersion" class="code-font">{{ row.clientVersion }}</span>
            <span v-else class="text-secondary">-</span>
          </template>
        </el-table-column>
        <el-table-column label="卡密档位" width="96" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.keyPlan" size="small" effect="plain">{{ row.keyPlan }}</el-tag>
            <span v-else class="text-secondary">-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="76" align="center">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.status === 3 && row.lockedUntil"
              :content="`锁定至 ${formatTime(row.lockedUntil)}`"
              placement="top"
            >
              <el-tag size="small" type="danger" effect="plain">锁定</el-tag>
            </el-tooltip>
            <el-tag v-else size="small" :type="row.status === 1 ? 'success' : 'info'" effect="plain">
              {{ row.status === 1 ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后登录" width="140">
          <template #default="{ row }"><TimeCell :value="row.lastLoginAt" /></template>
        </el-table-column>
        <el-table-column label="注册时间" width="140">
          <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
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
        <template #empty><el-empty description="暂无用户" :image-size="80" /></template>
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

    <!-- 用户详情 -->
    <el-dialog v-model="detailVisible" title="用户详情" width="940px" top="6vh">
      <div v-loading="detailLoading" class="detail-body">
        <template v-if="detail">
          <div class="detail-head">
            <div class="detail-name">
              {{ detail.account.login }}
              <span v-if="detail.account.nickname" class="text-secondary">（{{ detail.account.nickname }}）</span>
            </div>
            <div class="detail-tags">
              <el-tag size="small" :type="detail.account.role === 2 ? 'warning' : detail.account.role === 3 ? 'info' : ''">
                {{ ROLE_TEXT[detail.account.role] || detail.account.role }}
              </el-tag>
              <el-tag size="small" :type="detail.account.status === 1 ? 'success' : detail.account.status === 2 ? 'info' : 'danger'" effect="plain">
                {{ detail.account.status === 1 ? '正常' : detail.account.status === 2 ? '停用' : '锁定' }}
              </el-tag>
              <el-tag v-if="detail.enterprise" size="small" type="warning" effect="plain">
                {{ detail.enterprise.name }}（{{ detail.enterprise.code }}）
              </el-tag>
            </div>
          </div>

          <div class="detail-section">
            <div class="section-title">个人信息</div>
            <el-descriptions :column="3" border size="small">
              <el-descriptions-item label="用户 ID">{{ detail.account.id }}</el-descriptions-item>
              <el-descriptions-item label="账号">{{ detail.account.login }}</el-descriptions-item>
              <el-descriptions-item label="昵称">{{ detail.account.nickname || '-' }}</el-descriptions-item>
              <el-descriptions-item label="邮箱">{{ detail.account.email || '-' }}</el-descriptions-item>
              <el-descriptions-item label="手机">{{ detail.account.phone || '-' }}</el-descriptions-item>
              <el-descriptions-item label="角色">{{ ROLE_TEXT[detail.account.role] || '-' }}</el-descriptions-item>
              <el-descriptions-item label="注册时间">{{ formatTime(detail.account.createdAt) }}</el-descriptions-item>
              <el-descriptions-item label="最后登录">{{ formatTime(detail.account.lastLoginAt) }}</el-descriptions-item>
              <el-descriptions-item label="最后登录 IP">
                {{ detail.account.lastLoginIp || '-' }}
                <span v-if="detail.account.lastLoginRegion" class="text-secondary">（{{ detail.account.lastLoginRegion }}）</span>
              </el-descriptions-item>
              <el-descriptions-item label="锁定次数">{{ detail.account.lockCount }}</el-descriptions-item>
              <el-descriptions-item label="锁定到期">{{ formatTime(detail.account.lockedUntil) }}</el-descriptions-item>
              <el-descriptions-item label="曾经企业">{{ detail.account.everEnterprise ? '是' : '否' }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="detail-section">
            <div class="section-title">授权信息</div>
            <el-descriptions :column="3" border size="small">
              <el-descriptions-item label="版本">{{ VERSION_TEXT[detail.entitlements.version] || detail.entitlements.version }}</el-descriptions-item>
              <el-descriptions-item label="等级">{{ ENT_LEVEL_TEXT[detail.entitlements.level] || detail.entitlements.level }}</el-descriptions-item>
              <el-descriptions-item label="身份">{{ ENT_ROLE_TEXT[detail.entitlements.role] || detail.entitlements.role }}</el-descriptions-item>
              <el-descriptions-item label="到期时间">{{ detail.entitlements.permanent ? '永久' : formatTime(detail.entitlements.expireAt) }}</el-descriptions-item>
              <el-descriptions-item label="企业席位">{{ detail.entitlements.seats || '-' }}</el-descriptions-item>
              <el-descriptions-item label="当前卡密">{{ detail.currentKey ? detail.currentKey.codeMasked : '未绑定' }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="detail-section">
            <div class="section-title">绑定激活码（{{ detail.keys.length }}）</div>
            <el-table :data="detail.keys" size="small" stripe max-height="220">
              <el-table-column label="卡密" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">{{ row.code }}</template>
              </el-table-column>
              <el-table-column label="档位" width="120">
                <template #default="{ row }">{{ TIER_TEXT[row.tier] || '-' }} · {{ KEY_LEVEL_TEXT[row.level] || '-' }}</template>
              </el-table-column>
              <el-table-column label="时长" width="80">
                <template #default="{ row }">{{ row.durationDays ? `${row.durationDays}天` : '永久' }}</template>
              </el-table-column>
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">{{ KEY_STATUS_TEXT[row.status] || row.status }}</template>
              </el-table-column>
              <el-table-column label="激活时间" width="140">
                <template #default="{ row }"><TimeCell :value="row.activatedAt || row.usedAt" /></template>
              </el-table-column>
              <el-table-column label="到期时间" width="140">
                <template #default="{ row }"><TimeCell :value="row.accountExpireAt || row.expireAt" /></template>
              </el-table-column>
              <template #empty><span class="text-secondary">暂无绑定卡密</span></template>
            </el-table>
          </div>

          <div class="detail-section">
            <div class="section-title">激活记录 / 心跳（{{ detail.activations.length }}）</div>
            <el-table :data="detail.activations" size="small" stripe max-height="240">
              <el-table-column label="卡密" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">{{ row.keyCode || '-' }}</template>
              </el-table-column>
              <el-table-column label="机器码" width="140" show-overflow-tooltip>
                <template #default="{ row }">{{ row.machineFp }}</template>
              </el-table-column>
              <el-table-column label="状态" width="72" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.online ? 'success' : 'info'" effect="plain">{{ row.online ? '在线' : '离线' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="首次激活" width="140">
                <template #default="{ row }"><TimeCell :value="row.firstActivateAt" /></template>
              </el-table-column>
              <el-table-column label="最近心跳" width="140">
                <template #default="{ row }"><TimeCell :value="row.lastHeartbeatAt || row.lastOnlineAt" /></template>
              </el-table-column>
              <el-table-column label="IP / 地区" min-width="150" show-overflow-tooltip>
                <template #default="{ row }">
                  {{ row.lastIp || '-' }}
                  <span v-if="row.region" class="text-secondary">（{{ row.region }}）</span>
                </template>
              </el-table-column>
              <el-table-column label="系统" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">{{ row.osInfo || '-' }}</template>
              </el-table-column>
              <el-table-column label="版本" width="80">
                <template #default="{ row }">{{ row.appVersion || '-' }}</template>
              </el-table-column>
              <template #empty><span class="text-secondary">暂无激活记录</span></template>
            </el-table>
          </div>

          <div class="detail-section">
            <div class="section-title">环境与设备（{{ detail.devices.length }}）</div>
            <el-table :data="detail.devices" size="small" stripe max-height="200">
              <el-table-column label="机器码" width="140" show-overflow-tooltip>
                <template #default="{ row }">{{ row.machineFp }}</template>
              </el-table-column>
              <el-table-column label="设备名" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">{{ row.deviceName || '-' }}</template>
              </el-table-column>
              <el-table-column label="环境总数" width="90" align="center">
                <template #default="{ row }">{{ row.envTotal }}</template>
              </el-table-column>
              <el-table-column label="运行中" width="80" align="center">
                <template #default="{ row }">{{ row.envRunning }}</template>
              </el-table-column>
              <el-table-column label="绑定 IP" width="80" align="center">
                <template #default="{ row }">{{ row.boundResourceIds.length }}</template>
              </el-table-column>
              <el-table-column label="首次登录" width="140">
                <template #default="{ row }"><TimeCell :value="row.firstLoginAt" /></template>
              </el-table-column>
              <el-table-column label="最后活跃" width="140">
                <template #default="{ row }"><TimeCell :value="row.lastActiveAt" /></template>
              </el-table-column>
              <template #empty><span class="text-secondary">暂无设备数据</span></template>
            </el-table>
          </div>

          <div class="detail-section">
            <div class="section-title">登录会话（{{ detail.sessions.length }}）</div>
            <el-table :data="detail.sessions" size="small" stripe max-height="200">
              <el-table-column label="IP / 地区" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">
                  {{ row.clientIp || '-' }}
                  <span v-if="row.region" class="text-secondary">（{{ row.region }}）</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="72" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.online ? 'success' : row.revokedAt ? 'danger' : 'info'" effect="plain">
                    {{ row.revokedAt ? '已吊销' : row.online ? '在线' : '离线' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="最近活跃" width="140">
                <template #default="{ row }"><TimeCell :value="row.lastSeenAt" /></template>
              </el-table-column>
              <el-table-column label="登录时间" width="140">
                <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
              </el-table-column>
              <el-table-column label="客户端" min-width="220" show-overflow-tooltip>
                <template #default="{ row }">{{ row.userAgent || '-' }}</template>
              </el-table-column>
              <template #empty><span class="text-secondary">暂无会话</span></template>
            </el-table>
          </div>

          <div class="detail-section">
            <div class="section-title">网络 IP 资源（{{ detail.ipResources.length }}）</div>
            <el-table :data="detail.ipResources" size="small" stripe max-height="200">
              <el-table-column label="代理地址" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">{{ row.proxyType }}://{{ row.host }}:{{ row.port }}</template>
              </el-table-column>
              <el-table-column label="环境" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">{{ row.envName || row.envId || '-' }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">{{ IP_STATUS_TEXT[row.status] || row.status }}</template>
              </el-table-column>
              <el-table-column label="绑定时间" width="140">
                <template #default="{ row }"><TimeCell :value="row.boundAt" /></template>
              </el-table-column>
              <el-table-column label="释放时间" width="140">
                <template #default="{ row }"><TimeCell :value="row.releasedAt" /></template>
              </el-table-column>
              <template #empty><span class="text-secondary">未使用网络 IP</span></template>
            </el-table>
          </div>

          <div v-if="!detail.keys.length && !detail.activations.length && !detail.devices.length" class="detail-empty">
            <el-empty description="该用户暂无授权与设备数据" :image-size="64" />
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
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
  getAccounts, getAccountMetrics, getAccountDetail, unlockAccount, resetAccountPassword, setAccountStatus,
  type AccountItem, type AccountMetrics, type AccountDetail,
} from '@/api/accounts'

const ROLE_TEXT: Record<number, string> = { 1: '个人', 2: '企业管理员', 3: '企业成员' }
const TIER_TEXT: Record<number, string> = { 1: '个人版', 2: '企业版' }
const KEY_LEVEL_TEXT: Record<number, string> = { 1: '普通', 2: '高级' }
const VERSION_TEXT: Record<string, string> = { none: '未授权', personal: '个人版', enterprise: '企业版' }
const ENT_LEVEL_TEXT: Record<string, string> = { none: '未授权', normal: '普通', pro: '高级' }
const ENT_ROLE_TEXT: Record<string, string> = { user: '个人用户', admin: '企业管理员', member: '企业成员' }
const KEY_STATUS_TEXT: Record<number, string> = { 0: '未用', 1: '已用', 2: '作废', 3: '过期', 4: '已换机', 5: '已删除' }
const IP_STATUS_TEXT: Record<number, string> = { 1: '已分配', 2: '使用中', 3: '已回收' }

const query = reactive({ page: 1, pageSize: 20, keyword: '', status: '' as number | '', role: '' as number | '' })
const list = ref<AccountItem[]>([])
const total = ref(0)
const loading = ref(false)
const metrics = ref<AccountMetrics | null>(null)

function formatTime(v: string | null | undefined) {
  if (!v) return '-'
  return dayjs(v).format('YYYY-MM-DD HH:mm')
}

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<AccountDetail | null>(null)

async function openDetail(row: AccountItem) {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await getAccountDetail(row.id)
  } catch {
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
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
.detail-body {
  max-height: 68vh;
  overflow-y: auto;
  padding-right: 4px;
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 12px;
}
.detail-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
}
.detail-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.detail-section {
  margin-bottom: 16px;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
  margin-bottom: 8px;
  padding-left: 8px;
  border-left: 3px solid var(--primary-color, #409eff);
  line-height: 1.2;
}
.detail-empty {
  padding-bottom: 8px;
}
</style>
