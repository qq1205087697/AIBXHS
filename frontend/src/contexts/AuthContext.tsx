import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
  hasPermission: (code: string) => boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, nickname?: string, company_name?: string, company_code?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<string[]>([]);

  const isAdmin = user?.role === 'admin';

  const hasPermission = (code: string): boolean => {
    if (isAdmin) return true;
    return permissions.includes(code);
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      checkAuth();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchPermissions = async () => {
    try {
      const res = await permissionsApi.getMyPermissions();
      if (res.data.success) {
        setPermissions(res.data.data);
      }
    } catch (error) {
      // ignore
    }
  };

  const checkAuth = async () => {
    try {
      const response = await authApi.getMe();
      setUser(response.data);
      await fetchPermissions();
    } catch (error) {
      console.error('认证失败:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const refreshUser = async () => {
    try {
      const response = await authApi.getMe();
      setUser(response.data);
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

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setPermissions([]);
  };

  return (
    <AuthContext.Provider value={{ user, loading, permissions, isAdmin, hasPermission, login, register, logout, refreshUser }}>
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