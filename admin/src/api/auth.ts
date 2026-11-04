import { get, post } from './request'

export interface UserInfo {
  id: string
  username: string
  nickname: string | null
  role: number
  lastLoginAt?: string | null
  lastLoginIp?: string | null
}

export interface LoginResult {
  token: string
  user: UserInfo
}

/** 登录 */
export function login(data: { username: string; password: string }) {
  return post<LoginResult>('/auth/login', data)
}

/** 当前用户信息 */
export function getProfile() {
  return get<UserInfo>('/auth/profile')
}

/** 退出登录（服务端令牌版本自增，旧 token 立即失效） */
export function logout() {
  return post<null>('/auth/logout')
}
