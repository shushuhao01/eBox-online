<template>
  <div class="page-container">
    <!-- 工具栏 -->
    <div class="toolbar-card">
      <span class="page-title">营销管理</span>
      <el-input
        v-model="keyword"
        placeholder="搜索标题 / 邮件主题"
        clearable
        style="width: 220px"
        @keyup.enter="reload"
        @clear="reload"
      />
      <el-select v-model="status" placeholder="全部状态" clearable style="width: 140px" @change="reload">
        <el-option label="草稿" value="DRAFT" />
        <el-option label="定时待发" value="SCHEDULED" />
        <el-option label="已发送" value="SENT" />
      </el-select>
      <el-button :icon="Refresh" @click="reload">刷新</el-button>
      <div class="toolbar-right">
        <span class="hint">当前可投递账号：{{ audience.all_users }} 个</span>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建营销邮件</el-button>
      </div>
    </div>

    <!-- 列表 -->
    <div class="table-card">
      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column label="标题" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="campaign-title">{{ row.title }}</span>
          </template>
        </el-table-column>
        <el-table-column label="邮件主题" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.subject || row.title }}</template>
        </el-table-column>
        <el-table-column label="受众" width="120" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ audienceLabel(row.audience_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="送达 / 失败" width="110" align="center">
          <template #default="{ row }">
            <span class="count-ok">{{ row.sent_count }}</span>
            <span class="count-sep">/</span>
            <span :class="row.failed_count > 0 ? 'count-bad' : 'count-sep'">{{ row.failed_count }}</span>
          </template>
        </el-table-column>
        <el-table-column label="已读 / 未读" width="110" align="center">
          <template #default="{ row }">
            <span class="count-ok">{{ row.opened_count || 0 }}</span>
            <span class="count-sep">/</span>
            <span class="count-sep">{{ Math.max(0, (row.sent_count || 0) - (row.opened_count || 0)) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="发送时间" width="110">
          <template #default="{ row }">
            <TimeCell :value="row.sent_at || row.send_at" />
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="290" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openView(row)">查看</el-button>
            <el-button
              link
              type="primary"
              size="small"
              :disabled="row.status === 'SENT'"
              @click="openEdit(row)"
            >编辑</el-button>
            <el-button
              link
              type="primary"
              size="small"
              :disabled="row.status === 'SENT'"
              @click="handleSend(row)"
            >发送</el-button>
            <el-button link type="primary" size="small" @click="openRecipients(row)">发送用户</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无营销邮件" :image-size="80" /></template>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="load"
        />
      </div>
    </div>

    <!-- 编辑抽屉 -->
    <el-drawer v-model="drawerVisible" :title="form.id ? '编辑营销邮件' : '新建营销邮件'" size="820px">
      <el-form :model="form" label-width="92px">
        <el-form-item label="邮件标题" required>
          <el-input v-model="form.title" maxlength="255" placeholder="仅后台可见，用于区分不同活动" />
        </el-form-item>
        <el-form-item label="邮件主题">
          <el-input v-model="form.subject" maxlength="255" placeholder="收件箱中显示的标题，留空则使用邮件标题" />
        </el-form-item>
        <el-form-item label="受众">
          <el-radio-group v-model="form.audience_type">
            <el-radio value="ALL_USERS">全部注册用户（{{ audience.all_users }} 个）</el-radio>
            <el-radio value="USER_IDS">指定账号</el-radio>
            <el-radio value="EMAILS">指定邮箱</el-radio>
          </el-radio-group>
          <div v-if="form.audience_type !== 'ALL_USERS'" class="audience-target">
            <el-input
              v-model="form.targets"
              type="textarea"
              :rows="4"
              :placeholder="form.audience_type === 'USER_IDS' ? '每行一个登录账号或邮箱，也支持逗号分隔' : '每行一个邮箱，也支持逗号分隔'"
            />
            <div class="field-hint">
              {{ form.audience_type === 'USER_IDS' ? '按账号自动取绑定的邮箱；未匹配到账号时按邮箱直接发送。' : '仅向格式正确的邮箱发送，重复邮箱自动去重。' }}
            </div>
          </div>
        </el-form-item>
        <el-form-item label="定时发送">
          <el-date-picker
            v-model="form.send_at"
            type="datetime"
            placeholder="留空则保存为草稿，手动发送时立即发出"
            value-format="YYYY-MM-DD HH:mm:ss"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="邮件正文">
          <RichEditor v-model="form.content" />
          <div class="field-hint">
            支持变量：{username} 账号、{email} 邮箱、{site_name} 站点名称、{time} 发送时间；配置「邮件站点地址」后可统计打开率。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button :loading="saving" @click="submit(false)">保存草稿</el-button>
        <el-button type="primary" :loading="saving" @click="submit(true)">保存并发送</el-button>
      </template>
    </el-drawer>

    <!-- 发送用户 -->
    <el-dialog v-model="recipientsVisible" :title="`发送用户：${recipientsTitle}`" width="980px">
      <div class="recipient-summary">
        <div class="stat"><span class="stat-label">总收件人</span><span class="stat-value">{{ recipientStats.total }}</span></div>
        <div class="stat"><span class="stat-label">已送达</span><span class="stat-value count-ok">{{ recipientStats.delivered }}</span></div>
        <div class="stat"><span class="stat-label">已读</span><span class="stat-value count-ok">{{ recipientStats.opened }}</span></div>
        <div class="stat"><span class="stat-label">未读</span><span class="stat-value">{{ recipientStats.unopened }}</span></div>
        <div class="stat"><span class="stat-label">发送失败</span><span class="stat-value count-bad">{{ recipientStats.failed }}</span></div>
        <div class="stat"><span class="stat-label">待发送</span><span class="stat-value">{{ recipientStats.pending }}</span></div>
      </div>
      <el-radio-group v-model="recipientStatus" size="small" class="recipient-filter" @change="handleRecipientFilter">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="opened">已读</el-radio-button>
        <el-radio-button value="unopened">未读</el-radio-button>
        <el-radio-button value="delivered">已送达</el-radio-button>
        <el-radio-button value="failed">发送失败</el-radio-button>
        <el-radio-button value="pending">待发送</el-radio-button>
      </el-radio-group>
      <el-table v-loading="recipientsLoading" :data="recipients" stripe max-height="400">
        <el-table-column label="邮箱" min-width="200" show-overflow-tooltip prop="email" />
        <el-table-column label="账号" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.username || '-' }}</template>
        </el-table-column>
        <el-table-column label="送达状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.delivered === 1" size="small" type="success">已送达</el-tag>
            <el-tag v-else-if="row.error" size="small" type="danger">失败</el-tag>
            <el-tag v-else size="small" type="info">待发送</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="阅读状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.opened_at" size="small" type="success" effect="plain">已读</el-tag>
            <el-tag v-else-if="row.delivered === 1" size="small" type="info" effect="plain">未读</el-tag>
            <span v-else class="count-sep">-</span>
          </template>
        </el-table-column>
        <el-table-column label="发送时间" width="110">
          <template #default="{ row }"><TimeCell :value="row.sent_at" /></template>
        </el-table-column>
        <el-table-column label="打开时间" width="110">
          <template #default="{ row }"><TimeCell :value="row.opened_at" /></template>
        </el-table-column>
        <el-table-column label="错误信息" min-width="160" show-overflow-tooltip>
          <template #default="{ row }"><span class="error-text">{{ row.error || '-' }}</span></template>
        </el-table-column>
        <template #empty><el-empty description="暂无发送用户记录" :image-size="70" /></template>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="recipientsPage"
          :page-size="recipientsPageSize"
          :total="recipientsTotal"
          layout="total, prev, pager, next"
          @current-change="loadRecipients"
        />
      </div>
    </el-dialog>

    <!-- 查看发送内容 -->
    <el-dialog v-model="viewVisible" title="营销邮件详情" width="760px" top="6vh">
      <template v-if="viewRow">
        <div class="view-head">
          <div class="view-title">{{ viewRow.title }}</div>
          <div class="view-meta">
            <el-tag size="small" :type="statusTagType(viewRow.status)">{{ statusLabel(viewRow.status) }}</el-tag>
            <el-tag size="small" effect="plain">{{ audienceLabel(viewRow.audience_type) }}</el-tag>
            <span class="view-meta-text">送达 {{ viewRow.sent_count }} / 失败 {{ viewRow.failed_count }} / 已读 {{ viewRow.opened_count || 0 }}</span>
            <span class="view-meta-text">
              <TimeCell :value="viewRow.sent_at || viewRow.send_at" />
            </span>
          </div>
        </div>
        <div class="view-subject">
          <span class="view-label">邮件主题</span>
          <span>{{ viewRow.subject || viewRow.title }}</span>
        </div>
        <div class="view-label">邮件正文</div>
        <div v-if="viewRow.content" class="view-content" v-html="viewRow.content"></div>
        <div v-else class="view-content view-empty">（无正文）</div>
      </template>
      <template #footer>
        <el-button @click="viewVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import {
  getCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
  getRecipients,
  getAudienceSuggestions,
  type MarketingCampaignRow,
  type MarketingRecipientRow,
  type RecipientStats,
  type AudienceSuggestions,
} from '@/api/marketing'
import TimeCell from '@/components/TimeCell.vue'
import RichEditor from '@/components/RichEditor.vue'

const AUDIENCE_LABELS: Record<string, string> = {
  ALL_USERS: '全部注册用户',
  USER_IDS: '指定账号',
  EMAILS: '指定邮箱',
}
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SCHEDULED: '定时待发',
  SENT: '已发送',
}

function audienceLabel(v: string): string {
  return AUDIENCE_LABELS[v] || v
}
function statusLabel(v: string): string {
  return STATUS_LABELS[v] || v
}
function statusTagType(v: string): 'info' | 'warning' | 'success' | '' {
  if (v === 'SCHEDULED') return 'warning'
  if (v === 'SENT') return 'success'
  return 'info'
}

/** ISO 时间 → el-date-picker 需要的 YYYY-MM-DD HH:mm:ss */
function toDateTime(v: string | null | undefined): string {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// ============ 列表 ============
const list = ref<MarketingCampaignRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const loading = ref(false)
const keyword = ref('')
const status = ref('')
const audience = ref<AudienceSuggestions>({ all_users: 0, emails: [], usernames: [] })

async function load() {
  loading.value = true
  try {
    const res = await getCampaigns({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      status: status.value || undefined,
    })
    list.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  load()
}

async function loadAudience() {
  try {
    audience.value = await getAudienceSuggestions()
  } catch {
    /* 顶部提示为辅助信息，失败不打断列表 */
  }
}

// ============ 编辑表单 ============
const drawerVisible = ref(false)
const saving = ref(false)
const form = reactive({
  id: '',
  title: '',
  subject: '',
  audience_type: 'ALL_USERS',
  targets: '',
  send_at: '',
  content: '',
})

function parseTargets(raw: string | null): string {
  if (!raw) return ''
  try {
    const arr = JSON.parse(raw) as unknown
    if (Array.isArray(arr)) return arr.map((v) => String(v)).join('\n')
  } catch {
    /* 兼容历史纯文本 */
  }
  return raw
}

function buildTargetJson(): string | null {
  if (form.audience_type === 'ALL_USERS') return null
  const items = form.targets
    .split(/[\n,，;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return items.length > 0 ? JSON.stringify(items) : null
}

function resetForm() {
  form.id = ''
  form.title = ''
  form.subject = ''
  form.audience_type = 'ALL_USERS'
  form.targets = ''
  form.send_at = ''
  form.content = ''
}

function openCreate() {
  resetForm()
  drawerVisible.value = true
}

// ============ 查看详情 ============
const viewVisible = ref(false)
const viewRow = ref<MarketingCampaignRow | null>(null)

function openView(row: MarketingCampaignRow) {
  viewRow.value = row
  viewVisible.value = true
}

function openEdit(row: MarketingCampaignRow) {
  if (row.status === 'SENT') return
  resetForm()
  form.id = row.id
  form.title = row.title
  form.subject = row.subject || ''
  form.audience_type = row.audience_type
  form.targets = parseTargets(row.target_json)
  form.send_at = toDateTime(row.send_at)
  form.content = row.content || ''
  drawerVisible.value = true
}

async function submit(sendAfter: boolean) {
  if (!form.title.trim()) {
    ElMessage.warning('请填写邮件标题')
    return
  }
  if (form.audience_type !== 'ALL_USERS' && !buildTargetJson()) {
    ElMessage.warning('请填写受众账号或邮箱')
    return
  }
  if (sendAfter) {
    try {
      await ElMessageBox.confirm(
        `确定发送给「${audienceLabel(form.audience_type)}」吗？邮件发出后不可撤回。`,
        '发送确认',
        { type: 'warning', confirmButtonText: '发送', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }

  saving.value = true
  try {
    const payload = {
      title: form.title.trim(),
      subject: form.subject.trim() || null,
      content: form.content || '',
      audience_type: form.audience_type,
      target_json: buildTargetJson(),
      send_at: form.send_at || null,
    }
    const row = form.id ? await updateCampaign(form.id, payload) : await createCampaign(payload)
    if (sendAfter) {
      const res = await sendCampaign(row.id)
      ElMessage.success(
        res.scheduled
          ? `已设为定时发送：${toDateTime(res.send_at) || form.send_at}`
          : `已进入发送队列，共 ${res.sent ?? 0} 位收件人`,
      )
    } else {
      ElMessage.success(form.id ? '已保存' : '草稿已保存')
    }
    drawerVisible.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function handleSend(row: MarketingCampaignRow) {
  try {
    await ElMessageBox.confirm(
      `确定发送「${row.title}」吗？邮件发出后不可撤回。`,
      '发送确认',
      { type: 'warning', confirmButtonText: '发送', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const res = await sendCampaign(row.id)
  ElMessage.success(
    res.scheduled
      ? `已设为定时发送：${toDateTime(res.send_at) || toDateTime(row.send_at)}`
      : `已进入发送队列，共 ${res.sent ?? 0} 位收件人`,
  )
  await load()
}

async function handleDelete(row: MarketingCampaignRow) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.title}」及其收件人记录吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await deleteCampaign(row.id)
  ElMessage.success('已删除')
  await load()
}

// ============ 发送用户 ============
const recipientsVisible = ref(false)
const recipientsLoading = ref(false)
const recipients = ref<MarketingRecipientRow[]>([])
const recipientsTitle = ref('')
const recipientsCampaignId = ref('')
const recipientsPage = ref(1)
const recipientsPageSize = ref(10)
const recipientsTotal = ref(0)
const recipientStatus = ref('')
const recipientStats = ref<RecipientStats>({ total: 0, delivered: 0, opened: 0, unopened: 0, failed: 0, pending: 0 })

async function openRecipients(row: MarketingCampaignRow) {
  recipientsCampaignId.value = row.id
  recipientsTitle.value = row.title
  recipientsPage.value = 1
  recipientStatus.value = ''
  recipientStats.value = { total: 0, delivered: 0, opened: 0, unopened: 0, failed: 0, pending: 0 }
  recipientsVisible.value = true
  await loadRecipients()
}

function handleRecipientFilter() {
  recipientsPage.value = 1
  loadRecipients()
}

async function loadRecipients() {
  if (!recipientsCampaignId.value) return
  recipientsLoading.value = true
  try {
    const res = await getRecipients(recipientsCampaignId.value, {
      page: recipientsPage.value,
      pageSize: recipientsPageSize.value,
      status: recipientStatus.value || undefined,
    })
    recipients.value = res.list
    recipientsTotal.value = res.total
    if (res.stats) recipientStats.value = res.stats
  } finally {
    recipientsLoading.value = false
  }
}

onMounted(() => {
  load()
  loadAudience()
})
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

.campaign-title {
  font-weight: 500;
  color: var(--text-main);
}

.count-ok {
  color: var(--success-color);
  font-weight: 600;
}
.count-bad {
  color: var(--danger-color);
  font-weight: 600;
}
.count-sep {
  color: var(--text-secondary);
  margin: 0 2px;
}

.audience-target {
  width: 100%;
  margin-top: 8px;
}

.field-hint {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-top: 6px;
}

.error-text {
  color: var(--danger-color);
  font-size: 12px;
}

/* 发送用户弹窗：统计条 + 已读/未读筛选 */
.recipient-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  padding: 12px 16px;
  margin-bottom: 12px;
  background: var(--bg-secondary, #f5f7fa);
  border-radius: 6px;
}

.recipient-summary .stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 60px;
}

.recipient-summary .stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.recipient-summary .stat-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-main);
}

.recipient-filter {
  margin-bottom: 12px;
}

.view-head {
  margin-bottom: 14px;
}
.view-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
  margin-bottom: 8px;
}
.view-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.view-meta-text {
  font-size: 12px;
  color: var(--text-secondary);
}
.view-subject {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
  background: #f7f9fc;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-main);
}
.view-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.view-content {
  max-height: 52vh;
  overflow-y: auto;
  padding: 14px;
  border: 1px solid #eef1f6;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-main);
  word-break: break-word;

  :deep(img) {
    max-width: 100%;
  }
}
.view-empty {
  color: var(--text-secondary);
}
</style>
