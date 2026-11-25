import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authApi, permissionsApi } from '../api';

interface User {
  id: number;
  username: string;
  email: string;
  nickname: string | null;
  role: string;
  tenant_id?: number | null;
  tenant_name?: string | null;
  tenant_code?: string | null;
  is_personal?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  permissions: string[];
  isAdmin: boolean;
  /** 登录态校验出现临时故障（网络/后端不可用）时的提示，null 表示正常 */
  authError: string | null;
  hasPermission: (code: string) => boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, nickname?: string, company_name?: string, company_code?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

// 本地缓存：网络抖动 / 后端重启时用缓存兜住登录态，避免被误判为「登录失效」
const USER_CACHE_KEY = 'auth_user_cache';
const PERM_CACHE_KEY = 'auth_permissions_cache';

function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // 初始化优先用缓存：即使 getMe 暂时失败，也不会闪一下登录页
  const [user, setUser] = useState<User | null>(() =>
    readCache<User | null>(USER_CACHE_KEY, null),
  );
  const [permissions, setPermissions] = useState<string[]>(() =>
    readCache<string[]>(PERM_CACHE_KEY, []),
  );
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const hasPermission = (code: string): boolean => {
    if (isAdmin) return true;
    return permissions.includes(code);
  };

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem(USER_CACHE_KEY);
    localStorage.removeItem(PERM_CACHE_KEY);
    sessionStorage.removeItem('product_management_session_filters_v1');
    setUser(null);
    setPermissions([]);
    setAuthError(null);
  }, []);

  const fetchPermissions = useCallback(async () => {
    try {
      const res = await permissionsApi.getMyPermissions();
      if (res.data?.success) {
        setPermissions(res.data.data);
        localStorage.setItem(PERM_CACHE_KEY, JSON.stringify(res.data.data));
      }
    } catch (error) {
      // 权限接口失败时沿用缓存：静默清空会让非 admin 用户的菜单突然全部消失
      console.error('获取权限列表失败（沿用缓存）:', error);
    }
  }, []);

  /**
   * 校验登录态。
   *
   * 关键约定（2026-11-25 修复自动登出）：
   * - 只有 **401（凭据失效/过期）** 才 logout；
   * - 网络错误、5xx、后端重启中都没有 error.response，此时**保留 token 与缓存用户**，
   *   退避重试 2 次；仍失败则仅提示，绝不清登录态。
   *   否则「后端重启 / 断网 1 秒 / 代理超时」都会让用户 F5 后被踢回登录页。
   */
  const checkAuth = useCallback(
    async (retry = 0): Promise<void> => {
      try {
        const response = await authApi.getMe();
        setUser(response.data);
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(response.data));
        await fetchPermissions();
        setAuthError(null);
        setLoading(false);
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 401) {
          // 拦截器已做 401 二次确认：复核通过会静默重放（不会进到这里）；
          // 走到这里说明拦截器复核后仍 401 并已清 token 跳登录，或复核网络失败。
          // 仅当 token 确实已被拦截器清除（凭据确认失效）才同步清理内存，
          // token 还在 = 临时故障，保留登录态走下方退避重试。
          if (!localStorage.getItem('token')) {
            logout();
            setLoading(false);
            return;
          }
        }
        if (retry < 2) {
          // 临时故障：保持 loading（ProtectedRoute 不会跳登录），退避后重试
          setTimeout(() => {
            void checkAuth(retry + 1);
          }, 800 * (retry + 1));
          return;
        }
        console.error('认证校验失败（保留本地登录态，不退出）:', error);
        const cached = readCache<User | null>(USER_CACHE_KEY, null);
        if (cached) setUser(cached);
        setAuthError('无法连接服务器，请检查网络后刷新页面');
        setLoading(false);
      }
    },
    [fetchPermissions, logout],
  );

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    void checkAuth();
  }, [checkAuth]);

  const refreshUser = async () => {
    try {
      const response = await authApi.getMe();
      setUser(response.data);
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(response.data));
      await fetchPermissions();
    } catch (error) {
      console.error('刷新用户信息失败:', error);
    }
  };

  const login = async (username: string, password: string) => {
    try {
      const response = await authApi.login(username, password);
      const { access_token } = response.data;
      localStorage.setItem('token', access_token);
      await checkAuth();
    } catch (error) {
      throw error;
    }
  };

  const register = async (username: string, email: string, password: string, nickname?: string, company_name?: string, company_code?: string) => {
    try {
      const response = await authApi.register(username, email, password, nickname, company_name, company_code);
      const { access_token } = response.data;
      localStorage.setItem('token', access_token);
      await checkAuth();
    } catch (error) {
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, permissions, isAdmin, authError, hasPermission, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthContext');
  }
  return context;
};
