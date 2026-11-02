<template>
  <div class="page-container">
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Search, Refresh, Plus, CopyDocument } from '@element-plus/icons-vue'
import TimeCell from '@/components/TimeCell.vue'
import { getSeatAddons, createSeatAddons, voidSeatAddon, type SeatAddonRow } from '@/api/mall'

const STATUS: Record<number, { label: string; type: 'info' | 'success' | 'danger' }> = {
  1: { label: '未使用', type: 'info' },
  2: { label: '已使用', type: 'success' },
  3: { label: '已作废', type: 'danger' },
}

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

// ============ 生成 ============
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

onMounted(load)
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
