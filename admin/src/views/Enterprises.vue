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
    <el-dialog
      v-model="detailVisible"
      :title="`企业详情：${detail?.enterprise.name || ''}`"
      width="960px"
      top="5vh"
    >
      <div v-loading="detailLoading" class="detail-body">
        <template v-if="detail">
          <div class="detail-head">
            <div class="detail-name">{{ detail.enterprise.name }}</div>
            <span class="code-font detail-code">{{ detail.enterprise.code }}</span>
            <el-tag size="small" :type="ENT_STATUS[detail.enterprise.status]?.type || 'info'">
              {{ ENT_STATUS[detail.enterprise.status]?.label || detail.enterprise.status }}
            </el-tag>
            <el-tag v-if="detail.enterprise.skuLabel" size="small" effect="plain" type="success">
              {{ detail.enterprise.skuLabel }}
            </el-tag>
          </div>

          <div class="detail-section">
            <div class="section-title">企业信息</div>
            <el-descriptions :column="3" border size="small">
              <el-descriptions-item label="企业 ID">{{ detail.enterprise.id }}</el-descriptions-item>
              <el-descriptions-item label="企业码">
                <span class="code-font">{{ detail.enterprise.code }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="账号前缀">{{ detail.enterprise.codePrefix }}</el-descriptions-item>
              <el-descriptions-item label="企业管理员">
                {{ detail.enterprise.ownerLogin || `账号#${detail.enterprise.ownerAccountId}` }}
              </el-descriptions-item>
              <el-descriptions-item label="管理员昵称">{{ detail.enterprise.ownerNickname || '-' }}</el-descriptions-item>
              <el-descriptions-item label="联系邮箱">{{ detail.enterprise.ownerEmail || '-' }}</el-descriptions-item>
              <el-descriptions-item label="席位（已用 / 总数）">
                {{ detail.enterprise.usedSeats }} / {{ detail.enterprise.seats }}
              </el-descriptions-item>
              <el-descriptions-item label="到期时间">{{ renderTime(detail.enterprise.expireAt) }}</el-descriptions-item>
              <el-descriptions-item label="最后登录">{{ renderTime(detail.enterprise.ownerLastLoginAt) }}</el-descriptions-item>
              <el-descriptions-item label="创建时间">{{ renderTime(detail.enterprise.createdAt) }}</el-descriptions-item>
              <el-descriptions-item label="更新时间">{{ renderTime(detail.enterprise.updatedAt) }}</el-descriptions-item>
              <el-descriptions-item label="网络 IP">{{ detail.ipResources.using > 0 ? '已启用' : '未使用' }}</el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="detail-section">
            <div class="section-title">授权与等级</div>
            <el-descriptions v-if="detail.entitlements" :column="3" border size="small">
              <el-descriptions-item label="版本">
                {{ ENT_VERSION_TEXT[detail.entitlements.version] || detail.entitlements.version }}
              </el-descriptions-item>
              <el-descriptions-item label="等级">
                {{ ENT_LEVEL_TEXT[detail.entitlements.level] || detail.entitlements.level }}
              </el-descriptions-item>
              <el-descriptions-item label="角色">
                {{ ENT_ROLE_TEXT[detail.entitlements.role] || detail.entitlements.role }}
              </el-descriptions-item>
              <el-descriptions-item label="到期时间">
                {{ detail.entitlements.permanent ? '永久' : renderTime(detail.entitlements.expireAt) }}
              </el-descriptions-item>
              <el-descriptions-item label="席位">{{ detail.entitlements.seats }}</el-descriptions-item>
              <el-descriptions-item label="当前卡密">{{ detail.entitlements.activeKeyId ? `#${detail.entitlements.activeKeyId}` : '-' }}</el-descriptions-item>
            </el-descriptions>
            <el-empty v-else description="暂无授权信息" :image-size="60" />
          </div>

          <div class="detail-section">
            <div class="section-title">
              子账户（{{ detail.members.length }}）
              <el-button
                v-if="store.isSuperAdmin"
                link
                type="warning"
                size="small"
                @click="openSeatDialog(detail.enterprise, true)"
              >调整席位</el-button>
            </div>
            <el-table :data="detail.members" size="small" stripe max-height="300">
              <el-table-column label="账号" min-width="150">
                <template #default="{ row }">
                  <div>{{ row.login || `账号#${row.accountId}` }}</div>
                  <div v-if="row.nickname" class="text-secondary">{{ row.nickname }}</div>
                </template>
              </el-table-column>
              <el-table-column label="邮箱" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">{{ row.email || '-' }}</template>
              </el-table-column>
              <el-table-column label="角色" width="100" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.role === 1 ? 'warning' : 'info'" effect="plain">
                    {{ row.role === 1 ? '企业管理员' : '企业成员' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.status === 1 ? 'success' : row.status === 3 ? 'danger' : 'info'">
                    {{ MEMBER_STATUS[row.status] || row.status }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="最后登录 IP" width="130">
                <template #default="{ row }">{{ row.lastLoginIp || '-' }}</template>
              </el-table-column>
              <el-table-column label="最后登录" width="150">
                <template #default="{ row }"><TimeCell :value="row.lastLoginAt" /></template>
              </el-table-column>
              <el-table-column label="加入时间" width="150">
                <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
              </el-table-column>
              <template #empty><el-empty description="暂无子账户" :image-size="60" /></template>
            </el-table>
          </div>

          <div class="detail-section">
            <div class="section-title">绑定激活码（{{ detail.keys.length }}）</div>
            <el-table :data="detail.keys" size="small" stripe max-height="300">
              <el-table-column label="卡密" min-width="170">
                <template #default="{ row }"><span class="code-font">{{ row.code }}</span></template>
              </el-table-column>
              <el-table-column label="档位" width="130">
                <template #default="{ row }">{{ TIER_TEXT[row.tier] || '-' }} · {{ KEY_LEVEL_TEXT[row.level] || '-' }}</template>
              </el-table-column>
              <el-table-column label="绑定用户" width="130" show-overflow-tooltip>
                <template #default="{ row }">{{ row.accountLogin || (row.accountId ? `账号#${row.accountId}` : '-') }}</template>
              </el-table-column>
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-tag size="small" effect="plain">{{ KEY_STATUS_TEXT[row.status] || row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="绑定时间" width="150">
                <template #default="{ row }"><TimeCell :value="row.activatedAt || row.usedAt" /></template>
              </el-table-column>
              <el-table-column label="到期时间" width="150">
                <template #default="{ row }"><TimeCell :value="row.accountExpireAt" /></template>
              </el-table-column>
              <template #empty><el-empty description="暂无激活码" :image-size="60" /></template>
            </el-table>
          </div>

          <div class="detail-section">
            <div class="section-title">网络 IP 资源</div>
            <div class="ip-summary">
              <el-tag size="small" type="info" effect="plain">总数 {{ detail.ipResources.total }}</el-tag>
              <el-tag size="small" type="success" effect="plain">启用 {{ detail.ipResources.enabled }}</el-tag>
              <el-tag size="small" type="warning" effect="plain">已分配 {{ detail.ipResources.assigned }}</el-tag>
              <el-tag size="small" type="primary" effect="plain">使用中 {{ detail.ipResources.using }}</el-tag>
            </div>
            <el-table v-if="detail.ipResources.list.length" :data="detail.ipResources.list" size="small" stripe max-height="240">
              <el-table-column label="主机" min-width="150" prop="host" show-overflow-tooltip />
              <el-table-column label="端口" width="80" prop="port" />
              <el-table-column label="协议" width="80" prop="proxyType" />
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.status === 1 ? 'success' : 'info'">
                    {{ row.status === 1 ? '启用' : '停用' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="健康" width="80" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="IP_HEALTH[row.health]?.type || 'info'">
                    {{ IP_HEALTH[row.health]?.label || row.health }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="分配" width="90" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.assigned ? 'warning' : 'info'" effect="plain">
                    {{ row.assigned ? '已分配' : '空闲' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="备注" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">{{ row.remark || '-' }}</template>
              </el-table-column>
            </el-table>
            <el-empty v-else description="该企业未使用网络 IP" :image-size="60" />
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

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
const TIER_TEXT: Record<number, string> = { 1: '个人版', 2: '企业版' }
const KEY_LEVEL_TEXT: Record<number, string> = { 1: '普通', 2: '高级' }
const KEY_STATUS_TEXT: Record<number, string> = {
  0: '未用', 1: '已用', 2: '作废', 3: '过期', 4: '已换机', 5: '已删除',
}
const ENT_VERSION_TEXT: Record<string, string> = { none: '未授权', personal: '个人版', enterprise: '企业版' }
const ENT_LEVEL_TEXT: Record<string, string> = { none: '未授权', normal: '普通', pro: '高级' }
const ENT_ROLE_TEXT: Record<string, string> = { user: '个人用户', admin: '企业管理员', member: '企业成员' }
const IP_HEALTH: Record<number, { label: string; type: 'info' | 'success' | 'danger' }> = {
  1: { label: '未测', type: 'info' },
  2: { label: '正常', type: 'success' },
  3: { label: '异常', type: 'danger' },
}

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
const detailLoading = ref(false)
const detail = ref<EnterpriseDetail | null>(null)

async function openDetail(row: { id: string }) {
  detailVisible.value = true
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await getEnterpriseDetail(row.id)
  } catch {
    detailVisible.value = false
  } finally {
    detailLoading.value = false
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
.detail-body {
  max-height: 72vh;
  overflow-y: auto;
  padding-right: 4px;
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;

  .detail-name {
    font-size: 16px;
    font-weight: 600;
    color: #1f2d4d;
  }
  .detail-code {
    font-size: 13px;
  }
}
.detail-section {
  margin-bottom: 18px;

  .section-title {
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #1f2d4d;
    display: flex;
    align-items: center;
    gap: 8px;
  }
}
.ip-summary {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
}
</style>
