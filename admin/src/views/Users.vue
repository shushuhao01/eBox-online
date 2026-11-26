<template>
  <div class="page-container">
    <!-- 工具栏 -->
    <div class="toolbar-card">
      <span class="page-title">管理员账号</span>
      <div class="toolbar-right">
        <el-button type="primary" :icon="Plus" @click="openCreate">新建管理员</el-button>
      </div>
    </div>

    <!-- 列表 -->
    <div class="table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="ID" prop="id" width="90" />
        <el-table-column label="用户名" prop="username" min-width="160">
          <template #default="{ row }">
            <span>{{ row.username }}</span>
            <el-tag v-if="row.isFounder" size="small" type="warning" effect="plain" class="tag-gap">创始</el-tag>
            <el-tag v-if="row.id === store.user?.id" size="small" effect="plain" class="tag-gap">当前账号</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="昵称" min-width="120">
          <template #default="{ row }">{{ row.nickname || '-' }}</template>
        </el-table-column>
        <el-table-column label="角色" width="130" align="center">
          <template #default="{ row }">
            <el-tag :type="row.role === 1 ? 'danger' : 'info'" size="small">
              {{ row.role === 1 ? '超级管理员' : '管理员' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small" effect="plain">
              {{ row.status === 1 ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后登录" width="110">
          <template #default="{ row }"><TimeCell :value="row.lastLoginAt" /></template>
        </el-table-column>
        <el-table-column label="创建时间" width="110">
          <template #default="{ row }"><TimeCell :value="row.createdAt" /></template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openView(row)">查看</el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-tooltip :disabled="row.id !== store.user?.id" content="请前往「系统设置」修改自己的密码" placement="top">
              <span class="op-wrap">
                <el-button
                  link
                  type="warning"
                  size="small"
                  :disabled="row.id === store.user?.id"
                  @click="openResetPwd(row)"
                >改密</el-button>
              </span>
            </el-tooltip>
            <el-tooltip :disabled="!row.isFounder" content="创始人管理员不可停用" placement="top">
              <span class="op-wrap">
                <el-button
                  link
                  :type="row.status === 1 ? 'danger' : 'success'"
                  size="small"
                  :disabled="row.isFounder || row.id === store.user?.id"
                  @click="handleToggle(row)"
                >{{ row.status === 1 ? '停用' : '启用' }}</el-button>
              </span>
            </el-tooltip>
            <el-tooltip :disabled="!row.isFounder" content="创始人管理员不可删除" placement="top">
              <span class="op-wrap">
                <el-button
                  link
                  type="danger"
                  size="small"
                  :disabled="row.isFounder || row.id === store.user?.id"
                  @click="handleDelete(row)"
                >删除</el-button>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无管理员" :image-size="80" />
        </template>
      </el-table>
    </div>

    <!-- 新建管理员 -->
    <el-dialog v-model="createVisible" title="新建管理员" width="460px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="登录账号" maxlength="64" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" maxlength="128" />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="form.nickname" placeholder="昵称（可选）" maxlength="64" />
        </el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="form.role">
            <el-radio :value="0">管理员</el-radio>
            <el-radio :value="1">超级管理员</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 查看管理员 -->
    <el-dialog v-model="viewVisible" title="管理员详情" width="520px">
      <el-descriptions v-if="viewRow" :column="1" border size="small">
        <el-descriptions-item label="ID">{{ viewRow.id }}</el-descriptions-item>
        <el-descriptions-item label="用户名">
          {{ viewRow.username }}
          <el-tag v-if="viewRow.isFounder" size="small" type="warning" effect="plain" class="tag-gap">创始管理员</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="昵称">{{ viewRow.nickname || '-' }}</el-descriptions-item>
        <el-descriptions-item label="角色">{{ viewRow.role === 1 ? '超级管理员' : '管理员' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag size="small" :type="viewRow.status === 1 ? 'success' : 'danger'" effect="plain">
            {{ viewRow.status === 1 ? '启用' : '停用' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="最后登录"><TimeCell :value="viewRow.lastLoginAt" /></el-descriptions-item>
        <el-descriptions-item label="最后登录 IP">{{ viewRow.lastLoginIp || '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间"><TimeCell :value="viewRow.createdAt" /></el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="viewVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 编辑管理员 -->
    <el-dialog v-model="editVisible" title="编辑管理员" width="460px">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="editForm.username" maxlength="64" />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="editForm.nickname" placeholder="昵称（可选）" maxlength="64" />
        </el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="editForm.role" :disabled="editForm.isFounder || editForm.id === store.user?.id">
            <el-radio :value="0">管理员</el-radio>
            <el-radio :value="1">超级管理员</el-radio>
          </el-radio-group>
          <div v-if="editForm.isFounder" class="text-secondary tip">创始人管理员角色不可修改</div>
          <div v-else-if="editForm.id === store.user?.id" class="text-secondary tip">不能修改自己的角色</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog v-model="pwdVisible" title="重置密码" width="460px">
      <el-form ref="pwdFormRef" :model="pwdForm" :rules="pwdRules" label-width="90px">
        <el-form-item label="管理员">{{ pwdForm.username }}</el-form-item>
        <el-form-item label="新密码" prop="password">
          <el-input v-model="pwdForm.password" type="password" show-password placeholder="至少 6 位" maxlength="128" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirm">
          <el-input v-model="pwdForm.confirm" type="password" show-password placeholder="再次输入新密码" maxlength="128" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdSaving" @click="submitResetPwd">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { getUsers, createUser, setUserStatus, updateUser, resetUserPassword, deleteUser, type AdminUser } from '@/api/users'
import { useUserStore } from '@/stores/user'
import TimeCell from '@/components/TimeCell.vue'

const store = useUserStore()

const list = ref<AdminUser[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    list.value = await getUsers()
  } finally {
    loading.value = false
  }
}

// ============ 新建 ============
const createVisible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({ username: '', password: '', nickname: '', role: 0 as 0 | 1 })
const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
}

function openCreate() {
  form.username = ''
  form.password = ''
  form.nickname = ''
  form.role = 0
  createVisible.value = true
}

async function submit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    await createUser({
      username: form.username,
      password: form.password,
      nickname: form.nickname || undefined,
      role: form.role,
    })
    ElMessage.success('管理员创建成功')
    createVisible.value = false
    load()
  } catch {
    // 拦截器已提示
  } finally {
    saving.value = false
  }
}

// ============ 停用 / 启用 ============
async function handleToggle(row: AdminUser) {
  const enable = row.status === 0
  try {
    await ElMessageBox.confirm(
      enable
        ? `确定启用管理员「${row.username}」吗？`
        : `确定停用管理员「${row.username}」吗？停用后该账号将无法登录。`,
      enable ? '启用确认' : '停用确认',
      {
        confirmButtonText: enable ? '确认启用' : '确认停用',
        cancelButtonText: '取消',
        type: enable ? 'success' : 'warning',
      }
    )
    await setUserStatus(row.id, enable ? 1 : 0)
    ElMessage.success(enable ? '已启用' : '已停用')
    await load()
  } catch {
    // 取消或失败（拦截器已提示）
  }
}

// ============ 查看 ============
const viewVisible = ref(false)
const viewRow = ref<AdminUser | null>(null)

function openView(row: AdminUser) {
  viewRow.value = row
  viewVisible.value = true
}

// ============ 编辑 ============
const editVisible = ref(false)
const editSaving = ref(false)
const editFormRef = ref<FormInstance>()
const editForm = reactive({
  id: '',
  username: '',
  nickname: '',
  role: 0 as 0 | 1,
  isFounder: false,
})
const editRules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
}

function openEdit(row: AdminUser) {
  editForm.id = row.id
  editForm.username = row.username
  editForm.nickname = row.nickname || ''
  editForm.role = row.role === 1 ? 1 : 0
  editForm.isFounder = !!row.isFounder
  editVisible.value = true
}

async function submitEdit() {
  if (!editFormRef.value) return
  const valid = await editFormRef.value.validate().catch(() => false)
  if (!valid) return
  editSaving.value = true
  try {
    await updateUser(editForm.id, {
      username: editForm.username,
      nickname: editForm.nickname || null,
      role: editForm.role,
    })
    ElMessage.success('已保存')
    editVisible.value = false
    await load()
  } catch {
    // 拦截器已提示
  } finally {
    editSaving.value = false
  }
}

// ============ 重置密码 ============
const pwdVisible = ref(false)
const pwdSaving = ref(false)
const pwdFormRef = ref<FormInstance>()
const pwdForm = reactive({ id: '', username: '', password: '', confirm: '' })
const pwdRules: FormRules = {
  password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== pwdForm.password) callback(new Error('两次输入的密码不一致'))
        else callback()
      },
      trigger: 'blur',
    },
  ],
}

function openResetPwd(row: AdminUser) {
  pwdForm.id = row.id
  pwdForm.username = row.username
  pwdForm.password = ''
  pwdForm.confirm = ''
  pwdVisible.value = true
}

async function submitResetPwd() {
  if (!pwdFormRef.value) return
  const valid = await pwdFormRef.value.validate().catch(() => false)
  if (!valid) return
  pwdSaving.value = true
  try {
    await resetUserPassword(pwdForm.id, pwdForm.password)
    ElMessage.success('密码已重置，该管理员需重新登录')
    pwdVisible.value = false
  } catch {
    // 拦截器已提示
  } finally {
    pwdSaving.value = false
  }
}

// ============ 删除 ============
async function handleDelete(row: AdminUser) {
  try {
    await ElMessageBox.confirm(
      `确定删除管理员「${row.username}」吗？删除后不可恢复。`,
      '删除确认',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    )
    await deleteUser(row.id)
    ElMessage.success('已删除')
    await load()
  } catch {
    // 取消或失败（拦截器已提示）
  }
}

onMounted(load)
</script>

<style scoped lang="scss">
.toolbar-right {
  margin-left: auto;
}

.text-secondary {
  color: var(--text-secondary);
}

.tag-gap {
  margin-left: 6px;
}

.op-wrap {
  display: inline-block;
}

.tip {
  font-size: 12px;
  line-height: 18px;
}
</style>
