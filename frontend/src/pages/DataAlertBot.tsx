import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Button, List, Typography, Space, Divider, Tag, message, Select, Table, DatePicker, Input, Modal, Tooltip, Form, InputNumber } from 'antd';
import { SearchOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';
import { AlertTriangle, RefreshCw, CheckCircle, XCircle, Store, Filter } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, ZAxis, ReferenceLine, ComposedChart } from 'recharts';
import dayjs, { Dayjs } from 'dayjs';
import apiClient from '../api';
import { useAuth } from '../contexts/AuthContext';

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

interface MyStore {
  id: number;
  shop_abbr: string;
  name: string;
  site: string;
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
  ad_spend: number;
  sales_amount: number;
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

interface SkuAnomalyRecord {
  sku: string;
  store: string;
  latestSales: number;
  avgSales: number;
  maxSales: number;
  minSales: number;
  fluctuation: number;
  latestDirection: 'up' | 'down' | 'flat';
  overallDirection: 'up' | 'down' | 'flat';
  isMonitored: boolean;
  isAnomaly: boolean;
  daily: { date: string; sales: number; prevSales: number | null; changeRate: number | null; direction: 'up' | 'down' | 'flat' | null; isAnomaly: boolean }[];
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

const fetchThresholdSettings = async (): Promise<Record<string, { adRatio: number; storageRatio: number; acos: number; overallTrend: number; latestTrend: number }>> => {
  try {
    const response = await apiClient.get('/threshold-settings/stores');
    if (response.data.success) {
      const data: Record<string, { ad_ratio_threshold: number; storage_ratio_threshold: number; acos_threshold: number; overall_trend_threshold: number; latest_trend_threshold: number }> = response.data.data;
      const thresholds: Record<string, { adRatio: number; storageRatio: number; acos: number; overallTrend: number; latestTrend: number }> = {};
      for (const [store, settings] of Object.entries(data)) {
        thresholds[store] = {
          adRatio: settings.ad_ratio_threshold,
          storageRatio: settings.storage_ratio_threshold,
          acos: settings.acos_threshold,
          overallTrend: settings.overall_trend_threshold,
          latestTrend: settings.latest_trend_threshold,
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
  thresholds: { adRatio: number; storageRatio: number; acos: number; overallTrend: number; latestTrend: number }
): Promise<boolean> => {
  try {
    const response = await apiClient.post('/threshold-settings/', null, {
      params: {
        store,
        ad_ratio_threshold: thresholds.adRatio,
        storage_ratio_threshold: thresholds.storageRatio,
        acos_threshold: thresholds.acos,
        overall_trend_threshold: thresholds.overallTrend,
        latest_trend_threshold: thresholds.latestTrend,
      },
    });
    return response.data.success;
  } catch (error) {
    console.error('保存阈值设置失败:', error);
    return false;
  }
};

const DataAlertBot: React.FC = () => {
  // --- 获取用户信息，判断是否使用测试数据
  const { user } = useAuth();
  const isTestMode = user?.tenant_id === 6;

  // --- 状态管理
  const [selectedRegion, setSelectedRegion] = useState<string>('全部');
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [storesData, setStoresData] = useState<Record<string, StoreData>>({});
  // 缓存原始 data_warnings 记录（广告图表用，避免重复请求）
  const [adWarnings, setAdWarnings] = useState<DataWarningRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>(dayjs().format('YYYY-MM-DD HH:mm:ss'));
  const [myStores, setMyStores] = useState<MyStore[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  // --- 商品销量数据状态
  const [productSalesData, setProductSalesData] = useState<SkuSalesRecord[]>([]);
  const [skuDailySalesData, setSkuDailySalesData] = useState<SkuDailySalesRecord[]>([]);
  const [skuAnomalyRealData, setSkuAnomalyRealData] = useState<SkuAnomalyRecord[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({ up: true, down: true, flat: true });
  const [productAgingData, setProductAgingData] = useState<{ store: string; sku: string; aging_181_270: number; aging_271_365: number; aging_366_455: number; aging_456_plus: number }[]>([]);
  const [productAgingLatestDate, setProductAgingLatestDate] = useState<string | null>(null);
  const [productAgingDrillBucket, setProductAgingDrillBucket] = useState<string | null>(null);
  const [productAgingExpanded, setProductAgingExpanded] = useState<boolean>(false);
  
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

  // --- SKU销量异动检测：从真实数据计算
  const skuAnomalyTestData = useMemo(() => {
    return skuAnomalyRealData;
  }, [skuAnomalyRealData]);

  // --- 店铺列表（前置到此处，供后续 adRatioKpis / adRatioDailyChartData 等 useMemo 引用）
  const STORES = useMemo(() => {
    return myStores.map(s => ({
      id: s.id.toString(),
      name: s.shop_abbr,
      region: s.site || '',
    }));
  }, [myStores]);

  // --- 阈值设置相关状态
  const [thresholds, setThresholds] = useState<Record<string, { adRatio: number; storageRatio: number; acos: number; overallTrend: number; latestTrend: number }>>({});
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editFormValues, setEditFormValues] = useState<{ adRatio: number; storageRatio: number; acos: number; overallTrend: number; latestTrend: number }>({
    adRatio: 25,
    storageRatio: 10,
    acos: 30,
    overallTrend: 15,
    latestTrend: 20,
  });

  const [showSkuAnomalyThresholdModal, setShowSkuAnomalyThresholdModal] = useState(false);
  const [editingSkuStoreId, setEditingSkuStoreId] = useState<string | null>(null);
  const [skuEditFormValues, setSkuEditFormValues] = useState<{ overallTrend: number; latestTrend: number }>({
    overallTrend: 15,
    latestTrend: 20,
  });

  // --- 广告占比周监控：KPI（从真实 data_warnings 聚合，多店铺取最低 adRatio 阈值）
  const adRatioKpis = useMemo(() => {
    const selectedNames = STORES.filter(s => selectedStoreIds.includes(s.id)).map(s => s.name);
    const TH = selectedNames.length > 0
      ? Math.min(...selectedNames.map(n => thresholds[n]?.adRatio ?? 15))
      : 15;
    if (selectedNames.length === 0) return { sumRatio: 0, totalAd: 0, totalSales: 0, overDays: 0, weekChange: null, TH };
    const yesterday = dayjs().subtract(1, 'day');
    const dates: string[] = [];
    for (let i = 13; i >= 0; i--) dates.push(yesterday.clone().subtract(i, 'day').format('YYYY-MM-DD'));
    const byDate = new Map<string, { ad: number; sales: number }>();
    dates.forEach(d => byDate.set(d, { ad: 0, sales: 0 }));
    adWarnings.forEach(w => {
      if (!selectedNames.includes(w.store)) return;
      const cur = byDate.get(w.date);
      if (cur) { cur.ad += w.ad_spend || 0; cur.sales += w.sales_amount || 0; }
    });
    const arr = dates.map(d => byDate.get(d)!);
    let totalAd = 0, totalSales = 0, overDays = 0;
    arr.forEach(({ ad, sales }) => {
      totalAd += ad; totalSales += sales;
      if (sales > 0 && ad / sales * 100 > TH) overDays++;
    });
    const cAd = arr.slice(7).reduce((a, b) => a + b.ad, 0);
    const cSa = arr.slice(7).reduce((a, b) => a + b.sales, 0);
    const pAd = arr.slice(0, 7).reduce((a, b) => a + b.ad, 0);
    const pSa = arr.slice(0, 7).reduce((a, b) => a + b.sales, 0);
    const cR = cSa > 0 ? cAd / cSa : 0;
    const pR = pSa > 0 ? pAd / pSa : 0;
    return {
      sumRatio: totalSales > 0 ? totalAd / totalSales * 100 : 0,
      totalAd: Math.round(totalAd),
      totalSales: Math.round(totalSales),
      overDays,
      weekChange: pR > 0 ? (cR - pR) / pR * 100 : null,
      TH,
    };
  }, [adWarnings, selectedStoreIds, STORES, thresholds]);

  // --- 广告占比周监控：图表数据（复用上面的 TH）
  const adRatioDailyChartData = useMemo(() => {
    const TH = adRatioKpis.TH;
    const selectedNames = STORES.filter(s => selectedStoreIds.includes(s.id)).map(s => s.name);
    const yesterday = dayjs().subtract(1, 'day');
    const daily: any[] = [];
    for (let i = 13; i >= 0; i--) {
      const date = yesterday.clone().subtract(i, 'day');
      const dateStr = date.format('YYYY-MM-DD');
      let ad = 0, sales = 0;
      if (selectedNames.length > 0) {
        adWarnings.forEach(w => {
          if (w.date === dateStr && selectedNames.includes(w.store)) {
            ad += w.ad_spend || 0;
            sales += w.sales_amount || 0;
          }
        });
      }
      const ratio = sales > 0 ? ad / sales * 100 : 0;
      daily.push({
        date: date.format('MM-DD'),
        adDate: dateStr,
        ad: Math.round(ad),
        sales: Math.round(sales),
        ratio: parseFloat(ratio.toFixed(2)),
        over: ratio > TH && sales > 0,
      });
    }
    return { daily, TH };
  }, [adWarnings, selectedStoreIds, STORES, thresholds]);

  // --- 广告占比周汇总对比（本周 / 上周 / 上上周）
  const adRatioWeeklySummary = useMemo(() => {
    const daily = adRatioDailyChartData.daily;
    const thisMonday = dayjs().subtract((dayjs().day() + 6) % 7, 'day');
    const weeks: { label: string; range: string; ad: number; sales: number; overDays: number; days: number }[] = [];
    for (let offset = 0; offset < 3; offset++) {
      const ws = thisMonday.subtract(offset * 7, 'day');
      const we = ws.add(6, 'day');
      const wDaily = daily.filter(d => {
        const dt = dayjs(d.adDate);
        return !dt.isBefore(ws) && !dt.isAfter(we);
      });
      let ad = 0, sales = 0, overDays = 0;
      wDaily.forEach(d => { ad += d.ad; sales += d.sales; if (d.over) overDays++; });
      weeks.push({
        label: offset === 0 ? '本周' : offset === 1 ? '上周' : '上上周',
        range: `${ws.format('MM-DD')} ~ ${we.format('MM-DD')}`,
        ad, sales, overDays, days: wDaily.length,
      });
    }
    return weeks.map((w, i) => {
      const ratio = w.sales > 0 ? w.ad / w.sales * 100 : 0;
      const prev = weeks[i + 1];
      const adChg = prev && prev.ad > 0 ? (w.ad - prev.ad) / prev.ad * 100 : null;
      const salesChg = prev && prev.sales > 0 ? (w.sales - prev.sales) / prev.sales * 100 : null;
      const ratioChg = prev && prev.sales > 0 ? ratio - (prev.sales > 0 ? prev.ad / prev.sales * 100 : 0) : null;
      let attribution = '';
      let attrLevel: 'good' | 'warn' | 'bad' | 'info' = 'info';
      if (i < weeks.length - 1) {
        const adUp = (adChg ?? 0) > 3, adDown = (adChg ?? 0) < -3;
        const salesUp = (salesChg ?? 0) > 3, salesDown = (salesChg ?? 0) < -3;
        const ratioUp = (ratioChg ?? 0) > 1, ratioDown = (ratioChg ?? 0) < -1;
        if (adUp && salesUp && ratioUp) { attribution = '花费增长快于销售，需优化效率'; attrLevel = 'warn'; }
        else if (adUp && salesDown && ratioUp) { attribution = '⚠️ 严重：花多卖少，紧急排查'; attrLevel = 'bad'; }
        else if (adDown && salesUp && ratioDown) { attribution = '✅ 优秀：花少卖多，复制策略'; attrLevel = 'good'; }
        else if (adDown && salesDown && Math.abs(ratioChg ?? 0) <= 1) { attribution = '销售下滑拖累占比，关注市场端'; attrLevel = 'info'; }
        else if (!prev || (prev.ad === 0 && prev.sales === 0)) { attribution = '首周数据，无环比'; attrLevel = 'info'; }
        else { attribution = '数据波动，建议持续观察'; attrLevel = 'info'; }
      } else { attribution = '--'; attrLevel = 'info'; }
      return {
        key: w.label, week: w.label, range: w.range,
        ratio: parseFloat(ratio.toFixed(2)), ad: Math.round(w.ad), sales: Math.round(w.sales),
        adChg: adChg == null ? null : parseFloat(adChg.toFixed(1)),
        salesChg: salesChg == null ? null : parseFloat(salesChg.toFixed(1)),
        overDays: w.overDays, attribution, attrLevel, _ratioRaw: ratio,
      };
    });
  }, [adRatioDailyChartData]);

  const getThresholdsForStore = (storeId: string) => {
    const store = STORES.find(s => s.id === storeId);
    const storeName = store?.name || storeId;
    return thresholds[storeName] || {
      adRatio: 25,
      storageRatio: 10,
      acos: 30,
      overallTrend: 15,
      latestTrend: 20,
    };
  };

  const getThresholdsForStoreOrNull = (storeId: string) => {
    const store = STORES.find(s => s.id === storeId);
    const storeName = store?.name || storeId;
    return thresholds[storeName] || null;
  };

  // SKU异动检测结果（按总体趋势分三组）
  const skuAnomalyGroups = useMemo(() => {
    const selectedStoreNames = STORES.filter(s => selectedStoreIds.includes(s.id)).map(s => s.name);
    const filtered = skuAnomalyTestData.filter(item => item.isMonitored && (selectedStoreNames.length === 0 || selectedStoreNames.includes(item.store)));
    const groups: Record<'up' | 'down' | 'flat', typeof filtered> = { up: [], down: [], flat: [] };
    filtered.forEach(item => groups[item.overallDirection].push(item));
    // 每组内按波动降序
    (Object.keys(groups) as Array<'up' | 'down' | 'flat'>).forEach(dir => {
      groups[dir].sort((a, b) => b.fluctuation - a.fluctuation);
    });
    return groups;
  }, [skuAnomalyTestData, selectedStoreIds, STORES]);

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
    if (selectedStoreIds.length === 0) {
      console.log('fetchAllSkuSalesData: 未选择店铺');
      return [];
    }

    try {
      const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);
      // 和 SKU TOP10 卡片保持同口径：近 7 天（强制，不跟随顶部 dateRange）
      const yesterday = dayjs().subtract(1, 'day');
      const startDate = yesterday.clone().subtract(6, 'day').format('YYYY-MM-DD');
      const endDate = yesterday.format('YYYY-MM-DD');

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
    avgOrderPrice: { name: '平均客单价', unit: '¥', format: (v: number) => v.toLocaleString() },
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
    const isAvgOrderPrice = kpiType === 'avgOrderPrice';
    const storeData = selectedStoreIds
      .filter(id => storesData[id])
      .map(id => {
        const store = storesData[id];
        const storeInfo = STORES.find(s => s.id === id);
        const metrics = store.currentMetrics;
        // avgOrderPrice 是派生指标，不是 MetricData 原生字段，要单独算
        const rawValue = isAvgOrderPrice
          ? (metrics.orders > 0 ? metrics.gmv / metrics.orders : 0)
          : (metrics[kpiType as keyof MetricData] as number);
        return {
          key: id,
          storeName: storeInfo?.name || id,
          value: Math.round(rawValue),
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

    // 如果是测试模式，使用测试数据
    if (isTestMode) {
      const yesterday = dayjs().subtract(1, 'day');
      const testStoreData: Record<string, StoreData> = {};

      selectedStoreIds.forEach(storeId => {
        const store = STORES.find(s => s.id === storeId);
        if (!store) return;

        // 生成随机测试数据
        const orders = Math.floor(Math.random() * 150) + 50;
        const gmv = Math.floor(Math.random() * 50000) + 10000;
        const adRatio = Math.floor(Math.random() * 20) + 15;
        const acos = Math.floor(Math.random() * 15) + 20;
        const fbaTotalStock = Math.floor(Math.random() * 2000) + 500;
        const fbaStockValue = fbaTotalStock * 17;
        const grossProfit = Math.floor(gmv * 0.3);
        const storageRatio = Math.floor(Math.random() * 10) + 5;
        const sales = gmv;
        const adSpend = Math.floor(gmv * adRatio / 100);
        const adSales = acos > 0 ? Math.floor(adSpend * 100 / acos) : 0;

        // 订单量趋势（近14天）
        const ordersTrend: { date: string; orders: number }[] = [];
        for (let i = 13; i >= 0; i--) {
          ordersTrend.push({
            date: yesterday.clone().subtract(i, 'day').format('MM-DD'),
            orders: Math.floor(Math.random() * 100) + 30
          });
        }

        // 广告占比趋势（近7天）
        const adRatioTrend: { date: string; adRatio: number }[] = [];
        for (let i = 6; i >= 0; i--) {
          adRatioTrend.push({
            date: yesterday.clone().subtract(i, 'day').format('MM-DD'),
            adRatio: Math.floor(Math.random() * 20) + 15
          });
        }

        // 生成预警
        const alerts: AlertItem[] = [];
        const storeThresholds = getThresholdsForStore(store.id);

        if (adRatio > storeThresholds.adRatio) {
          alerts.push({
            id: 1,
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
            id: 2,
            time: dayjs().subtract(Math.floor(Math.random() * 60), 'minute').format('HH:mm:ss'),
            metricName: 'ACOS',
            currentValue: acos + '%',
            threshold: '>' + storeThresholds.acos + '%',
            suggestion: '建议暂停高ACOS关键词',
            severity: acos > storeThresholds.acos * 1.1 ? 'red' : 'orange',
          });
        }

        testStoreData[store.id] = {
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
            fbaStockValue,
            grossProfit,
            storageRatio,
          },
          ordersTrend,
          adRatioTrend,
          alerts,
        };
      });

      setStoresData(testStoreData);

      // 生成测试 adWarnings（广告占比周监控模块用）
      const testWarnings: DataWarningRecord[] = [];
      selectedStoreIds.forEach(storeId => {
        const store = STORES.find(s => s.id === storeId);
        if (!store) return;
        for (let i = 13; i >= 0; i--) {
          const date = yesterday.clone().subtract(i, 'day').format('YYYY-MM-DD');
          const baseAd = Math.floor(Math.random() * 1200) + 300;   // 300~1500
          const baseSales = Math.floor(Math.random() * 6000) + 2000; // 2000~8000
          const ratio = parseFloat((baseAd / baseSales * 100).toFixed(4));
          testWarnings.push({
            date,
            store: store.name,
            gmv: baseSales,
            orders: Math.floor(baseSales / 80),
            ad_spend: baseAd,
            sales_amount: baseSales,
            ad_ratio: ratio,
          });
        }
      });
      setAdWarnings(testWarnings);

      setLastUpdated(dayjs().format('YYYY-MM-DD HH:mm:ss'));
      console.log('tenant_id=6，使用测试KPI数据');
      return;
    }

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

      // 缓存原始 warnings 供广告占比图表复用
      setAdWarnings(warnings);

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

        // 当前指标（取指定日期的数据，没数据就是0）
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
            fbaStockValue: fbaTotalStock * 17,
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
  }, [selectedStoreIds, STORES, isTestMode]);

  // --- 从后端API加载商品销量数据
  const loadProductSalesData = useCallback(async () => {
    if (selectedStoreIds.length === 0) {
      setProductSalesData([]);
      setSkuDailySalesData([]);
      return;
    }

    // 如果是测试模式，使用测试数据
    if (isTestMode) {
      const testSkus = [
        { sku: 'SKU-001', totalSales: 450, store: 'A加' },
        { sku: 'SKU-002', totalSales: 380, store: 'B美' },
        { sku: 'SKU-003', totalSales: 320, store: 'A欧' },
        { sku: 'SKU-004', totalSales: 290, store: 'B日' },
        { sku: 'SKU-005', totalSales: 250, store: 'A加' },
        { sku: 'SKU-006', totalSales: 220, store: 'B美' },
        { sku: 'SKU-007', totalSales: 190, store: 'A欧' },
        { sku: 'SKU-008', totalSales: 160, store: 'B日' },
        { sku: 'SKU-009', totalSales: 130, store: 'A加' },
        { sku: 'SKU-010', totalSales: 100, store: 'B美' },
      ];

      const skuMap = new Map<string, SkuSalesRecord>();
      testSkus.forEach(record => {
        if (!skuMap.has(record.sku)) {
          skuMap.set(record.sku, {
            sku: record.sku,
            totalSales: 0,
            stores: [],
          });
        }
        const skuRecord = skuMap.get(record.sku)!;
        skuRecord.totalSales += record.totalSales;
        skuRecord.stores.push({
          storeId: '',
          storeName: record.store,
          date: dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
          sales: record.totalSales,
        });
      });

      const result = Array.from(skuMap.values()).sort((a, b) => b.totalSales - a.totalSales);
      setProductSalesData(result);

      // 生成测试的每日销量数据（近7天）
      const dailySalesTestData: SkuDailySalesRecord[] = [];
      const skus = testSkus.map(s => s.sku);
      const yesterday = dayjs().subtract(1, 'day');
      for (let i = 6; i >= 0; i--) {
        const date = yesterday.clone().subtract(i, 'day').format('YYYY-MM-DD');
        skus.forEach(sku => {
          dailySalesTestData.push({
            date,
            sku,
            total_sales: Math.floor(Math.random() * 80) + 20,
          });
        });
      }
      setSkuDailySalesData(dailySalesTestData);
      console.log('tenant_id=6，使用测试商品销量数据');
      return;
    }

    try {
      const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);
      
      // SKU波动模块：**强制用近7天**（默认 dateRange=[昨天,昨天] 只有一天，
      // 不能拿来算 top10，否则每天的销量榜单一天一变、无法比较）
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
    } catch (error) {
      console.error('加载商品销量数据失败:', error);
      setProductSalesData([]);
      setSkuDailySalesData([]);
    }
  }, [selectedStoreIds, dateRange, STORES, isTestMode]);

  // --- 加载SKU异动检测数据（取近14天全部SKU，基准为最后一天有销量的SKU）
  const loadSkuAnomalyData = useCallback(async () => {
    if (selectedStoreIds.length === 0) {
      setSkuAnomalyRealData([]);
      return;
    }

    if (isTestMode) {
      const testSkus = [
        { sku: 'SKU-001', store: 'A加', daily: [5, 6, 4, 7, 5, 8, 6, 5, 4, 15, 6, 5, 7, 6] },
        { sku: 'SKU-002', store: 'B美', daily: [12, 10, 11, 13, 25, 11, 10, 9, 11, 12, 10, 2, 11, 10] },
        { sku: 'SKU-003', store: 'A欧', daily: [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0] },
        { sku: 'SKU-004', store: 'B日', daily: [8, 9, 7, 8, 10, 9, 8, 7, 18, 9, 8, 7, 9, 8] },
        { sku: 'SKU-005', store: 'A加', daily: [3, 3, 4, 3, 2, 3, 4, 3, 3, 10, 3, 3, 4, 3] },
        { sku: 'SKU-006', store: 'B美', daily: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { sku: 'SKU-007', store: 'A欧', daily: [6, 7, 6, 5, 6, 1, 6, 7, 6, 5, 6, 7, 6, 5] },
        { sku: 'SKU-008', store: 'B日', daily: [15, 14, 16, 15, 14, 30, 15, 14, 16, 15, 14, 16, 15, 3] },
      ];
      const yesterday = dayjs().subtract(1, 'day');
      const result = testSkus.map(item => {
        const avg = item.daily.reduce((a, b) => a + b, 0) / item.daily.length;
        const max = Math.max(...item.daily);
        const min = Math.min(...item.daily.filter(v => v > 0));
        let maxDayOverDay = 0;

        // 构建完整 14 天明细（i=0 对应 14 天前，i=13 对应昨天）
        const daily = item.daily.map((sales, i) => {
          const date = yesterday.clone().subtract(13 - i, 'day').format('YYYY-MM-DD');
          const prevSales = i > 0 ? item.daily[i - 1] : null;
          let changeRate: number | null = null;
          let direction: 'up' | 'down' | 'flat' | null = null;
          let isAnomaly = false;
          if (prevSales !== null && prevSales > 0) {
            changeRate = Math.round(((sales - prevSales) / prevSales) * 10000) / 100;
            direction = changeRate > 0 ? 'up' : changeRate < 0 ? 'down' : 'flat';
            const absRate = Math.abs(changeRate);
            if (absRate > maxDayOverDay) maxDayOverDay = absRate;
            if (absRate >= 50) isAnomaly = true;
          }
          return { date, sales, prevSales, changeRate, direction, isAnomaly };
        });

        // 计算最新趋势方向（最后一天相对前一天）
        let latestDirection: 'up' | 'down' | 'flat' = 'flat';
        const lastIdx = item.daily.length - 1;
        if (lastIdx >= 1 && item.daily[lastIdx - 1] > 0) {
          const lastChangeRate = (item.daily[lastIdx] - item.daily[lastIdx - 1]) / item.daily[lastIdx - 1];
          const t = ((thresholds[item.store]?.latestTrend) ?? 20) / 100;
          if (lastChangeRate > t) latestDirection = 'up';
          else if (lastChangeRate < -t) latestDirection = 'down';
        }
        // 计算总体趋势方向（后7天均值 vs 前7天均值）
        let overallDirection: 'up' | 'down' | 'flat' = 'flat';
        if (item.daily.length >= 14) {
          const firstHalfAvg = item.daily.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
          const secondHalfAvg = item.daily.slice(7, 14).reduce((a, b) => a + b, 0) / 7;
          const t = ((thresholds[item.store]?.overallTrend) ?? 15) / 100;
          if (firstHalfAvg > 0) {
            const overallChangeRate = (secondHalfAvg - firstHalfAvg) / firstHalfAvg;
            if (overallChangeRate > t) overallDirection = 'up';
            else if (overallChangeRate < -t) overallDirection = 'down';
          } else if (secondHalfAvg > 0) {
            overallDirection = 'up';
          }
        }
        return {
          sku: item.sku,
          store: item.store,
          latestSales: item.daily[item.daily.length - 1],
          avgSales: Math.round(avg * 100) / 100,
          maxSales: max,
          minSales: min,
          fluctuation: Math.round(maxDayOverDay * 100) / 100,
          latestDirection,
          overallDirection,
          isMonitored: avg > 1,
          isAnomaly: avg > 1 && maxDayOverDay >= 50,
          daily,
        };
      });
      setSkuAnomalyRealData(result);
      return;
    }

    try {
      const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);

      // 基准日期固定为前一天
      const baseDate = dayjs().subtract(1, 'day');
      const queryStartDate = baseDate.clone().subtract(13, 'day');
      const baseDateStr = baseDate.format('YYYY-MM-DD');
      const queryStartDateStr = queryStartDate.format('YYYY-MM-DD');

      // 获取近14天全部销量数据（基准为前一天）
      const response = await apiClient.get('/product-sales/', {
        params: {
          stores: storeNames.join(','),
          start_date: queryStartDateStr,
          end_date: baseDateStr,
        },
      });

      if (!response.data.success) {
        setSkuAnomalyRealData([]);
        return;
      }

      const allSales = response.data.data as Array<{ date: string; store: string; sku: string; sales_count: number }>;

      if (allSales.length === 0) {
        setSkuAnomalyRealData([]);
        return;
      }

      // 基准：14 天窗口内**任意一天有销量**的 store+sku 组合（不绑死基准日，
      // 避免基准日数据未更新、或基准日碰巧 0 销量但历史有卖的 SKU 被漏掉）
      const activeSkus = new Set<string>();
      allSales.forEach(r => {
        if (r.sales_count > 0) {
          activeSkus.add(`${r.sku}__${r.store}`);
        }
      });

      if (activeSkus.size === 0) {
        setSkuAnomalyRealData([]);
        return;
      }

      // 按 store+sku 聚合14天日销量
      const skuStoreMap = new Map<string, { store: string; dailyMap: Map<string, number> }>();
      allSales.forEach(r => {
        const key = `${r.sku}__${r.store}`;
        if (!activeSkus.has(key)) return;
        if (!skuStoreMap.has(key)) {
          skuStoreMap.set(key, { store: r.store, dailyMap: new Map() });
        }
        const dailyEntry = skuStoreMap.get(key)!;
        dailyEntry.dailyMap.set(r.date, (dailyEntry.dailyMap.get(r.date) || 0) + r.sales_count);
      });

      // 计算异动指标
      const result: SkuAnomalyRecord[] = [];
      skuStoreMap.forEach((value, key) => {
        const [sku] = key.split('__');

        // 构建完整的 14 天日期序列，缺失日期补 0
        const fullDates: string[] = [];
        for (let i = 0; i < 14; i++) {
          fullDates.push(queryStartDate.clone().add(i, 'day').format('YYYY-MM-DD'));
        }
        const dailySalesSeq: number[] = fullDates.map(d => value.dailyMap.get(d) || 0);

        const total = dailySalesSeq.reduce((a, b) => a + b, 0);
        const avg = total / 14;
        const max = Math.max(...dailySalesSeq);
        const minPositive = Math.min(...dailySalesSeq.filter(v => v > 0)) || 0;

        // 构建完整 14 天明细，每行都算环比并标记是否异动
        let maxDayOverDay = 0;
        const daily = dailySalesSeq.map((sales, i) => {
          const prevSales = i > 0 ? dailySalesSeq[i - 1] : null;
          let changeRate: number | null = null;
          let direction: 'up' | 'down' | 'flat' | null = null;
          let isAnomaly = false;
          if (prevSales !== null && prevSales > 0) {
            changeRate = Math.round(((sales - prevSales) / prevSales) * 10000) / 100;
            direction = changeRate > 0 ? 'up' : changeRate < 0 ? 'down' : 'flat';
            const absRate = Math.abs(changeRate);
            if (absRate > maxDayOverDay) maxDayOverDay = absRate;
            if (absRate >= 50) isAnomaly = true;
          }
          return { date: fullDates[i], sales, prevSales, changeRate, direction, isAnomaly };
        });

        // 计算最新趋势方向（最后一天相对前一天的变化）
        let latestDirection: 'up' | 'down' | 'flat' = 'flat';
        const lastIdx = dailySalesSeq.length - 1;
        if (lastIdx >= 1 && dailySalesSeq[lastIdx - 1] > 0) {
          const lastChangeRate = (dailySalesSeq[lastIdx] - dailySalesSeq[lastIdx - 1]) / dailySalesSeq[lastIdx - 1];
          const t = ((thresholds[value.store]?.latestTrend) ?? 20) / 100;
          if (lastChangeRate > t) latestDirection = 'up';
          else if (lastChangeRate < -t) latestDirection = 'down';
        }

        // 计算总体趋势方向（后7天均值 vs 前7天均值）
        let overallDirection: 'up' | 'down' | 'flat' = 'flat';
        const firstHalfAvg = dailySalesSeq.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
        const secondHalfAvg = dailySalesSeq.slice(7, 14).reduce((a, b) => a + b, 0) / 7;
        const t = ((thresholds[value.store]?.overallTrend) ?? 15) / 100;
        if (firstHalfAvg > 0) {
          const overallChangeRate = (secondHalfAvg - firstHalfAvg) / firstHalfAvg;
          if (overallChangeRate > t) overallDirection = 'up';
          else if (overallChangeRate < -t) overallDirection = 'down';
        } else if (secondHalfAvg > 0) {
          // 前7天全零、后7天开卖 → 从零到有，算上升
          overallDirection = 'up';
        }

        result.push({
          sku,
          store: value.store,
          latestSales: dailySalesSeq[13],
          avgSales: Math.round(avg * 100) / 100,
          maxSales: max,
          minSales: minPositive || 0,
          fluctuation: Math.round(maxDayOverDay * 100) / 100,
          latestDirection,
          overallDirection,
          isMonitored: avg > 1,
          isAnomaly: avg > 1 && maxDayOverDay >= 50,
          daily,
        });
      });

      setSkuAnomalyRealData(result);
    } catch (error) {
      console.error('加载SKU异动数据失败:', error);
      setSkuAnomalyRealData([]);
    }
  }, [selectedStoreIds, STORES, isTestMode, thresholds]);

  // --- 加载 SKU 超库龄数据
  const loadProductAgingData = useCallback(async () => {
    try {
      const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);

      if (isTestMode) {
        // 测试数据
        setProductAgingLatestDate(dayjs().subtract(2, 'day').format('YYYY-MM-DD'));
        setProductAgingData([
          { store: 'A加', sku: 'TEST-001', aging_181_270: 12, aging_271_365: 0, aging_366_455: 0, aging_456_plus: 0 },
          { store: 'A加', sku: 'TEST-002', aging_181_270: 0, aging_271_365: 8, aging_366_455: 0, aging_456_plus: 0 },
          { store: 'B美', sku: 'TEST-003', aging_181_270: 0, aging_271_365: 0, aging_366_455: 20, aging_456_plus: 5 },
          { store: 'B美', sku: 'TEST-004', aging_181_270: 15, aging_271_365: 0, aging_366_455: 0, aging_456_plus: 0 },
        ].filter(r => storeNames.includes(r.store)));
        return;
      }

      const response = await apiClient.get('/product-aging/', {
        params: { stores: storeNames.join(',') },
      });

      if (!response.data.success) {
        setProductAgingData([]);
        setProductAgingLatestDate(null);
        return;
      }

      setProductAgingLatestDate(response.data.latest_date);
      setProductAgingData(response.data.data || []);
    } catch (error) {
      console.error('加载SKU超库龄数据失败:', error);
      setProductAgingData([]);
      setProductAgingLatestDate(null);
    }
  }, [selectedStoreIds, STORES, isTestMode]);

  // --- 初始化：获取数据
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // 如果 tenant_id === 6，使用测试数据
        if (isTestMode) {
          const testStores: MyStore[] = [
            { id: 1, shop_abbr: 'A加', name: 'A加店铺', site: '加拿大' },
            { id: 2, shop_abbr: 'B美', name: 'B美店铺', site: '美国' },
            { id: 3, shop_abbr: 'A欧', name: 'A欧店铺', site: '欧洲' },
            { id: 4, shop_abbr: 'B日', name: 'B日店铺', site: '日本' },
          ];
          setMyStores(testStores);
          setRegions(['加拿大', '美国', '欧洲', '日本']);
          console.log('tenant_id=6，使用测试店铺数据:', testStores);
        } else {
          const res = await apiClient.get('/stores/my-stores');
          if (res.data.success) {
            setMyStores(res.data.data.stores || []);
            setRegions(res.data.data.regions || []);
          }
        }
      } catch (error) {
        console.error('加载数据失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isTestMode]);

  // --- 当 STORES 初始化后，默认只选 data_warnings 表里有数据的店铺（避免无数据店铺导致 API 变慢）
  useEffect(() => {
    if (STORES.length > 0 && selectedStoreIds.length === 0 && !isTestMode) {
      apiClient.get('/data-warnings/stores').then(res => {
        const dbStores: string[] = res.data.data || [];
        const matched = STORES.filter(s => dbStores.includes(s.name));
        const ids = matched.length > 0 ? matched.map(s => s.id) : STORES.map(s => s.id);
        console.log(`[AUTO-SELECT] STORES=${STORES.length}, DB有数据=${dbStores.length}, 交集选中=${ids.length}`);
        setSelectedStoreIds(ids);
      }).catch(() => {
        console.log('[AUTO-SELECT] /data-warnings/stores fail, fallback all');
        setSelectedStoreIds(STORES.map(s => s.id));
      });
    } else if (STORES.length > 0 && selectedStoreIds.length === 0) {
      setSelectedStoreIds(STORES.map(s => s.id));
    }
  }, [STORES, isTestMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 当 myStores 加载完成后从API获取数据和阈值设置
  useEffect(() => {
    if (!loading && myStores.length > 0) {
      // 如果是测试模式，使用测试阈值
      if (isTestMode) {
        setThresholds({
          'A加': { adRatio: 25, storageRatio: 10, acos: 30, overallTrend: 15, latestTrend: 20 },
          'B美': { adRatio: 28, storageRatio: 12, acos: 35, overallTrend: 15, latestTrend: 20 },
          'A欧': { adRatio: 22, storageRatio: 8, acos: 25, overallTrend: 15, latestTrend: 20 },
          'B日': { adRatio: 30, storageRatio: 15, acos: 40, overallTrend: 15, latestTrend: 20 },
        });
      } else {
        fetchThresholdSettings().then(setThresholds);
      }
    }
  }, [myStores, loading, isTestMode]);

  useEffect(() => {
    if (selectedStoreIds.length > 0) {
      loadStoreDataFromAPI();
      loadProductSalesData();
      loadSkuAnomalyData();
      loadProductAgingData();
    } else {
      setProductAgingData([]);
      setProductAgingLatestDate(null);
    }
    setProductAgingDrillBucket(null);
  }, [selectedStoreIds, loadStoreDataFromAPI, loadProductSalesData, loadSkuAnomalyData]);

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

        {/* 平均客单价 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          onMouseEnter={() => setHoveredKpi('avgOrderPrice')}
          onMouseLeave={() => setHoveredKpi(null)}
        >
          <Card 
            size="small" 
            bordered 
            bodyStyle={{ padding: '8px 12px' }} 
            style={{ 
              minHeight: 'auto', 
              height: 'auto',
              backgroundColor: '#f6ffed'
            }} 
            hoverable
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '60px' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>平均客单价</Text>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#333', lineHeight: 1.2 }}>
                  ¥{(currentMetrics.orders > 0 ? Math.round(currentMetrics.gmv / currentMetrics.orders) : 0).toLocaleString()}
                </div>
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>GMV ÷ 订单量 · 昨日</Text>
              </div>
            </div>
          </Card>
          {hoveredKpi === 'avgOrderPrice' && renderKpiDetail('avgOrderPrice')}
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
          <Card title="📈 趋势分析" bordered={false} style={{ height: '100%', overflow: 'visible', position: 'relative' }}>
            <div style={{ marginBottom: '24px', overflow: 'visible', position: 'relative' }}>
              <Title level={5} style={{ marginBottom: '16px' }}>订单量趋势 (最近14天)</Title>
              <div style={{ overflow: 'visible', position: 'relative' }}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={ordersTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <RechartsTooltip wrapperStyle={{ zIndex: 1000 }} />
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
            </div>
            <Divider />
            <div style={{ overflow: 'visible', position: 'relative' }}>
              <Title level={5} style={{ marginBottom: '16px' }}>广告占比趋势 (最近7天)</Title>
              <div style={{ overflow: 'visible', position: 'relative' }}>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={adRatioTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <RechartsTooltip wrapperStyle={{ zIndex: 1000 }} formatter={(value, name) => [`${value}%`, name]} />
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
        style={{ overflow: 'visible', position: 'relative', zIndex: 10 }}
        bodyStyle={{ overflow: 'visible', position: 'relative', zIndex: 10 }}
      >
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={skuTrendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" fontSize={10} />
            <YAxis fontSize={10} />
            <RechartsTooltip wrapperStyle={{ zIndex: 9999, position: 'relative' }} />
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

      {/* --- SKU销量异动检测板块 */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>🔔 SKU销量异动检测</span>
            <Button type="link" size="small" onClick={() => setShowSkuAnomalyThresholdModal(true)}>
              阈值设置
            </Button>
          </div>
        }
        bordered={false}
        style={{ marginTop: 16 }}
      >
        {(() => {
          const groupMeta: Array<{
            dir: 'up' | 'down' | 'flat';
            label: string;
            arrow: string;
            color: string;
            bgColor: string;
            borderColor: string;
          }> = [
            { dir: 'up', label: '上升趋势', arrow: '↑', color: '#cf1322', bgColor: '#fff1f0', borderColor: '#ff4d4f' },
            { dir: 'down', label: '下降趋势', arrow: '↓', color: '#096dd9', bgColor: '#e6f7ff', borderColor: '#1890ff' },
            { dir: 'flat', label: '持平', arrow: '→', color: '#595959', bgColor: '#f5f5f5', borderColor: '#d9d9d9' },
          ];

          const commonColumns = [
            {
              title: 'SKU',
              dataIndex: 'sku',
              key: 'sku',
              width: 160,
              render: (text: string, record: any) => (
                <span style={{ fontWeight: record.isAnomaly ? 'bold' : 'normal' }}>{text}</span>
              ),
            },
            { title: '店铺', dataIndex: 'store', key: 'store', width: 80 },
            { title: '最新销量', dataIndex: 'latestSales', key: 'latestSales', width: 90 },
            { title: '最高销量', dataIndex: 'maxSales', key: 'maxSales', width: 90 },
            { title: '最低销量', dataIndex: 'minSales', key: 'minSales', width: 90 },
            {
              title: '日均销量',
              dataIndex: 'avgSales',
              key: 'avgSales',
              width: 90,
              render: (val: number) => val.toFixed(2),
            },
            {
              title: '近期趋势',
              key: 'recent',
              width: 90,
              render: (_: any, record: any) => {
                const d = record.latestDirection;
                const color = d === 'up' ? '#ff4d4f' : d === 'down' ? '#1890ff' : '#999';
                const arrow = d === 'up' ? '↑' : d === 'down' ? '↓' : '→';
                return <span style={{ color, fontWeight: 'bold', fontSize: 15 }}>{arrow}</span>;
              },
            },
            {
              title: '最大波动',
              dataIndex: 'fluctuation',
              key: 'fluctuation',
              width: 100,
              render: (val: number, record: any) => {
                const color = record.isAnomaly ? '#ff4d4f' : '#52c41a';
                const d = record.latestDirection;
                const arrow = d === 'up' ? '↑' : d === 'down' ? '↓' : '→';
                return (
                  <span style={{ color, fontWeight: 'bold' }}>
                    {arrow} {val.toFixed(1)}%
                  </span>
                );
              },
            },
          ];

          const renderExpanded = (record: any) => (
            <div>
              <div style={{ marginBottom: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>最新(前日)销量：</Text>
                  <Text strong>{record.latestSales}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>14天日均：</Text>
                  <Text strong>{record.avgSales.toFixed(2)}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>最高销量：</Text>
                  <Text strong style={{ color: '#ff4d4f' }}>{record.maxSales}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>最低销量：</Text>
                  <Text strong style={{ color: '#1890ff' }}>{record.minSales}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>近期趋势：</Text>
                  <Text strong style={{
                    color: record.latestDirection === 'up' ? '#ff4d4f' : record.latestDirection === 'down' ? '#1890ff' : '#999'
                  }}>
                    {record.latestDirection === 'up' ? '↑ 上升' : record.latestDirection === 'down' ? '↓ 下降' : '→ 持平'}
                  </Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>总体趋势：</Text>
                  <Text strong style={{
                    color: record.overallDirection === 'up' ? '#ff4d4f' : record.overallDirection === 'down' ? '#1890ff' : '#999'
                  }}>
                    {record.overallDirection === 'up' ? '↑ 上升' : record.overallDirection === 'down' ? '↓ 下降' : '→ 持平'}
                  </Text>
                </div>
              </div>
              {record.daily.length > 0 ? (
                <Table
                  dataSource={record.daily}
                  rowKey="date"
                  pagination={false}
                  size="small"
                  rowClassName={(row: any) => row.isAnomaly ? 'anomaly-row' : ''}
                  columns={[
                    {
                      title: '日期',
                      dataIndex: 'date',
                      key: 'date',
                      width: 120,
                      render: (val: string, row: any) => (
                        <span style={{ fontWeight: row.isAnomaly ? 'bold' : 'normal' }}>
                          {val}
                          {row.isAnomaly && <Tag color="red" style={{ marginLeft: 4 }}>异动</Tag>}
                        </span>
                      ),
                    },
                    { title: '销量', dataIndex: 'sales', key: 'sales', width: 80 },
                    {
                      title: '前日销量',
                      dataIndex: 'prevSales',
                      key: 'prevSales',
                      width: 90,
                      render: (val: number | null) => val === null ? <Text type="secondary">—</Text> : val,
                    },
                    {
                      title: '日环比变化',
                      dataIndex: 'changeRate',
                      key: 'changeRate',
                      width: 120,
                      render: (val: number | null, row: any) => {
                        if (val === null) return <Text type="secondary">—</Text>;
                        const isUp = row.direction === 'up';
                        const isDown = row.direction === 'down';
                        return (
                          <Text style={{ color: isUp ? '#ff4d4f' : isDown ? '#1890ff' : '#666', fontWeight: row.isAnomaly ? 'bold' : 'normal' }}>
                            {isUp ? '↑' : isDown ? '↓' : '→'} {Math.abs(val)}%
                          </Text>
                        );
                      },
                    },
                  ]}
                />
              ) : (
                <Text type="secondary">无异动记录</Text>
              )}
            </div>
          );

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {groupMeta.map(meta => {
                const list = skuAnomalyGroups[meta.dir];
                if (list.length === 0) return null;
                const isCollapsed = collapsedGroups[meta.dir];
                return (
                  <div key={meta.dir}>
                    <div
                      onClick={() => setCollapsedGroups(prev => ({ ...prev, [meta.dir]: !prev[meta.dir] }))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 14px',
                        background: meta.bgColor,
                        borderLeft: `4px solid ${meta.borderColor}`,
                        borderRadius: '4px 4px 0 0',
                        marginBottom: 0,
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <span style={{ fontSize: 22, color: meta.color, lineHeight: 1 }}>{meta.arrow}</span>
                      <span style={{ fontSize: 14, fontWeight: 'bold', color: meta.color }}>{meta.label}</span>
                      <span style={{ fontSize: 12, color: '#999', marginLeft: 'auto' }}>{list.length} 个SKU</span>
                      <span style={{ fontSize: 14, color: '#888', width: 16, textAlign: 'center' }}>
                        {isCollapsed ? '▸' : '▾'}
                      </span>
                    </div>
                    {!isCollapsed && (
                      <Table
                        dataSource={list}
                        rowKey={(record: any) => record.sku + record.store}
                        pagination={false}
                        size="small"
                        bordered
                        style={{ borderTop: 'none' }}
                        rowClassName={(record: any) => record.isAnomaly ? 'anomaly-row' : ''}
                        expandable={{ expandedRowRender: renderExpanded }}
                        columns={commonColumns}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
        <style>{`
          .anomaly-row {
            background-color: #fff2f0 !important;
          }
          .anomaly-row:hover > td {
            background-color: #ffddd8 !important;
          }
        `}</style>
      </Card>

      {/* --- 超库龄SKU分布板块 */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>📦 超库龄SKU分布</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {productAgingLatestDate && productAgingExpanded && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  最新更新时间：{productAgingLatestDate}
                </Text>
              )}
              <Button
                type="link"
                size="small"
                icon={productAgingExpanded ? <UpOutlined /> : <DownOutlined />}
                onClick={() => setProductAgingExpanded(v => !v)}
              >
                {productAgingExpanded ? '收起' : '展开'}
              </Button>
            </div>
          </div>
        }
        bordered={false}
        style={{ marginTop: 16 }}
      >
        {productAgingExpanded && (() => {
          if (selectedStoreIds.length === 0) {
            return <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>请先在上方筛选店铺</div>;
          }

          const bucketLabels = [
            { key: 'aging_181_270', label: '181-270天', color: '#faad14' },
            { key: 'aging_271_365', label: '271-365天', color: '#fa8c16' },
            { key: 'aging_366_455', label: '366-455天', color: '#f5222d' },
            { key: 'aging_456_plus', label: '456天+', color: '#722ed1' },
          ];

          // 第一层主视图：每个时间段的总数量（SUM 所有 SKU × 所有店铺）
          const barData = bucketLabels.map(b => ({
            bucket: b.label,
            key: b.key,
            color: b.color,
            total: productAgingData.reduce((sum, row) => sum + ((row as any)[b.key] || 0), 0),
          }));

          if (barData.every(b => b.total === 0)) {
            return <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>当前筛选店铺暂无超库龄数据</div>;
          }

          // 第二层：当前下钻的 bucket 明细（所有 SKU × 该 bucket > 0 的记录）
          const drillBucket = bucketLabels.find(b => b.label === productAgingDrillBucket);
          const drillData = drillBucket ? (() => {
            const list: Array<{ sku: string; store: string; qty: number; color: string }> = [];
            productAgingData.forEach(row => {
              const qty = (row as any)[drillBucket.key] || 0;
              if (qty > 0) list.push({ sku: row.sku, store: row.store, qty, color: drillBucket.color });
            });
            list.sort((a, b) => b.qty - a.qty);
            return list;
          })() : [];
          const DRILL_TOP_N = 15;
          const drillTopN = drillData.slice(0, DRILL_TOP_N);
          const drillRemaining = drillData.length - DRILL_TOP_N;

          return (
            <>
              {productAgingDrillBucket && (
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Button size="small" onClick={() => setProductAgingDrillBucket(null)}>← 返回汇总视图</Button>
                  <Text strong style={{ color: drillBucket?.color }}>当前下钻：{productAgingDrillBucket}（共 {drillData.length} 个 SKU）</Text>
                </div>
              )}

              {!productAgingDrillBucket ? (
                // ===== 第一层：柱状图主视图 =====
                <>
                  <div style={{ marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {barData.map(b => (
                      <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: b.color, display: 'inline-block' }} />
                        <Text type="secondary" style={{ fontSize: 12 }}>{b.bucket}</Text>
                        <Text strong style={{ color: b.color }}>{b.total}</Text>
                      </div>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={360}>
                    <BarChart data={barData} margin={{ top: 16, right: 24, left: 16, bottom: 36 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="bucket" type="category" tickLine={false} />
                      <YAxis type="number" allowDecimals={false} tickLine={false} name="数量" />
                      <RechartsTooltip
                        cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                        formatter={(value: any) => [value, '数量']}
                      />
                      <Bar
                        dataKey="total"
                        radius={[4, 4, 0, 0]}
                        cursor="pointer"
                        onClick={(d: any) => setProductAgingDrillBucket(d.bucket)}
                        shape={(props: any) => {
                          const { x, y, width, height, payload } = props;
                          return (
                            <g>
                              <rect
                                x={x}
                                y={y}
                                width={width}
                                height={height}
                                rx={4}
                                ry={4}
                                fill={payload.color}
                                style={{ cursor: 'pointer' }}
                              />
                              {height > 16 && (
                                <text
                                  x={x + width / 2}
                                  y={y + height / 2}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fill="#fff"
                                  fontSize={13}
                                  fontWeight="bold"
                                  style={{ pointerEvents: 'none' }}
                                >
                                  {payload.total}
                                </text>
                              )}
                            </g>
                          );
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>💡 点击柱子可下钻查看该时间段下每个 SKU 的明细</Text>
                  </div>
                </>
              ) : (
                // ===== 第二层：水平条形图 + 表格（左右同高）=====
                (() => {
                  const sideHeight = Math.max(360, drillTopN.length * 30 + 60);
                  return (
                    <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', height: sideHeight }}>
                      {/* 左侧：水平条形图 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: drillBucket?.color }}>
                          Top {Math.min(DRILL_TOP_N, drillTopN.length)} SKU 数量排名
                          {drillRemaining > 0 && (
                            <span style={{ fontSize: 12, fontWeight: 400, color: '#999', marginLeft: 8 }}>
                              （剩余 {drillRemaining} 个见右侧表格）
                            </span>
                          )}
                        </div>
                        <ResponsiveContainer width="100%" height={sideHeight - 24}>
                          <BarChart
                            layout="vertical"
                            data={drillTopN}
                            margin={{ top: 8, right: 16, left: 150, bottom: 8 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" dataKey="qty" allowDecimals={false} tickLine={false} />
                            <YAxis
                              type="category"
                              dataKey="sku"
                              width={140}
                              interval={0}
                              tickLine={false}
                              tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + '…' : v)}
                            />
                            <RechartsTooltip
                              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                              content={({ active, payload }) => {
                                if (!active || !payload || payload.length === 0) return null;
                                const p = payload[0].payload;
                                return (
                                  <div style={{
                                    background: 'rgba(0,0,0,0.85)',
                                    color: '#fff',
                                    padding: '6px 10px',
                                    borderRadius: 4,
                                    fontSize: 12,
                                    lineHeight: 1.6,
                                  }}>
                                    <div style={{ fontWeight: 'bold' }}>{p.sku}</div>
                                    <div>店铺：{p.store}</div>
                                    <div>库龄段：{productAgingDrillBucket}</div>
                                    <div>数量：<span style={{ color: p.color, fontWeight: 'bold' }}>{p.qty}</span></div>
                                  </div>
                                );
                              }}
                            />
                            <Bar
                              dataKey="qty"
                              radius={[0, 4, 4, 0]}
                              cursor="pointer"
                              shape={(props: any) => {
                                const { x, y, width, height, payload } = props;
                                return (
                                  <g>
                                    <rect
                                      x={x}
                                      y={y}
                                      width={width}
                                      height={height}
                                      rx={4}
                                      ry={4}
                                      fill={payload.color}
                                      fillOpacity={0.85}
                                    />
                                    {width > 36 && (
                                      <text
                                        x={x + width - 6}
                                        y={y + height / 2}
                                        textAnchor="end"
                                        dominantBaseline="middle"
                                        fill="#fff"
                                        fontSize={11}
                                        fontWeight="bold"
                                        style={{ pointerEvents: 'none' }}
                                      >
                                        {payload.qty}
                                      </text>
                                    )}
                                  </g>
                                );
                              }}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* 右侧：完整明细表 */}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                          全部 {drillData.length} 个 SKU 明细
                        </div>
                        <Table
                          dataSource={drillData.map((d, i) => ({ ...d, key: d.sku + d.store, rank: i + 1 }))}
                          rowKey="key"
                          size="small"
                          bordered
                          pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
                          scroll={{ y: sideHeight - 24 - 56 }}
                          columns={[
                            { title: '排名', dataIndex: 'rank', key: 'rank', width: 56 },
                            { title: '店铺', dataIndex: 'store', key: 'store', width: 90 },
                            { title: 'SKU', dataIndex: 'sku', key: 'sku', ellipsis: true },
                            { title: '数量', dataIndex: 'qty', key: 'qty', width: 80, render: (v, r) => <span style={{ color: r.color, fontWeight: 'bold' }}>{v}</span> },
                          ]}
                        />
                      </div>
                    </div>
                  );
                })()
              )}
            </>
          );
        })()}
      </Card>

      {/* --- 广告占比周监控 */}
      <Card bordered={false} style={{ marginTop: 16 }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>📊 广告占比周监控</span>
            <Tag color={adRatioKpis.sumRatio > adRatioKpis.TH ? 'red' : 'green'} style={{ marginLeft: 4 }}>
              阈值 {adRatioKpis.TH}% · 近14天
            </Tag>
          </div>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <div style={{ background: '#fafbfd', border: '1px solid #f0f2f8', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>汇总占比</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: adRatioKpis.sumRatio > adRatioKpis.TH ? '#f5222d' : '#52c41a' }}>
              {adRatioKpis.sumRatio.toFixed(2)}%
            </div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>近14天花费 ÷ 销售额</div>
          </div>
          <div style={{ background: '#fafbfd', border: '1px solid #f0f2f8', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>广告总花费</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1890ff' }}>¥{adRatioKpis.totalAd.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>近14天合计</div>
          </div>
          <div style={{ background: '#fafbfd', border: '1px solid #f0f2f8', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>总销售额</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1890ff' }}>¥{adRatioKpis.totalSales.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>近14天合计</div>
          </div>
          <div style={{ background: '#fafbfd', border: '1px solid #f0f2f8', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>较上周变化</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: adRatioKpis.weekChange == null ? '#999' : adRatioKpis.weekChange >= 0 ? '#f5222d' : '#52c41a' }}>
              {adRatioKpis.weekChange == null ? '--' : `${adRatioKpis.weekChange >= 0 ? '+' : ''}${adRatioKpis.weekChange.toFixed(1)}%`}
            </div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>汇总占比环比</div>
          </div>
          <div style={{ background: '#fafbfd', border: '1px solid #f0f2f8', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>超标天数</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: adRatioKpis.overDays >= 5 ? '#f5222d' : '#52c41a' }}>
              {adRatioKpis.overDays}天 / 14
            </div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>占比 &gt; {adRatioKpis.TH}% 的天数</div>
          </div>
        </div>

        {/* 图表区域（同 Card 内，不单独断卡） */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16, overflow: 'visible' }}>
          {/* 左侧：每日趋势图（柱状图 + 折线图组合） */}
          <div style={{ border: '1px solid #f0f2f8', borderRadius: 10, padding: 12, overflow: 'visible', position: 'relative' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 8 }}>
              📈 每日广告花费 & 占比趋势
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={adRatioDailyChartData.daily} margin={{ top: 10, right: 50, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888' }} />
                {/* 左Y轴：广告花费 */}
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#1890ff' }} tickFormatter={v => `¥${(v / 1000).toFixed(0)}k`} />
                {/* 右Y轴：广告占比 */}
                <YAxis yAxisId="right" orientation="right" domain={[0, 35]} tick={{ fontSize: 11, fill: '#fa8c16' }} tickFormatter={v => `${v}%`} />
                <RechartsTooltip
                  wrapperStyle={{ zIndex: 1000 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = adRatioDailyChartData.daily.find(d => d.date === label);
                    return (
                      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 6, padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{row?.adDate}</div>
                        <div style={{ color: '#1890ff' }}>💵 广告花费：¥{row?.ad?.toLocaleString()}</div>
                        <div style={{ color: '#fa8c16' }}>📊 销售额：¥{row?.sales?.toLocaleString()}</div>
                        <div style={{ color: row?.over ? '#f5222d' : '#333', fontWeight: 600 }}>
                          广告占比：{row?.ratio}% {row?.over ? '⚠️ 超标' : ''}
                        </div>
                      </div>
                    );
                  }}
                />
                {/* 柱状图：广告花费（左Y轴） */}
                <Bar yAxisId="left" dataKey="ad" name="广告花费" fill="#1890ff" radius={[3, 3, 0, 0]} barSize={16} />
                {/* 折线图：广告占比（右Y轴），超标点染红色 */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="ratio"
                  name="广告占比"
                  stroke="#fa8c16"
                  strokeWidth={2}
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    const color = payload.over ? '#f5222d' : '#fa8c16';
                    return <circle cx={cx} cy={cy} r={payload.over ? 5 : 3} fill={color} stroke="#fff" strokeWidth={1.5} />;
                  }}
                  activeDot={{ r: 6 }}
                />
                {/* 红色虚线：15% 阈值线 */}
                <ReferenceLine yAxisId="right" y={adRatioDailyChartData.TH} stroke="#f5222d" strokeDasharray="5 5" strokeWidth={1.5} label={{ value: `${adRatioDailyChartData.TH}%阈值`, fill: '#f5222d', fontSize: 11, position: 'right' }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* 右侧：花费-销售散点图 */}
          <div style={{ border: '1px solid #f0f2f8', borderRadius: 10, padding: 12, overflow: 'visible', position: 'relative' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 8 }}>
              🎯 花费-销售散点分布
              <span style={{ fontSize: 11, color: '#888', fontWeight: 400, marginLeft: 6 }}>
                （蓝：占比≤{adRatioDailyChartData.TH}% · 红：超标）
              </span>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" dataKey="ad" name="广告花费" tick={{ fontSize: 11, fill: '#1890ff' }} tickFormatter={v => `¥${(v / 1000).toFixed(0)}k`} label={{ value: '广告花费', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#999' }} />
                <YAxis type="number" dataKey="sales" name="销售额" tick={{ fontSize: 11, fill: '#52c41a' }} tickFormatter={v => `¥${(v / 1000).toFixed(0)}k`} label={{ value: '销售额', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#999' }} />
                <RechartsTooltip
                  wrapperStyle={{ zIndex: 1000 }}
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const p = payload[0].payload;
                    return (
                      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 6, padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.adDate}</div>
                        <div style={{ color: '#1890ff' }}>💵 广告花费：¥{p.ad.toLocaleString()}</div>
                        <div style={{ color: '#52c41a' }}>📦 销售额：¥{p.sales.toLocaleString()}</div>
                        <div style={{ color: p.over ? '#f5222d' : '#333', fontWeight: 600 }}>
                          广告占比：{p.ratio}% {p.over ? '⚠️ 超标' : '✅'}
                        </div>
                      </div>
                    );
                  }}
                />
                {/* 蓝点：占比 ≤ 阈值 */}
                <Scatter name="正常" data={adRatioDailyChartData.daily.filter(d => !d.over)} fill="#1890ff" fillOpacity={0.7} />
                {/* 红点：占比 > 阈值 */}
                <Scatter name="超标" data={adRatioDailyChartData.daily.filter(d => d.over)} fill="#f5222d" fillOpacity={0.8} />
                {/* 灰色虚线：平均转化效率线（y = ratio_avg * x） */}
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: Math.max(...adRatioDailyChartData.daily.map(d => d.ad)) * 1.1, y: Math.max(...adRatioDailyChartData.daily.map(d => d.sales)) * 1.1 }]} stroke="#bbb" strokeDasharray="4 4" strokeWidth={1} label={{ value: '效率线', fill: '#bbb', fontSize: 10, position: 'right' }} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 底部：周汇总对比表 */}
        <div style={{ marginTop: 16, borderTop: '1px solid #f0f2f8', paddingTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
              📋 周汇总对比
            </div>
            {(() => {
              const thisWeek = adRatioWeeklySummary[0];
              if (!thisWeek) return null;
              const isBad = thisWeek.attrLevel === 'bad' || thisWeek.attrLevel === 'warn';
              const isGood = thisWeek.attrLevel === 'good';
              return (
                <div style={{
                  fontSize: 12,
                  padding: '4px 12px',
                  borderRadius: 14,
                  background: isBad ? '#fff1f0' : isGood ? '#f6ffed' : '#e6f7ff',
                  color: isBad ? '#cf1322' : isGood ? '#389e0d' : '#0958d9',
                  border: `1px solid ${isBad ? '#ffa39e' : isGood ? '#b7eb8f' : '#91d5ff'}`,
                  fontWeight: 600,
                }}>
                  {isBad ? '🔴 预警' : isGood ? '🟢 健康' : '🔵 观察'}
                  <span style={{ marginLeft: 8, fontWeight: 400, opacity: 0.85 }}>
                    {thisWeek.ratio > 15 ? `汇总占比 ${thisWeek.ratio}% 超阈值` : `汇总占比 ${thisWeek.ratio}% 正常`}
                  </span>
                </div>
              );
            })()}
          </div>
          <Table
            size="middle"
            bordered={false}
            pagination={false}
            dataSource={adRatioWeeklySummary}
            rowKey="key"
            rowClassName={(record: any) => {
              if (record.attrLevel === 'bad') return 'row-danger';
              if (record.attrLevel === 'good') return 'row-success';
              return '';
            }}
            style={{ fontSize: 12, background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
            columns={[
              {
                title: '周次',
                dataIndex: 'week',
                width: 90,
                fixed: 'left',
                render: (v: string, r: any) => (
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#1890ff' }}>{v}</div>
                    <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>{r.range}</div>
                  </div>
                ),
              },
              {
                title: '汇总占比',
                dataIndex: 'ratio',
                width: 100,
                align: 'center',
                render: (v: number) => (
                  <span style={{ fontWeight: 700, fontSize: 14, color: v > 15 ? '#f5222d' : '#1890ff' }}>
                    {v.toFixed(2)}%
                  </span>
                ),
              },
              {
                title: '广告总花费',
                dataIndex: 'ad',
                width: 110,
                align: 'right',
                render: (v: number) => <span style={{ color: '#1890ff', fontFamily: 'monospace' }}>¥{(v || 0).toLocaleString()}</span>,
              },
              {
                title: '总销售额',
                dataIndex: 'sales',
                width: 110,
                align: 'right',
                render: (v: number) => <span style={{ color: '#52c41a', fontFamily: 'monospace' }}>¥{(v || 0).toLocaleString()}</span>,
              },
              {
                title: '花费环比',
                dataIndex: 'adChg',
                width: 100,
                align: 'center',
                render: (v: number | null) => {
                  if (v == null) return <span style={{ color: '#bbb' }}>--</span>;
                  const up = v > 0;
                  return (
                    <span style={{
                      color: up ? '#f5222d' : '#52c41a',
                      fontWeight: 600,
                      background: up ? '#fff1f0' : '#f6ffed',
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 12,
                    }}>
                      {up ? '↑' : '↓'} {Math.abs(v)}%
                    </span>
                  );
                },
              },
              {
                title: '销售环比',
                dataIndex: 'salesChg',
                width: 100,
                align: 'center',
                render: (v: number | null) => {
                  if (v == null) return <span style={{ color: '#bbb' }}>--</span>;
                  const up = v > 0;
                  return (
                    <span style={{
                      color: up ? '#f5222d' : '#52c41a',
                      fontWeight: 600,
                      background: up ? '#fff1f0' : '#f6ffed',
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 12,
                    }}>
                      {up ? '↑' : '↓'} {Math.abs(v)}%
                    </span>
                  );
                },
              },
              {
                title: '超标天数',
                dataIndex: 'overDays',
                width: 90,
                align: 'center',
                render: (v: number) => (
                  <span style={{
                    fontWeight: 600,
                    color: v >= 3 ? '#f5222d' : '#52c41a',
                    background: v >= 3 ? '#fff1f0' : '#f6ffed',
                    padding: '2px 10px',
                    borderRadius: 10,
                  }}>
                    {v}天 / 7
                  </span>
                ),
              },
              {
                title: '归因分析',
                dataIndex: 'attribution',
                render: (v: string, r: any) => {
                  const level = r.attrLevel;
                  const bg = level === 'bad' ? '#fff1f0' : level === 'warn' ? '#fffbe6' : level === 'good' ? '#f6ffed' : '#f5f5f5';
                  const fg = level === 'bad' ? '#cf1322' : level === 'warn' ? '#d48806' : level === 'good' ? '#389e0d' : '#888';
                  return (
                    <span style={{
                      background: bg,
                      color: fg,
                      padding: '4px 12px',
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: level !== 'info' ? 500 : 400,
                      border: level !== 'info' ? `1px solid ${level === 'bad' ? '#ffa39e' : level === 'warn' ? '#ffe58f' : '#b7eb8f'}` : '1px solid transparent',
                    }}>
                      {v}
                    </span>
                  );
                },
              },
            ]}
          />
          <style>{`
            .ant-table-row.row-danger td { background: #fff7f7 !important; }
            .ant-table-row.row-success td { background: #f9fff0 !important; }
            .ant-table-thead > tr > th { background: #fafbfd !important; font-weight: 600; color: #333; font-size: 12px; border-bottom: 2px solid #e8e8e8; }
            .ant-table-tbody > tr > td { font-size: 12px; padding: 10px 12px; }
            .ant-table-tbody > tr:hover > td { background: #f5faff !important; }
          `}</style>
        </div>
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
                  overallTrend: values.overallTrend !== undefined ? values.overallTrend : 15,
                  latestTrend: values.latestTrend !== undefined ? values.latestTrend : 20,
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
              <Form.Item
                name="overallTrend"
                label="总体趋势分组均值差阈值 (%)"
                rules={[{ required: true, message: '请输入总体趋势阈值' }]}
                extra="SKU异动：后一半天数均值 vs 前一半天数均值的变化率"
              >
                <InputNumber
                  min={1}
                  max={100}
                  step={1}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item
                name="latestTrend"
                label="近期趋势方向变化率阈值 (%)"
                rules={[{ required: true, message: '请输入近期趋势阈值' }]}
                extra="SKU异动：最后一天 vs 前一天的变化率"
              >
                <InputNumber
                  min={1}
                  max={100}
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
                            overallTrend: storeThresholds.overallTrend,
                            latestTrend: storeThresholds.latestTrend,
                          });
                          setEditingStoreId(store.id);
                        }}
                      >
                        修改
                      </Button>
                    </div>
                    <div style={{ display: 'flex', gap: '24px', fontSize: '13px', flexWrap: 'wrap' }}>
                      <div>
                        <span style={{ color: '#999' }}>广告占比：</span>
                        <span style={{ color: '#333', fontWeight: '500' }}>{storeThresholds.adRatio}%</span>
                      </div>
                      <div>
                        <span style={{ color: '#999' }}>仓储占比：</span>
                        <span style={{ color: '#333', fontWeight: '500' }}>{storeThresholds.storageRatio}%</span>
                      </div>
                      <div>
                        <span style={{ color: '#999' }}>ACOS：</span>
                        <span style={{ color: '#333', fontWeight: '500' }}>{storeThresholds.acos}%</span>
                      </div>
                      <div>
                        <span style={{ color: '#999' }}>总体趋势：</span>
                        <span style={{ color: '#333', fontWeight: '500' }}>{storeThresholds.overallTrend}%</span>
                      </div>
                      <div>
                        <span style={{ color: '#999' }}>近期趋势：</span>
                        <span style={{ color: '#333', fontWeight: '500' }}>{storeThresholds.latestTrend}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>

      {/* --- SKU异动阈值设置弹窗 */}
      <Modal
        title="SKU销量异动 - 阈值设置"
        visible={showSkuAnomalyThresholdModal}
        onCancel={() => {
          setShowSkuAnomalyThresholdModal(false);
          setEditingSkuStoreId(null);
        }}
        footer={null}
        width={600}
      >
        {selectedStoreIds.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            请先在上方筛选店铺
          </div>
        ) : editingSkuStoreId ? (
          <div>
            <div style={{ marginBottom: '20px', fontWeight: 'bold' }}>
              修改 {STORES.find(s => s.id === editingSkuStoreId)?.name || editingSkuStoreId} 的 SKU异动阈值
            </div>
            <Form
              layout="vertical"
              initialValues={skuEditFormValues}
              onFinish={async (values) => {
                const store = STORES.find(s => s.id === editingSkuStoreId);
                const storeName = store?.name || editingSkuStoreId;
                const current = thresholds[storeName] || { adRatio: 25, storageRatio: 10, acos: 30, overallTrend: 15, latestTrend: 20 };
                const newOverall = values.overallTrend !== undefined ? values.overallTrend : 15;
                const newLatest = values.latestTrend !== undefined ? values.latestTrend : 20;

                await saveThresholdSetting(storeName, {
                  adRatio: current.adRatio,
                  storageRatio: current.storageRatio,
                  acos: current.acos,
                  overallTrend: newOverall,
                  latestTrend: newLatest,
                });

                setThresholds(prev => ({
                  ...prev,
                  [storeName]: {
                    ...current,
                    overallTrend: newOverall,
                    latestTrend: newLatest,
                  },
                }));

                setEditingSkuStoreId(null);
                message.success('SKU异动阈值已保存');
                setTimeout(() => {
                  loadSkuAnomalyData();
                }, 300);
              }}
            >
              <Form.Item
                name="overallTrend"
                label="总体趋势分组均值差阈值 (%)"
                rules={[{ required: true, message: '请输入总体趋势阈值' }]}
                extra="后一半天数均值 vs 前一半天数均值的变化率，超过此阈值视为上升/下降"
              >
                <InputNumber
                  min={1}
                  max={100}
                  step={1}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item
                name="latestTrend"
                label="近期趋势方向变化率阈值 (%)"
                rules={[{ required: true, message: '请输入近期趋势阈值' }]}
                extra="最后一天 vs 前一天的变化率，超过此阈值视为上升/下降"
              >
                <InputNumber
                  min={1}
                  max={100}
                  step={1}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <div style={{ marginTop: '20px', textAlign: 'right' }}>
                <Button
                  onClick={() => setEditingSkuStoreId(null)}
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
              以下为各店铺 SKU异动当前阈值，点击"修改"按钮可编辑
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
                          setSkuEditFormValues({
                            overallTrend: storeThresholds.overallTrend,
                            latestTrend: storeThresholds.latestTrend,
                          });
                          setEditingSkuStoreId(store.id);
                        }}
                      >
                        修改
                      </Button>
                    </div>
                    <div style={{ display: 'flex', gap: '24px', fontSize: '13px' }}>
                      <div>
                        <span style={{ color: '#999' }}>总体趋势：</span>
                        <span style={{ color: '#333', fontWeight: '500' }}>{storeThresholds.overallTrend}%</span>
                      </div>
                      <div>
                        <span style={{ color: '#999' }}>近期趋势：</span>
                        <span style={{ color: '#333', fontWeight: '500' }}>{storeThresholds.latestTrend}%</span>
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
