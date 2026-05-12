import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Row,
  Col,
  Table,
  Tag,
  Statistic,
  Button,
  Input,
  Select,
  Space,
  Modal,
  Empty,
  Spin,
  message,
  Tooltip,
  Upload,
} from "antd";
import type { TablePaginationConfig, ColumnsType } from "antd/es/table";
import type { UploadProps } from "antd";
import {
  Package,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Search,
  Truck,
  BarChart3,
  Upload as UploadIcon,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { inventoryApi } from "../api";
import { useTheme } from "../contexts/ThemeContext";

// ==================== TypeScript Interfaces ====================

interface OverviewData {
  total_sku: number;
  red_count: number;
  yellow_count: number;
  green_count: number;
  snapshot_date: string;
  stockout_top10: StockoutItem[];
  overstock_top10: OverstockItem[];
}

interface StockoutItem {
  asin: string;
  product_name: string;
  account: string;
  country: string;
  days_of_supply: number;
  fba_stock: number;
  daily_sales: number;
  stockout_date: string;
}

interface OverstockItem {
  asin: string;
  product_name: string;
  account: string;
  country: string;
  total_stock: number;
  age_12_plus: number;
  age_9_12: number;
  age_6_9: number;
}

interface InventoryItem {
  id: number;
  asin: string;
  sku: string;
  fnsku: string;
  msku: string;
  product_name: string;
  account: string;
  country: string;
  fba_stock: number;
  fba_available: number;
  fba_pending_transfer: number;
  fba_in_transfer: number;
  fba_inbound_processing: number;
  fba_inbound: number;
  total_stock: number;
  daily_sales: number;
  days_of_supply: number;
  stockout_date: string | null;
  risk_level: string;
  replenishment_status: string;
  summary_flag: string;
}

interface InboundDetail {
  shipment_id: string;
  quantity: number;
  logistics_method: string;
  transport_method: string;
  ship_date: string | null;
  estimated_available_date: string | null;
}

// ==================== Helper Functions ====================

const getDaysSupplyColor = (days: number): string => {
  if (days <= 30) return "#cf1322";
  if (days <= 60) return "#fa8c16";
  return "#52c41a";
};

const getDaysSupplyTag = (days: number) => {
  if (days <= 30) return <Tag color="red">{days}天</Tag>;
  if (days <= 60) return <Tag color="orange">{days}天</Tag>;
  return <Tag color="green">{days}天</Tag>;
};

const getRiskLevelTag = (level: string) => {
  if (level === "red" || level === "红色")
    return <Tag color="red">断货风险</Tag>;
  if (level === "yellow" || level === "黄色")
    return <Tag color="orange">库存预警</Tag>;
  if (level === "green" || level === "绿色")
    return <Tag color="green">库存正常</Tag>;
  return <Tag>{level}</Tag>;
};

const formatNumber = (num: number | null | undefined): string => {
  if (num === null || num === undefined) return "-";
  return num.toLocaleString();
};

const truncateText = (text: string, maxLen: number): string => {
  if (!text) return "-";
  return text.length > maxLen ? text.substring(0, maxLen) + "..." : text;
};

// ==================== Component ====================

const InventoryBot: React.FC = () => {
  const { currentTheme } = useTheme();
  const [messageApi, contextHolder] = message.useMessage();

  // --- Loading states ---
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  // --- Data states ---
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [inventoryList, setInventoryList] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);

  // --- Filter states ---
  const [searchText, setSearchText] = useState("");
  const [accountFilter, setAccountFilter] = useState<string | undefined>(
    undefined,
  );
  const [countryFilter, setCountryFilter] = useState<string | undefined>(
    undefined,
  );
  const [accountOptions, setAccountOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);

  // --- Pagination ---
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
    showSizeChanger: true,
    showTotal: (t) => `共 ${t} 条`,
    pageSizeOptions: ["10", "20", "50", "100"],
  });

  // --- Sorting ---
  const [sortField, setSortField] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<string | undefined>(undefined);

  // --- Table Filter State ---
  const [tableRiskFilter, setTableRiskFilter] = useState<string[] | undefined>(
    undefined,
  );

  // --- Modal states ---
  const [inboundModalVisible, setInboundModalVisible] = useState(false);
  const [inboundDetails, setInboundDetails] = useState<InboundDetail[]>([]);
  const [inboundLoading, setInboundLoading] = useState(false);
  const [inboundAsin, setInboundAsin] = useState("");

  // --- Expanded rows for TOP10 lists ---
  const [expandedStockout, setExpandedStockout] = useState<string | null>(null);
  const [expandedOverstock, setExpandedOverstock] = useState<string | null>(
    null,
  );

  // --- Collapsed state for TOP10 cards ---
  const [stockoutCollapsed, setStockoutCollapsed] = useState(true);
  const [overstockCollapsed, setOverstockCollapsed] = useState(true);

  // ==================== Data Fetching ====================

  const fetchOverview = useCallback(async () => {
    try {
      setOverviewLoading(true);
      const response = await inventoryApi.getOverview();
      const data = response.data?.data || response.data;
      if (data) {
        setOverviewData(data);
      }
    } catch (error) {
      console.error("获取概览数据失败:", error);
      messageApi.error("获取概览数据失败");
    } finally {
      setOverviewLoading(false);
    }
  }, [messageApi]);

  const fetchInventoryList = useCallback(
    async (
      page = 1,
      pageSize = 20,
      search?: string,
      risk?: string | string[],
      account?: string,
      country?: string,
      sortF?: string,
      sortOrd?: string,
    ) => {
      try {
        setTableLoading(true);
        const params: any = {
          page,
          page_size: pageSize,
        };
        if (search) params.keyword = search;
        if (risk) params.risk_level = risk;
        if (account) params.account = account;
        if (country) params.country = country;
        if (sortF) params.sort_field = sortF;
        if (sortOrd) params.sort_order = sortOrd;

        console.log("发送请求参数:", params);

        const response = await inventoryApi.search(params);
        const data = response.data?.data || response.data;
        if (data) {
          // 过滤掉共享库存，只展示独立SKU
          const allItems = data.items || data.list || [];
          const filteredItems = Array.isArray(allItems)
            ? allItems.filter((item: any) => item.summary_flag !== "共享库存")
            : [];
          setInventoryList(filteredItems);
          setTotal(filteredItems.length);
          // Extract filter options from所有数据（包括共享库存用于筛选）
          const listForOptions = Array.isArray(allItems) ? allItems : [];
          const accounts = [
            ...new Set(
              listForOptions.map((item: any) => item.account).filter(Boolean),
            ),
          ];
          const countries = [
            ...new Set(
              listForOptions.map((item: any) => item.country).filter(Boolean),
            ),
          ];
          setAccountOptions(
            accounts.map((a: string) => ({ value: a, label: a })),
          );
          setCountryOptions(
            countries.map((c: string) => ({ value: c, label: c })),
          );
        }
      } catch (error) {
        console.error("获取库存列表失败:", error);
        messageApi.error("获取库存列表失败");
      } finally {
        setTableLoading(false);
      }
    },
    [messageApi],
  );

  useEffect(() => {
    fetchOverview();
    fetchInventoryList(
      1,
      pagination.pageSize,
      searchText,
      tableRiskFilter,
      accountFilter,
      countryFilter,
      sortField,
      sortOrder,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==================== Event Handlers ====================

  const handleSearch = (value: string) => {
    setSearchText(value);
    setPagination((prev) => ({ ...prev, current: 1 }));
    fetchInventoryList(
      1,
      pagination.pageSize,
      value,
      tableRiskFilter,
      accountFilter,
      countryFilter,
      sortField,
      sortOrder,
    );
  };

  const handleAccountFilterChange = (value: string | undefined) => {
    setAccountFilter(value || undefined);
    setPagination((prev) => ({ ...prev, current: 1 }));
    fetchInventoryList(
      1,
      pagination.pageSize,
      searchText,
      tableRiskFilter,
      value || undefined,
      countryFilter,
      sortField,
      sortOrder,
    );
  };

  const handleCountryFilterChange = (value: string | undefined) => {
    setCountryFilter(value || undefined);
    setPagination((prev) => ({ ...prev, current: 1 }));
    fetchInventoryList(
      1,
      pagination.pageSize,
      searchText,
      tableRiskFilter,
      accountFilter,
      value || undefined,
      sortField,
      sortOrder,
    );
  };

  const handleTableChange = (
    pag: TablePaginationConfig,
    filters: any,
    sorter: any,
  ) => {
    const newPage = pag.current || 1;
    const newPageSize = pag.pageSize || 20;
    setPagination(pag);

    // 处理排序
    let newSortField: string | undefined = undefined;
    let newSortOrder: string | undefined = undefined;

    if (sorter.field) {
      newSortField = sorter.field as string;
      if (sorter.order === "ascend") {
        newSortOrder = "asc";
      } else if (sorter.order === "descend") {
        newSortOrder = "desc";
      }
    }

    setSortField(newSortField);
    setSortOrder(newSortOrder);

    // 处理风险等级筛选（从表格列）并保存状态 - 支持多选
    let newTableRiskFilter: string[] | undefined = undefined;
    if (filters.risk_level && filters.risk_level.length > 0) {
      newTableRiskFilter = filters.risk_level;
    }
    setTableRiskFilter(newTableRiskFilter);

    fetchInventoryList(
      newPage,
      newPageSize,
      searchText,
      newTableRiskFilter,
      accountFilter,
      countryFilter,
      newSortField,
      newSortOrder,
    );
  };

  const handleImportData = async () => {
    try {
      setImportLoading(true);
      const response = await inventoryApi.calculate();
      if (response.data?.success) {
        messageApi.success(
          `补货计算完成：${response.data.data?.total || 0}条记录`,
        );
        fetchOverview();
        fetchInventoryList(
          1,
          pagination.pageSize,
          searchText,
          tableRiskFilter,
          accountFilter,
          countryFilter,
          sortField,
          sortOrder,
        );
      } else {
        messageApi.warning(response.data?.message || "计算完成，请检查数据");
      }
    } catch (error: any) {
      console.error("计算失败:", error);
      messageApi.error(error?.response?.data?.detail || "操作失败");
    } finally {
      setImportLoading(false);
    }
  };

  const handleViewInbound = async (asin: string, account?: string) => {
    try {
      setInboundAsin(asin);
      setInboundModalVisible(true);
      setInboundLoading(true);
      const response = await inventoryApi.getInboundDetails(asin, account);
      const data = response.data?.data || response.data;
      setInboundDetails(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("获取在途详情失败:", error);
      messageApi.error("获取在途详情失败");
      setInboundDetails([]);
    } finally {
      setInboundLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    try {
      setImportLoading(true);
      const response = await inventoryApi.import(file);
      if (response.data?.success) {
        messageApi.success(
          `导入成功：${response.data.data?.total_rows || 0}条记录`,
        );
        fetchOverview();
        fetchInventoryList(
          1,
          pagination.pageSize,
          searchText,
          tableRiskFilter,
          accountFilter,
          countryFilter,
          sortField,
          sortOrder,
        );
      } else {
        messageApi.warning(response.data?.message || "导入完成，请检查数据");
      }
    } catch (error: any) {
      console.error("导入失败:", error);
      messageApi.error(error?.response?.data?.detail || "导入失败");
    } finally {
      setImportLoading(false);
    }
    return false; // 阻止默认上传行为
  };

  // ==================== Table Columns ====================

  const inventoryColumns: ColumnsType<InventoryItem> = [
    {
      title: "ASIN",
      dataIndex: "asin",
      key: "asin",
      width: 130,
      fixed: "left",
      render: (val: string, record: InventoryItem) => {
        if (record.summary_flag === "共享库存") {
          return (
            <span style={{ color: "#1890ff", fontWeight: 600 }}>
              {val || "-"}
            </span>
          );
        }
        return val || "-";
      },
    },
    {
      title: "SKU",
      dataIndex: "sku",
      key: "sku",
      width: 120,
      render: (val: string, record: InventoryItem) => {
        if (record.summary_flag === "共享库存") {
          return (
            <span style={{ color: "#1890ff", fontWeight: 500 }}>
              {val || "-"}
            </span>
          );
        }
        return val || "-";
      },
    },
    {
      title: "品名",
      dataIndex: "product_name",
      key: "product_name",
      width: 200,
      ellipsis: true,
      render: (text: string, record: InventoryItem) => (
        <Tooltip title={text}>
          {record.summary_flag === "共享库存" ? (
            <span style={{ color: "#1890ff", fontWeight: 500 }}>
              {text || "-"}
            </span>
          ) : (
            <span>{text || "-"}</span>
          )}
        </Tooltip>
      ),
    },
    {
      title: "店铺",
      dataIndex: "account",
      key: "account",
      width: 120,
      render: (val: string, record: InventoryItem) => {
        if (record.summary_flag === "共享库存") {
          return <Tag color="blue">{val || "-"}</Tag>;
        }
        return val || "-";
      },
    },
    {
      title: "国家",
      dataIndex: "country",
      key: "country",
      width: 80,
    },
    {
      title: "FBA库存",
      dataIndex: "fba_stock",
      key: "fba_stock",
      width: 90,
      align: "center",
      render: (val: number, record: InventoryItem) => {
        const tooltipContent = (
          <div style={{ padding: "4px 0" }}>
            <table style={{ fontSize: 12, borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td
                    style={{
                      padding: "4px 12px 4px 0",
                      color: "#666",
                      minWidth: 60,
                    }}
                  >
                    FNSKU
                  </td>
                  <td style={{ padding: "4px 0", fontWeight: 500 }}>
                    {record.fnsku || "-"}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>
                    MSKU
                  </td>
                  <td style={{ padding: "4px 0", fontWeight: 500 }}>
                    {record.msku || "-"}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>
                    可售
                  </td>
                  <td
                    style={{
                      padding: "4px 0",
                      fontWeight: 500,
                      color: "#52c41a",
                    }}
                  >
                    {formatNumber(record.fba_available)}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>
                    待调仓
                  </td>
                  <td
                    style={{
                      padding: "4px 0",
                      fontWeight: 500,
                      color: "#fa8c16",
                    }}
                  >
                    {formatNumber(record.fba_pending_transfer)}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>
                    调仓中
                  </td>
                  <td
                    style={{
                      padding: "4px 0",
                      fontWeight: 500,
                      color: "#faad14",
                    }}
                  >
                    {formatNumber(record.fba_in_transfer)}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>
                    入库中
                  </td>
                  <td
                    style={{
                      padding: "4px 0",
                      fontWeight: 500,
                      color: "#1890ff",
                    }}
                  >
                    {formatNumber(record.fba_inbound_processing)}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>
                    待发货
                  </td>
                  <td
                    style={{
                      padding: "4px 0",
                      fontWeight: 500,
                      color: "#722ed1",
                    }}
                  >
                    {formatNumber(record.fba_inbound)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
        if (val && val > 0) {
          return (
            <Tooltip title={tooltipContent}>
              <span
                style={{
                  display: "inline-block",
                  color: "#1890ff",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: "#f0f7ff",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#d6eaff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#f0f7ff";
                }}
              >
                {formatNumber(val)}
              </span>
            </Tooltip>
          );
        }
        return (
          <span
            style={{
              color: "#999",
              fontSize: 13,
            }}
          >
            {formatNumber(val)}
          </span>
        );
      },
    },
    {
      title: "在途",
      dataIndex: "fba_inbound",
      key: "fba_inbound",
      width: 80,
      align: "right",
      render: (val: number, record: InventoryItem) => {
        if (record.summary_flag === "共享库存") {
          return (
            <span style={{ color: "#1890ff", fontWeight: 600 }}>
              {formatNumber(val)}
            </span>
          );
        }
        return formatNumber(val);
      },
    },
    {
      title: "总库存",
      dataIndex: "total_stock",
      key: "total_stock",
      width: 100,
      align: "right",
      render: (val: number, record: InventoryItem) => {
        if (record.summary_flag === "共享库存") {
          return (
            <span style={{ color: "#1890ff", fontWeight: 600 }}>
              {formatNumber(val)}
            </span>
          );
        }
        return formatNumber(val);
      },
    },
    {
      title: "日均销量",
      dataIndex: "daily_sales",
      key: "daily_sales",
      width: 100,
      align: "right",
      render: (val: number, record: InventoryItem) => {
        if (record.summary_flag === "共享库存") {
          return <span style={{ color: "#999" }}>-</span>;
        }
        return formatNumber(val);
      },
    },
    {
      title: "可售天数",
      dataIndex: "days_of_supply",
      key: "days_of_supply",
      width: 120,
      align: "center",
      sorter: true,
      sortOrder:
        sortField === "days_of_supply"
          ? sortOrder === "asc"
            ? "ascend"
            : "descend"
          : undefined,
      render: (val: number, record: InventoryItem) => {
        if (record.summary_flag === "共享库存") {
          return <Tag color="blue">共享库存</Tag>;
        }
        return getDaysSupplyTag(val);
      },
    },
    {
      title: "断货时间",
      dataIndex: "stockout_date",
      key: "stockout_date",
      width: 120,
      render: (val: string | null, record: InventoryItem) => {
        if (record.summary_flag === "共享库存") {
          return <span style={{ color: "#999" }}>-</span>;
        }
        return val || "-";
      },
    },
    {
      title: "风险等级",
      dataIndex: "risk_level",
      key: "risk_level",
      width: 100,
      align: "center",
      filters: [
        { text: "断货风险", value: "red" },
        { text: "库存预警", value: "yellow" },
        { text: "库存正常", value: "green" },
      ],
      filterMultiple: true,
      filteredValue: tableRiskFilter,
      render: (val: string, record: InventoryItem) => {
        if (record.summary_flag === "共享库存") {
          return <Tag color="blue">共享库存</Tag>;
        }
        return getRiskLevelTag(val);
      },
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      fixed: "right",
      render: (_: any, record: InventoryItem) => {
        if (record.summary_flag === "共享库存") {
          return null;
        }
        return (
          <Button
            type="link"
            size="small"
            icon={<Truck size={14} />}
            onClick={() => handleViewInbound(record.asin, record.account)}
          >
            在途详情
          </Button>
        );
      },
    },
  ];

  const inboundColumns: ColumnsType<InboundDetail> = [
    {
      title: "货件单号",
      dataIndex: "shipment_id",
      key: "shipment_id",
      width: 180,
    },
    {
      title: "数量",
      dataIndex: "quantity",
      key: "quantity",
      width: 80,
      align: "right",
      render: (val: number) => formatNumber(val),
    },
    {
      title: "物流方式",
      dataIndex: "logistics_method",
      key: "logistics_method",
      width: 120,
      render: (val: string) => val || "-",
    },
    {
      title: "运输方式",
      dataIndex: "transport_method",
      key: "transport_method",
      width: 120,
      render: (val: string) => val || "-",
    },
    {
      title: "发货时间",
      dataIndex: "ship_date",
      key: "ship_date",
      width: 130,
      render: (val: string | null) => val || "-",
    },
    {
      title: "预计可售时间",
      dataIndex: "estimated_available_date",
      key: "estimated_available_date",
      width: 140,
      render: (val: string | null) => val || "-",
    },
  ];

  // ==================== Render ====================

  const snapshotDate = overviewData?.snapshot_date || "";

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "0 0 24px 0" }}>
      {contextHolder}

      {/* ===== 1. Page Title Bar ===== */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Package color={currentTheme.primary} size={32} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
            库存机器人
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {snapshotDate && (
            <span style={{ color: "#888", fontSize: 13 }}>
              数据更新时间: {snapshotDate}
            </span>
          )}
          <Upload
            beforeUpload={handleFileUpload}
            showUploadList={false}
            accept=".xlsx,.xls"
          >
            <Button icon={<UploadIcon size={15} />} loading={importLoading}>
              导入Excel
            </Button>
          </Upload>
          <Button
            type="primary"
            icon={<BarChart3 size={15} />}
            loading={importLoading}
            onClick={handleImportData}
            style={{
              background: currentTheme.primary,
              borderColor: currentTheme.primary,
            }}
          >
            重新计算
          </Button>
        </div>
      </div>

      {/* ===== 2. Statistics Overview Cards ===== */}
      <Spin spinning={overviewLoading}>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col xs={12} sm={12} md={6}>
            <Card size="small" bordered={false} style={{ borderRadius: 8 }}>
              <Statistic
                title="总SKU数"
                value={overviewData?.total_sku ?? 0}
                prefix={<BarChart3 size={18} color="#1890ff" />}
                valueStyle={{ color: "#1890ff" }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card size="small" bordered={false} style={{ borderRadius: 8 }}>
              <Statistic
                title="断货风险"
                value={overviewData?.red_count ?? 0}
                prefix={<AlertTriangle size={18} color="#cf1322" />}
                valueStyle={{ color: "#cf1322" }}
                suffix="SKU"
              />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card size="small" bordered={false} style={{ borderRadius: 8 }}>
              <Statistic
                title="库存预警"
                value={overviewData?.yellow_count ?? 0}
                prefix={<AlertCircle size={18} color="#fa8c16" />}
                valueStyle={{ color: "#fa8c16" }}
                suffix="SKU"
              />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card size="small" bordered={false} style={{ borderRadius: 8 }}>
              <Statistic
                title="库存正常"
                value={overviewData?.green_count ?? 0}
                prefix={<CheckCircle size={18} color="#52c41a" />}
                valueStyle={{ color: "#52c41a" }}
                suffix="SKU"
              />
            </Card>
          </Col>
        </Row>
      </Spin>

      {/* ===== 3. TOP10 Area - Collapsible Cards ===== */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        {/* Stockout Risk TOP10 */}
        <Col xs={24} md={12}>
          <Card
            size="small"
            bordered={false}
            style={{ borderRadius: 8, overflow: "hidden" }}
            bodyStyle={{ padding: 0 }}
          >
            {/* Header - Always visible */}
            <div
              onClick={() => setStockoutCollapsed(!stockoutCollapsed)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                cursor: "pointer",
                background: stockoutCollapsed ? "#fff" : "#fff1f0",
                transition: "background 0.2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "#fff1f0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <TrendingDown size={18} color="#cf1322" />
                </div>
                <div>
                  <div
                    style={{ fontWeight: 600, fontSize: 14, color: "#262626" }}
                  >
                    断货风险 TOP10
                  </div>
                  <div style={{ fontSize: 12, color: "#8c8c8c" }}>
                    可售天数最低的SKU
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {overviewData?.stockout_top10 &&
                  overviewData.stockout_top10.length > 0 && (
                    <Tag color="error" style={{ margin: 0, borderRadius: 10 }}>
                      {overviewData.stockout_top10[0]?.days_of_supply}天起
                    </Tag>
                  )}
                {stockoutCollapsed ? (
                  <ChevronRight size={16} color="#8c8c8c" />
                ) : (
                  <ChevronDown size={16} color="#cf1322" />
                )}
              </div>
            </div>

            {/* Content - Collapsible */}
            {!stockoutCollapsed &&
              overviewData?.stockout_top10 &&
              overviewData.stockout_top10.length > 0 && (
                <div
                  style={{
                    padding: "0 12px 12px",
                    borderTop: "1px solid #f0f0f0",
                  }}
                >
                  {overviewData.stockout_top10.map((item, index) => (
                    <div key={item.asin}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "8px 4px",
                          borderBottom:
                            index < 9 ? "1px dashed #f0f0f0" : "none",
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          setExpandedStockout(
                            expandedStockout === item.asin ? null : item.asin,
                          )
                        }
                      >
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 600,
                            marginRight: 8,
                            background: index < 3 ? "#cf1322" : "#f0f0f0",
                            color: index < 3 ? "#fff" : "#8c8c8c",
                          }}
                        >
                          {index + 1}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              fontWeight: 500,
                              fontSize: 12,
                              color: "#262626",
                            }}
                          >
                            {item.asin}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "#8c8c8c",
                              marginLeft: 6,
                            }}
                          >
                            {truncateText(item.product_name, 10)}
                          </span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: 13,
                              color: "#cf1322",
                              background: "#fff1f0",
                              padding: "2px 8px",
                              borderRadius: 4,
                            }}
                          >
                            {item.days_of_supply}天
                          </span>
                        </div>
                      </div>
                      {/* 展开详情 */}
                      {expandedStockout === item.asin && (
                        <div
                          style={{
                            padding: "8px 8px 10px 32px",
                            background: "#fafafa",
                            borderRadius: 4,
                            marginBottom: 4,
                            fontSize: 11,
                            color: "#666",
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: "4px 12px",
                            }}
                          >
                            <span>店铺: {item.account}</span>
                            <span>国家: {item.country}</span>
                            <span>FBA库存: {formatNumber(item.fba_stock)}</span>
                            <span>
                              日均销量: {formatNumber(item.daily_sales)}
                            </span>
                            <span>预计断货: {item.stockout_date || "-"}</span>
                            <span>
                              总库存: {formatNumber(item.total_stock)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
          </Card>
        </Col>

        {/* Overstock TOP10 */}
        <Col xs={24} md={12}>
          <Card
            size="small"
            bordered={false}
            style={{ borderRadius: 8, overflow: "hidden" }}
            bodyStyle={{ padding: 0 }}
          >
            {/* Header - Always visible */}
            <div
              onClick={() => setOverstockCollapsed(!overstockCollapsed)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                cursor: "pointer",
                background: overstockCollapsed ? "#fff" : "#fff7e6",
                transition: "background 0.2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "#fff7e6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <TrendingUp size={18} color="#fa8c16" />
                </div>
                <div>
                  <div
                    style={{ fontWeight: 600, fontSize: 14, color: "#262626" }}
                  >
                    冗余库存 TOP10
                  </div>
                  <div style={{ fontSize: 12, color: "#8c8c8c" }}>
                    12月以上库龄最多
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {overviewData?.overstock_top10 &&
                  overviewData.overstock_top10.length > 0 && (
                    <Tag
                      color="warning"
                      style={{ margin: 0, borderRadius: 10 }}
                    >
                      {formatNumber(
                        overviewData.overstock_top10[0]?.age_12_plus,
                      )}
                      件
                    </Tag>
                  )}
                {overstockCollapsed ? (
                  <ChevronRight size={16} color="#8c8c8c" />
                ) : (
                  <ChevronDown size={16} color="#fa8c16" />
                )}
              </div>
            </div>

            {/* Content - Collapsible */}
            {!overstockCollapsed &&
              overviewData?.overstock_top10 &&
              overviewData.overstock_top10.length > 0 && (
                <div
                  style={{
                    padding: "0 12px 12px",
                    borderTop: "1px solid #f0f0f0",
                  }}
                >
                  {overviewData.overstock_top10.map((item, index) => (
                    <div key={item.asin}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "8px 4px",
                          borderBottom:
                            index < 9 ? "1px dashed #f0f0f0" : "none",
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          setExpandedOverstock(
                            expandedOverstock === item.asin ? null : item.asin,
                          )
                        }
                      >
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 600,
                            marginRight: 8,
                            background: index < 3 ? "#fa8c16" : "#f0f0f0",
                            color: index < 3 ? "#fff" : "#8c8c8c",
                          }}
                        >
                          {index + 1}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              fontWeight: 500,
                              fontSize: 12,
                              color: "#262626",
                            }}
                          >
                            {item.asin}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "#8c8c8c",
                              marginLeft: 6,
                            }}
                          >
                            {truncateText(item.product_name, 10)}
                          </span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: 13,
                              color: "#fa8c16",
                              background: "#fff7e6",
                              padding: "2px 8px",
                              borderRadius: 4,
                            }}
                          >
                            {formatNumber(item.age_12_plus)}件
                          </span>
                        </div>
                      </div>
                      {/* 展开详情 */}
                      {expandedOverstock === item.asin && (
                        <div
                          style={{
                            padding: "8px 8px 10px 32px",
                            background: "#fafafa",
                            borderRadius: 4,
                            marginBottom: 4,
                            fontSize: 11,
                            color: "#666",
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: "4px 12px",
                            }}
                          >
                            <span>店铺: {item.account}</span>
                            <span>国家: {item.country}</span>
                            <span>
                              总库存:{" "}
                              <b style={{ color: "#fa8c16" }}>
                                {formatNumber(item.total_stock)}
                              </b>
                            </span>
                            <span></span>
                            <span>
                              12月以上: {formatNumber(item.age_12_plus)}
                            </span>
                            <span>9-12月: {formatNumber(item.age_9_12)}</span>
                            <span>6-9月: {formatNumber(item.age_6_9)}</span>
                            <span>3-6月: {formatNumber(item.age_3_6)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
          </Card>
        </Col>
      </Row>

      {/* ===== 4. Search & Filter Bar ===== */}
      <Card
        size="small"
        style={{ marginBottom: 24, borderRadius: 8 }}
        bordered={false}
      >
        <Space wrap style={{ width: "100%" }} size="middle">
          <Input
            placeholder="搜索ASIN/SKU/品名/店铺..."
            prefix={<Search size={15} color="#bbb" />}
            allowClear
            style={{ width: 280 }}
            value={searchText}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <Select
            placeholder="店铺"
            allowClear
            showSearch
            style={{ width: 180 }}
            value={accountFilter}
            onChange={handleAccountFilterChange}
            options={accountOptions}
            filterOption={(input, option) =>
              (option?.label as string)
                ?.toLowerCase()
                .includes(input.toLowerCase())
            }
          />
          <Select
            placeholder="国家/地区"
            allowClear
            showSearch
            style={{ width: 140 }}
            value={countryFilter}
            onChange={handleCountryFilterChange}
            options={countryOptions}
            filterOption={(input, option) =>
              (option?.label as string)
                ?.toLowerCase()
                .includes(input.toLowerCase())
            }
          />
        </Space>
      </Card>

      <style>{`
        .summary-row {
          background: #f0f7ff !important;
          font-weight: 600;
        }
        .summary-row td {
          background: #f0f7ff !important;
        }
        .risk-row-red:hover td {
          background: #fff1f0 !important;
        }
        .risk-row-yellow:hover td {
          background: #fff7e6 !important;
        }
        .risk-row-green:hover td {
          background: #f6ffed !important;
        }
      `}</style>
      {/* ===== 5. Inventory Detail Table ===== */}
      <Card
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Package size={18} color={currentTheme.primary} />
            <span>库存明细</span>
          </div>
        }
        size="small"
        bordered={false}
        style={{ borderRadius: 8 }}
      >
        <Table
          columns={inventoryColumns}
          dataSource={inventoryList}
          rowKey="id"
          loading={tableLoading}
          pagination={{
            ...pagination,
            total: total,
          }}
          onChange={handleTableChange}
          scroll={{ x: 1400 }}
          size="small"
          rowClassName={(record) => {
            let classes = [];
            if (record.summary_flag === "是") {
              classes.push("summary-row");
            }
            if (record.risk_level === "red") {
              classes.push("risk-row-red");
            } else if (record.risk_level === "yellow") {
              classes.push("risk-row-yellow");
            } else if (record.risk_level === "green") {
              classes.push("risk-row-green");
            }
            return classes.join(" ");
          }}
        />
      </Card>

      {/* ===== 6. Inbound Details Modal ===== */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Truck size={18} color="#722ed1" />
            <span>在途货件详情 - ASIN: {inboundAsin}</span>
          </div>
        }
        open={inboundModalVisible}
        onCancel={() => setInboundModalVisible(false)}
        footer={null}
        width={800}
      >
        <Spin spinning={inboundLoading}>
          {inboundDetails && inboundDetails.length > 0 ? (
            <Table
              columns={inboundColumns}
              dataSource={inboundDetails}
              rowKey="shipment_id"
              pagination={false}
              size="small"
            />
          ) : (
            <Empty
              description="暂无在途货件数据"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </Spin>
      </Modal>
    </div>
  );
};

export default InventoryBot;
