import axios from "axios";

const API_BASE = "/api";

// 配置 axios 实例
const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 180000,
  headers: {
    "Content-Type": "application/json",
  },
  paramsSerializer: (params) => {
    // 自定义参数序列化，处理数组参数
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // 数组参数用同一个 key 多次传递
        value.forEach((item) => {
          if (item !== undefined && item !== null) {
            searchParams.append(key, item);
          }
        });
      } else if (value !== undefined && value !== null) {
        searchParams.append(key, value);
      }
    });
    return searchParams.toString();
  },
});

// 请求拦截器 - 自动添加 token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // 如果是 401 未授权，清除 token（只有当不是在登录页面时才跳转）
    if (error.response?.status === 401) {
      const url = error.config?.url || "";

      // 只有当不是登录请求且不在登录页面时才跳转
      if (
        !url.includes("/auth/login") &&
        window.location.pathname !== "/login"
      ) {
        console.warn("认证过期，跳转到登录页");
        localStorage.removeItem("token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

// ========== Auth API ==========
export const authApi = {
  login: (username: string, password: string) =>
    apiClient.post("/auth/login", { username, password }),

  register: (
    username: string,
    email: string,
    password: string,
    nickname?: string,
    company_name?: string,
    company_code?: string,
  ) =>
    apiClient.post("/auth/register", {
      username, email, password, nickname,
      company_name, company_code,
    }),

  getMe: () => apiClient.get("/auth/me"),

  changePassword: (oldPassword: string, newPassword: string) =>
    apiClient.post("/auth/change-password", {
      old_password: oldPassword,
      new_password: newPassword,
    }),
};

// ========== Dashboard API ==========
export const dashboardApi = {
  getStats: () => apiClient.get("/dashboard/stats"),
};

// ========== Inventory API ==========
export const inventoryApi = {
  getAlerts: () => apiClient.get("/inventory/alerts"),
  getList: () => apiClient.get("/inventory/"),
  updateStock: (id: string, data: any) =>
    apiClient.put(`/inventory/${id}`, data),

  // ========== Restock (补货) API ==========
  getOverview: () => apiClient.get("/restock/overview"),
  calculate: (params?: { snapshot_ids?: string }) =>
    apiClient.post("/restock/calculate", params),
  getCalculateStatus: (taskId: string) =>
    apiClient.get(`/restock/calculate/status/${taskId}`),
  import: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/restock/import", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  search: (params: any) => apiClient.get("/restock/search", { params }),
  getStockoutTop10: () => apiClient.get("/restock/stockout-top10"),
  getOverstockTop10: () => apiClient.get("/restock/overstock-top10"),
  getInboundDetails: (asin: string, account?: string) =>
    apiClient.get("/restock/inbound-details", { params: { asin, account } }),
  getLatestDate: () => apiClient.get("/restock/latest-date"),
  getFilterOptions: () => apiClient.get("/restock/filter-options"),
  exportInventory: (params?: {
    keyword?: string;
    risk_level?: string[];
    account?: string[];
    country?: string[];
    fields?: string[];
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.keyword) searchParams.append("keyword", params.keyword);
    if (params?.risk_level)
      params.risk_level.forEach((r) => searchParams.append("risk_level", r));
    if (params?.account)
      params.account.forEach((a) => searchParams.append("account", a));
    if (params?.country)
      params.country.forEach((c) => searchParams.append("country", c));
    if (params?.fields)
      params.fields.forEach((f) => searchParams.append("fields", f));
    return apiClient.get(`/restock/export?${searchParams.toString()}`, {
      responseType: "blob",
    });
  },
  syncFeishuInbound: () => apiClient.post("/restock/sync-feishu-inbound"),
  getSyncFeishuStatus: () => apiClient.get("/restock/sync-feishu-status"),
  updateInspectionQuantity: (snapshotId: number, quantity: number) =>
    apiClient.put("/restock/inspection-quantity", null, {
      params: { snapshot_id: snapshotId, inspection_quantity: quantity },
    }),
  getSummaryChildren: (asin: string) =>
    apiClient.get("/restock/summary-children", { params: { asin } }),
  markHoliday: (snapshotIds: number[], isHoliday: boolean) =>
    apiClient.post("/restock/mark-holiday", {
      snapshot_ids: snapshotIds,
      is_holiday: isHoliday,
    }),
};

// ========== Local Inventory API ==========
export const localInventoryApi = {
  import: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/local-inventory/import", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  getSummary: () => apiClient.get("/local-inventory/summary"),
  getList: (params?: { keyword?: string; page?: number; page_size?: number }) =>
    apiClient.get("/local-inventory/list", { params }),
  clear: () => apiClient.delete("/local-inventory/clear"),
  importReduction: (country: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post(
      `/local-inventory/import-reduction?country=${encodeURIComponent(country)}`,
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    );
  },
  downloadReductionResult: (fileId: string) =>
    apiClient.get(`/local-inventory/import-reduction/result/${fileId}`, {
      responseType: "blob",
    }),
};

// ========== Reviews API ==========
export const reviewsApi = {
  getList: (params?: {
    page?: number;
    page_size?: number;
    asin_search?: string;
    product_name_search?: string;
    sku_search?: string;
    sort_by?: string;
    sort_order?: string;
    start_date?: string;
    end_date?: string;
    status?: string;
    importance_level?: string;
  }) => {
    // 过滤掉undefined、null和空字符串的参数
    const filteredParams: any = {};
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          filteredParams[key] = value;
        }
      });
    }
    return apiClient.get("/reviews/", { params: filteredParams });
  },
  getById: (id: string) => apiClient.get(`/reviews/${id}`),
  updateStatus: (id: string, status: string) =>
    apiClient.put(`/reviews/${id}/status`, { status }),
  updateImportance: (id: string, importance_level: string | undefined) =>
    apiClient.put(`/reviews/${id}/importance`, { importance_level }),
  batchAnalyze: (ids: string[]) =>
    apiClient.post("/reviews/analyze/batch", ids),
  getNewCount: () => apiClient.get("/reviews/new/count"),
  getStats: () => apiClient.get("/reviews/stats"),
};

// ========== Departments API ==========
export const departmentsApi = {
  getList: () => apiClient.get("/departments/"),
  create: (data: { name: string; description?: string }) =>
    apiClient.post("/departments/", data),
  update: (id: number, data: { name?: string; description?: string }) =>
    apiClient.put(`/departments/${id}`, data),
  delete: (id: number) => apiClient.delete(`/departments/${id}`),
  getMembers: (id: number) => apiClient.get(`/departments/${id}/members`),
  addMember: (deptId: number, userId: number) =>
    apiClient.post(`/departments/${deptId}/members`, { user_id: userId }),
  removeMember: (deptId: number, userId: number) =>
    apiClient.delete(`/departments/${deptId}/members/${userId}`),
  getAllUsers: () => apiClient.get("/departments/users/all"),
  updateUserDepartments: (userId: number, departmentIds: number[]) =>
    apiClient.put(`/departments/users/${userId}/departments`, departmentIds),
  createUser: (data: { username: string; email: string; role?: string; role_id?: number }) =>
    apiClient.post("/departments/users", data),
  updateUser: (userId: number, data: { username?: string; email?: string; nickname?: string; role?: string; role_id?: number }) =>
    apiClient.put(`/departments/users/${userId}`, data),
  deleteUser: (userId: number) =>
    apiClient.delete(`/departments/users/${userId}`),
  toggleUserStatus: (userId: number) =>
    apiClient.put(`/departments/users/${userId}/toggle-status`),
  changeUserPassword: (userId: number, newPassword: string) =>
    apiClient.put(`/departments/users/${userId}/change-password`, { new_password: newPassword }),
  batchAssignDepartments: (data: {
    user_ids: number[];
    department_ids: number[];
  }) => apiClient.post("/departments/users/batch-assign", data),
  batchEnableUsers: (userIds: number[]) =>
    apiClient.post("/departments/users/batch-enable", { user_ids: userIds }),
  batchDisableUsers: (userIds: number[]) =>
    apiClient.post("/departments/users/batch-disable", { user_ids: userIds }),
  batchChangePassword: (userIds: number[], newPassword: string) =>
    apiClient.post("/departments/users/batch-password", { user_ids: userIds, new_password: newPassword }),
  batchDeleteUsers: (userIds: number[]) =>
    apiClient.post("/departments/users/batch-delete", { user_ids: userIds }),
};

// ========== Notifications API ==========
export const notificationsApi = {
  getList: (params?: {
    page?: number;
    page_size?: number;
    unread_only?: boolean;
  }) => apiClient.get("/notifications/", { params }),
  getUnreadCount: () => apiClient.get("/notifications/unread-count"),
  markAsRead: (id: number) => apiClient.put(`/notifications/${id}/read`),
  markAllAsRead: () => apiClient.put("/notifications/read-all"),
};

// ========== Chat API ==========
export const chatApi = {
  sendMessage: (
    message: string,
    sessionId?: string,
    chatType: string = "review",
  ) =>
    apiClient.post(
      "/chat",
      { message, session_id: sessionId, chat_type: chatType },
      { timeout: 300000 },
    ),
  getSessions: (chatType?: string) =>
    apiClient.get("/chat/sessions", {
      params: chatType ? { chat_type: chatType } : {},
    }),
  getSessionMessages: (sessionId: string) =>
    apiClient.get(`/chat/sessions/${sessionId}/messages`),

  deleteSession: (sessionId: string) =>
    apiClient.delete(`/chat/sessions/${sessionId}`),
};

// ========== Chat API (Streaming) ==========
export const chatStreamApi = {
  sendMessage: async (
    message: string,
    sessionId?: string,
    chatType: string = "review",
  ): Promise<Response> => {
    return fetch("/api/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
      },
      body: JSON.stringify({
        message,
        session_id: sessionId,
        chat_type: chatType,
      }),
    });
  },

  searchSessions: (query: string, chatType?: string, limit?: number) =>
    apiClient.post("/chat/search", { query, chat_type: chatType, limit }),

  exportSession: (
    sessionId: string,
    format: "markdown" | "json" | "txt" = "markdown",
  ) =>
    apiClient.post(
      "/chat/export",
      { session_id: sessionId, format },
      { responseType: "text" },
    ),
};

// ========== Stores API ==========
export const storesApi = {
  getList: (params?: {
    page?: number;
    page_size?: number;
    name_search?: string;
    site_search?: string;
  }) => apiClient.get("/stores/", { params }),
  getAll: () => apiClient.get("/stores/all"),
  create: (data: {
    name: string;
    platform?: string;
    site?: string;
    inventory_name?: string;
    platform_store_id?: string;
    department_id?: number;
  }) => apiClient.post("/stores/", data),
  update: (
    id: number,
    data: {
      name?: string;
      platform?: string;
      site?: string;
      inventory_name?: string;
      platform_store_id?: string;
      department_id?: number;
      status?: string;
    },
  ) => apiClient.put(`/stores/${id}`, data),
  delete: (id: number) => apiClient.delete(`/stores/${id}`),
  batchUpdateDepartment: (data: {
    store_ids: number[];
    department_id?: number;
  }) => apiClient.post("/stores/batch-update-department", data),
};

// ========== Products API ==========
export const productsApi = {
  getList: (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    product_type?: string;
    status?: string;
  }) => apiClient.get("/products/", { params }),
  getById: (id: number) => apiClient.get(`/products/${id}`),
  create: (data: {
    product_code?: string;
    name: string;
    name_en?: string;
    product_type?: string;
    product_attribute?: string;
    category?: string;
    brand?: string;
    purchase_price?: number;
    sale_price?: number;
    main_image?: string;
    weight?: number;
    length?: number;
    width?: number;
    height?: number;
    status?: string;
    is_robot_monitored?: boolean;
    local_quantity?: number;
    local_warehouse?: string;
    local_inbound_date?: string;
    local_stock_age?: number;
  }) => apiClient.post("/products/", data),
  update: (
    id: number,
    data: {
      product_code?: string;
      name?: string;
      name_en?: string;
      product_type?: string;
      product_attribute?: string;
      category?: string;
      brand?: string;
      purchase_price?: number;
      sale_price?: number;
      main_image?: string;
      weight?: number;
      length?: number;
      width?: number;
      height?: number;
      status?: string;
      is_robot_monitored?: boolean;
      local_quantity?: number;
      local_warehouse?: string;
      local_inbound_date?: string;
      local_stock_age?: number;
    },
  ) => apiClient.put(`/products/${id}`, data),
  delete: (id: number) => apiClient.delete(`/products/${id}`),
  getPlatformProducts: (productId: number) =>
    apiClient.get(`/products/${productId}/platform-products`),
  createPlatformProduct: (
    productId: number,
    data: {
      platform: string;
      store_ids: number[];
      platform_product_id?: string;
      asin?: string;
      spu?: string;
      sku?: string;
      title?: string;
      title_en?: string;
      image_url?: string;
      currency?: string;
      price?: number;
      cost_price?: number;
      status?: string;
    },
  ) => apiClient.post(`/products/${productId}/platform-products`, data),
  updatePlatformProduct: (
    productId: number,
    ppId: number,
    data: {
      platform_product_id?: string;
      asin?: string;
      spu?: string;
      sku?: string;
      title?: string;
      title_en?: string;
      image_url?: string;
      currency?: string;
      price?: number;
      cost_price?: number;
      status?: string;
      store_ids?: number[];
    },
  ) => apiClient.put(`/products/${productId}/platform-products/${ppId}`, data),
  deletePlatformProduct: (productId: number, ppId: number) =>
    apiClient.delete(`/products/${productId}/platform-products/${ppId}`),
  downloadTemplate: () => apiClient.get('/products/template/download', {
    responseType: 'blob',
  }),
  uploadPreview: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/products/upload/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  batchImport: (data: any) =>
    apiClient.post('/products/batch-import', data),
  getImportRecordStatus: (recordId: number) =>
    apiClient.get(`/products/import-records/${recordId}/status`),
  batchUpdateMissing: (items: any[]) =>
    apiClient.post('/products/batch-update-missing', { items }),
  exportProducts: (params?: {
    search?: string;
    product_type?: string[];
    product_attribute?: string;
    status?: string;
  }) => apiClient.get('/products/export', {
    params,
    paramsSerializer: (params) => {
      const items: string[] = []
      Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((v) => items.push(`${key}=${encodeURIComponent(v)}`))
        } else if (value !== undefined && value !== null) {
          items.push(`${key}=${encodeURIComponent(String(value))}`)
        }
      })
      return items.join('&')
    },
    responseType: 'blob',
  }),
  batchDelete: (ids: number[]) =>
    apiClient.post('/products/batch-delete', { ids }),
  batchBindAccessory: (data: { finished_product_ids: number[]; accessory_ids: number[]; quantity?: number }) =>
    apiClient.post('/products/batch-bind-accessory', data),
  getImportRecords: (params?: {
    status?: string;
    created_by?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  }) => apiClient.get('/products/import-records', { params }),
  getImportRecordPreviewData: (id: number) =>
    apiClient.get(`/products/import-records/${id}/preview-data`),
  getImportRecordDetail: (id: number) =>
    apiClient.get(`/products/import-records/${id}`),
};

// ========== Inventory Count API ==========
export const inventoryCountApi = {
  downloadTemplate: () =>
    apiClient.get('/inventory-count/template', { responseType: 'blob' }),
  upload: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return apiClient.post('/inventory-count/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  confirm: (data: { items: any[] }) =>
    apiClient.post('/inventory-count/confirm', data),
};

// ========== Store Groups API ==========
export const storeGroupsApi = {
  getList: () => apiClient.get("/store-groups/"),
  getGroupStores: (groupId: number) => apiClient.get(`/store-groups/${groupId}/stores`),
  create: (data: { name: string; description?: string }) =>
    apiClient.post("/store-groups/", data),
  update: (id: number, data: { name?: string; description?: string }) =>
    apiClient.put(`/store-groups/${id}`, data),
  delete: (id: number) => apiClient.delete(`/store-groups/${id}`),
  batchAddStores: (groupId: number, storeIds: number[]) =>
    apiClient.post(`/store-groups/${groupId}/stores`, { store_ids: storeIds }),
  removeStore: (groupId: number, storeId: number) =>
    apiClient.delete(`/store-groups/${groupId}/stores/${storeId}`),
};

// ========== Tenants API ==========
export const tenantsApi = {
  getList: () => apiClient.get("/tenants/"),
  getById: (id: number) => apiClient.get(`/tenants/${id}`),
  create: (data: { name: string; code: string; status?: string }) =>
    apiClient.post("/tenants/", data),
  update: (
    id: number,
    data: {
      name?: string;
      code?: string;
      status?: string;
    },
  ) => apiClient.put(`/tenants/${id}`, data),
  delete: (id: number) => apiClient.delete(`/tenants/${id}`),
  generateBindingCode: (id: number) =>
    apiClient.put(`/tenants/${id}/generate-binding-code`),
  bind: (binding_code: string) =>
    apiClient.post("/tenants/bind", { binding_code }),
};

// ========== Inbound Orders API ==========
export const inboundOrdersApi = {
  getList: (params?: {
    page?: number;
    page_size?: number;
    status?: string;
    inbound_type?: string;
    search?: string;
  }) => apiClient.get("/inbound-orders/", { params }),
  create: (data: {
    order_number: string;
    inbound_type: string;
    purchase_order_id?: number;
    warehouse?: string;
    handler?: string;
    inbound_date?: string;
    notes?: string;
    items: {
      product_id: number;
      quantity: number;
      unit_price?: number;
      batch_number?: string;
      production_date?: string;
      expiry_date?: string;
      warehouse?: string;
      notes?: string;
    }[];
  }) => apiClient.post("/inbound-orders/", data),
  update: (id: number, data: {
    order_number?: string;
    inbound_type?: string;
    purchase_order_id?: number;
    warehouse?: string;
    handler?: string;
    inbound_date?: string;
    notes?: string;
  }) => apiClient.put(`/inbound-orders/${id}`, data),
  confirm: (id: number) => apiClient.put(`/inbound-orders/${id}/confirm`),
  delete: (id: number) => apiClient.delete(`/inbound-orders/${id}`),
  downloadTemplate: () => apiClient.get(`/inbound-orders/template/download`, {
    responseType: 'blob',
  }),
  uploadPreview: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/inbound-orders/upload/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ========== Outbound Orders API ==========
export const outboundOrdersApi = {
  getList: (params?: {
    page?: number;
    page_size?: number;
    status?: string;
    outbound_type?: string;
    search?: string;
  }) => apiClient.get("/outbound-orders/", { params }),
  create: (data: {
    order_number: string;
    outbound_type: string;
    warehouse?: string;
    handler?: string;
    outbound_date?: string;
    notes?: string;
    items: {
      product_id: number;
      quantity: number;
      unit_price?: number;
      notes?: string;
    }[];
  }) => apiClient.post("/outbound-orders/", data),
  update: (id: number, data: {
    order_number?: string;
    outbound_type?: string;
    warehouse?: string;
    handler?: string;
    outbound_date?: string;
    notes?: string;
  }) => apiClient.put(`/outbound-orders/${id}`, data),
  confirm: (id: number) => apiClient.put(`/outbound-orders/${id}/confirm`),
  delete: (id: number) => apiClient.delete(`/outbound-orders/${id}`),
  downloadTemplate: () => apiClient.get(`/outbound-orders/template/download`, {
    responseType: 'blob',
  }),
  uploadPreview: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/outbound-orders/upload/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ========== Purchase Orders API ==========
export const purchaseOrdersApi = {
  getList: (params?: {
    page?: number;
    page_size?: number;
    status?: string;
    supplier?: string;
    search?: string;
  }) => apiClient.get("/purchase-orders/", { params }),
  create: (data: {
    order_number: string;
    supplier?: string;
    contact_person?: string;
    contact_phone?: string;
    warehouse?: string;
    expected_date?: string;
    notes?: string;
    items: {
      product_id: number;
      quantity: number;
      unit_price?: number;
      notes?: string;
    }[];
  }) => apiClient.post("/purchase-orders/", data),
  update: (id: number, data: {
    order_number?: string;
    supplier?: string;
    contact_person?: string;
    contact_phone?: string;
    warehouse?: string;
    expected_date?: string;
    notes?: string;
    status?: string;
  }) => apiClient.put(`/purchase-orders/${id}`, data),
  delete: (id: number) => apiClient.delete(`/purchase-orders/${id}`),
  downloadTemplate: () => apiClient.get(`/purchase-orders/template/download`, {
    responseType: 'blob',
  }),
  uploadPreview: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/purchase-orders/upload/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ========== Inventory Batches API ==========
export const inventoryBatchesApi = {
  getProductBatches: (productId: number) => apiClient.get(`/inventory-batches/product/${productId}`),
  getProductHistory: (productId: number) => apiClient.get(`/inventory-batches/product/${productId}/history`),
  getReport: (params?: { page?: number; page_size?: number }) => apiClient.get("/inventory-batches/report", { params }),
  updateShelfNumber: (batchId: number, shelfNumber: string) =>
    apiClient.put(`/inventory-batches/${batchId}/shelf-number`, { shelf_number: shelfNumber }),
};

// ========== Operation Logs API ==========
export const operationLogsApi = {
  getList: (params?: {
    page?: number;
    page_size?: number;
    module?: string;
    action?: string;
    user_id?: number;
    start_date?: string;
    end_date?: string;
    search?: string;
  }) => apiClient.get("/operation-logs/", { params }),
  getModules: () => apiClient.get("/operation-logs/modules"),
  getActions: () => apiClient.get("/operation-logs/actions"),
};

// ========== Permissions API ==========
export const permissionsApi = {
  // 角色管理
  getRoles: () => apiClient.get("/permissions/roles"),
  createRole: (data: { name: string; code: string; description?: string; sort_order?: number }) =>
    apiClient.post("/permissions/roles", data),
  updateRole: (id: number, data: { name?: string; description?: string; sort_order?: number }) =>
    apiClient.put(`/permissions/roles/${id}`, data),
  deleteRole: (id: number) => apiClient.delete(`/permissions/roles/${id}`),

  // 权限管理
  getPermissions: (type?: string) => apiClient.get("/permissions/permissions", { params: { type } }),

  // 角色权限
  getRolePermissions: (roleId: number) => apiClient.get(`/permissions/roles/${roleId}/permissions`),
  updateRolePermissions: (roleId: number, permissionIds: number[]) =>
    apiClient.put(`/permissions/roles/${roleId}/permissions`, { permission_ids: permissionIds }),

  // 角色用户
  getRoleUsers: (roleId: number) => apiClient.get(`/permissions/roles/${roleId}/users`),
  updateRoleUsers: (roleId: number, userIds: number[]) =>
    apiClient.put(`/permissions/roles/${roleId}/users`, { user_ids: userIds }),

  // 用户管理
  getAllUsers: () => apiClient.get("/permissions/users"),

  // 当前用户权限
  getMyPermissions: () => apiClient.get("/permissions/my-permissions"),

  // 初始化默认权限
  initDefaultPermissions: () => apiClient.post("/permissions/init-default-permissions"),
  
  // 补充缺失权限
  addMissingPermissions: () => apiClient.post("/permissions/add-missing-permissions"),
};

// ========== Stock Transfer API ==========
export const stockTransfersApi = {
  getList: (params?: {
    page?: number;
    page_size?: number;
    status?: string;
    source_warehouse?: string;
    search?: string;
    start_date?: string;
    end_date?: string;
  }) => apiClient.get("/stock-transfers/", { params }),
  getDetail: (id: number) => apiClient.get(`/stock-transfers/${id}`),
  create: (data: {
    order_number: string;
    source_warehouse: string;
    target_warehouse: string;
    notes?: string;
    items: {
      product_id: number;
      batch_id?: number;
      batch_number?: string;
      shelf_number?: string;
      target_shelf_number?: string;
      quantity: number;
      unit_price?: number;
      notes?: string;
    }[];
  }) => apiClient.post("/stock-transfers/", data),
  update: (id: number, data: {
    order_number?: string;
    source_warehouse?: string;
    target_warehouse?: string;
    notes?: string;
  }) => apiClient.put(`/stock-transfers/${id}`, data),
  confirm: (id: number) => apiClient.put(`/stock-transfers/${id}/confirm`),
  delete: (id: number) => apiClient.delete(`/stock-transfers/${id}`),
  getWarehouses: () => apiClient.get("/stock-transfers/warehouses/list"),
  getProductsByWarehouse: (warehouse: string) =>
    apiClient.get("/stock-transfers/products/by-warehouse", { params: { warehouse } }),
};

export const warehousesApi = {
  getList: (params?: { search?: string; status?: string; page?: number; page_size?: number }) =>
    apiClient.get("/warehouses/", { params }),
  create: (data: {
    name: string;
    code?: string;
    address?: string;
    contact_person?: string;
    contact_phone?: string;
    notes?: string;
  }) => apiClient.post("/warehouses/", data),
  update: (id: number, data: {
    name?: string;
    code?: string;
    address?: string;
    contact_person?: string;
    contact_phone?: string;
    status?: string;
    notes?: string;
  }) => apiClient.put(`/warehouses/${id}`, data),
  delete: (id: number) => apiClient.delete(`/warehouses/${id}`),
};

// ========== Emails API ==========
export const emailsApi = {
  getList: (params?: {
    page?: number;
    page_size?: number;
    buyer_mail_number_search?: string;
    store_name_search?: string;
    sort_by?: string;
    sort_order?: string;
  }) => {
    const filteredParams: any = {};
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          filteredParams[key] = value;
        }
      });
    }
    return apiClient.get("/emails/", { params: filteredParams });
  },
  getById: (id: string) => apiClient.get(`/emails/${id}`),
  updateFollowUp: (id: string, follow_up_status: number) =>
    apiClient.put(`/emails/${id}/follow-up`, { follow_up_status }),
  updateNeedReply: (id: string, need_reply: number, reply_text?: string) =>
    apiClient.put(`/emails/${id}/need-reply`, { need_reply, reply_text }),
  getStoreNames: () => apiClient.get("/emails/store-names"),
  getUnfollowedCount: () => apiClient.get("/emails/unfollowed-count"),
  aiReply: (id: string, requirements: string) =>
    apiClient.post(
      `/emails/${id}/ai-reply`,
      { requirements },
      { timeout: 180000 },
    ),
  batchUpdateFollowUp: (email_ids: string[], follow_up_status: number) =>
    apiClient.put('/emails/batch/follow-up', { email_ids, follow_up_status }),
  getDepartmentTodos: () => apiClient.get('/emails/department-todos'),
  reRunRobot: (id: string) => apiClient.post(`/emails/${id}/re-run`),
};

// ========== Business Settings API ==========
export interface FormulaWeight {
  period: string;
  label: string;
  weight: number;
}

export interface DailySalesConfig {
  type: string;
  weights: FormulaWeight[];
}

export interface BusinessSetting {
  id: number;
  setting_type: string;
  setting_name: string;
  formula_config: DailySalesConfig;
  is_active: number;
}

export const businessSettingsApi = {
  getSetting: (settingType: string) =>
    apiClient.get<BusinessSetting>(`/business-settings/${settingType}`),

  listSettings: () => apiClient.get<BusinessSetting[]>("/business-settings/"),

  updateSetting: (
    settingType: string,
    data: { formula_config: DailySalesConfig; is_active?: number },
  ) =>
    apiClient.put<BusinessSetting>(`/business-settings/${settingType}`, data),

  resetSetting: (settingType: string) =>
    apiClient.post<BusinessSetting>(`/business-settings/reset/${settingType}`),
};

// ========== Product Bindings API ==========
export const productBindingsApi = {
  getByFinished: (productId: number) =>
    apiClient.get(`/product-bindings/by-finished/${productId}`),
  getByAccessory: (productId: number) =>
    apiClient.get(`/product-bindings/by-accessory/${productId}`),
  create: (data: {
    finished_product_id: number;
    accessory_product_id: number;
    quantity: number;
  }) => apiClient.post("/product-bindings/", data),
  update: (bindingId: number, data: {
    finished_product_id: number;
    accessory_product_id: number;
    quantity: number;
  }) => apiClient.put(`/product-bindings/${bindingId}`, data),
  delete: (bindingId: number) =>
    apiClient.delete(`/product-bindings/${bindingId}`),
};

// ========== Ads API ==========
export const adsApi = {
  import: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/ads/import", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  getImportStatus: () => apiClient.get("/ads/import-status"),
  getOverview: (params?: {
    account?: string[];
    country?: string[];
    date_from?: string;
    date_to?: string;
    report_type?: string;
  }) => apiClient.get("/ads/overview", { params }),
  search: (params: any) => apiClient.get("/ads/search", { params }),
  getPerformance: (params?: any) => apiClient.get("/ads/performance", { params }),
  getKeywordAnalysis: (params?: any) => apiClient.get("/ads/keyword-analysis", { params }),
  getSearchTermAnalysis: (params?: any) => apiClient.get("/ads/search-term-analysis", { params }),
  export: (params?: any) => apiClient.get("/ads/export", {
    params,
    responseType: "blob",
  }),
  getFilterOptions: (country?: string) =>
    apiClient.get("/ads/filter-options", { params: country ? { country } : {} }),
  getAiSuggestions: (params?: any) => apiClient.get("/ads/ai-suggestions", { params }),
  getHealthScore: (params?: { campaign_id?: string; date_from?: string; date_to?: string }) =>
    apiClient.get("/ads/health-score", { params }),
  syncRpa: (data: { report_type: string; date: string; records: any[] }) =>
    apiClient.post("/ads/sync/rpa", data),
};

// ========== Ad Rules API ==========
export const adRulesApi = {
  getList: () => apiClient.get("/ad-rules/list"),
  create: (data: { name: string; rule_type: string; conditions: any; actions: any }) =>
    apiClient.post("/ad-rules/create", data),
  update: (id: number, data: any) => apiClient.put(`/ad-rules/${id}`, data),
  delete: (id: number) => apiClient.delete(`/ad-rules/${id}`),
  execute: (ruleIds?: number[]) => {
    const params = new URLSearchParams();
    if (ruleIds) ruleIds.forEach(id => params.append("rule_ids", String(id)));
    return apiClient.post(`/ad-rules/execute?${params.toString()}`);
  },
  getPredefined: () => apiClient.get("/ad-rules/predefined"),
};

// ========== Ad Suggestions API ==========
export const adSuggestionsApi = {
  list: (params?: {
    status?: string;
    priority?: string;
    target_type?: string;
    page?: number;
    page_size?: number;
  }) => apiClient.get("/ad-suggestions/list", { params }),
  getById: (id: number) => apiClient.get(`/ad-suggestions/${id}`),
  updateStatus: (id: number, status: string) =>
    apiClient.put(`/ad-suggestions/${id}/status`, { status }),
  runRules: (date: string) =>
    apiClient.post("/ad-suggestions/run-rules", { date }),
  delete: (id: number) => apiClient.delete(`/ad-suggestions/${id}`),
};

// ========== Ad Execution Logs API ==========
export const adExecutionLogsApi = {
  list: (params?: {
    rule_name?: string;
    status?: string;
    page?: number;
    page_size?: number;
  }) => apiClient.get("/ad-execution-logs/list", { params }),
  getById: (id: number) => apiClient.get(`/ad-execution-logs/${id}`),
};

export default apiClient;
