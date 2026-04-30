import axios from 'axios'

const API_BASE = '/api'

// 配置 axios 实例
const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器 - 自动添加 token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // 如果是 401 未授权，清除 token
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ========== Auth API ==========
export const authApi = {
  login: (username: string, password: string) =>
    apiClient.post('/auth/login', { username, password }),
  
  register: (username: string, email: string, password: string, nickname?: string) =>
    apiClient.post('/auth/register', { username, email, password, nickname }),
  
  getMe: () => apiClient.get('/auth/me'),
}

// ========== Dashboard API ==========
export const dashboardApi = {
  getStats: () => apiClient.get('/dashboard/stats'),
}

// ========== Inventory API ==========
export const inventoryApi = {
  getAlerts: () => apiClient.get('/inventory/alerts'),
  getList: () => apiClient.get('/inventory/'),
  updateStock: (id: string, data: any) =>
    apiClient.put(`/inventory/${id}`, data),
}

// ========== Reviews API ==========
export const reviewsApi = {
  getList: () => apiClient.get('/reviews/'),
  getById: (id: string) => apiClient.get(`/reviews/${id}`),
}

// ========== Chat API ==========
export const chatApi = {
  sendMessage: (message: string) =>
    apiClient.post('/chat/message', { message }),
  getHistory: () => apiClient.get('/chat/history'),
}

export default apiClient
