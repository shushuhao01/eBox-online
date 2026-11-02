<template>
  <div class="main-layout">
    <!-- 左侧菜单 -->
    <aside class="sidebar" :class="{ collapsed }">
      <div class="logo" @click="$router.push('/dashboard')">
        <el-icon :size="26" color="#fff"><Key /></el-icon>
        <span v-show="!collapsed" class="logo-text">eBox 授权平台</span>
      </div>
      <el-scrollbar class="menu-scroll">
        <el-menu
          :default-active="$route.path"
          :collapse="collapsed"
          :collapse-transition="false"
          background-color="transparent"
          router
        >
          <template v-for="group in visibleMenus" :key="group.kind === 'group' ? group.key : group.path">
            <el-sub-menu v-if="group.kind === 'group'" :index="group.key" popper-class="sidebar-submenu">
              <template #title>
                <el-icon><component :is="group.icon" /></el-icon>
                <span>{{ group.title }}</span>
              </template>
              <el-menu-item v-for="item in group.children" :key="item.path" :index="item.path">
                <el-icon><component :is="item.icon" /></el-icon>
                <template #title>{{ item.title }}</template>
              </el-menu-item>
            </el-sub-menu>
            <el-menu-item v-else :index="group.path">
              <el-icon><component :is="group.icon" /></el-icon>
              <template #title>{{ group.title }}</template>
            </el-menu-item>
          </template>
        </el-menu>
      </el-scrollbar>
    </aside>

    <!-- 右侧主体 -->
    <div class="main">
      <!-- 顶栏 -->
      <header class="header">
        <div class="header-left">
          <el-icon class="collapse-btn" :size="20" @click="collapsed = !collapsed">
            <Expand v-if="collapsed" />
            <Fold v-else />
          </el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="currentMenu?.group">{{ currentMenu.group }}</el-breadcrumb-item>
            <el-breadcrumb-item v-if="currentMenu">{{ currentMenu.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <!-- 服务健康灯 -->
          <div class="health" :title="healthText">
            <span class="health-dot" :class="health ? 'ok' : 'bad'"></span>
            <span class="health-text">服务{{ health ? '正常' : '异常' }}</span>
          </div>
          <el-divider direction="vertical" />
          <el-dropdown trigger="click" @command="onCommand">
            <span class="user-info">
              <el-avatar :size="30" class="user-avatar">{{ displayName.slice(0, 1) }}</el-avatar>
              <span class="user-name">{{ displayName }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>
                  角色：{{ store.isSuperAdmin ? '超级管理员' : '管理员' }}
                </el-dropdown-item>
                <el-dropdown-item divided command="logout">
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <!-- 主内容 -->
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'

const store = useUserStore()
const route = useRoute()
const router = useRouter()

const collapsed = ref(false)

const displayName = computed(() => store.displayName)

/** 菜单项：过滤仅超管可见 */
interface MenuItem {
  title: string
  path: string
  icon: string
  superOnly?: boolean
}

interface MenuGroup {
  kind: 'group'
  key: string
  title: string
  icon: string
  children: MenuItem[]
}

interface MenuEntry extends MenuItem {
  kind: 'item'
}

type MenuNode = MenuGroup | MenuEntry

/**
 * 左侧菜单一二级分组：条目过多的扁平菜单按业务归类，减少视觉噪音。
 * 官网管理 / 客户端代理商 / 营销管理保持独立一级入口。
 */
const menus: MenuNode[] = [
  { kind: 'item', path: '/dashboard', title: '总览', icon: 'DataAnalysis' },
  {
    kind: 'group',
    key: 'enterprise',
    title: '企业与客户',
    icon: 'OfficeBuilding',
    children: [
      { title: '企业管理', path: '/enterprises', icon: 'OfficeBuilding' },
      { title: '账号管理', path: '/accounts', icon: 'UserFilled' },
      { title: '客户管理', path: '/customers', icon: 'User' },
    ],
  },
  {
    kind: 'group',
    key: 'codes',
    title: '激活码与扩容',
    icon: 'Key',
    children: [
      { title: '激活码管理', path: '/licenses', icon: 'Key' },
      { title: '码批次', path: '/batches', icon: 'Collection' },
      { title: '席位扩容码', path: '/seat-addons', icon: 'Ticket' },
    ],
  },
  {
    kind: 'group',
    key: 'resources',
    title: '套餐与资源',
    icon: 'ShoppingCart',
    children: [
      { title: '套餐与档位', path: '/mall', icon: 'ShoppingCart' },
      { title: 'IP 资源', path: '/ip-resources', icon: 'Connection' },
    ],
  },
  {
    kind: 'group',
    key: 'records',
    title: '日志与记录',
    icon: 'Document',
    children: [
      { title: '设备管理', path: '/devices', icon: 'Monitor' },
      { title: '换机记录', path: '/unbind-logs', icon: 'Refresh' },
      { title: '作废记录', path: '/revoke-logs', icon: 'CircleClose' },
      { title: '心跳日志', path: '/heartbeats', icon: 'Timer' },
      { title: '使用分析', path: '/analytics', icon: 'TrendCharts' },
      { title: '操作日志', path: '/logs', icon: 'Document' },
    ],
  },
  { kind: 'item', path: '/site', title: '官网管理', icon: 'Platform' },
  { kind: 'item', path: '/agencies', title: '客户端代理商', icon: 'Shop' },
  { kind: 'item', path: '/marketing', title: '营销管理', icon: 'Promotion' },
  {
    kind: 'group',
    key: 'system',
    title: '系统管理',
    icon: 'Setting',
    children: [
      { title: '管理员', path: '/users', icon: 'Lock', superOnly: true },
      { title: '回收站', path: '/recycle-bin', icon: 'Delete' },
      { title: '系统设置', path: '/settings', icon: 'Setting' },
    ],
  },
]

const visibleMenus = computed<MenuNode[]>(() =>
  menus
    .map((node) => {
      if (node.kind === 'item') {
        return node.superOnly && !store.isSuperAdmin ? null : node
      }
      const children = node.children.filter((item) => !item.superOnly || store.isSuperAdmin)
      return children.length ? { ...node, children } : null
    })
    .filter((node): node is MenuNode => node !== null),
)

const currentMenu = computed(() => {
  for (const node of menus) {
    if (node.kind === 'item') {
      if (node.path === route.path) return { title: node.title, group: '' }
    } else {
      const item = node.children.find((child) => child.path === route.path)
      if (item) return { title: item.title, group: node.title }
    }
  }
  return null
})

// ============ 服务健康 ============
const health = ref(true)
const healthText = ref('正在检测服务状态...')

async function checkHealth() {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' })
    health.value = res.ok
    healthText.value = health.value ? '后端服务正常' : '后端服务异常'
  } catch {
    health.value = false
    healthText.value = '后端服务异常'
  }
}

let healthTimer: number | undefined

onMounted(() => {
  checkHealth()
  healthTimer = window.setInterval(checkHealth, 30000)
})

onBeforeUnmount(() => {
  if (healthTimer) window.clearInterval(healthTimer)
})

// ============ 用户操作 ============
async function onCommand(cmd: string) {
  if (cmd === 'logout') {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      type: 'warning',
      confirmButtonText: '退出',
      cancelButtonText: '取消',
    })
    store.logout()
    router.push('/login')
  }
}
</script>

<style scoped lang="scss">
.main-layout {
  height: 100%;
  display: flex;
}

.sidebar {
  width: var(--sidebar-width);
  background: linear-gradient(180deg, #1f2d4d 0%, #17233d 100%);
  display: flex;
  flex-direction: column;
  transition: width 0.2s;
  flex-shrink: 0;

  &.collapsed {
    width: var(--sidebar-collapsed-width);
  }

  .logo {
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
    color: #fff;
    flex-shrink: 0;

    .logo-text {
      font-size: 16px;
      font-weight: 600;
      white-space: nowrap;
    }
  }

  .menu-scroll {
    flex: 1;
  }

  :deep(.el-menu) {
    border-right: none;

    .el-menu-item,
    .el-sub-menu__title {
      color: #a8b6d4;
      height: 46px;
      margin: 2px 8px;
      border-radius: 6px;

      &:hover {
        background: rgba(58, 122, 254, 0.15);
        color: #fff;
      }
    }

    .el-menu-item.is-active {
      background: var(--primary-color);
      color: #fff;
    }

    // 一级分组展开时标题保持高亮，便于定位当前业务域
    .el-sub-menu.is-active > .el-sub-menu__title {
      color: #fff;
    }

    // 二级菜单项缩小高度并缩进，层级更清晰
    .el-sub-menu .el-menu-item {
      height: 40px;
      padding-left: 44px !important;
      font-size: 13px;
    }
  }
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.header {
  height: 56px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.06);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;

  .collapse-btn {
    cursor: pointer;
    color: var(--text-secondary);
    &:hover {
      color: var(--primary-color);
    }
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;

  .health {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-secondary);

    .health-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;

      &.ok {
        background: var(--success-color);
        box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
      }
      &.bad {
        background: var(--danger-color);
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);
      }
    }
  }

  .user-info {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--text-main);
    outline: none;

    .user-avatar {
      background: var(--primary-color);
      font-size: 14px;
    }
    .user-name {
      font-size: 14px;
    }
  }
}

.content {
  flex: 1;
  overflow: auto;
}
</style>

<!-- 折叠态下二级菜单通过 teleport 渲染到 body，scoped 样式覆盖不到，需全局样式 -->
<style lang="scss">
.sidebar-submenu {
  .el-menu--popup {
    background: #17233d;
    padding: 6px;
    min-width: 168px;
  }

  .el-menu-item {
    color: #a8b6d4;
    height: 40px;
    margin: 2px 0;
    border-radius: 6px;

    &:hover {
      background: rgba(58, 122, 254, 0.15);
      color: #fff;
    }

    &.is-active {
      background: var(--primary-color);
      color: #fff;
    }
  }
}
</style>
