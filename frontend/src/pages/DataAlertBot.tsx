import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Button, List, Typography, Space, Divider, Tag, message, Select, Table, DatePicker, Input, Modal, Tooltip, Form, InputNumber } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { AlertTriangle, RefreshCw, CheckCircle, XCircle, Store, Filter } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import dayjs, { Dayjs } from 'dayjs';
import { departmentsApi } from '../api';
import apiClient from '../api';

const { Title, Text } = Typography;
const { Option } = Select;

const styles: { [key: string]: React.CSSProperties } = {
  storeDividerRow: {
    borderTop: '2px solid #e8e8e8',
    marginTop: '8px',
    paddingTop: '8px',
  },
  newStoreRow: {
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px dashed #e8e8e8',
  },
};

// --- 接口定义
interface MetricData {
  orders: number;
  adRatio: number;
  adSpend: number;
  sales: number;
  adSales: number;
  acos: number;
  gmv: number;
  fbaTotalStock: number;
  fbaStockValue: number;
  grossProfit: number;
  storageRatio: number;
}

interface AlertItem {
  id: number;
  time: string;
  metricName: string;
  currentValue: string;
  threshold: string;
  suggestion: string;
  severity: 'red' | 'orange' | 'yellow';
  storeName?: string;
}

interface StoreInfo {
  id: string;
  name: string;
  region: string;
}

interface StoreData {
  info: StoreInfo;
  currentMetrics: MetricData;
  ordersTrend: { date: string; orders: number }[];
  adRatioTrend: { date: string; adRatio: number }[];
  alerts: AlertItem[];
}

interface Department {
  id: number;
  name: string;
  region?: string;
  description: string;
}

interface DateQueryRecord {
  date: string;
  storeId: string;
  storeName: string;
  orders: number;
  gmv: number;
  adRatio: number;
  grossProfit: number;
  grossMargin: number;
  fbaTotalStock?: number;
  storageRatio?: number;
}

interface StoreSalesDetail {
  storeId: string;
  storeName: string;
  date: string;
  sales: number;
}

interface SkuSalesRecord {
  sku: string;
  totalSales: number;
  stores: StoreSalesDetail[];
}



// 图表颜色列表
const CHART_COLORS = [
  '#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1',
  '#13c2c2', '#eb2f96', '#fa8c16', '#2f54eb', '#10239e'
];

interface DataWarningRecord {
  id: number;
  tenant_id: number;
  date: string;
  store: string;
  order_count: number;
  ad_ratio: number;
  acos: number;
  cargo_value: number;
  gmv: number;
  fba_total_stock: number;
  storage_ratio: number;
  gross_profit: number;
}

const fetchDataWarnings = async (
  stores?: string[],
  startDate?: string,
  endDate?: string
): Promise<DataWarningRecord[]> => {
  try {
    const params: Record<string, any> = {};
    if (stores && stores.length > 0) {
      params.stores = stores.join(',');
    }
    if (startDate) {
      params.start_date = startDate;
    }
    if (endDate) {
      params.end_date = endDate;
    }
    
    console.log('fetchDataWarnings params:', params);
    
    const response = await apiClient.get('/data-warnings', { params });
    if (response.data.success) {
      return response.data.data;
    }
    return [];
  } catch (error) {
    console.error('获取地区列表失败:', error);
    return [];
  }
};

interface TopSkuRecord {
  store: string;
  sku: string;
  total_sales: number;
}

interface SkuDailySalesRecord {
  date: string;
  sku: string;
  total_sales: number;
}

const fetchTopSkus = async (
  stores?: string[],
  startDate?: string,
  endDate?: string,
  limit: number = 10
): Promise<TopSkuRecord[]> => {
  try {
    const params: Record<string, any> = {};
    if (stores && stores.length > 0) {
      params.stores = stores.join(',');
    }
    if (startDate) {
      params.start_date = startDate;
    }
    if (endDate) {
      params.end_date = endDate;
    }
    params.limit = limit;
    
    console.log('fetchTopSkus params:', params);
    
    const response = await apiClient.get('/product-sales/top-skus', { params });
    if (response.data.success) {
      return response.data.data;
    }
    return [];
  } catch (error) {
    console.error('获取TOP SKU失败:', error);
    return [];
  }
};

const fetchSkuDailySales = async (
  stores?: string[],
  skus?: string[],
  startDate?: string,
  endDate?: string
): Promise<SkuDailySalesRecord[]> => {
  try {
    const params: Record<string, any> = {};
    if (stores && stores.length > 0) {
      params.stores = stores.join(',');
    }
    if (skus && skus.length > 0) {
      params.skus = skus.join(',');
    }
    if (startDate) {
      params.start_date = startDate;
    }
    if (endDate) {
      params.end_date = endDate;
    }
    
    console.log('fetchSkuDailySales params:', params);
    
    const response = await apiClient.get('/product-sales/sku-daily-sales', { params });
    if (response.data.success) {
      return response.data.data;
    }
    return [];
  } catch (error) {
    console.error('获取SKU每日销量失败:', error);
    return [];
  }
};

const fetchThresholdSettings = async (): Promise<Record<string, { adRatio: number; storageRatio: number; acos: number }>> => {
  try {
    const response = await apiClient.get('/threshold-settings/stores');
    if (response.data.success) {
      const data: Record<string, { ad_ratio_threshold: number; storage_ratio_threshold: number; acos_threshold: number }> = response.data.data;
      const thresholds: Record<string, { adRatio: number; storageRatio: number; acos: number }> = {};
      for (const [store, settings] of Object.entries(data)) {
        thresholds[store] = {
          adRatio: settings.ad_ratio_threshold,
          storageRatio: settings.storage_ratio_threshold,
          acos: settings.acos_threshold,
        };
      }
      return thresholds;
    }
    return {};
  } catch (error) {
    console.error('获取阈值设置失败:', error);
    return {};
  }
};

const saveThresholdSetting = async (
  store: string,
  thresholds: { adRatio: number; storageRatio: number; acos: number }
): Promise<boolean> => {
  try {
    const response = await apiClient.post('/threshold-settings/', null, {
      params: {
        store,
        ad_ratio_threshold: thresholds.adRatio,
        storage_ratio_threshold: thresholds.storageRatio,
        acos_threshold: thresholds.acos,
      },
    });
    return response.data.success;
  } catch (error) {
    console.error('保存阈值设置失败:', error);
    return false;
  }
};

const DataAlertBot: React.FC = () => {
  // --- 状态管理
  const [selectedRegion, setSelectedRegion] = useState<string>('全部');
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [storesData, setStoresData] = useState<Record<string, StoreData>>({});
  const [lastUpdated, setLastUpdated] = useState<string>(dayjs().format('YYYY-MM-DD HH:mm:ss'));
  const [departments, setDepartments] = useState<Department[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  // --- 商品销量数据状态
  const [productSalesData, setProductSalesData] = useState<SkuSalesRecord[]>([]);
  const [skuDailySalesData, setSkuDailySalesData] = useState<SkuDailySalesRecord[]>([]);
  
  // --- 日期查询状态
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(
    [dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')]
  );
  const [dateQueryResults, setDateQueryResults] = useState<DateQueryRecord[]>([]);
  const [dateQueryLoading, setDateQueryLoading] = useState(false);
  const [dateQueryPageSize, setDateQueryPageSize] = useState<number>(10);
  const [dateQueryCurrentPage, setDateQueryCurrentPage] = useState<number>(1);
  const [dateQueryExpanded, setDateQueryExpanded] = useState<boolean>(false);
  
  // --- 对比模式状态
  const [compareMode, setCompareMode] = useState<'store' | 'date'>('date');

  // --- 基数对比状态（用于GMV和广告占比的趋势判断）
  const [gmvBase, setGmvBase] = useState<string>('');
  const [adRatioBase, setAdRatioBase] = useState<string>('');
  const [storageRatioBase, setStorageRatioBase] = useState<string>('');

  // --- KPI悬停状态（null表示没有悬停）
  const [hoveredKpi, setHoveredKpi] = useState<string | null>(null);

  // --- "只显示"店铺筛选状态（空数组表示显示全部）
  const [selectedDisplayStoreIds, setSelectedDisplayStoreIds] = useState<string[]>([]);

  // --- 商品销量详情弹窗状态
  const [showSkuModal, setShowSkuModal] = useState(false);
  const [skuSearchValue, setSkuSearchValue] = useState('');

  // --- SKU销量波动趋势相关状态
  const [trendDateMode, setTrendDateMode] = useState<'recent7Days' | 'dateRange'>('recent7Days');
  const [selectedSkusForTrend, setSelectedSkusForTrend] = useState<string[]>([]);
  const [showAddSkuModal, setShowAddSkuModal] = useState(false);
  const [addSkuSearchValue, setAddSkuSearchValue] = useState('');

  // --- 阈值设置相关状态
  const [thresholds, setThresholds] = useState<Record<string, { adRatio: number; storageRatio: number; acos: number }>>({});
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editFormValues, setEditFormValues] = useState<{ adRatio: number; storageRatio: number; acos: number }>({
    adRatio: 25,
    storageRatio: 10,
    acos: 30,
  });

  const getThresholdsForStore = (storeId: string) => {
    const store = STORES.find(s => s.id === storeId);
    const storeName = store?.name || storeId;
    return thresholds[storeName] || {
      adRatio: 25,
      storageRatio: 10,
      acos: 30,
    };
  };

  const getThresholdsForStoreOrNull = (storeId: string) => {
    const store = STORES.find(s => s.id === storeId);
    const storeName = store?.name || storeId;
    return thresholds[storeName] || null;
  };

  // --- 转换 departments 为 StoreInfo 格式
  const STORES = useMemo(() => {
    return departments.map(dept => ({
      id: dept.id.toString(),
      name: dept.name,
      region: dept.region || '',
    }));
  }, [departments]);

  // --- 商品销量数据（从数据库获取，显示累计销量前10个SKU）
  const skuSalesData = useMemo(() => {
    return productSalesData;
  }, [productSalesData]);

  // --- SKU销量波动趋势数据（从数据库读取）
  const skuTrendData = useMemo(() => {
    if (selectedStoreIds.length === 0) return [];

    let dates: string[] = [];
    
    if (trendDateMode === 'recent7Days') {
      const yesterday = dayjs().subtract(1, 'day');
      for (let i = 6; i >= 0; i--) {
        dates.push(yesterday.clone().subtract(i, 'day').format('YYYY-MM-DD'));
      }
      console.log('SKU趋势近7天日期:', dates);
    } else {
      if (!dateRange || !dateRange[0] || !dateRange[1]) return [];
      const [start, end] = dateRange;
      let current = start.clone();
      while (current.isBefore(end) || current.isSame(end)) {
        dates.push(current.format('YYYY-MM-DD'));
        current = current.add(1, 'day');
      }
    }

    const skusToShow = selectedSkusForTrend.length > 0 
      ? selectedSkusForTrend 
      : skuSalesData.slice(0, 10).map(s => s.sku);

    const trendData: Array<{ date: string } & Record<string, number>> = [];

    dates.forEach(date => {
      const dayRecord: { date: string } & Record<string, number> = { date } as any;
      
      skusToShow.forEach(sku => {
        const salesRecord = skuDailySalesData.find(s => s.date === date && s.sku === sku);
        dayRecord[sku] = salesRecord ? salesRecord.total_sales : 0;
      });
      
      trendData.push(dayRecord);
    });

    return trendData;
  }, [selectedStoreIds, skuSalesData, skuDailySalesData, trendDateMode, dateRange, selectedSkusForTrend]);

  // --- 从数据库获取完整的商品销量数据（用于弹窗）
  const fetchAllSkuSalesData = async () => {
    if (!dateRange || !dateRange[0] || !dateRange[1] || selectedStoreIds.length === 0) {
      console.log('fetchAllSkuSalesData: 缺少必要参数', { dateRange, selectedStoreIds });
      return [];
    }

    try {
      const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);
      const [startDate, endDate] = [dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD')];

      const response = await apiClient.get('/product-sales/', {
        params: {
          stores: storeNames.join(','),
          start_date: startDate,
          end_date: endDate,
        },
      });

      if (response.data.success) {
        const data = response.data.data;
        
        const aggregated: Record<string, SkuSalesRecord> = {};
        data.forEach((record: any) => {
          const sku = record.sku;
          const storeName = record.store;
          
          if (!aggregated[sku]) {
            aggregated[sku] = {
              sku,
              totalSales: 0,
              stores: [],
            };
          }
          
          aggregated[sku].totalSales += record.sales_count;
          
          const existingStore = aggregated[sku].stores.find(s => s.storeName === storeName);
          if (existingStore) {
            existingStore.sales += record.sales_count;
          } else {
            aggregated[sku].stores.push({
              storeId: '',
              storeName: storeName,
              date: record.date,
              sales: record.sales_count,
            });
          }
        });

        const result = Object.values(aggregated);
        result.sort((a, b) => b.totalSales - a.totalSales);
        return result;
      }
    } catch (error) {
      console.error('获取完整商品销量数据失败:', error);
    }
    return [];
  };

  // --- 详情弹窗数据状态
  const [allSkuSalesData, setAllSkuSalesData] = useState<SkuSalesRecord[]>([]);

  // --- 打开详情弹窗时从数据库获取数据
  const handleOpenSkuModal = async () => {
    const data = await fetchAllSkuSalesData();
    setAllSkuSalesData(data);
    setShowSkuModal(true);
  };

  // --- 计算日期范围内的店铺汇总数据
  const storeAggregatedData = useMemo(() => {
    if (dateQueryResults.length === 0) return {};
    const aggregated: Record<string, any> = {};
    
    dateQueryResults.forEach(record => {
      if (!aggregated[record.storeId]) {
        aggregated[record.storeId] = {
          storeId: record.storeId,
          storeName: record.storeName,
          totalOrders: 0,
          totalGmv: 0,
          // 用于加权平均计算广告占比
          weightedAdRatioSum: 0,
          gmvForAdRatioSum: 0,
          recordCount: 0
        };
      }
      const data = aggregated[record.storeId];
      data.totalOrders += record.orders;
      data.totalGmv += record.gmv;
      // 累积加权平均的分子和分母（按KPI方法）
      const recordGmv = record.gmv;
      const recordAdRatio = record.adRatio;
      if (recordGmv > 0) {
        data.weightedAdRatioSum += recordGmv * recordAdRatio;
        data.gmvForAdRatioSum += recordGmv;
      }
      data.recordCount++;
    });
    
    // 计算汇总数据（参考KPI的计算方法）
    Object.keys(aggregated).forEach(storeId => {
      const data = aggregated[storeId];
      // 订单量：直接相加求和
      data.avgOrders = data.totalOrders;
      // GMV：直接相加求和
      data.avgGmv = data.totalGmv;
      // 广告占比：加权平均 = (Σ(店铺GMV × 店铺广告占比)) / (Σ店铺GMV)
      data.avgAdRatio = data.gmvForAdRatioSum > 0 
        ? parseFloat((data.weightedAdRatioSum / data.gmvForAdRatioSum).toFixed(1)) 
        : 0;
    });
    
    return aggregated;
  }, [dateQueryResults]);

  // --- 计算日期对比的趋势数据（按店铺分组）
  const storeTrendData = useMemo(() => {
    if (dateQueryResults.length === 0) return {};
    const grouped: Record<string, DateQueryRecord[]> = {};
    
    dateQueryResults.forEach(record => {
      if (!grouped[record.storeId]) {
        grouped[record.storeId] = [];
      }
      grouped[record.storeId].push(record);
    });
    
    // 对每个店铺的数据按日期排序
    Object.keys(grouped).forEach(storeId => {
      grouped[storeId].sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf());
    });
    
    return grouped;
  }, [dateQueryResults]);

  // --- 国家筛选选项（添加"全部"选项）
  const COUNTRIES = useMemo(() => {
    return ['全部', ...regions];
  }, [regions]);

  // --- 根据筛选后的店铺列表
  const filteredStores = useMemo(() => {
    if (selectedRegion === '全部') {
      return STORES;
    }
    return STORES.filter(s => s.region === selectedRegion);
  }, [selectedRegion, STORES]);

  // --- 实际用于显示的店铺ID列表（考虑"只显示"筛选）
  const displayStoreIds = useMemo(() => {
    if (selectedDisplayStoreIds.length > 0) {
      return selectedDisplayStoreIds;
    }
    return selectedStoreIds;
  }, [selectedStoreIds, selectedDisplayStoreIds]);

  // --- 实际用于显示的店铺列表（考虑"只显示"筛选）
  const displayStores = useMemo(() => {
    return STORES.filter(s => displayStoreIds.includes(s.id));
  }, [displayStoreIds, STORES]);

  // --- 计算聚合的指标
  const aggregateMetrics = useCallback((storeIds: string[], storeData: Record<string, StoreData>): MetricData => {
    if (storeIds.length === 0) {
      return {
        orders: 0, adRatio: 0, adSpend: 0, sales: 0, adSales: 0, acos: 0, gmv: 0, fbaTotalStock: 0, fbaStockValue: 0, grossProfit: 0, storageRatio: 0 
      };
    }

    let totalOrders = 0;
    let totalAdSpend = 0;
    let totalSales = 0;
    let totalAdSales = 0;
    let totalGmv = 0;
    let totalGrossProfit = 0;
    
    // 用于加权平均计算广告占比和仓储占比的累积值
    let weightedAdRatioSum = 0;
    let weightedStorageRatioSum = 0;
    let gmvForAdRatioSum = 0;

    // FBA总库存和货值：各店铺分开看，不汇总，只取第一个店铺的值
    const firstStoreData = storeData[storeIds[0]];
    const fbaTotalStock = firstStoreData?.currentMetrics.fbaTotalStock || 0;
    const fbaStockValue = firstStoreData?.currentMetrics.fbaStockValue || 0;

    storeIds.forEach((id) => {
      const sd = storeData[id];
      if (sd) {
        totalOrders += sd.currentMetrics.orders;
        totalAdSpend += sd.currentMetrics.adSpend;
        totalSales += sd.currentMetrics.sales;
        totalAdSales += sd.currentMetrics.adSales;
        totalGmv += sd.currentMetrics.gmv;
        totalGrossProfit += sd.currentMetrics.grossProfit;
        
        // 累积加权平均的分子和分母
        const storeGmv = sd.currentMetrics.gmv;
        const storeAdRatio = sd.currentMetrics.adRatio;
        const storeStorageRatio = sd.currentMetrics.storageRatio;
        if (storeGmv > 0) {
          weightedAdRatioSum += storeGmv * storeAdRatio;
          weightedStorageRatioSum += storeGmv * storeStorageRatio;
          gmvForAdRatioSum += storeGmv;
        }
      }
    });

    // 使用加权平均公式计算广告占比
    // 合计广告占比 = (店铺A的GMV × 店铺A的广告占比 + 店铺B的GMV × 店铺B的广告占比) ÷ (店铺A的GMV + 店铺B的GMV)
    const aggregateAdRatio = gmvForAdRatioSum > 0 ? (weightedAdRatioSum / gmvForAdRatioSum) : 0;
    // 使用加权平均公式计算仓储占比
    const aggregateStorageRatio = gmvForAdRatioSum > 0 ? (weightedStorageRatioSum / gmvForAdRatioSum) : 0;
    // ACOS = 广告花费 / 广告销售额，多店铺时按总花费/总销售额计算
    const aggregateAcos = totalAdSales > 0 ? ((totalAdSpend / totalAdSales) * 100) : 0;

    return {
      orders: totalOrders,
      adRatio: parseFloat(aggregateAdRatio.toFixed(1)),
      acos: parseFloat(aggregateAcos.toFixed(1)),
      adSpend: totalAdSpend,
      sales: totalSales,
      adSales: totalAdSales,
      gmv: totalGmv,
      fbaTotalStock,
      fbaStockValue,
      grossProfit: totalGrossProfit,
      storageRatio: parseFloat(aggregateStorageRatio.toFixed(1)),
    };
  }, [STORES]);

  // --- KPI指标名称和格式化映射
  const kpiInfo = {
    orders: { name: '订单量', unit: '单', format: (v: number) => v.toLocaleString() },
    gmv: { name: 'GMV', unit: '¥', format: (v: number) => v.toLocaleString() },
    adRatio: { name: '广告占比', unit: '%', format: (v: number) => v.toFixed(1) },
    acos: { name: 'ACOS', unit: '%', format: (v: number) => v.toFixed(1) },
    fbaTotalStock: { name: 'FBA总库存', unit: '件', format: (v: number) => v.toLocaleString() },
    grossProfit: { name: '毛利润', unit: '¥', format: (v: number) => v.toLocaleString() },
    storageRatio: { name: '仓储占比', unit: '%', format: (v: number) => v.toFixed(1) },
  };

  // --- 渲染KPI下方详细内容（各店铺该KPI数据）
  const renderKpiDetail = useCallback((kpiType: string) => {
    if (selectedStoreIds.length === 0) {
      return null;
    }

    const info = kpiInfo[kpiType as keyof typeof kpiInfo];
    if (!info) return null;

    // ACOS和FBA总库存特殊处理：KPI卡片上只显示单店铺，但悬停时显示所有店铺
    const isAcos = kpiType === 'acos';
    const isFbaStock = kpiType === 'fbaTotalStock';
    const isMultiStore = selectedStoreIds.length > 1;
    
    // 悬停时显示所有店铺数据（不限制）
    const storeData = selectedStoreIds
      .filter(id => storesData[id])
      .map(id => {
        const store = storesData[id];
        const storeInfo = STORES.find(s => s.id === id);
        const metrics = store.currentMetrics;
        return {
          key: id,
          storeName: storeInfo?.name || id,
          value: metrics[kpiType as keyof MetricData] as number,
          fbaStockValue: metrics.fbaStockValue,
        };
      })
      .sort((a, b) => b.value - a.value);

    return (
      <div style={{ 
        position: 'absolute', 
        top: '100%', 
        left: 0, 
        right: 0, 
        marginTop: '8px', 
        padding: '12px', 
        backgroundColor: '#fff', 
        borderRadius: '8px',
        border: '1px solid #eee',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        zIndex: 100,
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box'
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '10px', color: '#333' }}>
          {info.name} - 各店铺昨日数据
        </div>
        
        {(isAcos || isFbaStock) && isMultiStore && (
          <div style={{ 
            backgroundColor: '#fffbe6', 
            border: '1px solid #ffe58f', 
            borderRadius: '4px', 
            padding: '8px', 
            marginBottom: '10px',
            fontSize: '12px',
            color: '#d48806'
          }}>
            💡 {isAcos ? 'ACOS' : 'FBA总库存/货值'}数据为各店铺独立数据，不做合计。KPI卡片上仅显示「{STORES.find(s => s.id === selectedStoreIds[0])?.name || selectedStoreIds[0]}」的数据。
          </div>
        )}
        
        <div style={{ maxHeight: '250px', overflow: 'auto' }}>
          {storeData.map((item, index) => {
            let displayValue = '';
            if (isFbaStock) {
              displayValue = `${item.value.toLocaleString()}件 / ¥${item.fbaStockValue?.toLocaleString() || '0'}`;
            } else if (info.unit === '¥') {
              displayValue = `¥${item.value.toLocaleString()}`;
            } else if (info.unit === '%') {
              displayValue = `${item.value.toFixed(1)}%`;
            } else {
              displayValue = `${item.value.toLocaleString()} ${info.unit}`;
            }
            
            return (
              <div key={item.key} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '8px 0',
                borderBottom: index < storeData.length - 1 ? '1px solid #f0f0f0' : 'none',
                fontSize: '13px'
              }}>
                <span style={{ color: '#666' }}>{index + 1}. {item.storeName}</span>
                <span style={{ fontWeight: 600, color: '#333' }}>{displayValue}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }, [selectedStoreIds, storesData, STORES, kpiInfo]);

  const currentMetrics = useMemo(() => {
    return aggregateMetrics(displayStoreIds, storesData);
  }, [displayStoreIds, storesData, aggregateMetrics]);

  // --- 准备订单量趋势数据（分店铺）- 只跟随顶部店铺筛选变化
  const ordersTrendData = useMemo(() => {
    if (selectedStoreIds.length === 0) return [];
    
    // 获取所有日期
    const allDates = new Set<string>();
    selectedStoreIds.forEach(storeId => {
      const sd = storesData[storeId];
      if (sd && sd.ordersTrend) {
        sd.ordersTrend.forEach(point => allDates.add(point.date));
      }
    });
    
    const sortedDates = Array.from(allDates).sort((a, b) => dayjs(a, 'MM-DD').valueOf() - dayjs(b, 'MM-DD').valueOf());
    
    // 构建数据结构：日期 + 各店铺数据
    return sortedDates.map(date => {
      const row: any = { date };
      selectedStoreIds.forEach(storeId => {
        const sd = storesData[storeId];
        if (sd) {
          const point = sd.ordersTrend?.find(p => p.date === date);
          row[sd.info.name] = point?.orders || 0;
        }
      });
      return row;
    });
  }, [selectedStoreIds, storesData]);

  // --- 准备广告占比趋势数据（分店铺）- 只跟随顶部店铺筛选变化
  const adRatioTrendData = useMemo(() => {
    if (selectedStoreIds.length === 0) return [];
    
    // 获取所有日期
    const allDates = new Set<string>();
    selectedStoreIds.forEach(storeId => {
      const sd = storesData[storeId];
      if (sd && sd.adRatioTrend) {
        sd.adRatioTrend.forEach(point => allDates.add(point.date));
      }
    });
    
    const sortedDates = Array.from(allDates).sort((a, b) => dayjs(a, 'MM-DD').valueOf() - dayjs(b, 'MM-DD').valueOf());
    
    // 构建数据结构：日期 + 各店铺数据
    return sortedDates.map(date => {
      const row: any = { date };
      selectedStoreIds.forEach(storeId => {
        const sd = storesData[storeId];
        if (sd) {
          const point = sd.adRatioTrend?.find(p => p.date === date);
          row[sd.info.name] = point?.adRatio || 0;
        }
      });
      return row;
    });
  }, [selectedStoreIds, storesData]);

  // --- 聚合预警（多店铺时按指标最低的店铺判断）
  const aggregateAlerts = useMemo(() => {
    if (displayStoreIds.length <= 1) {
      const alerts: AlertItem[] = [];
      displayStoreIds.forEach(storeId => {
        const sd = storesData[storeId];
        if (sd && sd.alerts) {
          sd.alerts.forEach(alert => {
            alerts.push({
              ...alert,
              storeName: sd.info.name,
            });
          });
        }
      });
      return alerts.sort((a, b) => b.id - a.id);
    }

    const alerts: AlertItem[] = [];
    let alertId = 0;

    displayStoreIds.forEach(storeId => {
      const sd = storesData[storeId];
      if (sd && sd.currentMetrics) {
        const storeThresholds = getThresholdsForStore(storeId);
        const metrics = sd.currentMetrics;
        const storeName = sd.info.name;

        if (metrics.adRatio > storeThresholds.adRatio) {
          alerts.push({
            id: alertId++,
            time: dayjs().format('HH:mm:ss'),
            metricName: '广告占比',
            currentValue: metrics.adRatio + '%',
            threshold: '>' + storeThresholds.adRatio + '%',
            suggestion: '广告花费偏高，建议优化投放',
            severity: metrics.adRatio > storeThresholds.adRatio * 1.1 ? 'red' : 'orange',
            storeName: storeName,
          });
        }

        if (metrics.storageRatio > storeThresholds.storageRatio) {
          alerts.push({
            id: alertId++,
            time: dayjs().format('HH:mm:ss'),
            metricName: '仓储占比',
            currentValue: metrics.storageRatio + '%',
            threshold: '>' + storeThresholds.storageRatio + '%',
            suggestion: '仓储费用偏高，建议清理库存',
            severity: metrics.storageRatio > storeThresholds.storageRatio * 1.1 ? 'red' : 'orange',
            storeName: storeName,
          });
        }

        if (metrics.acos > storeThresholds.acos) {
          alerts.push({
            id: alertId++,
            time: dayjs().format('HH:mm:ss'),
            metricName: 'ACOS',
            currentValue: metrics.acos + '%',
            threshold: '>' + storeThresholds.acos + '%',
            suggestion: '建议暂停高ACOS关键词',
            severity: metrics.acos > storeThresholds.acos * 1.1 ? 'red' : 'orange',
            storeName: storeName,
          });
        }
      }
    });

    return alerts.sort((a, b) => b.id - a.id);
  }, [displayStoreIds, storesData, thresholds]);

  // --- 日期查询函数（从后端API获取数据）
  const handleDateQuery = useCallback(async () => {
    if (!dateRange || displayStoreIds.length === 0) {
      message.warning('请先选择日期和店铺');
      return;
    }

    setDateQueryLoading(true);
    setDateQueryCurrentPage(1); // 查询时重置到第一页
    
    const [start, end] = dateRange;
    
    if (start && end) {
      try {
        const startDate = start.format('YYYY-MM-DD');
        const endDate = end.format('YYYY-MM-DD');
        
        // 获取选中店铺的名称
        const storeNames = displayStoreIds
          .map(id => STORES.find(s => s.id === id)?.name)
          .filter(Boolean) as string[];
        
        // 从后端API获取数据
        const warnings = await fetchDataWarnings(storeNames, startDate, endDate);
        
        // 如果数据库没有数据，按0处理
        if (warnings.length === 0) {
          console.warn('数据库没有数据，按0处理');
          const results: DateQueryRecord[] = [];
          let current = start.clone();
          while (current.isBefore(end) || current.isSame(end)) {
            const dateStr = current.format('YYYY-MM-DD');
            
            displayStoreIds.forEach(storeId => {
              const storeName = STORES.find(s => s.id === storeId)?.name || '';
              
              // 数据库没数据时按0处理
              results.push({
                date: dateStr,
                storeId,
                storeName,
                orders: 0,
                gmv: 0,
                adRatio: 0,
                grossProfit: 0,
                grossMargin: 0,
                fbaTotalStock: 0,
                storageRatio: 0
              });
            });
            
            current = current.add(1, 'day');
          }
          
          setDateQueryResults(results);
          message.success('查询完成（数据库无数据，按0处理）');
          setDateQueryLoading(false);
          return;
        }
        
        // 转换为前端需要的格式
        const results: DateQueryRecord[] = warnings.map(warning => {
          const store = STORES.find(s => s.name === warning.store);
          const gmv = warning.gmv;
          const grossProfit = warning.gross_profit || 0;
          const grossMargin = gmv > 0 ? parseFloat(((grossProfit / gmv) * 100).toFixed(2)) : 0;
          return {
            date: warning.date,
            storeId: store?.id || warning.store,
            storeName: warning.store,
            orders: warning.order_count,
            gmv: gmv,
            adRatio: parseFloat((warning.ad_ratio * 100).toFixed(2)),
            grossProfit: grossProfit,
            grossMargin: grossMargin,
            fbaTotalStock: warning.fba_total_stock || 0,
            storageRatio: parseFloat(((warning.storage_ratio || 0) * 100).toFixed(2))
          };
        });
        
        results.sort((a, b) => {
          const storeCompare = a.storeId.localeCompare(b.storeId);
          if (storeCompare !== 0) return storeCompare;
          return a.date.localeCompare(b.date);
        });
        
        setDateQueryResults(results);
        message.success('查询完成');
      } catch (error) {
        console.error('日期查询失败:', error);
        message.error('查询失败，按0处理');
        
        // 异常时也按0处理
        const results: DateQueryRecord[] = [];
        let current = start.clone();
        while (current.isBefore(end) || current.isSame(end)) {
          const dateStr = current.format('YYYY-MM-DD');
          
          displayStoreIds.forEach(storeId => {
            const storeName = STORES.find(s => s.id === storeId)?.name || '';
            
            // 异常时按0处理
            results.push({
              date: dateStr,
              storeId,
              storeName,
              orders: 0,
              gmv: 0,
              adRatio: 0,
              grossProfit: 0,
              grossMargin: 0,
              fbaTotalStock: 0,
              storageRatio: 0
            });
          });
          
          current = current.add(1, 'day');
        }
        
        setDateQueryResults(results);
      } finally {
        setDateQueryLoading(false);
      }
    }
  }, [dateRange, displayStoreIds, STORES]);

  // --- 自动查询：当日期或店铺（含只显示筛选）变化时，自动重新查询
  useEffect(() => {
    if (dateRange && displayStoreIds.length > 0) {
      handleDateQuery();
    }
  }, [displayStoreIds, dateRange, handleDateQuery]);

  // --- 从后端API加载数据并更新storesData
  const loadStoreDataFromAPI = useCallback(async () => {
    if (selectedStoreIds.length === 0) return;
    
    try {
      // 获取最近14天的数据（从14天前到昨天）
      const yesterday = dayjs().subtract(1, 'day');
      const endDate = yesterday.format('YYYY-MM-DD');
      const startDate = yesterday.clone().subtract(13, 'day').format('YYYY-MM-DD');
      console.log('数据加载日期范围:', startDate, '~', endDate);
      
      // 获取选中店铺的名称
      const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);
      
      // 查询最近14天的数据
      const warnings = await fetchDataWarnings(storeNames, startDate, endDate);
      
      if (warnings.length === 0) {
        console.warn(`未从数据库获取到${startDate}至${endDate}的数据，按0处理`);
      }
      
      const newStoresData: Record<string, StoreData> = {};
      
      // 按店铺分组数据
      const groupedByStore: Record<string, DataWarningRecord[]> = {};
      warnings.forEach(warning => {
        if (!groupedByStore[warning.store]) {
          groupedByStore[warning.store] = [];
        }
        groupedByStore[warning.store].push(warning);
      });
      
      selectedStores.forEach(store => {
        const storeWarnings = groupedByStore[store.name] || [];
        
        // 按日期排序
        storeWarnings.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        // 当前指标（取前一天的数据，如果没有则为0）
        const yesterdayWarning = storeWarnings.find(w => w.date === endDate);
        
        let orders = 0, sales = 0, adSpend = 0, adSales = 0, adRatio = 0, acos = 0, gmv = 0, fbaTotalStock = 0, grossProfit = 0, storageRatio = 0;
        
        if (yesterdayWarning) {
          orders = yesterdayWarning.order_count;
          adRatio = parseFloat((yesterdayWarning.ad_ratio * 100).toFixed(2));
          acos = parseFloat((yesterdayWarning.acos * 100).toFixed(2));
          fbaTotalStock = yesterdayWarning.fba_total_stock || 0;
          gmv = yesterdayWarning.gmv;
          grossProfit = yesterdayWarning.gross_profit || 0;
          storageRatio = parseFloat((yesterdayWarning.storage_ratio * 100).toFixed(2));
          sales = gmv;
          adSpend = adRatio * sales / 100;
          adSales = acos > 0 ? (adSpend / acos) * 100 : 0;
        }
        
        // 订单量趋势（近14天）- 确保显示完整日期范围
        const ordersTrend: { date: string; orders: number }[] = [];
        for (let i = 13; i >= 0; i--) {
          const dateStr = yesterday.clone().subtract(i, 'day').format('MM-DD');
          const fullDateStr = yesterday.clone().subtract(i, 'day').format('YYYY-MM-DD');
          const warning = storeWarnings.find(w => w.date === fullDateStr);
          ordersTrend.push({
            date: dateStr,
            orders: warning?.order_count || 0
          });
        }
        
        // 广告占比趋势（近7天）- 确保显示完整日期范围
        const adRatioTrend: { date: string; adRatio: number }[] = [];
        for (let i = 6; i >= 0; i--) {
          const dateStr = yesterday.clone().subtract(i, 'day').format('MM-DD');
          const fullDateStr = yesterday.clone().subtract(i, 'day').format('YYYY-MM-DD');
          const warning = storeWarnings.find(w => w.date === fullDateStr);
          adRatioTrend.push({
            date: dateStr,
            adRatio: parseFloat(((warning?.ad_ratio || 0) * 100).toFixed(2))
          });
        }
        
        // 生成预警
        const alerts: AlertItem[] = [];
        let alertId = 0;
        
        if (orders < 80) {
          alerts.push({
            id: alertId++,
            time: dayjs().subtract(Math.floor(Math.random() * 60), 'minute').format('HH:mm:ss'),
            metricName: '订单量',
            currentValue: orders.toString(),
            threshold: '<80',
            suggestion: '建议检查今日流量是否异常',
            severity: orders < 80 * 0.8 ? 'red' : 'orange',
          });
        }
        const storeThresholds = getThresholdsForStore(store.id);
        if (adRatio > storeThresholds.adRatio) {
          alerts.push({
            id: alertId++,
            time: dayjs().subtract(Math.floor(Math.random() * 60), 'minute').format('HH:mm:ss'),
            metricName: '广告占比',
            currentValue: adRatio + '%',
            threshold: '>' + storeThresholds.adRatio + '%',
            suggestion: '广告花费偏高，建议优化投放',
            severity: adRatio > storeThresholds.adRatio * 1.1 ? 'red' : 'orange',
          });
        }
        if (acos > storeThresholds.acos) {
          alerts.push({
            id: alertId++,
            time: dayjs().subtract(Math.floor(Math.random() * 60), 'minute').format('HH:mm:ss'),
            metricName: 'ACOS',
            currentValue: acos + '%',
            threshold: '>' + storeThresholds.acos + '%',
            suggestion: '建议暂停高ACOS关键词',
            severity: acos > storeThresholds.acos * 1.1 ? 'red' : 'orange',
          });
        }
        if (storageRatio > storeThresholds.storageRatio) {
          alerts.push({
            id: alertId++,
            time: dayjs().subtract(Math.floor(Math.random() * 60), 'minute').format('HH:mm:ss'),
            metricName: '仓储占比',
            currentValue: storageRatio + '%',
            threshold: '>' + storeThresholds.storageRatio + '%',
            suggestion: '仓储费用偏高，建议清理库存',
            severity: storageRatio > storeThresholds.storageRatio * 1.1 ? 'red' : 'orange',
          });
        }
        
        newStoresData[store.id] = {
          info: store,
          currentMetrics: {
            orders,
            adRatio,
            acos,
            adSpend,
            sales,
            adSales,
            gmv,
            fbaTotalStock,
            fbaStockValue: yesterdayWarning?.cargo_value || 0,
            grossProfit,
            storageRatio,
          },
          ordersTrend,
          adRatioTrend,
          alerts,
        };
      });
      
      setStoresData(newStoresData);
      setLastUpdated(dayjs().format('YYYY-MM-DD HH:mm:ss'));
      message.success('数据已从数据库加载');
    } catch (error) {
      console.error('从数据库加载数据失败:', error);
      message.error('从数据库加载数据失败，按0处理');
      // 失败时按0处理，不使用模拟数据
      const newStoresData: Record<string, StoreData> = {};
      selectedStoreIds.forEach(storeId => {
        const store = STORES.find(s => s.id === storeId);
        if (store) {
          newStoresData[store.id] = {
            info: store,
            currentMetrics: {
              orders: 0,
              adRatio: 0,
              acos: 0,
              adSpend: 0,
              sales: 0,
              adSales: 0,
              gmv: 0,
              fbaTotalStock: 0,
              fbaStockValue: 0,
              grossProfit: 0,
              storageRatio: 0,
            },
            ordersTrend: [],
            adRatioTrend: [],
            alerts: [],
          };
        }
      });
      setStoresData(newStoresData);
      setLastUpdated(dayjs().format('YYYY-MM-DD HH:mm:ss'));
    }
  }, [selectedStoreIds, STORES]);

  // --- 从后端API加载商品销量数据
  const loadProductSalesData = useCallback(async () => {
    if (selectedStoreIds.length === 0) {
      setProductSalesData([]);
      setSkuDailySalesData([]);
      return;
    }

    try {
      const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);
      
      const [startDate, endDate] = dateRange && dateRange[0] && dateRange[1] 
        ? [dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD')]
        : [dayjs().subtract(7, 'day').format('YYYY-MM-DD'), dayjs().subtract(1, 'day').format('YYYY-MM-DD')];

      const topSkus = await fetchTopSkus(storeNames, startDate, endDate, 10);
      const topSkuList = topSkus.map(s => s.sku);
      const dailySales = await fetchSkuDailySales(storeNames, topSkuList, startDate, endDate);

      const skuMap = new Map<string, SkuSalesRecord>();
      topSkus.forEach(record => {
        const sku = record.sku;
        const storeName = record.store;
        if (!skuMap.has(sku)) {
          skuMap.set(sku, {
            sku,
            totalSales: 0,
            stores: [],
          });
        }
        const skuRecord = skuMap.get(sku)!;
        skuRecord.totalSales += record.total_sales;
        
        const existingStore = skuRecord.stores.find(s => s.storeName === storeName);
        if (existingStore) {
          existingStore.sales += record.total_sales;
        } else {
          skuRecord.stores.push({
            storeId: '',
            storeName: storeName,
            date: endDate,
            sales: record.total_sales,
          });
        }
      });

      const result = Array.from(skuMap.values()).sort((a, b) => b.totalSales - a.totalSales);
      setProductSalesData(result);
      setSkuDailySalesData(dailySales);
    } catch (error) {
      console.error('加载商品销量数据失败:', error);
      setProductSalesData([]);
      setSkuDailySalesData([]);
    }
  }, [selectedStoreIds, dateRange, STORES]);

  // --- 初始化：获取数据
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [deptsRes, regsRes] = await Promise.all([
          departmentsApi.getList(),
          departmentsApi.getRegions()
        ]);
        
        if (deptsRes.data.success) {
          setDepartments(deptsRes.data.data);
        }
        
        if (regsRes.data.success) {
          setRegions(regsRes.data.data);
        }
      } catch (error) {
        console.error('加载数据失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // --- 当 departments 加载完成后从API获取数据和阈值设置
  useEffect(() => {
    if (!loading && departments.length > 0) {
      fetchThresholdSettings().then(setThresholds);
    }
  }, [departments, loading]);

  useEffect(() => {
    if (selectedStoreIds.length > 0) {
      loadStoreDataFromAPI();
      loadProductSalesData();
    }
  }, [selectedStoreIds, loadStoreDataFromAPI, loadProductSalesData]);

  useEffect(() => {
    if (selectedStoreIds.length > 0) {
      loadProductSalesData();
    }
  }, [dateRange, selectedStoreIds, loadProductSalesData]);



  // --- 获取聚合阈值（取所有选中店铺中最严格的阈值，即最小值）
  const getAggregateThresholds = useMemo(() => {
    if (displayStoreIds.length === 0) {
      return { adRatio: 25, storageRatio: 10, acos: 30 };
    }

    const storeThresholds = displayStoreIds.map(id => getThresholdsForStore(id));
    
    return {
      adRatio: Math.min(...storeThresholds.map(t => t.adRatio)),
      storageRatio: Math.min(...storeThresholds.map(t => t.storageRatio)),
      acos: Math.min(...storeThresholds.map(t => t.acos)),
    };
  }, [displayStoreIds, thresholds]);

  // --- 判断指标状态（使用店铺级阈值）
  const getMetricStatus = (metric: string, value: number): 'normal' | 'warning' | 'danger' => {
    const allThresholds = {
      orders: 80,
      ...getAggregateThresholds,
    };
    const threshold = allThresholds[metric as keyof typeof allThresholds];
    if (metric === 'orders') {
      if (value < threshold) return 'danger';
      if (value < threshold * 1.2) return 'warning';
      return 'normal';
    } else {
      if (value > threshold) return 'danger';
      if (value > threshold * 0.9) return 'warning';
      return 'normal';
    }
  };

  // --- 获取卡片样式
  const getCardStyle = (status: 'normal' | 'warning' | 'danger') => {
    if (status === 'danger') {
      return { backgroundColor: '#fff0f0', borderColor: '#ff4d4f', borderWidth: 2 };
    }
    if (status === 'warning') {
      return { backgroundColor: '#fffbe6', borderColor: '#faad14', borderWidth: 2 };
    }
    return { backgroundColor: '#f0fff0', borderColor: '#52c41a', borderWidth: 2 };
  };

  // --- 获取状态图标
  const getStatusIcon = (status: 'normal' | 'warning' | 'danger') => {
    if (status === 'danger') return <XCircle size={16} color="#ff4d4f" />;
    if (status === 'warning') return <AlertTriangle size={16} color="#faad14" />;
    return <CheckCircle size={16} color="#52c41a" />;
  };



  // --- 重置筛选
  const handleResetFilters = () => {
    setSelectedRegion('全部');
    setSelectedStoreIds([]);
  };

  // --- 全选/取消全选店铺
  const handleToggleSelectAll = () => {
    const allStoreIds = filteredStores.map(s => s.id);
    const isAllSelected = allStoreIds.every(id => selectedStoreIds.includes(id));
    if (isAllSelected) {
      setSelectedStoreIds([]);
    } else {
      setSelectedStoreIds(allStoreIds);
    }
  };

  // --- 处理地区变化
  const handleRegionChange = (value: string) => {
    setSelectedRegion(value);
    // 地区变化时不清空已选店铺，只过滤显示
  };

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto', backgroundColor: '#f5f7fa' }}>
      {/* --- 筛选区 */}
      <Card bordered={false} style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <Space wrap size="middle" style={{ justifyContent: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Filter size={16} />
              <span style={{ fontWeight: 500 }}>地区筛选:</span>
            </div>
            <Select
              value={selectedRegion}
              onChange={handleRegionChange}
              style={{ width: 120 }}
            >
              {COUNTRIES.map(country => (
                <Option key={country} value={country}>{country}</Option>
              ))}
            </Select>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Store size={16} />
              <span style={{ fontWeight: 500 }}>店铺筛选:</span>
            </div>
            <Select
              mode="multiple"
              placeholder="请选择店铺"
              value={selectedStoreIds}
              onChange={setSelectedStoreIds}
              style={{ minWidth: 250 }}
              maxTagCount="responsive"
              maxTagPlaceholder={() => `已选${selectedStoreIds.length}个店铺`}
              showSearch
              filterOption={(input, option) =>
                (option?.children as unknown as string)?.toLowerCase().includes(input.toLowerCase())
              }
              dropdownRender={menu => (
                <div>
                  <div style={{ padding: '4px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }} onClick={handleToggleSelectAll}>
                    <input
                      type="checkbox"
                      checked={filteredStores.length > 0 && filteredStores.every(s => selectedStoreIds.includes(s.id))}
                      style={{ marginRight: '8px' }}
                      onChange={e => e.stopPropagation()}
                    />
                    {filteredStores.length > 0 && filteredStores.every(s => selectedStoreIds.includes(s.id)) ? '取消全选' : '全选'}
                  </div>
                  {menu}
                </div>
              )}
            >
              {filteredStores.map(store => (
                <Option key={store.id} value={store.id}>{store.name}</Option>
              ))}
            </Select>

            <Button type="primary" icon={<RefreshCw />} onClick={loadStoreDataFromAPI}>
              刷新数据
            </Button>
            <Button onClick={handleResetFilters}>重置</Button>
          </Space>
          <Text type="secondary" style={{ fontSize: '14px' }}>
            最后更新: {lastUpdated}
          </Text>
        </div>
      </Card>

      {/* --- 顶部 KPI 指标卡区 */}
      <div style={{ 
        display: 'flex', 
        flexWrap: 'nowrap', 
        gap: '12px', 
        marginBottom: '16px' 
      }}>
        {/* 订单量 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          onMouseEnter={() => setHoveredKpi('orders')}
          onMouseLeave={() => setHoveredKpi(null)}
        >
          <Card 
            size="small" 
            bordered 
            bodyStyle={{ padding: '8px 12px' }} 
            style={{ 
              minHeight: 'auto', 
              height: 'auto',
              backgroundColor: '#f5efe0'
            }} 
            hoverable
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '60px' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>订单量</Text>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#333', lineHeight: 1.2 }}>
                  {currentMetrics.orders}
                </div>
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>单/昨日</Text>
              </div>
            </div>
          </Card>
          {hoveredKpi === 'orders' && renderKpiDetail('orders')}
        </div>

        {/* GMV */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          onMouseEnter={() => setHoveredKpi('gmv')}
          onMouseLeave={() => setHoveredKpi(null)}
        >
          <Card 
            size="small" 
            bordered 
            bodyStyle={{ padding: '8px 12px' }} 
            style={{ 
              minHeight: 'auto', 
              height: 'auto',
              backgroundColor: '#e6f0eb'
            }} 
            hoverable
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '60px' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>GMV</Text>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#333', lineHeight: 1.2 }}>
                  ¥{currentMetrics.gmv.toLocaleString()}
                </div>
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>昨日交易总额</Text>
              </div>
            </div>
          </Card>
          {hoveredKpi === 'gmv' && renderKpiDetail('gmv')}
        </div>

        {/* 毛利润 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          onMouseEnter={() => setHoveredKpi('grossProfit')}
          onMouseLeave={() => setHoveredKpi(null)}
        >
          <Card 
            size="small" 
            bordered 
            bodyStyle={{ padding: '8px 12px' }} 
            style={{ 
              minHeight: 'auto', 
              height: 'auto',
              backgroundColor: '#e6f7ff'
            }} 
            hoverable
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '60px' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>毛利润</Text>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#333', lineHeight: 1.2 }}>
                  ¥{currentMetrics.grossProfit.toLocaleString()}
                </div>
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>昨日毛利润</Text>
              </div>
            </div>
          </Card>
          {hoveredKpi === 'grossProfit' && renderKpiDetail('grossProfit')}
        </div>

        {/* 广告占比 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          onMouseEnter={() => setHoveredKpi('adRatio')}
          onMouseLeave={() => setHoveredKpi(null)}
        >
          <Card 
            size="small" 
            bordered 
            bodyStyle={{ padding: '8px 12px' }} 
            style={{ 
              ...getCardStyle(getMetricStatus('adRatio', currentMetrics.adRatio)), 
              minHeight: 'auto', 
              height: 'auto'
            }} 
            hoverable
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '60px' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>广告占比</Text>
                <div style={{ fontSize: '24px', fontWeight: 600, color: getMetricStatus('adRatio', currentMetrics.adRatio) === 'danger' ? '#ff4d4f' : '#333', lineHeight: 1.2 }}>
                  {currentMetrics.adRatio}%
                </div>
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>花费/销售额</Text>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                {getStatusIcon(getMetricStatus('adRatio', currentMetrics.adRatio))}
                <Tag color={getMetricStatus('adRatio', currentMetrics.adRatio) === 'normal' ? 'success' : getMetricStatus('adRatio', currentMetrics.adRatio) === 'warning' ? 'warning' : 'error'} style={{ fontSize: '11px', padding: '0 6px', lineHeight: 1.6, height: 'auto' }}>
                  阈值: &gt;{getAggregateThresholds.adRatio}%
                </Tag>
              </div>
            </div>
          </Card>
          {hoveredKpi === 'adRatio' && renderKpiDetail('adRatio')}
        </div>

        {/* 仓储占比 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          onMouseEnter={() => setHoveredKpi('storageRatio')}
          onMouseLeave={() => setHoveredKpi(null)}
        >
          <Card 
            size="small" 
            bordered 
            bodyStyle={{ padding: '8px 12px' }} 
            style={{ 
              ...getCardStyle(getMetricStatus('storageRatio', currentMetrics.storageRatio)), 
              minHeight: 'auto', 
              height: 'auto'
            }} 
            hoverable
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '60px' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>仓储占比</Text>
                <div style={{ fontSize: '24px', fontWeight: 600, color: getMetricStatus('storageRatio', currentMetrics.storageRatio) === 'danger' ? '#ff4d4f' : '#333', lineHeight: 1.2 }}>
                  {currentMetrics.storageRatio}%
                </div>
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>仓储费用占比</Text>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                {getStatusIcon(getMetricStatus('storageRatio', currentMetrics.storageRatio))}
                <Tag color={getMetricStatus('storageRatio', currentMetrics.storageRatio) === 'normal' ? 'success' : getMetricStatus('storageRatio', currentMetrics.storageRatio) === 'warning' ? 'warning' : 'error'} style={{ fontSize: '11px', padding: '0 6px', lineHeight: 1.6, height: 'auto' }}>
                  阈值: &gt;{getAggregateThresholds.storageRatio}%
                </Tag>
              </div>
            </div>
          </Card>
          {hoveredKpi === 'storageRatio' && renderKpiDetail('storageRatio')}
        </div>

        {/* ACOS */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          onMouseEnter={() => setHoveredKpi('acos')}
          onMouseLeave={() => setHoveredKpi(null)}
        >
          <Card 
            size="small" 
            bordered 
            bodyStyle={{ padding: '8px 12px' }} 
            style={{ 
              ...getCardStyle(getMetricStatus('acos', currentMetrics.acos)), 
              minHeight: 'auto', 
              height: 'auto'
            }} 
            hoverable
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '60px' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>ACOS</Text>
                <div style={{ fontSize: '24px', fontWeight: 600, color: getMetricStatus('acos', currentMetrics.acos) === 'danger' ? '#ff4d4f' : '#333', lineHeight: 1.2 }}>
                  {currentMetrics.acos}%
                </div>
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>广告效率</Text>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                {getStatusIcon(getMetricStatus('acos', currentMetrics.acos))}
                <Tag color={getMetricStatus('acos', currentMetrics.acos) === 'normal' ? 'success' : getMetricStatus('acos', currentMetrics.acos) === 'warning' ? 'warning' : 'error'} style={{ fontSize: '11px', padding: '0 6px', lineHeight: 1.6, height: 'auto' }}>
                  阈值: &gt;{getAggregateThresholds.acos}%
                </Tag>
              </div>
            </div>
          </Card>
          {hoveredKpi === 'acos' && renderKpiDetail('acos')}
        </div>

        {/* FBA总库存 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          onMouseEnter={() => setHoveredKpi('fbaTotalStock')}
          onMouseLeave={() => setHoveredKpi(null)}
        >
          <Card 
            size="small" 
            bordered 
            bodyStyle={{ padding: '8px 12px' }} 
            style={{ 
              minHeight: 'auto', 
              height: 'auto',
              backgroundColor: '#f0fff0'
            }} 
            hoverable
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '60px' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>FBA总库存/货值</Text>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#333', lineHeight: 1.2 }}>
                  {currentMetrics.fbaTotalStock} / ¥{currentMetrics.fbaStockValue.toLocaleString()}
                </div>
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>FBA仓库总库存</Text>
              </div>
            </div>
          </Card>
          {hoveredKpi === 'fbaTotalStock' && renderKpiDetail('fbaTotalStock')}
        </div>
      </div>

      {/* --- 中部区域：趋势分析和商品销量 */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
        {/* 左侧：趋势图表 */}
        <div style={{ flex: 1.4 }}>
          <Card title="📈 趋势分析" bordered={false} style={{ height: '100%' }}>
            <div style={{ marginBottom: '24px' }}>
              <Title level={5} style={{ marginBottom: '16px' }}>订单量趋势 (最近14天)</Title>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ordersTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <RechartsTooltip />
                  <Legend />
                  {selectedStoreIds.map((storeId, index) => {
                    const storeName = STORES.find(s => s.id === storeId)?.name || '';
                    return (
                      <Bar 
                        key={storeId}
                        dataKey={storeName} 
                        fill={CHART_COLORS[index % CHART_COLORS.length]} 
                        name={storeName}
                        barSize={20}
                      />
                    );
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Divider />
            <div>
              <Title level={5} style={{ marginBottom: '16px' }}>广告占比趋势 (最近7天)</Title>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={adRatioTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <RechartsTooltip formatter={(value, name) => [`${value}%`, name]} />
                  <Legend />
                  {selectedStoreIds.map((storeId, index) => {
                    const storeName = STORES.find(s => s.id === storeId)?.name || '';
                    return (
                      <Line 
                        key={storeId}
                        type="monotone" 
                        dataKey={storeName} 
                        stroke={CHART_COLORS[index % CHART_COLORS.length]} 
                        strokeWidth={2} 
                        dot={{ r: 4 }} 
                        activeDot={{ r: 6 }} 
                        name={storeName}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* 右侧：实时预警消息列表 */}
        <div style={{ flex: 1 }}>
          <Card 
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span>⚠️ 实时预警</span>
                <Button 
                  size="small" 
                  type="dashed"
                  onClick={() => setShowThresholdModal(true)}
                >
                  阈值设置
                </Button>
              </div>
            } 
            bordered={false} 
            style={{ height: '100%' }}
          >
            <List
              dataSource={aggregateAlerts}
              pagination={{ 
                pageSize: 5,
                showTotal: (total) => `共 ${total} 条`,
                size: 'small',
                showSizeChanger: false
              }}
              renderItem={(item) => (
                <List.Item>
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <Space>
                        <Tag color={item.severity === 'red' ? 'error' : item.severity === 'orange' ? 'warning' : 'processing'}>
                          {item.severity === 'red' ? '严重' : item.severity === 'orange' ? '警告' : '关注'}
                        </Tag>
                        <Text strong>
                          {item.storeName ? `${item.storeName} - ${item.metricName}` : item.metricName}
                        </Text>
                      </Space>
                      <Text type="secondary" style={{ fontSize: '12px' }}>{item.time}</Text>
                    </div>
                    <div style={{ marginBottom: '4px' }}>
                      <Text>当前值: </Text>
                      <Text strong>{item.currentValue}</Text>
                      <Text type="secondary" style={{ marginLeft: '8px' }}>阈值: {item.threshold}</Text>
                    </div>
                    <div style={{ backgroundColor: '#f5f5f5', padding: '8px', borderRadius: '4px', marginTop: '8px' }}>
                      <Text type="secondary">💡 建议: {item.suggestion}</Text>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </div>
      </div>

      {/* --- 店铺日期查询 */}
      <Card 
        title={
          <div 
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              cursor: 'pointer'
            }}
            onClick={() => setDateQueryExpanded(!dateQueryExpanded)}
          >
            <span>📅 店铺日期查询</span>
            <span style={{ color: '#1890ff' }}>
              {dateQueryExpanded ? '收起 ▲' : '展开 ▼'}
            </span>
          </div>
        }
        bordered={false} 
        style={{ marginBottom: '24px' }}
      >
        <div style={{ marginBottom: '16px' }}>
          <Space wrap size="middle">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 500 }}>日期范围: </span>
              <DatePicker.RangePicker 
                value={dateRange} 
                onChange={setDateRange} 
                style={{ width: 300 }} 
                allowClear
                disabledDate={(current) => {
                  if (!dateRange || !dateRange[0]) {
                    return current && current > dayjs().endOf('day');
                  }
                  const diffDays = current.diff(dateRange[0], 'day');
                  return diffDays > 92 || (current && current > dayjs().endOf('day'));
                }}
              />
            </div>
            {selectedStoreIds.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 500 }}>只显示:</span>
                <Select
                  mode="multiple"
                  value={selectedDisplayStoreIds}
                  onChange={setSelectedDisplayStoreIds}
                  style={{ minWidth: 250 }}
                  placeholder="全部店铺"
                  allowClear
                  maxTagCount="responsive"
                  maxTagPlaceholder={() => `已选${selectedDisplayStoreIds.length}个店铺`}
                >
                  {selectedStoreIds.map(storeId => {
                    const store = STORES.find(s => s.id === storeId);
                    return (
                      <Option key={storeId} value={storeId}>
                        {store?.name || storeId}
                      </Option>
                    );
                  })}
                </Select>
              </div>
            )}
            <Button 
              type="primary" 
              icon={<SearchOutlined />} 
              onClick={handleDateQuery}
              loading={dateQueryLoading}
            >
              查询
            </Button>
          </Space>
        </div>
        {dateQueryExpanded && (
          <>
            <Divider />
            {dateQueryResults.length > 0 ? (
              <Table
                columns={[
                  { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
                  { title: '店铺', dataIndex: 'storeName', key: 'storeName', width: 150 },
                  { title: '订单量', dataIndex: 'orders', key: 'orders', width: 100 },
                  { title: 'GMV', dataIndex: 'gmv', key: 'gmv', width: 150, render: (val: number) => `¥${val.toLocaleString()}` },
                  { title: '广告占比', dataIndex: 'adRatio', key: 'adRatio', width: 120, render: (val: number) => `${val}%` },
                  { title: '毛利润', dataIndex: 'grossProfit', key: 'grossProfit', width: 150, render: (val: number) => `¥${val.toLocaleString()}` },
                  { title: '毛利率', dataIndex: 'grossMargin', key: 'grossMargin', width: 120, render: (val: number) => `${val}%` },
                ]}
                dataSource={dateQueryResults}
                rowKey={(record) => `${record.date}-${record.storeId}`}
                pagination={{ 
                  current: dateQueryCurrentPage,
                  pageSize: dateQueryPageSize,
                  total: dateQueryResults.length,
                  showTotal: (total) => `共 ${total} 条`,
                  showSizeChanger: true,
                  pageSizeOptions: ['5', '10', '20', '50'],
                  onChange: (page, pageSize) => {
                    setDateQueryCurrentPage(page);
                    if (pageSize !== dateQueryPageSize) {
                      setDateQueryPageSize(pageSize);
                      setDateQueryCurrentPage(1); // 改变每页条数时重置到第一页
                    }
                  }
                }}
                size="middle"
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                请选择日期范围并点击查询按钮
              </div>
            )}
          </>
        )}
      </Card>



      {/* --- 第一行：数据对比和TOP10并排显示 */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {/* --- 对比表格 */}
        <Card 
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span>📊 数据对比</span>
                <span style={{ color: '#999', fontSize: '12px' }}>基数对比:</span>
                <Input 
                  placeholder="GMV基数" 
                  value={gmvBase}
                  onChange={(e) => setGmvBase(e.target.value)}
                  style={{ width: 120 }}
                  prefix="¥"
                />
                <Input 
                  placeholder="广告占比基数" 
                  value={adRatioBase}
                  onChange={(e) => setAdRatioBase(e.target.value)}
                  style={{ width: 120 }}
                  suffix="%"
                />
                <Input 
                  placeholder="仓储占比基数" 
                  value={storageRatioBase}
                  onChange={(e) => setStorageRatioBase(e.target.value)}
                  style={{ width: 120 }}
                  suffix="%"
                />
              </div>
              <Select
                value={compareMode}
                onChange={setCompareMode}
                style={{ width: 150 }}
              >
                <Option value="store">店铺对比</Option>
                <Option value="date">日期对比</Option>
              </Select>
            </div>
          }
          bordered={false}
          style={{ flex: 1.5, minWidth: '500px', display: 'flex', flexDirection: 'column' }}
        >
        {compareMode === 'store' ? (
          <Table
            columns={[
              { title: '店铺', dataIndex: 'name', key: 'name', width: 150 },
              { title: '订单量', dataIndex: 'orders', key: 'orders', width: 120 },
              { title: 'GMV', dataIndex: 'gmv', key: 'gmv', width: 150,
                render: (val: number) => {
                  const parsedGmvBase = gmvBase && gmvBase.trim() !== '' ? parseFloat(gmvBase) : null;
                  const enableGmvTrend = parsedGmvBase !== null && !isNaN(parsedGmvBase);
                  if (!enableGmvTrend) {
                    return <span>¥{val.toLocaleString()}</span>;
                  }
                  let trend = '';
                  let color = 'inherit';
                  if (val > parsedGmvBase!) {
                    trend = '↑';
                    color = '#52c41a';
                  } else if (val < parsedGmvBase!) {
                    trend = '↓';
                    color = '#ff4d4f';
                  }
                  return <span style={{ color }}>¥{val.toLocaleString()} {trend}</span>;
                }
              },
              { title: '广告占比', dataIndex: 'adRatio', key: 'adRatio', width: 120,
                render: (val: number) => {
                  const parsedAdRatioBase = adRatioBase && adRatioBase.trim() !== '' ? parseFloat(adRatioBase) : null;
                  const enableAdRatioTrend = parsedAdRatioBase !== null && !isNaN(parsedAdRatioBase);
                  if (!enableAdRatioTrend) {
                    return <span>{val}%</span>;
                  }
                  let trend = '';
                  let color = 'inherit';
                  if (val > parsedAdRatioBase!) {
                    trend = '↑';
                    color = '#ff4d4f';
                  } else if (val < parsedAdRatioBase!) {
                    trend = '↓';
                    color = '#52c41a';
                  }
                  return <span style={{ color }}>{val}% {trend}</span>;
                }
              },
            ]}
            dataSource={
              dateQueryResults.length > displayStoreIds.length 
                ? displayStores.map(store => {
                    const aggregated = storeAggregatedData[store.id];
                    return {
                      ...store,
                      orders: aggregated ? aggregated.avgOrders : 0,
                      gmv: aggregated ? aggregated.avgGmv : 0,
                      adRatio: aggregated ? aggregated.avgAdRatio : 0,
                    };
                  })
                : displayStores.map(store => {
                    const data = storesData[store.id];
                    return {
                      ...store,
                      orders: data?.currentMetrics.orders || 0,
                      gmv: data?.currentMetrics.gmv || 0,
                      adRatio: data?.currentMetrics.adRatio || 0,
                    };
                  })
            }
            rowKey="id"
            pagination={{ pageSize: 10, showSizeChanger: false }}
          />
        ) : (
          <Table
            columns={[
              { title: '店铺', dataIndex: 'storeName', key: 'storeName', width: 120 },
              { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
              { title: '订单量', dataIndex: 'orders', key: 'orders', width: 120 },
              { title: 'GMV', dataIndex: 'gmv', key: 'gmv', width: 150,
                render: (val: number) => {
                  const parsedGmvBase = gmvBase && gmvBase.trim() !== '' ? parseFloat(gmvBase) : null;
                  const enableGmvTrend = parsedGmvBase !== null && !isNaN(parsedGmvBase);
                  if (!enableGmvTrend) {
                    return <span>¥{val.toLocaleString()}</span>;
                  }
                  let trend = '';
                  let color = 'inherit';
                  if (val > parsedGmvBase!) {
                    trend = '↑';
                    color = '#52c41a';
                  } else if (val < parsedGmvBase!) {
                    trend = '↓';
                    color = '#ff4d4f';
                  }
                  return <span style={{ color }}>¥{val.toLocaleString()} {trend}</span>;
                }
              },
              { title: '广告占比', dataIndex: 'adRatio', key: 'adRatio', width: 120,
                render: (val: number) => {
                  const parsedAdRatioBase = adRatioBase && adRatioBase.trim() !== '' ? parseFloat(adRatioBase) : null;
                  const enableAdRatioTrend = parsedAdRatioBase !== null && !isNaN(parsedAdRatioBase);
                  if (!enableAdRatioTrend) {
                    return <span>{val}%</span>;
                  }
                  let trend = '';
                  let color = 'inherit';
                  if (val > parsedAdRatioBase!) {
                    trend = '↑';
                    color = '#ff4d4f';
                  } else if (val < parsedAdRatioBase!) {
                    trend = '↓';
                    color = '#52c41a';
                  }
                  return <span style={{ color }}>{val}% {trend}</span>;
                }
              },
              { title: '毛利润', dataIndex: 'grossProfit', key: 'grossProfit', width: 150, render: (val: number) => `¥${val.toLocaleString()}` },
              { title: '仓储占比', dataIndex: 'storageRatio', key: 'storageRatio', width: 120,
                render: (val: number) => {
                  const parsedStorageRatioBase = storageRatioBase && storageRatioBase.trim() !== '' ? parseFloat(storageRatioBase) : null;
                  const enableStorageRatioTrend = parsedStorageRatioBase !== null && !isNaN(parsedStorageRatioBase);
                  if (!enableStorageRatioTrend) {
                    return <span>{val.toFixed(2)}%</span>;
                  }
                  let trend = '';
                  let color = 'inherit';
                  if (val > parsedStorageRatioBase!) {
                    trend = '↑';
                    color = '#ff4d4f';
                  } else if (val < parsedStorageRatioBase!) {
                    trend = '↓';
                    color = '#52c41a';
                  }
                  return <span style={{ color }}>{val.toFixed(2)}% {trend}</span>;
                }
              },
            ]}
            dataSource={dateQueryResults.map((record, index) => ({
              ...record,
              isNewStore: index > 0 && record.storeId !== dateQueryResults[index - 1].storeId,
            }))}
            rowKey={(record: any) => `${record.date}-${record.storeId}`}
            rowStyle={(record: any) => record.isNewStore ? styles.newStoreRow : {}}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            size="small"
          />
        )}
      </Card>

        {/* --- 商品销量TOP10 */}
        <Card
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span>🏆 商品销量TOP10</span>
              <Button 
                type="primary" 
                size="small"
                onClick={handleOpenSkuModal}
              >
                查看详情
              </Button>
            </div>
          }
          bordered={false}
          style={{ flex: 0.8, minWidth: '350px', display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ padding: '4px 0' }}>
              {skuSalesData.map((record, index) => {
                const rank = index + 1;
                const maxSales = skuSalesData[0]?.totalSales || 1;
                const percentage = (record.totalSales / maxSales) * 100;
                
                const getRankStyle = () => {
                  const alpha = 1 - (rank - 1) * 0.09;
                  const rankColor = `rgba(24, 144, 255, ${alpha})`;
                  const borderColor = `rgba(24, 144, 255, ${alpha * 0.6})`;
                  const bgColor = `rgba(24, 144, 255, ${alpha * 0.08})`;
                  const rankBg = `linear-gradient(135deg, rgba(24, 144, 255, ${alpha}) 0%, rgba(59, 173, 255, ${alpha}) 100%)`;
                  
                  return {
                    backgroundColor: bgColor,
                    borderColor: borderColor,
                    rankColor: rankColor,
                    rankBg: rankBg,
                  };
                };
                
                const style = getRankStyle();
                
                return (
                  <div 
                    key={record.sku}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '6px 8px',
                      marginBottom: '3px',
                      backgroundColor: style.backgroundColor,
                      borderLeft: `3px solid ${style.borderColor}`,
                      borderRadius: '4px',
                    }}
                  >
                    <div 
                      style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        background: style.rankBg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: '8px',
                        fontWeight: 'bold',
                        color: rank <= 3 ? '#fff' : '#666',
                        fontSize: '11px',
                        flexShrink: 0,
                      }}
                    >
                      {rank}
                    </div>
                    
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '500', fontSize: '12px', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {record.sku}
                      </div>
                      <div style={{ 
                        height: '4px', 
                        backgroundColor: '#f0f0f0', 
                        borderRadius: '2px',
                        overflow: 'hidden',
                      }}>
                        <div 
                          style={{
                            height: '100%',
                            width: `${percentage}%`,
                            backgroundColor: style.rankColor,
                            borderRadius: '2px',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>
                    
                    <Tooltip 
                      placement="top"
                      overlayInnerStyle={{ 
                        backgroundColor: '#ffffff',
                        color: '#333333',
                      }}
                      overlayStyle={{ 
                        borderRadius: '6px', 
                        padding: '0',
                        backgroundColor: '#ffffff',
                        border: '1px solid #d9d9d9',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      }}
                      title={
                        <div style={{ color: '#333', padding: '8px 12px' }}>
                          {record.stores.map((store) => (
                            <div key={store.storeId} style={{ padding: '2px 0', fontSize: '13px', color: '#333' }}>
                              <span style={{ color: '#333' }}>{store.storeName}:</span>
                              <span style={{ fontWeight: 'bold', marginLeft: '8px', color: '#333' }}>{store.sales}</span>
                            </div>
                          ))}
                        </div>
                      }
                    >
                      <div style={{ textAlign: 'right', marginLeft: '8px', flexShrink: 0 }}>
                        <div style={{ fontWeight: 'bold', fontSize: '13px', color: style.rankColor }}>
                          {record.totalSales}
                        </div>
                        <div style={{ fontSize: '9px', color: '#999' }}>
                          {record.stores.length}个店铺
                        </div>
                      </div>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      {/* --- 第二行：SKU销量波动趋势（独立板块） */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>📈 SKU销量波动趋势</span>
            <Space size="small">
              <Button 
                size="small" 
                type={trendDateMode === 'recent7Days' && selectedSkusForTrend.length === 0 ? 'primary' : 'default'}
                onClick={async () => {
                  setTrendDateMode('recent7Days');
                  setSelectedSkusForTrend([]);
                  
                  if (selectedStoreIds.length > 0) {
                    const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
                    const storeNames = selectedStores.map(s => s.name);
                    const yesterday = dayjs().subtract(1, 'day');
                    const startDate = yesterday.clone().subtract(6, 'day').format('YYYY-MM-DD');
                    const endDate = yesterday.format('YYYY-MM-DD');
                    
                    const topSkus = await fetchTopSkus(storeNames, startDate, endDate, 10);
                    const topSkuList = topSkus.map(s => s.sku);
                    const dailySales = await fetchSkuDailySales(storeNames, topSkuList, startDate, endDate);
                    
                    const skuMap = new Map<string, SkuSalesRecord>();
                    topSkus.forEach(record => {
                      const sku = record.sku;
                      const storeName = record.store;
                      if (!skuMap.has(sku)) {
                        skuMap.set(sku, {
                          sku,
                          totalSales: 0,
                          stores: [],
                        });
                      }
                      const skuRecord = skuMap.get(sku)!;
                      skuRecord.totalSales += record.total_sales;
                      
                      const existingStore = skuRecord.stores.find(s => s.storeName === storeName);
                      if (existingStore) {
                        existingStore.sales += record.total_sales;
                      } else {
                        skuRecord.stores.push({
                          storeId: '',
                          storeName: storeName,
                          date: endDate,
                          sales: record.total_sales,
                        });
                      }
                    });
                    
                    const result = Array.from(skuMap.values()).sort((a, b) => b.totalSales - a.totalSales);
                    setProductSalesData(result);
                    setSkuDailySalesData(dailySales);
                  }
                }}
              >
                近七天top10商品波动
              </Button>
              <Button 
                size="small" 
                type={trendDateMode === 'dateRange' ? 'primary' : 'default'}
                onClick={() => setTrendDateMode('dateRange')}
              >
                按筛选日期
              </Button>
              <Button 
                size="small" 
                type="dashed"
                onClick={async () => {
                  const data = await fetchAllSkuSalesData();
                  setAllSkuSalesData(data);
                  setShowAddSkuModal(true);
                }}
              >
                + 添加SKU
              </Button>
            </Space>
          </div>
        }
        bordered={false}
      >
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={skuTrendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" fontSize={10} />
            <YAxis fontSize={10} />
            <RechartsTooltip />
            <Legend />
            {(() => {
              const skusToShow = selectedSkusForTrend.length > 0 
                ? selectedSkusForTrend 
                : skuSalesData.slice(0, 10).map(s => s.sku);
              const colors = ['#1890ff', '#52c41a', '#faad14', '#ff4d4f', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16', '#a0d911', '#531dab'];
              return skusToShow.map((sku, index) => (
                <Line
                  key={sku}
                  type="monotone"
                  dataKey={sku}
                  name={sku}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              ));
            })()}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* --- 阈值设置弹窗 */}
      <Modal
        title="预警阈值设置"
        visible={showThresholdModal}
        onCancel={() => {
          setShowThresholdModal(false);
          setEditingStoreId(null);
        }}
        footer={null}
        width={600}
      >
        {selectedStoreIds.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            请先在上方筛选店铺
          </div>
        ) : editingStoreId ? (
          <div>
            <div style={{ marginBottom: '20px', fontWeight: 'bold' }}>
              修改 {STORES.find(s => s.id === editingStoreId)?.name || editingStoreId} 的阈值
            </div>
            <Form
              layout="vertical"
              initialValues={editFormValues}
              onFinish={async (values) => {
                const store = STORES.find(s => s.id === editingStoreId);
                const storeName = store?.name || editingStoreId;
                
                const newThresholds = {
                  adRatio: values.adRatio !== undefined ? values.adRatio : 25,
                  storageRatio: values.storageRatio !== undefined ? values.storageRatio : 10,
                  acos: values.acos !== undefined ? values.acos : 30,
                };
                
                await saveThresholdSetting(storeName, newThresholds);
                
                setThresholds(prev => ({
                  ...prev,
                  [storeName]: newThresholds,
                }));
                
                setEditingStoreId(null);
                message.success('阈值设置已保存');
              }}
            >
              <Form.Item
                name="adRatio"
                label="广告占比阈值 (%)"
                rules={[{ required: true, message: '请输入广告占比阈值' }]}
              >
                <InputNumber 
                  min={0} 
                  max={100} 
                  step={1} 
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item
                name="storageRatio"
                label="仓储占比阈值 (%)"
                rules={[{ required: true, message: '请输入仓储占比阈值' }]}
              >
                <InputNumber 
                  min={0} 
                  max={100} 
                  step={0.5} 
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item
                name="acos"
                label="ACOS阈值 (%)"
                rules={[{ required: true, message: '请输入ACOS阈值' }]}
              >
                <InputNumber 
                  min={0} 
                  max={200} 
                  step={1} 
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <div style={{ marginTop: '20px', textAlign: 'right' }}>
                <Button 
                  onClick={() => setEditingStoreId(null)}
                  style={{ marginRight: '8px' }}
                >
                  取消
                </Button>
                <Button type="primary" htmlType="submit">
                  保存
                </Button>
              </div>
            </Form>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '16px', fontSize: '14px', color: '#666' }}>
              以下为各店铺当前阈值设置，点击"修改"按钮可编辑
            </div>
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {selectedStoreIds.map(storeId => {
                const store = STORES.find(s => s.id === storeId);
                if (!store) return null;
                const storeThresholds = getThresholdsForStore(storeId);
                return (
                  <div 
                    key={store.id}
                    style={{ 
                      padding: '12px 16px', 
                      border: '1px solid #e8e8e8', 
                      borderRadius: '6px', 
                      marginBottom: '12px',
                      background: '#fafafa'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{store.name}</span>
                      <Button 
                        type="link" 
                        size="small"
                        onClick={() => {
                          setEditFormValues({
                            adRatio: storeThresholds.adRatio,
                            storageRatio: storeThresholds.storageRatio,
                            acos: storeThresholds.acos,
                          });
                          setEditingStoreId(store.id);
                        }}
                      >
                        修改
                      </Button>
                    </div>
                    <div style={{ display: 'flex', gap: '24px', fontSize: '13px' }}>
                      <div>
                        <span style={{ color: '#999' }}>广告占比阈值：</span>
                        <span style={{ color: '#333', fontWeight: '500' }}>{storeThresholds.adRatio}%</span>
                      </div>
                      <div>
                        <span style={{ color: '#999' }}>仓储占比阈值：</span>
                        <span style={{ color: '#333', fontWeight: '500' }}>{storeThresholds.storageRatio}%</span>
                      </div>
                      <div>
                        <span style={{ color: '#999' }}>ACOS阈值：</span>
                        <span style={{ color: '#333', fontWeight: '500' }}>{storeThresholds.acos}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>

      {/* --- 添加SKU弹窗 */}
      <Modal
        title="添加SKU到趋势分析"
        visible={showAddSkuModal}
        onCancel={() => {
          setShowAddSkuModal(false);
          setAddSkuSearchValue('');
        }}
        footer={null}
        width={600}
      >
        <div style={{ marginBottom: '16px' }}>
          <Input
            placeholder="搜索SKU"
            prefix={<SearchOutlined />}
            value={addSkuSearchValue}
            onChange={(e) => setAddSkuSearchValue(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        
        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
          <Table
            dataSource={allSkuSalesData.filter(s => s.sku.toLowerCase().includes(addSkuSearchValue.toLowerCase()))}
            rowKey="sku"
            pagination={false}
            size="small"
            bordered
            rowSelection={{
              type: 'checkbox',
              selectedRowKeys: selectedSkusForTrend,
              onChange: (keys: string[]) => setSelectedSkusForTrend(keys),
            }}
            columns={[
              {
                title: 'SKU',
                dataIndex: 'sku',
                key: 'sku',
                width: 250,
                render: (text: string) => <span style={{ fontWeight: '500' }}>{text}</span>,
              },
              {
                title: '总销量',
                dataIndex: 'totalSales',
                key: 'totalSales',
                width: 100,
                align: 'right',
                render: (text: number) => <span style={{ color: '#1890ff' }}>{text}</span>,
              },
              {
                title: '店铺数量',
                dataIndex: 'stores',
                key: 'stores',
                width: 100,
                align: 'center',
                render: (stores: any[]) => <span>{stores.length}</span>,
              },
            ]}
          />
        </div>
        
        {selectedSkusForTrend.length > 0 && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f0f0f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: '500' }}>已选择的SKU ({selectedSkusForTrend.length}个)</span>
              <Button 
                type="link" 
                size="small"
                onClick={() => setSelectedSkusForTrend([])}
              >
                重置
              </Button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {selectedSkusForTrend.map(sku => (
                <Tag 
                  key={sku}
                  color="blue"
                  closable
                  onClose={() => setSelectedSkusForTrend(prev => prev.filter(s => s !== sku))}
                >
                  {sku}
                </Tag>
              ))}
            </div>
          </div>
        )}
        
        <div style={{ marginTop: '16px', textAlign: 'right' }}>
          <Button 
            onClick={async () => {
              setShowAddSkuModal(false);
              setAddSkuSearchValue('');
              
              if (selectedSkusForTrend.length > 0) {
                const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
                const storeNames = selectedStores.map(s => s.name);
                const [startDate, endDate] = dateRange && dateRange[0] && dateRange[1] 
                  ? [dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD')]
                  : [dayjs().subtract(7, 'day').format('YYYY-MM-DD'), dayjs().subtract(1, 'day').format('YYYY-MM-DD')];
                
                const dailySales = await fetchSkuDailySales(storeNames, selectedSkusForTrend, startDate, endDate);
                setSkuDailySalesData(dailySales);
              }
            }}
          >
            确定
          </Button>
        </div>
      </Modal>

      {/* --- 商品销量详情弹窗 */}
      <Modal
        title="📦 商品销量详情"
        visible={showSkuModal}
        onCancel={() => {
          setShowSkuModal(false);
          setSkuSearchValue('');
        }}
        footer={null}
        width={800}
      >
        <div style={{ marginBottom: '16px' }}>
          <Input
            placeholder="搜索SKU"
            prefix={<SearchOutlined />}
            value={skuSearchValue}
            onChange={(e) => setSkuSearchValue(e.target.value)}
            style={{ width: 250 }}
          />
        </div>
        <Table
          columns={[
            { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 180 },
            { title: '销量', dataIndex: 'totalSales', key: 'totalSales', width: 100 },
            { title: '店铺', key: 'stores', width: 250,
              render: (_: any, record: any) => (
                <span>{[...new Set(record.stores.map((s: any) => s.storeName))].join('、')}</span>
              )
            },
          ]}
          dataSource={allSkuSalesData
            .filter(record => record.sku.toLowerCase().includes(skuSearchValue.toLowerCase()))
            .map(record => ({
              sku: record.sku,
              totalSales: record.totalSales,
              stores: record.stores,
            }))}
          rowKey={(record) => record.sku}
          pagination={{ pageSize: 15 }}
          size="small"
          expandable={{
            expandedRowRender: (record: any) => (
              <Table
                columns={[
                  { title: '店铺', dataIndex: 'storeName', key: 'storeName', width: 180 },
                  { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
                  { title: '销量', dataIndex: 'sales', key: 'sales', width: 100 },
                ]}
                dataSource={record.stores}
                rowKey={(store: any) => `${store.storeId}-${store.date}`}
                pagination={false}
                size="small"
                style={{ margin: '16px 0 0 48px' }}
              />
            ),
            rowExpandable: () => true,
          }}
        />
      </Modal>

    </div>
  );
};

export default DataAlertBot;
