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
        <el-table-column label="打开" width="70" align="center">
          <template #default="{ row }">{{ row.opened_count || 0 }}</template>
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
        <el-table-column label="操作" width="230" fixed="right" align="center">
          <template #default="{ row }">
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
            <el-button link type="primary" size="small" @click="openRecipients(row)">收件人</el-button>
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

    <!-- 收件人 -->
    <el-dialog v-model="recipientsVisible" :title="`收件人：${recipientsTitle}`" width="900px">
      <el-table v-loading="recipientsLoading" :data="recipients" stripe max-height="420">
        <el-table-column label="邮箱" min-width="200" show-overflow-tooltip prop="email" />
        <el-table-column label="账号" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.username || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.delivered === 1" size="small" type="success">已送达</el-tag>
            <el-tag v-else-if="row.error" size="small" type="danger">失败</el-tag>
            <el-tag v-else size="small" type="info">待发送</el-tag>
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
        <template #empty><el-empty description="暂无收件人记录" :image-size="70" /></template>
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

// ============ 收件人 ============
const recipientsVisible = ref(false)
const recipientsLoading = ref(false)
const recipients = ref<MarketingRecipientRow[]>([])
const recipientsTitle = ref('')
const recipientsCampaignId = ref('')
const recipientsPage = ref(1)
const recipientsPageSize = ref(10)
const recipientsTotal = ref(0)

async function openRecipients(row: MarketingCampaignRow) {
  recipientsCampaignId.value = row.id
  recipientsTitle.value = row.title
  recipientsPage.value = 1
  recipientsVisible.value = true
  await loadRecipients()
}

async function loadRecipients() {
  if (!recipientsCampaignId.value) return
  recipientsLoading.value = true
  try {
    const res = await getRecipients(recipientsCampaignId.value, {
      page: recipientsPage.value,
      pageSize: recipientsPageSize.value,
    })
    recipients.value = res.list
    recipientsTotal.value = res.total
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
</style>
