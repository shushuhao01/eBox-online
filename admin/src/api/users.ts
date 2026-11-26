import { get, post, put, del } from './request'

export interface AdminUser {
  id: string
  username: string
  nickname: string | null
  role: number
  status: number
  lastLoginAt: string | null
  lastLoginIp: string | null
  /** 创始管理员（最早创建）：不可停用、不可删除、角色固定 */
  isFounder: boolean
  createdAt: string
}

/** 管理员列表（仅超管） */
export function getUsers() {
  return get<AdminUser[]>('/users')
}

/** 新建管理员（仅超管） */
export function createUser(data: { username: string; password: string; nickname?: string; role: 0 | 1 }) {
  return post<{ id: string; username: string }>('/users', data)
}

/** 修改密码 */
export function changePassword(data: { oldPassword: string; newPassword: string }) {
  return put<null>('/users/password', data)
}

/** 停用/启用管理员（仅超管） */
export function setUserStatus(id: string, status: 0 | 1) {
  return put<null>(`/users/${id}/status`, { status })
}

/** 编辑管理员资料（仅超管） */
export function updateUser(id: string, data: { username?: string; nickname?: string | null; role?: 0 | 1 }) {
  return put<null>(`/users/${id}`, data)
}

/** 重置管理员密码（仅超管，无需原密码） */
export function resetUserPassword(id: string, newPassword: string) {
  return put<null>(`/users/${id}/password`, { newPassword })
}

/** 删除管理员（仅超管） */
export function deleteUser(id: string) {
  return del<null>(`/users/${id}`)
}
