<template>
  <div class="page-container">
    <el-tabs v-model="activeTab">
      <!-- ==================== 升级码 ==================== -->
      <el-tab-pane label="升级码" name="upgrade">
        <div class="toolbar-card">
          <span class="page-title">升级码</span>
          <div class="toolbar-right">
            <el-input
              v-model="upgradeQuery.keyword"
              placeholder="码 / 备注"
              clearable
              style="width: 200px"
              :prefix-icon="Search"
              @keyup.enter="searchUpgradeCodes"
            />
            <el-select
              v-model="upgradeQuery.status"
              placeholder="状态"
              clearable
              style="width: 120px"
              @change="searchUpgradeCodes"
            >
              <el-option label="未使用" :value="1" />
              <el-option label="已使用" :value="2" />
              <el-option label="已作废" :value="3" />
            </el-select>
            <el-button type="primary" :icon="Search" @click="searchUpgradeCodes">查询</el-button>
            <el-button :icon="Refresh" @click="resetUpgradeCodes">重置</el-button>
            <el-button type="primary" :icon="Plus" @click="openUpgradeGenerate">生成升级码</el-button>
          </div>
        </div>

        <div class="table-card">
          <el-table :data="upgradeList" v-loading="upgradeLoading" stripe>
            <el-table-column label="升级码" min-width="240">
              <template #default="{ row }">
                <div class="code-cell">
                  <span class="code-font">{{ row.code }}</span>
                  <el-button link type="primary" :icon="CopyDocument" size="small" @click="copyText(row.code)" />
                </div>
              </template>
            </el-table-column>
            <el-table-column label="升级到" min-width="180">
              <template #default="{ row }">
                <div class="tier-cell">
                  <span>{{ DURATION_TEXT[row.toDuration || ''] || row.toSkuLabel || '-' }} · 普通升级高级</span>
                  <span class="code-font text-secondary">{{ row.toSkuCode || '' }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="STATUS[row.status]?.type || 'info'">{{ STATUS[row.status]?.label || row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="有效期至" width="160">
              <template #default="{ row }"><TimeCell :value="row.validUntil" /></template>
            </el-table-column>
            <el-table-column label="核销时间" width="160">
              <template #default="{ row }"><TimeCell :value="row.usedAt" /></template>
            </el-table-column>
            <el-table-column label="核销账号" width="110" align="center">
              <template #default="{ row }">{{ row.usedBy || row.accountId || '-' }}</template>
            </el-table-column>
            <el-table-column label="备注" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || '-' }}</template>
            </el-table-column>
            <el-table-column label="创建时间" width="160">
              <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
            </el-table-column>
            <el-table-column label="操作" width="90" fixed="right" align="center">
              <template #default="{ row }">
                <el-button v-if="row.status === 1" link type="danger" size="small" @click="handleVoidUpgrade(row)">作废</el-button>
                <span v-else class="text-secondary">-</span>
              </template>
            </el-table-column>
            <template #empty><el-empty description="暂无升级码" :image-size="80" /></template>
          </el-table>

          <div class="pager">
            <el-pagination
              v-model:current-page="upgradeQuery.page"
              v-model:page-size="upgradeQuery.pageSize"
              :total="upgradeTotal"
              :page-sizes="[20, 50, 100]"
              layout="total, sizes, prev, pager, next, jumper"
              @current-change="loadUpgradeCodes"
              @size-change="searchUpgradeCodes"
            />
          </div>
        </div>

        <!-- 生成升级码 -->
        <el-dialog v-model="upgradeGenVisible" title="生成升级码" width="580px" :close-on-click-modal="false">
          <el-form ref="upgradeGenFormRef" :model="upgradeGenForm" :rules="upgradeGenRules" label-width="110px">
            <el-form-item label="档位时长" prop="duration">
              <el-select v-model="upgradeGenForm.duration" placeholder="选择升级码档位时长" style="width: 100%">
                <el-option
                  v-for="d in UPGRADE_DURATIONS"
                  :key="d.key"
                  :label="`${d.label} · 普通升级高级`"
                  :value="d.key"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="指定账号ID">
              <el-input v-model="upgradeGenForm.accountId" placeholder="留空表示不限账号（可选）" style="width: 260px" />
            </el-form-item>
            <el-form-item label="生成数量" prop="count">
              <el-input-number v-model="upgradeGenForm.count" :min="1" :max="200" />
            </el-form-item>
            <el-form-item label="有效期至">
              <el-date-picker
                v-model="upgradeGenForm.validUntil"
                type="datetime"
                placeholder="留空表示长期有效"
                value-format="YYYY-MM-DDTHH:mm:ssZ"
                style="width: 260px"
              />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="upgradeGenForm.remark" placeholder="备注（可选）" maxlength="255" style="width: 320px" />
            </el-form-item>
          </el-form>
          <div class="text-secondary">
            升级码只把「同一档位时长」的普通版升级为高级版（个人/企业均可），核销后到期时间不变。
          </div>
          <template #footer>
            <el-button @click="upgradeGenVisible = false">取消</el-button>
            <el-button type="primary" :loading="upgradeGenerating" @click="submitUpgradeGenerate">生成</el-button>
          </template>
        </el-dialog>

        <!-- 升级码生成结果 -->
        <el-dialog v-model="upgradeResultVisible" title="升级码生成结果" width="560px">
          <div class="result-head">
            <span>共 {{ upgradeGenerated.length }} 个</span>
            <el-button link type="primary" :icon="CopyDocument" @click="copyAllUpgrade">全部复制</el-button>
          </div>
          <el-scrollbar max-height="300px">
            <div v-for="(c, i) in upgradeGenerated" :key="i" class="code-line">
              <span class="code-font">{{ c }}</span>
              <el-button link type="primary" :icon="CopyDocument" size="small" @click="copyText(c)" />
            </div>
          </el-scrollbar>
          <template #footer>
            <el-button type="primary" @click="upgradeResultVisible = false">完成</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>

      <!-- ==================== 扩容码 ==================== -->
      <el-tab-pane label="扩容码" name="codes">
        <div class="toolbar-card">
          <span class="page-title">席位扩容码</span>
          <div class="toolbar-right">
            <el-input
              v-model="query.keyword"
              placeholder="码 / 备注"
              clearable
              style="width: 200px"
              :prefix-icon="Search"
              @keyup.enter="search"
            />
            <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px" @change="search">
              <el-option label="未使用" :value="1" />
              <el-option label="已使用" :value="2" />
              <el-option label="已作废" :value="3" />
            </el-select>
            <el-button type="primary" :icon="Search" @click="search">查询</el-button>
            <el-button :icon="Refresh" @click="reset">重置</el-button>
            <el-button type="primary" :icon="Plus" @click="openGenerate">生成扩容码</el-button>
          </div>
        </div>

        <div class="table-card">
          <el-table :data="list" v-loading="loading" stripe>
            <el-table-column label="扩容码" min-width="240">
              <template #default="{ row }">
                <div class="code-cell">
                  <span class="code-font">{{ row.code }}</span>
                  <el-button link type="primary" :icon="CopyDocument" size="small" @click="copyText(row.code)" />
                </div>
              </template>
            </el-table-column>
            <el-table-column label="增加席位" width="100" align="center">
              <template #default="{ row }">
                <el-tag size="small" type="success" effect="plain">+{{ row.seatDelta }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="限定企业" width="110" align="center">
              <template #default="{ row }">
                <span v-if="row.enterpriseId">#{{ row.enterpriseId }}</span>
                <span v-else class="text-secondary">不限</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="STATUS[row.status]?.type || 'info'">{{ STATUS[row.status]?.label || row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="有效期至" width="160">
              <template #default="{ row }"><TimeCell :value="row.validUntil" /></template>
            </el-table-column>
            <el-table-column label="核销时间" width="160">
              <template #default="{ row }"><TimeCell :value="row.usedAt" /></template>
            </el-table-column>
            <el-table-column label="核销账号" width="110" align="center">
              <template #default="{ row }">{{ row.usedBy || '-' }}</template>
            </el-table-column>
            <el-table-column label="备注" min-width="140" prop="remark" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || '-' }}</template>
            </el-table-column>
            <el-table-column label="创建时间" width="160">
              <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
            </el-table-column>
            <el-table-column label="操作" width="90" fixed="right" align="center">
              <template #default="{ row }">
                <el-button v-if="row.status === 1" link type="danger" size="small" @click="handleVoid(row)">作废</el-button>
                <span v-else class="text-secondary">-</span>
              </template>
            </el-table-column>
            <template #empty><el-empty description="暂无席位扩容码" :image-size="80" /></template>
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

        <!-- 生成 -->
        <el-dialog v-model="genVisible" title="生成席位扩容码" width="560px" :close-on-click-modal="false">
          <el-form ref="genFormRef" :model="genForm" :rules="genRules" label-width="100px">
            <el-form-item label="增加席位" prop="seatDelta">
              <el-input-number v-model="genForm.seatDelta" :min="1" :max="500" />
              <span class="text-secondary" style="margin-left: 8px">（1 ~ 500，核销后企业席位立即增加）</span>
            </el-form-item>
            <el-form-item label="生成数量" prop="count">
              <el-input-number v-model="genForm.count" :min="1" :max="200" />
            </el-form-item>
            <el-form-item label="限定企业ID">
              <el-input v-model="genForm.enterpriseId" placeholder="留空表示不限企业（可选）" style="width: 260px" />
            </el-form-item>
            <el-form-item label="有效期至">
              <el-date-picker
                v-model="genForm.validUntil"
                type="datetime"
                placeholder="留空表示长期有效"
                value-format="YYYY-MM-DDTHH:mm:ssZ"
                style="width: 260px"
              />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="genForm.remark" placeholder="备注（可选）" maxlength="255" style="width: 320px" />
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="genVisible = false">取消</el-button>
            <el-button type="primary" :loading="generating" @click="submitGenerate">生成</el-button>
          </template>
        </el-dialog>

        <!-- 生成结果 -->
        <el-dialog v-model="resultVisible" title="扩容码生成结果" width="560px">
          <div class="result-head">
            <span>共 {{ generated.length }} 个</span>
            <el-button link type="primary" :icon="CopyDocument" @click="copyAll">全部复制</el-button>
          </div>
          <el-scrollbar max-height="300px">
            <div v-for="(c, i) in generated" :key="i" class="code-line">
              <span class="code-font">{{ c }}</span>
              <el-button link type="primary" :icon="CopyDocument" size="small" @click="copyText(c)" />
            </div>
          </el-scrollbar>
          <template #footer>
            <el-button type="primary" @click="resultVisible = false">完成</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>

      <!-- ==================== 客户端下发 ==================== -->
      <el-tab-pane label="客户端下发" name="delivery">
        <div class="table-card">
          <div class="delivery-head">
            <span class="page-title">客户端下发</span>
            <span class="text-secondary">保存后立即推送到在线客户端，无需重启</span>
          </div>
          <el-form label-width="150px" style="max-width: 760px">
            <el-form-item v-for="g in UPGRADE_DURATIONS" :key="g.key" :label="`${g.label} · 普通升级高级`">
              <el-input
                v-model="upgradeUrls[g.key]"
                placeholder="https://mall.example.com/upgrade"
                clearable
                style="max-width: 480px"
              />
            </el-form-item>
            <el-form-item label="扩容码商城链接">
              <div style="width: 100%">
                <el-input
                  v-model="seatAddonMallUrl"
                  placeholder="https://mall.example.com/seat-addon"
                  clearable
                  style="width: 100%"
                />
                <div class="text-secondary">
                  客户端「扩容」弹窗下方「去商城购买」按钮跳转此链接；留空则客户端不显示该按钮
                </div>
              </div>
            </el-form-item>
            <el-form-item label="商城购买链接">
              <div style="width: 100%">
                <el-input
                  v-model="buyUrl"
                  placeholder="https://mall.example.com/buy"
                  clearable
                  style="width: 100%"
                />
                <div class="text-secondary">
                  升企业版弹窗（个人中心 / 用户中心 / 用户管理的「升企业版」入口）里「去商城购买」按钮跳转此链接；
                  优先用上方对应档位链接，未配置时用此链接；留空则回退客户端内置购买页
                </div>
              </div>
            </el-form-item>
            <el-form-item label="其他购买链接">
              <div style="width: 100%">
                <el-input
                  v-model="otherBuyUrl"
                  placeholder="https://mall.example.com/buy"
                  clearable
                  style="width: 100%"
                />
                <div class="text-secondary">
                  激活软件、续费、授权页面「购买激活码」、个人中心「购买卡密」等购买按钮跳转此链接；
                  与升级码、升企业版互不影响；留空则回退客户端内置购买页
                </div>
              </div>
            </el-form-item>
          </el-form>
          <div class="text-secondary" style="margin-bottom: 12px">
            客户端只对「普通版」卡密显示升级入口，可升级目标为同档位的高档位（高级版）；此处按 4 个档位时长下发商品页链接，
            个人/企业普通用户按自己卡密的时长匹配，留空则该档位不显示升级入口。
          </div>
          <el-button type="primary" :icon="Check" :loading="savingMall" @click="saveMallLink">保存并推送</el-button>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Search, Refresh, Plus, CopyDocument, Check } from '@element-plus/icons-vue'
import TimeCell from '@/components/TimeCell.vue'
import {
  getSeatAddons,
  createSeatAddons,
  voidSeatAddon,
  getUpgradeCodes,
  createUpgradeCodes,
  voidUpgradeCode,
  getUpgradeLinks,
  saveUpgradeLinks,
  type SeatAddonRow,
  type UpgradeCodeRow,
} from '@/api/mall'

const activeTab = ref('upgrade')

const STATUS: Record<number, { label: string; type: 'info' | 'success' | 'danger' }> = {
  1: { label: '未使用', type: 'info' },
  2: { label: '已使用', type: 'success' },
  3: { label: '已作废', type: 'danger' },
}

const DURATION_TEXT: Record<string, string> = { month: '月卡', quarter: '季卡', year: '年卡', permanent: '永久' }

// ==================== 客户端下发（商城链接） ====================
/** 升级链接按 4 个档位时长下发；同档位的个人/企业、普通/高级 SKU 共用该链接 */
const UPGRADE_DURATIONS: Array<{ key: string; label: string }> = [
  { key: 'month', label: '月卡' },
  { key: 'quarter', label: '季卡' },
  { key: 'year', label: '年卡' },
  { key: 'permanent', label: '永久' },
]

const upgradeUrls = reactive<Record<string, string>>({ month: '', quarter: '', year: '', permanent: '' })
const seatAddonMallUrl = ref('')
// 升企业版弹窗「去商城购买」的兜底地址
const buyUrl = ref('')
// 其他购买按钮链接：激活 / 续费 / 授权页购买 / 个人中心购买卡密
const otherBuyUrl = ref('')
const savingMall = ref(false)

/** 固定档位 code：个人/企业 × 普通/高级 × 4 时长（价格 SKU 已移除） */
function tierCodesOf(duration: string): string[] {
  const codes: string[] = []
  for (const v of [1, 2]) {
    for (const l of [1, 2]) codes.push(`${v === 2 ? 'ent' : 'per'}_${l === 2 ? 'pro' : 'normal'}_${duration}`)
  }
  return codes
}

/** 把每个时长的链接展开写入该时长全部档位 code（含个人/企业、普通/高级） */
function buildUpgradeLinks(): Record<string, string> {
  const links: Record<string, string> = {}
  for (const g of UPGRADE_DURATIONS) {
    const url = (upgradeUrls[g.key] || '').trim()
    if (!url) continue
    for (const code of tierCodesOf(g.key)) links[code] = url
  }
  return links
}

async function loadMallLink() {
  const state = await getUpgradeLinks()
  seatAddonMallUrl.value = state.seatAddonMallUrl || ''
  buyUrl.value = state.buyUrl || ''
  otherBuyUrl.value = state.otherBuyUrl || ''
  for (const g of UPGRADE_DURATIONS) {
    const hit = tierCodesOf(g.key).find((code) => !!state.links[code])
    upgradeUrls[g.key] = hit ? state.links[hit] : ''
  }
}

async function saveMallLink() {
  savingMall.value = true
  try {
    const res = await saveUpgradeLinks({
      links: buildUpgradeLinks(),
      seatAddonMallUrl: seatAddonMallUrl.value.trim(),
      buyUrl: buyUrl.value.trim(),
      otherBuyUrl: otherBuyUrl.value.trim(),
    })
    ElMessage.success(`已保存并推送（在线客户端 ${res.delivered} 个）`)
  } finally {
    savingMall.value = false
  }
}

// ==================== 升级码 ====================
const upgradeQuery = reactive({ page: 1, pageSize: 20, keyword: '', status: '' as number | '' })
const upgradeList = ref<UpgradeCodeRow[]>([])
const upgradeTotal = ref(0)
const upgradeLoading = ref(false)

async function loadUpgradeCodes() {
  upgradeLoading.value = true
  try {
    const res = await getUpgradeCodes(upgradeQuery)
    upgradeList.value = res.list
    upgradeTotal.value = res.total
  } finally {
    upgradeLoading.value = false
  }
}

function searchUpgradeCodes() {
  upgradeQuery.page = 1
  loadUpgradeCodes()
}

function resetUpgradeCodes() {
  upgradeQuery.keyword = ''
  upgradeQuery.status = ''
  searchUpgradeCodes()
}

const upgradeGenVisible = ref(false)
const upgradeGenerating = ref(false)
const upgradeGenFormRef = ref<FormInstance>()
const upgradeGenForm = reactive({
  duration: 'month',
  accountId: '',
  count: 1,
  validUntil: '' as string,
  remark: '',
})
const upgradeGenRules: FormRules = {
  duration: [{ required: true, message: '请选择档位时长', trigger: 'change' }],
  count: [{ required: true, message: '请设置生成数量', trigger: 'change' }],
}

function openUpgradeGenerate() {
  upgradeGenForm.duration = 'month'
  upgradeGenForm.accountId = ''
  upgradeGenForm.count = 1
  upgradeGenForm.validUntil = ''
  upgradeGenForm.remark = ''
  upgradeGenVisible.value = true
}

const upgradeResultVisible = ref(false)
const upgradeGenerated = ref<string[]>([])

async function submitUpgradeGenerate() {
  if (!upgradeGenFormRef.value) return
  const valid = await upgradeGenFormRef.value.validate().catch(() => false)
  if (!valid) return
  upgradeGenerating.value = true
  try {
    const rows = await createUpgradeCodes({
      duration: upgradeGenForm.duration,
      accountId: upgradeGenForm.accountId.trim() || null,
      count: upgradeGenForm.count,
      validUntil: upgradeGenForm.validUntil || null,
      remark: upgradeGenForm.remark || undefined,
    })
    upgradeGenerated.value = rows.map((r) => r.code)
    upgradeGenVisible.value = false
    upgradeResultVisible.value = true
    searchUpgradeCodes()
  } finally {
    upgradeGenerating.value = false
  }
}

async function handleVoidUpgrade(row: UpgradeCodeRow) {
  try {
    await ElMessageBox.confirm(`确定作废升级码「${row.code}」吗？`, '作废确认', {
      type: 'warning',
      confirmButtonText: '确认作废',
      cancelButtonText: '取消',
    })
    await voidUpgradeCode(row.id)
    ElMessage.success('已作废')
    loadUpgradeCodes()
  } catch {
    // 取消或已提示
  }
}

function copyAllUpgrade() {
  copyText(upgradeGenerated.value.join('\n'))
}

// ==================== 扩容码 ====================
const query = reactive({ page: 1, pageSize: 20, keyword: '', status: '' as number | '' })
const list = ref<SeatAddonRow[]>([])
const total = ref(0)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await getSeatAddons(query)
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

const genVisible = ref(false)
const generating = ref(false)
const genFormRef = ref<FormInstance>()
const genForm = reactive({
  seatDelta: 1,
  count: 1,
  enterpriseId: '',
  validUntil: '' as string,
  remark: '',
})
const genRules: FormRules = {
  seatDelta: [{ required: true, message: '请设置增加席位', trigger: 'change' }],
  count: [{ required: true, message: '请设置生成数量', trigger: 'change' }],
}

function openGenerate() {
  genForm.seatDelta = 1
  genForm.count = 1
  genForm.enterpriseId = ''
  genForm.validUntil = ''
  genForm.remark = ''
  genVisible.value = true
}

const resultVisible = ref(false)
const generated = ref<string[]>([])

async function submitGenerate() {
  if (!genFormRef.value) return
  const valid = await genFormRef.value.validate().catch(() => false)
  if (!valid) return
  generating.value = true
  try {
    const rows = await createSeatAddons({
      seatDelta: genForm.seatDelta,
      count: genForm.count,
      enterpriseId: genForm.enterpriseId.trim() || null,
      validUntil: genForm.validUntil || null,
      remark: genForm.remark || undefined,
    })
    generated.value = rows.map((r) => r.code)
    genVisible.value = false
    resultVisible.value = true
    search()
  } finally {
    generating.value = false
  }
}

async function handleVoid(row: SeatAddonRow) {
  try {
    await ElMessageBox.confirm(`确定作废席位扩容码「${row.code}」吗？`, '作废确认', {
      type: 'warning',
      confirmButtonText: '确认作废',
      cancelButtonText: '取消',
    })
    await voidSeatAddon(row.id)
    ElMessage.success('已作废')
    load()
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

function copyAll() {
  copyText(generated.value.join('\n'))
}

onMounted(() => {
  loadUpgradeCodes()
  load()
  loadMallLink()
})
</script>

<style scoped lang="scss">
.toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
.code-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tier-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.delivery-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.code-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
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
