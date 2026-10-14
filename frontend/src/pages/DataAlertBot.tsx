import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, Button, List, Typography, Space, Divider, Tag, message, Select, Table, DatePicker, Input, Modal, Tooltip, Form, InputNumber } from 'antd';
import { SearchOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';
import { AlertTriangle, RefreshCw, CheckCircle, XCircle, Store, Filter } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, ReferenceLine, ComposedChart, PieChart, Pie, Cell, Sector } from 'recharts';
import * as XLSX from 'xlsx';
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
  fbaStockDate?: string;
  grossProfit: number;
  storageRatio: number;
  storageFee: number;
  salesAmount: number;
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
  avgAdRatio30d?: number;
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

// --- 购物车预警记录（product_buybox）
interface BuyboxRecord {
  id: number;
  date: string;
  sku: string;
  product_name: string | null;
  store: string;
  status: string | null;
}

// --- 货件预警记录（product_shipment_notice）
interface ShipmentRecord {
  id: number;
  date: string;
  store: string;
  shipment_code: string;
  status: string | null;
}

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
  storage_fee?: number;
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

// --- SKU销量异动检测常量（评分制改造，后续可迁入阈值设置）
const SKU_ANOMALY_CONSTANTS = {
  minPrevSales: 3,      // 通道A：前一天销量≥3单
  absGateBase: 3,       // 通道A：绝对变化量基础门槛（单）
  absGateAvgRatio: 0.25,// 通道A：绝对变化量随日均放大的比例
  relGate: 50,          // 通道A：有效环比门槛（%）
  bBase: 5,             // 通道B（起量事件）：今日≥max(5, 日均×3)
  bAvgRatio: 3,
  eventRelP1: 100,      // 事件环比达到翻倍即P1（%）
  p0Ratio: 1,           // P0：绝对变化≥max(10, 日均×1)
  p0Base: 10,
  p1Ratio: 0.3,         // P1：绝对变化≥max(5, 日均×0.3)
  p1Base: 5,
  recentEventDays: 3,   // 最近3天有事件→按事件方向分组
  minTotal: 7,          // 纳入门槛：14天总销量≥7（只保留观察池口径）
} as const;

type SkuAnomalySeverity = 'P0' | 'P1' | 'P2';

interface SkuAnomalyEvent {
  startDate: string;
  endDate: string;
  days: number;
  direction: 'up' | 'down';
  maxAbsChange: number;
  maxRelChange: number;
  severity: SkuAnomalySeverity;
}

interface SkuAnomalyDailyItem {
  date: string;
  sales: number | null;      // null = 无记录（dataMissing）
  prevSales: number | null;
  changeRate: number | null;
  absChange: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  isAnomaly: boolean;
  dataMissing: boolean;
  channel: 'A' | 'B' | null; // A=有效环比，B=起量事件
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
  // --- 评分制字段
  anomalyScore: number;        // 0-100
  severity: SkuAnomalySeverity | null;
  maxAbsChange: number;        // 14天最大单日绝对变化
  anomalyDayCount: number;     // 有效异动天数
  recentEventDirection: 'up' | 'down' | null; // 最近3天事件方向（分组用）
  dataIncomplete: boolean;     // 昨天无记录，趋势回退T-2
  events: SkuAnomalyEvent[];
  daily: SkuAnomalyDailyItem[];
}

// --- SKU异动共享计算函数：真实数据与测试数据共用（评分/事件/池判定）
const computeSkuAnomalyMetrics = (
  salesByDate: Map<string, number>,
  fullDates: string[],
  store: string,
  thresholds: Record<string, { latestTrend?: number; overallTrend?: number }>
) => {
  const C = SKU_ANOMALY_CONSTANTS;
  // 无记录日期不补0：仅统计有记录的日期
  const recordedSales: number[] = fullDates.map(d => (salesByDate.has(d) ? salesByDate.get(d)! : null) as number | null);
  const validValues = recordedSales.filter((v): v is number => v !== null);
  const total = validValues.reduce((a, b) => a + b, 0);
  const avg = total / 14; // 固定14天窗口分母
  const max = validValues.length ? Math.max(...validValues) : 0;
  const positives = validValues.filter(v => v > 0);
  const minPositive = positives.length ? Math.min(...positives) : 0;
  // 通道A门槛：绝对变化≥max(3, 日均×0.25)
  const absGateA = Math.max(C.absGateBase, avg * C.absGateAvgRatio);
  // 通道B门槛：今日≥max(5, 日均×3)
  const gateB = Math.max(C.bBase, avg * C.bAvgRatio);

  // 逐日判定：
  // 通道A：前一天≥3 且 |Δ|≥max(3,日均×0.25) 且 |环比|≥50%
  // 通道B（起量事件）：前一天<3 且 今日≥max(5,日均×3) → 方向固定上升，不参与环比
  let maxValidRel = 0;   // 最大有效环比（仅通道A）
  let maxAbsChange = 0;  // 最大绝对变化（通道A+B）
  let anomalyDayCount = 0;
  let latestRateAbs = 0; // 最新趋势变化率绝对值（%）
  const daily: SkuAnomalyDailyItem[] = recordedSales.map((sales, i) => {
    const date = fullDates[i];
    // 无记录日期：标记 dataMissing，不参与环比
    if (sales === null) {
      return { date, sales: null, prevSales: null, changeRate: null, absChange: null, direction: null, isAnomaly: false, dataMissing: true, channel: null };
    }
    const prevItem = i > 0 ? daily[i - 1] : null;
    const prevSales = prevItem && !prevItem.dataMissing ? prevItem.sales : null;
    let changeRate: number | null = null;
    let absChange: number | null = null;
    let direction: 'up' | 'down' | 'flat' | null = null;
    let isAnomaly = false;
    let channel: 'A' | 'B' | null = null;
    if (prevSales !== null) {
      absChange = sales - prevSales;
      if (prevSales > 0) {
        changeRate = Math.round(((sales - prevSales) / prevSales) * 10000) / 100;
        direction = changeRate > 0 ? 'up' : changeRate < 0 ? 'down' : 'flat';
      }
      if (prevSales >= C.minPrevSales && Math.abs(absChange) >= absGateA && Math.abs(changeRate ?? 0) >= C.relGate) {
        // 通道A：有效环比
        isAnomaly = true;
        channel = 'A';
        anomalyDayCount++;
        if (Math.abs(changeRate) > maxValidRel) maxValidRel = Math.abs(changeRate);
        if (Math.abs(absChange) > maxAbsChange) maxAbsChange = Math.abs(absChange);
      } else if (prevSales < C.minPrevSales && sales >= gateB) {
        // 通道B：起量事件（含从0起量），方向固定上升，不参与环比
        isAnomaly = true;
        channel = 'B';
        direction = 'up';
        changeRate = null;
        anomalyDayCount++;
        if (Math.abs(absChange) > maxAbsChange) maxAbsChange = Math.abs(absChange);
      }
    }
    return { date, sales, prevSales, changeRate, absChange, direction, isAnomaly, dataMissing: false, channel };
  });

  // 连续有效异动日合并为事件，并定级 P0/P1/P2
  const events: SkuAnomalyEvent[] = [];
  let cursor = 0;
  while (cursor < daily.length) {
    if (!daily[cursor].isAnomaly) { cursor++; continue; }
    let end = cursor;
    while (end + 1 < daily.length && daily[end + 1].isAnomaly) end++;
    let evMaxAbs = 0, evMaxRel = 0, evDir: 'up' | 'down' = 'up';
    for (let i = cursor; i <= end; i++) {
      const d = daily[i];
      const abs = Math.abs(d.absChange || 0);
      // 通道B不参与环比，事件环比仅统计通道A
      const rel = d.channel === 'A' ? Math.abs(d.changeRate || 0) : 0;
      if (abs > evMaxAbs) { evMaxAbs = abs; evDir = (d.absChange || 0) > 0 ? 'up' : 'down'; }
      if (rel > evMaxRel) evMaxRel = rel;
    }
    const evSeverity: SkuAnomalySeverity =
      evMaxAbs >= Math.max(C.p0Base, avg * C.p0Ratio) ? 'P0'
        : (evMaxAbs >= Math.max(C.p1Base, avg * C.p1Ratio) || evMaxRel >= C.eventRelP1) ? 'P1'
          : 'P2';
    events.push({
      startDate: daily[cursor].date,
      endDate: daily[end].date,
      days: end - cursor + 1,
      direction: evDir,
      maxAbsChange: evMaxAbs,
      maxRelChange: evMaxRel,
      severity: evSeverity,
    });
    cursor = end + 1;
  }

  // 最新趋势方向：最后有记录日 vs 其前一天（昨天无记录自动回退T-2），阈值走数据库
  let latestDirection: 'up' | 'down' | 'flat' = 'flat';
  let dataIncomplete = daily[daily.length - 1].dataMissing;
  let baseIdx = daily.length - 1;
  while (baseIdx >= 0 && daily[baseIdx].dataMissing) baseIdx--;
  const baseItem = baseIdx >= 0 ? daily[baseIdx] : null;
  const basePrev = baseIdx >= 1 ? daily[baseIdx - 1] : null;
  if (baseItem && baseItem.sales !== null && basePrev && !basePrev.dataMissing && (basePrev.sales ?? 0) > 0) {
    const lastChangeRate = ((baseItem.sales ?? 0) - (basePrev.sales ?? 0)) / (basePrev.sales ?? 1);
    const t = ((thresholds[store]?.latestTrend) ?? 20) / 100;
    if (lastChangeRate > t) latestDirection = 'up';
    else if (lastChangeRate < -t) latestDirection = 'down';
  }

  // 总体趋势方向（后7天均值 vs 前7天均值，仅统计有记录日期，阈值走数据库）
  let overallDirection: 'up' | 'down' | 'flat' = 'flat';
  const halfStat = (from: number, to: number) => {
    let sum = 0, cnt = 0;
    for (let i = from; i < to; i++) {
      const v = recordedSales[i];
      if (v !== null) { sum += v; cnt++; }
    }
    return cnt > 0 ? sum / cnt : 0;
  };
  const firstHalfAvg = halfStat(0, 7);
  const secondHalfAvg = halfStat(7, 14);
  const tOverall = ((thresholds[store]?.overallTrend) ?? 15) / 100;
  if (firstHalfAvg > 0) {
    const overallChangeRate = (secondHalfAvg - firstHalfAvg) / firstHalfAvg;
    if (overallChangeRate > tOverall) overallDirection = 'up';
    else if (overallChangeRate < -tOverall) overallDirection = 'down';
  } else if (secondHalfAvg > 0) {
    // 前7天无销量、后7天开卖 → 从零到有，算上升
    overallDirection = 'up';
  }

  // 评分（0-100）：相对波动40 + 绝对冲击30 + 趋势强度20 + 连续性10
  const relScore = maxValidRel >= C.relGate
    ? 10 + (Math.min(maxValidRel, 200) - C.relGate) / (200 - C.relGate) * 30 : 0;
  const absScore = avg > 0 ? Math.min(maxAbsChange / avg / 2, 1) * 30 : 0;
  let overallRateAbs = 0;
  if (firstHalfAvg > 0) overallRateAbs = Math.abs((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;
  if (baseItem && baseItem.sales !== null && basePrev && !basePrev.dataMissing && (basePrev.sales ?? 0) > 0) {
    latestRateAbs = Math.abs(((baseItem.sales ?? 0) - (basePrev.sales ?? 0)) / (basePrev.sales ?? 1)) * 100;
  }
  const trendRaw = Math.max(
    latestRateAbs / ((thresholds[store]?.latestTrend) ?? 20),
    overallRateAbs / ((thresholds[store]?.overallTrend) ?? 15)
  );
  const trendScore = severityAwareTrend(events.length > 0, Number.isFinite(trendRaw) ? trendRaw : 0);
  const streakScore = Math.min(anomalyDayCount / 7, 1) * 10;
  const anomalyScore = Math.min(100, Math.round(relScore + absScore + trendScore + streakScore));

  const isMonitored = total >= C.minTotal;
  // 最近3天（窗口末3天）有事件 → 按最近事件方向分组；否则按总体趋势
  const recentSince = fullDates[fullDates.length - C.recentEventDays] || '';
  const recentEvent = events.filter(e => e.endDate >= recentSince).sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const recentEventDirection: 'up' | 'down' | null = recentEvent ? recentEvent.direction : null;
  // SKU严重度 = 所有事件中最高级
  const severityOrder: Record<SkuAnomalySeverity, number> = { P0: 3, P1: 2, P2: 1 };
  const severity: SkuAnomalySeverity | null = events.length > 0
    ? events.reduce((best, e) => (severityOrder[e.severity] > severityOrder[best] ? e.severity : best), events[0].severity)
    : null;

  return {
    latestSales: baseItem ? (baseItem.sales ?? 0) : 0,
    avgSales: Math.round(avg * 100) / 100,
    maxSales: max,
    minSales: minPositive,
    fluctuation: Math.round(maxValidRel * 100) / 100,
    latestDirection,
    overallDirection,
    isMonitored,
    isAnomaly: severity !== null,
    anomalyScore,
    severity,
    maxAbsChange,
    anomalyDayCount,
    recentEventDirection,
    dataIncomplete,
    events,
    daily,
  };
};

// 趋势强度评分：仅当存在异动事件（severity != null）时计入
function severityAwareTrend(hasEvents: boolean, raw: number) {
  return hasEvents ? Math.min(raw, 1) * 20 : 0;
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
  // --- 购物车预警（product_buybox 未处理数据）
  const [buyboxRecords, setBuyboxRecords] = useState<BuyboxRecord[]>([]);
  const [buyboxLoading, setBuyboxLoading] = useState(false);
  // --- 货件预警（product_shipment_notice 未处理数据）
  const [shipmentRecords, setShipmentRecords] = useState<ShipmentRecord[]>([]);
  const [shipmentLoading, setShipmentLoading] = useState(false);
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
  const [adRatioExpanded, setAdRatioExpanded] = useState<boolean>(false);
  const [buyboxExpanded, setBuyboxExpanded] = useState<boolean>(false);
  const [shipmentExpanded, setShipmentExpanded] = useState<boolean>(false);
  
  // --- 日期查询状态
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(
    [dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')]
  );

  // --- KPI卡片日期范围（默认昨天，可修改后KPI跟随变化）
  const [kpiDateRange, setKpiDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(
    [dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')]
  );
  // --- KPI快捷日期按钮：昨日/近7天/近30天/上月/自定义（参考首页消息搜索面板）
  const [kpiQuickKey, setKpiQuickKey] = useState<'yesterday' | '7d' | '30d' | 'lastMonth' | 'custom'>('yesterday');
  const handleKpiQuick = (key: 'yesterday' | '7d' | '30d' | 'lastMonth' | 'custom') => {
    setKpiQuickKey(key);
    if (key === 'custom') return;
    const y = dayjs().subtract(1, 'day');
    if (key === 'yesterday') {
      setKpiDateRange([y, y]);
    } else if (key === '7d') {
      setKpiDateRange([y.subtract(6, 'day'), y]);
    } else if (key === '30d') {
      setKpiDateRange([y.subtract(29, 'day'), y]);
    } else {
      const lm = dayjs().subtract(1, 'month');
      setKpiDateRange([lm.startOf('month'), lm.endOf('month')]);
    }
  };
  const [dateQueryResults, setDateQueryResults] = useState<DateQueryRecord[]>([]);
  // --- 店铺日期查询快捷按钮：昨日/近7天/近30天/上月/自定义（与KPI日期一致）
  const [dateQueryQuickKey, setDateQueryQuickKey] = useState<'yesterday' | '7d' | '30d' | 'lastMonth' | 'custom'>('yesterday');
  const handleDateQueryQuick = (key: 'yesterday' | '7d' | '30d' | 'lastMonth' | 'custom') => {
    setDateQueryQuickKey(key);
    if (key === 'custom') return;
    const y = dayjs().subtract(1, 'day');
    if (key === 'yesterday') {
      setDateRange([y, y]);
    } else if (key === '7d') {
      setDateRange([y.subtract(6, 'day'), y]);
    } else if (key === '30d') {
      setDateRange([y.subtract(29, 'day'), y]);
    } else {
      const lm = dayjs().subtract(1, 'month');
      setDateRange([lm.startOf('month'), lm.endOf('month')]);
    }
  };
  // --- 订单量单日对比数据：KPI选中单日时，显示月环比（上月同日）与周同比（上周同日）
  const [ordersCompare, setOrdersCompare] = useState<{
    curOrders: number;
    monthDate: string; monthOrders: number;
    weekDate: string; weekOrders: number;
  } | null>(null);
  const [dateQueryLoading, setDateQueryLoading] = useState(false);
  const [dateQueryPageSize, setDateQueryPageSize] = useState<number>(10);
  const [dateQueryCurrentPage, setDateQueryCurrentPage] = useState<number>(1);
  const [dateQueryExpanded, setDateQueryExpanded] = useState<boolean>(false);
  
  // --- 对比模式状态
  const [compareMode, setCompareMode] = useState<'store' | 'date'>('store');

  // --- 基数对比状态（用于GMV和广告占比的趋势判断）
  const [gmvBase, setGmvBase] = useState<string>('');
  const [adRatioBase, setAdRatioBase] = useState<string>('');
  const [storageRatioBase, setStorageRatioBase] = useState<string>('');

  // --- KPI悬停状态（null表示没有悬停）
  const [hoveredKpi, setHoveredKpi] = useState<string | null>(null);
  // KPI卡片点击固定：点击卡片固定详情框，点击其他位置取消固定
  const [pinnedKpi, setPinnedKpi] = useState<string | null>(null);

  useEffect(() => {
    if (!pinnedKpi) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-kpi-card]')) setPinnedKpi(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pinnedKpi]);

  // --- 趋势图日期饼图（订单量/广告占比）：悬停日期显示当天各店铺饼图预览，点击打开独立弹窗
  const [trendPieHover, setTrendPieHover] = useState<{ chart: 'orders' | 'adRatio'; date: string; left: number; top: number } | null>(null);
  const [trendPieModal, setTrendPieModal] = useState<{ chart: 'orders' | 'adRatio'; date: string } | null>(null);
  const ordersChartWrapRef = useRef<HTMLDivElement | null>(null);
  const adRatioChartWrapRef = useRef<HTMLDivElement | null>(null);
  // --- 饼图扇区悬停放大：记录当前悬停的扇区索引
  const [pieActiveIndex, setPieActiveIndex] = useState<number>(-1);
  // --- 当前生效的饼图悬停弹窗
  const trendPieActive = trendPieHover;
  // --- 弹窗内滚轮直接滚动下方店铺列表
  const trendPiePopupRef = useRef<HTMLDivElement | null>(null);
  const trendPieListRef = useRef<HTMLDivElement | null>(null);
  const hasTrendPiePopup = !!trendPieActive;

  // --- 悬停日期/图表切换时重置扇区悬停状态
  useEffect(() => {
    setPieActiveIndex(-1);
  }, [trendPieActive?.chart, trendPieActive?.date]);

  // --- 弹窗内任意位置滚动鼠标时，直接滚动下方店铺列表（阻止页面滚动）
  useEffect(() => {
    const popup = trendPiePopupRef.current;
    if (!popup) return;
    const onWheel = (e: WheelEvent) => {
      const list = trendPieListRef.current;
      if (!list || list.scrollHeight <= list.clientHeight) return;
      e.preventDefault();
      list.scrollTop += e.deltaY;
    };
    popup.addEventListener('wheel', onWheel, { passive: false });
    return () => popup.removeEventListener('wheel', onWheel);
  }, [hasTrendPiePopup, trendPieActive?.chart]);

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
    // 跟随"店铺筛选"+"只显示"（displayStoreIds）；未选择时默认全部
    const srcIds = displayStoreIds.length > 0 ? displayStoreIds : STORES.map(s => s.id);
    const selectedNames = STORES.filter(s => srcIds.includes(s.id)).map(s => s.name);
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
  }, [adWarnings, displayStoreIds, STORES, thresholds]);

  // --- 广告占比周监控：图表数据（复用上面的 TH）
  const adRatioDailyChartData = useMemo(() => {
    const TH = adRatioKpis.TH;
    // 跟随"店铺筛选"+"只显示"（displayStoreIds）；未选择时默认全部
    const srcIds = displayStoreIds.length > 0 ? displayStoreIds : STORES.map(s => s.id);
    const selectedNames = STORES.filter(s => srcIds.includes(s.id)).map(s => s.name);
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
  }, [adWarnings, displayStoreIds, STORES, thresholds, adRatioKpis.TH]);

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
        adChg: adChg == null ? null : parseFloat(adChg.toFixed(2)),
        salesChg: salesChg == null ? null : parseFloat(salesChg.toFixed(2)),
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

  // --- 购物车预警：加载 product_buybox 未处理数据（按筛选店铺）
  const loadBuyboxRecords = useCallback(async () => {
    if (isTestMode) {
      // 测试模式：购物车预警使用固定测试数据（日期相对今天生成，保持新鲜）
      const names = STORES.filter(s => selectedStoreIds.includes(s.id)).map(s => s.name);
      const d = (n: number) => dayjs().subtract(n, 'day').format('YYYY-MM-DD');
      const all: BuyboxRecord[] = [
        { id: 9101, date: d(1), sku: 'TEST-CART-001', product_name: '无线蓝牙耳机 入耳式（测试数据）', store: 'A加', status: null },
        { id: 9102, date: d(1), sku: 'TEST-CART-002', product_name: '不锈钢保温杯 500ml（测试数据）', store: 'A加', status: null },
        { id: 9103, date: d(2), sku: 'TEST-CART-003', product_name: '宠物自动喂食器 定时定量（测试数据）', store: 'A加', status: null },
        { id: 9104, date: d(1), sku: 'TEST-CART-004', product_name: '车载手机支架 重力感应（测试数据）', store: 'B美', status: null },
        { id: 9105, date: d(2), sku: 'TEST-CART-005', product_name: '瑜伽垫加厚防滑 双面纹（测试数据）', store: 'B美', status: null },
        { id: 9106, date: d(1), sku: 'TEST-CART-006', product_name: '厨房置物架 落地多层（测试数据）', store: 'A欧', status: null },
        { id: 9107, date: d(3), sku: 'TEST-CART-007', product_name: 'LED化妆镜 带灯可调光（测试数据）', store: 'B日', status: null },
      ];
      setBuyboxRecords(names.length > 0 ? all.filter(r => names.includes(r.store)) : all);
      return;
    }
    try {
      setBuyboxLoading(true);
      const names = STORES.filter(s => selectedStoreIds.includes(s.id)).map(s => s.name);
      const params: Record<string, any> = {};
      if (names.length > 0) params.stores = names.join(',');
      const res = await apiClient.get('/product-buybox', { params });
      setBuyboxRecords(res.data?.data || []);
    } catch (err) {
      console.error('加载购物车预警失败', err);
      setBuyboxRecords([]);
    } finally {
      setBuyboxLoading(false);
    }
  }, [selectedStoreIds, STORES]);

  useEffect(() => {
    loadBuyboxRecords();
  }, [loadBuyboxRecords]);

  // --- 购物车预警：有待处理数据自动展开，无数据自动收起
  useEffect(() => {
    setBuyboxExpanded(buyboxRecords.length > 0);
  }, [buyboxRecords]);

  // --- 购物车预警：标记单条为已处理
  const handleBuyboxProcess = useCallback(async (id: number) => {
    if (isTestMode) {
      // 测试模式：仅本地移除，不调用真实接口
      setBuyboxRecords(prev => prev.filter(r => r.id !== id));
      message.success('已标记为已处理');
      return;
    }
    try {
      await apiClient.post(`/product-buybox/${id}/process`);
      message.success('已标记为已处理');
      loadBuyboxRecords();
    } catch (err) {
      console.error('标记已处理失败', err);
      message.error('操作失败，请重试');
    }
  }, [loadBuyboxRecords]);

  // --- 购物车预警：按店铺分组展示（组头行 + 组内数据行）
  const buyboxGroups = useMemo(() => {
    const sorted = [...buyboxRecords].sort((a, b) =>
      a.store.localeCompare(b.store, 'zh') || b.date.localeCompare(a.date)
    );
    const map = new Map<string, BuyboxRecord[]>();
    sorted.forEach(r => {
      if (!map.has(r.store)) map.set(r.store, []);
      map.get(r.store)!.push(r);
    });
    return Array.from(map.entries());
  }, [buyboxRecords]);

  type BuyboxRow = BuyboxRecord & { isGroup?: boolean; count?: number; groupIds?: number[] };
  const buyboxTableRows = useMemo<BuyboxRow[]>(() => {
    const rows: BuyboxRow[] = [];
    buyboxGroups.forEach(([store, recs]) => {
      rows.push({ ...recs[0], id: -rows.length - 1, isGroup: true, store, count: recs.length, groupIds: recs.map(r => r.id) });
      recs.forEach(r => rows.push({ ...r, isGroup: false }));
    });
    return rows;
  }, [buyboxGroups]);

  // --- 购物车预警：一键处理某店铺全部未处理记录
  const handleBuyboxProcessAll = useCallback(async (storeName: string, ids: number[]) => {
    if (isTestMode) {
      setBuyboxRecords(prev => prev.filter(r => !ids.includes(r.id)));
      message.success(`已处理 ${storeName} 的 ${ids.length} 条记录`);
      return;
    }
    try {
      await apiClient.post('/product-buybox/process-batch', { ids });
      message.success(`已处理 ${storeName} 的 ${ids.length} 条记录`);
      loadBuyboxRecords();
    } catch (err) {
      console.error('一键处理失败', err);
      message.error('操作失败，请重试');
    }
  }, [loadBuyboxRecords]);

  // --- 购物车预警：查看已处理记录
  const [processedModalVisible, setProcessedModalVisible] = useState(false);
  const [processedRecords, setProcessedRecords] = useState<BuyboxRecord[]>([]);
  const [processedLoading, setProcessedLoading] = useState(false);

  const openProcessedModal = useCallback(async () => {
    setProcessedModalVisible(true);
    if (isTestMode) {
      // 测试模式：无已处理记录，直接展示空状态
      setProcessedRecords([]);
      return;
    }
    setProcessedLoading(true);
    try {
      const res = await apiClient.get('/product-buybox', { params: { processed: true } });
      setProcessedRecords(res.data?.data || []);
    } catch (err) {
      console.error('加载已处理记录失败', err);
      setProcessedRecords([]);
    } finally {
      setProcessedLoading(false);
    }
  }, []);

  // --- 货件预警（product_shipment_notice，逻辑与购物车预警一致）
  const loadShipmentRecords = useCallback(async () => {
    if (isTestMode) {
      // 测试模式：货件预警使用固定测试数据
      const names = STORES.filter(s => selectedStoreIds.includes(s.id)).map(s => s.name);
      const d = (n: number) => dayjs().subtract(n, 'day').format('YYYY-MM-DD');
      const all: ShipmentRecord[] = [
        { id: 9201, date: d(1), store: 'A加', shipment_code: 'FBA15TEST01U001', status: null },
        { id: 9202, date: d(1), store: 'A加', shipment_code: 'FBA15TEST01U002', status: null },
        { id: 9203, date: d(2), store: 'A加', shipment_code: 'FBA15TEST01U003', status: null },
        { id: 9204, date: d(1), store: 'B美', shipment_code: 'FBA15TEST02U001', status: null },
        { id: 9205, date: d(1), store: 'A欧', shipment_code: 'FBA15TEST03U001', status: null },
        { id: 9206, date: d(2), store: 'A欧', shipment_code: 'FBA15TEST03U002', status: null },
        { id: 9207, date: d(3), store: 'B日', shipment_code: 'FBA15TEST04U001', status: null },
      ];
      setShipmentRecords(names.length > 0 ? all.filter(r => names.includes(r.store)) : all);
      return;
    }
    try {
      setShipmentLoading(true);
      const names = STORES.filter(s => selectedStoreIds.includes(s.id)).map(s => s.name);
      const params: Record<string, any> = {};
      if (names.length > 0) params.stores = names.join(',');
      const res = await apiClient.get('/product-shipment-notice', { params });
      setShipmentRecords(res.data?.data || []);
    } catch (err) {
      console.error('加载货件预警失败', err);
      setShipmentRecords([]);
    } finally {
      setShipmentLoading(false);
    }
  }, [selectedStoreIds, STORES]);

  useEffect(() => {
    loadShipmentRecords();
  }, [loadShipmentRecords]);

  // --- 货件预警：有待处理数据自动展开，无数据自动收起
  useEffect(() => {
    setShipmentExpanded(shipmentRecords.length > 0);
  }, [shipmentRecords]);

  // --- 货件预警：按店铺分组 + 店铺内按日期分组（组头行 + 日期头行 + 数据行）
  const shipmentGroups = useMemo(() => {
    const sorted = [...shipmentRecords].sort((a, b) =>
      a.store.localeCompare(b.store, 'zh') || b.date.localeCompare(a.date)
    );
    const map = new Map<string, ShipmentRecord[]>();
    sorted.forEach(r => {
      if (!map.has(r.store)) map.set(r.store, []);
      map.get(r.store)!.push(r);
    });
    return Array.from(map.entries());
  }, [shipmentRecords]);

  type ShipmentRow = ShipmentRecord & { isGroup?: boolean; isDateGroup?: boolean; count?: number; groupIds?: number[]; dateCount?: number; dateIds?: number[] };
  const shipmentTableRows = useMemo<ShipmentRow[]>(() => {
    const rows: ShipmentRow[] = [];
    let seq = 0;
    shipmentGroups.forEach(([store, recs]) => {
      seq += 1;
      rows.push({ ...recs[0], id: -seq * 1000 - 1, isGroup: true, store, count: recs.length, groupIds: recs.map(r => r.id) });
      const byDate = new Map<string, ShipmentRecord[]>();
      recs.forEach(r => {
        if (!byDate.has(r.date)) byDate.set(r.date, []);
        byDate.get(r.date)!.push(r);
      });
      Array.from(byDate.entries()).forEach(([date, drecs]) => {
        seq += 1;
        rows.push({ ...drecs[0], id: -seq * 1000 - 2, isDateGroup: true, store, date, dateCount: drecs.length, dateIds: drecs.map(r => r.id) });
        drecs.forEach(r => rows.push({ ...r }));
      });
    });
    return rows;
  }, [shipmentGroups]);

  // --- 货件预警：一键确认某店铺全部未确认记录（数据库状态写为已确认）
  const handleShipmentProcessAll = useCallback(async (storeName: string, ids: number[]) => {
    if (isTestMode) {
      setShipmentRecords(prev => prev.filter(r => !ids.includes(r.id)));
      message.success(`已确认 ${storeName} 的 ${ids.length} 条记录`);
      return;
    }
    try {
      await apiClient.post('/product-shipment-notice/process-batch', { ids });
      message.success(`已确认 ${storeName} 的 ${ids.length} 条记录`);
      loadShipmentRecords();
    } catch (err) {
      console.error('一键确认失败', err);
      message.error('操作失败，请重试');
    }
  }, [loadShipmentRecords]);

  // --- 货件预警：确认某店铺某日期的记录
  const handleShipmentConfirmDate = useCallback(async (storeName: string, date: string, ids: number[]) => {
    if (isTestMode) {
      setShipmentRecords(prev => prev.filter(r => !ids.includes(r.id)));
      message.success(`已确认 ${storeName} ${date} 的 ${ids.length} 条记录`);
      return;
    }
    try {
      await apiClient.post('/product-shipment-notice/process-batch', { ids });
      message.success(`已确认 ${storeName} ${date} 的 ${ids.length} 条记录`);
      loadShipmentRecords();
    } catch (err) {
      console.error('确认失败', err);
      message.error('操作失败，请重试');
    }
  }, [loadShipmentRecords]);

  // --- 货件预警：查看已确认记录
  const [shipmentProcessedModalVisible, setShipmentProcessedModalVisible] = useState(false);
  const [shipmentProcessedRecords, setShipmentProcessedRecords] = useState<ShipmentRecord[]>([]);
  const [shipmentProcessedLoading, setShipmentProcessedLoading] = useState(false);

  const openShipmentProcessedModal = useCallback(async () => {
    setShipmentProcessedModalVisible(true);
    if (isTestMode) {
      // 测试模式：无已确认记录，直接展示空状态
      setShipmentProcessedRecords([]);
      return;
    }
    setShipmentProcessedLoading(true);
    try {
      const res = await apiClient.get('/product-shipment-notice', { params: { processed: true } });
      setShipmentProcessedRecords(res.data?.data || []);
    } catch (err) {
      console.error('加载已确认记录失败', err);
      setShipmentProcessedRecords([]);
    } finally {
      setShipmentProcessedLoading(false);
    }
  }, []);


  // SKU异动检测结果：最近3天有事件→按事件方向分组，否则按总体趋势方向分组（只保留观察池口径）
  const skuAnomalyGroups = useMemo(() => {
    const selectedStoreNames = STORES.filter(s => displayStoreIds.includes(s.id)).map(s => s.name);
    const filtered = skuAnomalyTestData.filter(item => item.isMonitored && (selectedStoreNames.length === 0 || selectedStoreNames.includes(item.store)));
    const severityOrder: Record<string, number> = { P0: 3, P1: 2, P2: 1 };
    const sortFn = (a: typeof filtered[0], b: typeof filtered[0]) => {
      const sa = a.severity ? severityOrder[a.severity] : 0;
      const sb = b.severity ? severityOrder[b.severity] : 0;
      if (sa !== sb) return sb - sa;
      return b.anomalyScore - a.anomalyScore;
    };
    const groups: Record<'up' | 'down' | 'flat', typeof filtered> = { up: [], down: [], flat: [] };
    filtered.forEach(item => {
      const dir = item.recentEventDirection ?? item.overallDirection;
      groups[dir].push(item);
    });
    (Object.keys(groups) as Array<'up' | 'down' | 'flat'>).forEach(dir => {
      groups[dir].sort(sortFn);
    });
    return groups;
  }, [skuAnomalyTestData, selectedStoreIds, STORES]);

  // P0/P1/P2 统计（标题徽章用）
  const skuAnomalySeverityStats = useMemo(() => {
    const selectedStoreNames = STORES.filter(s => displayStoreIds.includes(s.id)).map(s => s.name);
    const stats = { P0: 0, P1: 0, P2: 0 };
    skuAnomalyTestData.forEach(item => {
      if (item.isMonitored && item.severity && (selectedStoreNames.length === 0 || selectedStoreNames.includes(item.store))) {
        stats[item.severity]++;
      }
    });
    return stats;
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
  const fetchAllSkuSalesData = async (customStart?: string, customEnd?: string) => {
    if (displayStoreIds.length === 0) {
      console.log('fetchAllSkuSalesData: 未选择店铺');
      return [];
    }

    try {
      const selectedStores = STORES.filter(s => displayStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);
      if (storeNames.length === 0) return [];
      // 默认近 7 天，或按传入的自定义日期范围
      const yesterday = dayjs().subtract(1, 'day');
      const startDate = customStart || yesterday.clone().subtract(6, 'day').format('YYYY-MM-DD');
      const endDate = customEnd || yesterday.format('YYYY-MM-DD');

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
          
          const existingStore = aggregated[sku].stores.find(s => s.storeName === storeName && s.date === record.date);
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
  const [skuModalMode, setSkuModalMode] = useState<'recent7' | 'dateRange'>('recent7');
  const [skuModalDateLabel, setSkuModalDateLabel] = useState('');
  // --- TOP10卡片模式：近7天 / 筛选日期（点击"按筛选日期查看"后图表跟随切换）
  const [top10Mode, setTop10Mode] = useState<'recent7' | 'dateRange'>('recent7');
  const [top10DateData, setTop10DateData] = useState<SkuSalesRecord[]>([]);
  const [top10DateLabel, setTop10DateLabel] = useState('');
  // --- 右下角悬浮球：板块导航（悬停展开，点击定位，可拖拽移动）
  const [sectionNavOpen, setSectionNavOpen] = useState(false);
  const [ballPos, setBallPos] = useState<{ left: number; top: number } | null>(null);
  const ballDragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number; moved: boolean } | null>(null);
  const ballMovedRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = ballDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      d.moved = true;
      ballMovedRef.current = true;
      const left = Math.min(Math.max(0, d.origLeft + dx), window.innerWidth - 48);
      const top = Math.min(Math.max(0, d.origTop + dy), window.innerHeight - 48);
      setBallPos({ left, top });
    };
    const onUp = () => {
      ballDragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleBallMouseDown = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    ballDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: ballPos ? ballPos.left : rect.left,
      origTop: ballPos ? ballPos.top : rect.top,
      moved: false,
    };
    e.preventDefault();
  };

  const handleBallClick = () => {
    if (ballMovedRef.current) {
      ballMovedRef.current = false;
      return;
    }
    setSectionNavOpen(v => !v);
  };
  const SECTION_NAVS = [
    { id: 'section-kpi', title: '📋 KPI总览' },
    { id: 'section-alerts', title: '⚠️ 实时预警' },
    { id: 'section-compare', title: '📊 数据对比' },
    { id: 'section-top10', title: '🏆 商品销量TOP10' },
    { id: 'section-sku-trend', title: '📈 SKU销量波动趋势' },
    { id: 'section-aging', title: '📦 超库龄SKU分布' },
    { id: 'section-ad-ratio', title: '📊 广告占比周监控' },
    { id: 'section-buybox', title: '🛒 购物车预警' },
    { id: 'section-shipment', title: '🚚 货件预警' },
  ];
  // --- 导航点击：先展开对应板块的折叠内容，再滚动定位（展开改变页面高度，等一帧后定位更准）
  const expandSectionByNavId = (id: string) => {
    if (id === 'section-aging') setProductAgingExpanded(true);
    if (id === 'section-ad-ratio') setAdRatioExpanded(true);
    if (id === 'section-buybox') setBuyboxExpanded(true);
    if (id === 'section-shipment') setShipmentExpanded(true);
  };
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const handleSectionNavClick = (id: string) => {
    setSectionNavOpen(false);
    expandSectionByNavId(id);
    setTimeout(() => scrollToSection(id), 100);
  };

  // --- 支持外部链接定位板块：/data-alert?section=section-buybox / section-shipment 等（延迟等待数据渲染，同时展开折叠内容）
  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get('section');
    if (!section) return;
    expandSectionByNavId(section);
    const timer = setTimeout(() => scrollToSection(section), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 打开详情弹窗：按当前TOP10模式获取数据（近7天 / 筛选日期）
  const handleOpenSkuModal = async () => {
    const isDateRange = top10Mode === 'dateRange' && dateRange && dateRange[0] && dateRange[1];
    const startDate = isDateRange ? dateRange![0].format('YYYY-MM-DD') : undefined;
    const endDate = isDateRange ? dateRange![1].format('YYYY-MM-DD') : undefined;
    const data = await fetchAllSkuSalesData(startDate, endDate);
    setAllSkuSalesData(data);
    setSkuModalMode(isDateRange ? 'dateRange' : 'recent7');
    if (isDateRange) {
      setSkuModalDateLabel(`${dateRange![0].format('MM-DD')} ~ ${dateRange![1].format('MM-DD')}`);
    } else {
      const yesterday = dayjs().subtract(1, 'day');
      setSkuModalDateLabel(`近 7 天 (${yesterday.clone().subtract(6, 'day').format('MM-DD')} ~ ${yesterday.format('MM-DD')})`);
    }
    setShowSkuModal(true);
  };

  // --- 切换TOP10为近7天模式（图表回退到近7天榜单，不打开弹窗）
  const handleSwitchTop10Recent7 = () => {
    setTop10Mode('recent7');
    setSkuModalMode('recent7');
    setTop10DateLabel('');
  };

  // --- 按筛选日期查看（TOP10图表同步切换为筛选日期数据）
  const handleOpenSkuModalByDate = async () => {
    if (!dateRange || !dateRange[0] || !dateRange[1]) {
      message.warning('请先选择日期范围');
      return;
    }
    const startDate = dateRange[0].format('YYYY-MM-DD');
    const endDate = dateRange[1].format('YYYY-MM-DD');

    // TOP10图表切换为筛选日期范围的数据
    try {
      const selectedStores = STORES.filter(s => displayStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);
      if (storeNames.length > 0) {
        const topSkus = await fetchTopSkus(storeNames, startDate, endDate, 10);
        const skuMap = new Map<string, SkuSalesRecord>();
        topSkus.forEach(record => {
          if (!skuMap.has(record.sku)) {
            skuMap.set(record.sku, { sku: record.sku, totalSales: 0, stores: [] });
          }
          const skuRecord = skuMap.get(record.sku)!;
          skuRecord.totalSales += record.total_sales;
          const existingStore = skuRecord.stores.find(s => s.storeName === record.store);
          if (existingStore) {
            existingStore.sales += record.total_sales;
          } else {
            skuRecord.stores.push({ storeId: '', storeName: record.store, date: record.date || endDate, sales: record.total_sales });
          }
        });
        setTop10DateData(Array.from(skuMap.values()).sort((a, b) => b.totalSales - a.totalSales));
      }
    } catch (error) {
      console.error('按筛选日期加载TOP10失败:', error);
      setTop10DateData([]);
    }

    // 仅切换内联TOP10图表为筛选日期数据，不打开弹窗（弹窗由"查看详情"触发）
    setTop10Mode('dateRange');
    setTop10DateLabel(`${dateRange[0].format('MM-DD')} ~ ${dateRange[1].format('MM-DD')}`);
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
        ? parseFloat((data.weightedAdRatioSum / data.gmvForAdRatioSum).toFixed(2))
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

  // --- 计算聚合的指标
  const aggregateMetrics = useCallback((storeIds: string[], storeData: Record<string, StoreData>): MetricData => {
    if (storeIds.length === 0) {
      return {
        orders: 0, adRatio: 0, adSpend: 0, sales: 0, adSales: 0, acos: 0, gmv: 0, fbaTotalStock: 0, fbaStockValue: 0, grossProfit: 0, storageRatio: 0, storageFee: 0, salesAmount: 0
      };
    }

    let totalOrders = 0;
    let totalAdSpend = 0;
    let totalSales = 0;
    let totalAdSales = 0;
    let totalGmv = 0;
    let totalGrossProfit = 0;
    let totalStorageFee = 0;
    let totalSalesAmount = 0;

    // FBA总库存和货值：全部筛选店铺求和
    let fbaTotalStock = 0;
    let fbaStockValue = 0;
    // FBA快照日期：取各店铺中最新的快照日期
    let fbaStockDate = '';

    // 数据为0的店铺（昨日无数据）不参与聚合计算
    const validStoreIds = storeIds.filter(id => {
      const sd = storeData[id];
      return sd && sd.currentMetrics.orders > 0;
    });

    storeIds.forEach((id) => {
      const sd = storeData[id];
      if (sd) {
        // FBA库存快照：所有选中店铺求和（含无订单店铺，库存快照与订单无关）
        fbaTotalStock += sd.currentMetrics.fbaTotalStock || 0;
        fbaStockValue += sd.currentMetrics.fbaStockValue || 0;
        const d = sd.currentMetrics.fbaStockDate || '';
        if (d && (!fbaStockDate || d > fbaStockDate)) fbaStockDate = d;
        if (sd.currentMetrics.orders <= 0) return;
        totalOrders += sd.currentMetrics.orders;
        totalAdSpend += sd.currentMetrics.adSpend;
        totalSales += sd.currentMetrics.sales;
        totalAdSales += sd.currentMetrics.adSales;
        totalGmv += sd.currentMetrics.gmv;
        totalGrossProfit += sd.currentMetrics.grossProfit;
        totalStorageFee += sd.currentMetrics.storageFee || 0;
        totalSalesAmount += sd.currentMetrics.salesAmount || 0;
      }
    });

    // 广告占比 = 广告费用总和 ÷ 利润报表销售额总和（数据库真实值）
    const aggregateAdRatio = totalSalesAmount > 0 ? ((totalAdSpend / totalSalesAmount) * 100) : 0;
    // 仓储占比 = 仓储费用总和 ÷ 利润报表销售额总和（数据库真实值）
    const aggregateStorageRatio = totalSalesAmount > 0 ? ((totalStorageFee / totalSalesAmount) * 100) : 0;
    // ACOS = 广告花费 / 广告销售额，多店铺时按总花费/总销售额计算
    const aggregateAcos = totalAdSales > 0 ? ((totalAdSpend / totalAdSales) * 100) : 0;

    return {
      orders: totalOrders,
      adRatio: parseFloat(aggregateAdRatio.toFixed(2)),
      acos: parseFloat(aggregateAcos.toFixed(2)),
      adSpend: totalAdSpend,
      sales: totalSales,
      adSales: totalAdSales,
      gmv: totalGmv,
      fbaTotalStock,
      fbaStockValue,
      fbaStockDate,
      grossProfit: totalGrossProfit,
      storageRatio: parseFloat(aggregateStorageRatio.toFixed(2)),
    };
  }, [STORES]);

  // --- 百分比格式化：保留两位小数但去掉末尾多余的零（14.00→14, 14.10→14.1, 14.14→14.14）
  const fmtPct = (v: number) => parseFloat(v.toFixed(2)).toString();

  // --- KPI指标名称和格式化映射
  const kpiInfo = {
    orders: { name: '订单量', unit: '单', format: (v: number) => v.toLocaleString() },
    gmv: { name: 'GMV', unit: '¥', format: (v: number) => v.toLocaleString() },
    adRatio: { name: '广告占比', unit: '%', format: (v: number) => fmtPct(v) },
    acos: { name: 'ACOS', unit: '%', format: (v: number) => fmtPct(v) },
    fbaTotalStock: { name: 'FBA总库存', unit: '件', format: (v: number) => v.toLocaleString() },
    grossProfit: { name: '毛利润', unit: '¥', format: (v: number) => v.toLocaleString() },
    storageRatio: { name: '仓储占比', unit: '%', format: (v: number) => fmtPct(v) },
    avgOrderPrice: { name: '平均客单价', unit: '¥', format: (v: number) => v.toLocaleString() },
  };

  // --- KPI日期范围标签（必须在 renderKpiDetail 之前声明，避免 TDZ）
  const kpiDateLabel = useMemo(() => {
    if (!kpiDateRange || !kpiDateRange[0] || !kpiDateRange[1]) return '昨日';
    const start = kpiDateRange[0].format('MM-DD');
    const end = kpiDateRange[1].format('MM-DD');
    return start === end ? start : `${start} ~ ${end}`;
  }, [kpiDateRange]);

  // --- 渲染KPI下方详细内容（各店铺该KPI数据）
  const renderKpiDetail = useCallback((kpiType: string) => {
    if (selectedStoreIds.length === 0) {
      return null;
    }

    const info = kpiInfo[kpiType as keyof typeof kpiInfo];
    if (!info) return null;

    // ACOS特殊处理：悬停时显示提示
    const isAcos = kpiType === 'acos';
    const isFbaStock = kpiType === 'fbaTotalStock';
    const isMultiStore = selectedStoreIds.length > 1;
    
    // 悬停时显示所有店铺数据（不限制）
    const isAvgOrderPrice = kpiType === 'avgOrderPrice';
    const storeData = selectedStoreIds
      .filter(id => {
        const sd = storesData[id];
        // 数据为0的店铺（昨日无数据）不显示在详情中；ACOS额外过滤掉acos为0的店铺
        if (!sd || sd.currentMetrics.orders <= 0) return false;
        if (isAcos && sd.currentMetrics.acos <= 0) return false;
        return true;
      })
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
          value: isAvgOrderPrice ? Math.round(rawValue) : parseFloat(rawValue.toFixed(2)),
          fbaStockValue: metrics.fbaStockValue,
          gmv: metrics.gmv,
          orders: metrics.orders,
        };
      })
      .sort((a, b) => {
        return b.value - a.value;
      });

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
          {info.name} - 各店铺{kpiDateLabel}数据
        </div>
        
        {isAcos && isMultiStore && (
          <div style={{
            backgroundColor: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: '4px',
            padding: '8px',
            marginBottom: '10px',
            fontSize: '12px',
            color: '#d48806'
          }}>
            💡 多店铺时ACOS卡片仅显示第一个选中店铺的数值，以下为各店铺明细。
          </div>
        )}
        
        <div style={{ maxHeight: '250px', overflow: 'auto' }}>
          {storeData.map((item, index) => {
            let displayValue = '';
            if (isAvgOrderPrice) {
              // 平均客单价详情：显示每个店铺的平均客单价
              displayValue = `¥${item.value.toLocaleString()}`;
            } else if (isFbaStock) {
              displayValue = `${item.value.toLocaleString()}件 / ¥${item.fbaStockValue?.toLocaleString() || '0'}`;
            } else if (info.unit === '¥') {
              displayValue = `¥${item.value.toLocaleString()}`;
            } else if (info.unit === '%') {
              displayValue = `${fmtPct(item.value)}%`;
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
  }, [selectedStoreIds, storesData, STORES, kpiInfo, kpiDateLabel]);

  const currentMetrics = useMemo(() => {
    return aggregateMetrics(displayStoreIds, storesData);
  }, [displayStoreIds, storesData, aggregateMetrics]);

  // --- ACOS卡片：多店铺时仅显示第一个有数据的店铺的ACOS，点击查看各店铺详情
  const acosCard = useMemo(() => {
    // 找第一个有数据（orders > 0 且 acos > 0）的店铺
    const validId = displayStoreIds.find(id => storesData[id] && storesData[id].currentMetrics.orders > 0 && storesData[id].currentMetrics.acos > 0);
    const validSd = validId ? storesData[validId] : undefined;
    return {
      value: validSd ? validSd.currentMetrics.acos : currentMetrics.acos,
      storeName: displayStoreIds.length > 1 ? (validSd?.info.name || '') : '',
    };
  }, [displayStoreIds, storesData, currentMetrics]);

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

  // --- 趋势图日期饼图：根据悬停/固定的日期提取当天各店铺数据（颜色与趋势图一致）
  // --- 通用：按 (chart, date) 计算当天各店铺饼图数据
  const buildTrendPieData = (chart: 'orders' | 'adRatio', date: string) => {
    const rows = chart === 'orders' ? ordersTrendData : adRatioTrendData;
    const row: any = rows.find(r => r.date === date);
    if (!row) return [];
    return selectedStoreIds
      .map((storeId, index) => {
        const storeName = STORES.find(s => s.id === storeId)?.name || '';
        return {
          name: storeName,
          value: Number(row[storeName] || 0),
          color: CHART_COLORS[index % CHART_COLORS.length],
        };
      })
      .filter(item => item.value > 0);
  };

  const trendPieData = useMemo(() => {
    if (!trendPieActive) return [];
    return buildTrendPieData(trendPieActive.chart, trendPieActive.date);
  }, [trendPieActive, ordersTrendData, adRatioTrendData, selectedStoreIds, STORES]);

  const trendPieModalData = useMemo(() => {
    if (!trendPieModal) return [];
    return buildTrendPieData(trendPieModal.chart, trendPieModal.date);
  }, [trendPieModal, ordersTrendData, adRatioTrendData, selectedStoreIds, STORES]);

  // --- 趋势图鼠标事件：悬停更新饼图弹窗位置，点击图表打开独立弹窗
  const buildTrendPieState = (chart: 'orders' | 'adRatio', state: any, wrapEl: HTMLDivElement | null) => {
    if (!state || state.activeTooltipIndex == null || state.activeTooltipIndex < 0 || !state.activeLabel) return null;
    const chartX: number = state.chartX ?? 0;
    const chartY: number = state.chartY ?? 0;
    const wrapW = wrapEl?.clientWidth ?? 420;
    const popupW = 320;
    let left = chartX + 14;
    if (left + popupW > wrapW) left = chartX - popupW - 14;
    left = Math.max(0, Math.min(left, Math.max(0, wrapW - popupW)));
    const top = Math.max(0, Math.min(chartY - 12, 60));
    return { chart, date: state.activeLabel as string, left, top };
  };

  const handleTrendMouseMove = (chart: 'orders' | 'adRatio', wrapRef: React.MutableRefObject<HTMLDivElement | null>) => (state: any) => {
    setTrendPieHover(buildTrendPieState(chart, state, wrapRef.current));
  };

  // --- 鼠标从图表移入饼图弹窗时保留弹窗（relatedTarget在弹窗内则不清除悬停）
  const handleTrendMouseLeave = (_state: any, e: React.MouseEvent) => {
    const rt = e?.relatedTarget as HTMLElement | null;
    if (rt && typeof rt.closest === 'function' && rt.closest('[data-trend-pie-popup]')) return;
    setTrendPieHover(null);
  };

  const handleTrendChartClick = (chart: 'orders' | 'adRatio') => (state: any) => {
    if (!state || state.activeTooltipIndex == null || state.activeTooltipIndex < 0 || !state.activeLabel) return;
    setTrendPieModal({ chart, date: state.activeLabel as string });
    setTrendPieHover(null);
  };

  // --- 渲染趋势图日期饼图弹窗
  const renderTrendPiePopup = (chart: 'orders' | 'adRatio') => {
    if (!trendPieActive || trendPieActive.chart !== chart) return null;
    const isOrders = chart === 'orders';
    const total = trendPieData.reduce((s, i) => s + i.value, 0);
    return (
      <div
        ref={trendPiePopupRef}
        data-trend-pie-popup
        onMouseLeave={() => {
          setTrendPieHover(null);
        }}
        onClick={() => {
          setTrendPieModal({ chart, date: trendPieActive.date });
          setTrendPieHover(null);
        }}
        style={{
          position: 'absolute',
          left: trendPieActive.left,
          top: trendPieActive.top,
          width: '320px',
          backgroundColor: '#fff',
          borderRadius: '8px',
          border: '1px solid #eee',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          zIndex: 1100,
          padding: '12px 14px',
          cursor: 'pointer',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px', color: '#333' }}>
          {trendPieActive.date} 各店铺{isOrders ? '订单量' : '广告占比'}
          <span style={{ fontSize: '12px', color: '#999', fontWeight: 400, marginLeft: '6px' }}>点击查看大图</span>
        </div>
        {trendPieData.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#999', padding: '16px 0', textAlign: 'center' }}>当天暂无数据</div>
        ) : (
          <>
            <PieChart width={292} height={200}>
              <Pie
                data={trendPieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={80}
                paddingAngle={2}
                stroke="#fff"
                activeIndex={pieActiveIndex >= 0 ? pieActiveIndex : undefined}
                activeShape={(props: any) => <Sector {...props} outerRadius={props.outerRadius + 10} />}
                onMouseEnter={(_data: any, index: number) => setPieActiveIndex(index)}
                onMouseLeave={() => setPieActiveIndex(-1)}
              >
                {trendPieData.map(item => (
                  <Cell key={item.name} fill={item.color} />
                ))}
              </Pie>
              <RechartsTooltip
                formatter={(value: any, name: any) => [isOrders ? `${Number(value).toLocaleString()} 单` : `${fmtPct(Number(value))}%`, name]}
                wrapperStyle={{ zIndex: 1200 }}
              />
            </PieChart>
            <div ref={trendPieListRef} style={{ maxHeight: '150px', overflow: 'auto', marginTop: '4px' }}>
              {trendPieData.map((item, idx) => (
                <div
                  key={item.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 6px',
                    margin: '0 -6px',
                    fontSize: '13px',
                    borderRadius: '4px',
                    backgroundColor: pieActiveIndex === idx ? '#e6f4ff' : 'transparent',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ width: '9px', height: '9px', borderRadius: '2px', backgroundColor: item.color, marginRight: '7px', flexShrink: 0 }} />
                    {item.name}
                  </span>
                  <span style={{ fontWeight: 600, color: '#333', marginLeft: '8px', flexShrink: 0 }}>
                    {isOrders ? item.value.toLocaleString() : `${fmtPct(item.value)}%`}
                    <span style={{ color: '#999', fontWeight: 400, marginLeft: '5px' }}>{total > 0 ? `${((item.value / total) * 100).toFixed(0)}%` : '0%'}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

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

        if ((sd.avgAdRatio30d ?? metrics.adRatio) > storeThresholds.adRatio) {
          alerts.push({
            id: alertId++,
            time: dayjs().format('HH:mm:ss'),
            metricName: '广告占比',
            currentValue: fmtPct(sd.avgAdRatio30d ?? metrics.adRatio) + '%',
            threshold: '>' + storeThresholds.adRatio + '%',
            suggestion: '广告花费偏高（近30天均值），建议优化投放',
            severity: (sd.avgAdRatio30d ?? metrics.adRatio) > storeThresholds.adRatio * 1.1 ? 'red' : 'orange',
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

  // --- 按筛选日期加载SKU趋势每日销量（切换「按筛选日期」模式或日期变化时调用）
  // 注意：该函数依赖 skuSalesData（随每次商品销量加载而变化），函数身份不稳定，
  // 禁止直接放入 effect 依赖数组，否则会形成「加载→identity变化→effect重跑→再加载」死循环
  const loadSkuTrendForDateRange = useCallback(async () => {
    if (!dateRange || !dateRange[0] || !dateRange[1] || selectedStoreIds.length === 0) return;
    const startDate = dateRange[0].format('YYYY-MM-DD');
    const endDate = dateRange[1].format('YYYY-MM-DD');
    try {
      const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);
      const skus = selectedSkusForTrend.length > 0
        ? selectedSkusForTrend
        : skuSalesData.slice(0, 10).map(s => s.sku);
      if (skus.length === 0) return;
      const dailySales = await fetchSkuDailySales(storeNames, skus, startDate, endDate);
      setSkuDailySalesData(dailySales);
    } catch (error) {
      console.error('按筛选日期刷新SKU趋势数据失败:', error);
    }
  }, [dateRange, selectedStoreIds, selectedSkusForTrend, skuSalesData]);

  // latest-ref 模式：让店铺变化 effect 能调用最新版本而不依赖其不稳定身份
  const loadSkuTrendRef = useRef(loadSkuTrendForDateRange);
  loadSkuTrendRef.current = loadSkuTrendForDateRange;

  // --- 日期变化时同步刷新其他受影响数据（无需手动点按钮）：
  // 1) TOP10处于筛选日期模式 → 自动刷新榜单
  // 2) SKU趋势处于按筛选日期模式 → 按新日期范围重拉每日销量
  useEffect(() => {
    if (!dateRange || !dateRange[0] || !dateRange[1]) return;

    if (top10Mode === 'dateRange') {
      handleOpenSkuModalByDate();
    }

    if (trendDateMode === 'dateRange') {
      loadSkuTrendForDateRange();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

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
        const salesAmount = gmv;
        const storageFee = Math.floor(gmv * storageRatio / 100);

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
            currentValue: fmtPct(adRatio) + '%',
            threshold: '>' + storeThresholds.adRatio + '%',
            suggestion: '广告花费偏高（近30天均值），建议优化投放',
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
            fbaStockDate: yesterday.format('YYYY-MM-DD'),
            grossProfit,
            storageRatio,
            storageFee,
            salesAmount,
          },
          ordersTrend,
          adRatioTrend,
          alerts,
          avgAdRatio30d: adRatio,
        };
      });

      setStoresData(testStoreData);

      // 生成测试 adWarnings（广告占比周监控模块用）
      const testWarnings: DataWarningRecord[] = [];
      selectedStoreIds.forEach(storeId => {
        const store = STORES.find(s => s.id === storeId);
        if (!store) return;
        for (let i = 29; i >= 0; i--) {
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
      setOrdersCompare(null);
      return;
    }

    try {
      // 获取最近30天的数据（从30天前到昨天）；KPI日期范围超出时自动扩展获取范围
      const yesterday = dayjs().subtract(1, 'day');
      const endDate = yesterday.format('YYYY-MM-DD');
      const startDate = yesterday.clone().subtract(29, 'day').format('YYYY-MM-DD');
      const kpiStartD = kpiDateRange?.[0]?.format('YYYY-MM-DD') || null;
      const kpiEndD = kpiDateRange?.[1]?.format('YYYY-MM-DD') || null;
      const fetchStart = (kpiStartD && kpiStartD < startDate) ? kpiStartD : startDate;
      const fetchEnd = (kpiEndD && kpiEndD > endDate) ? kpiEndD : endDate;
      console.log('数据加载日期范围:', fetchStart, '~', fetchEnd);

      // 获取选中店铺的名称
      const selectedStores = STORES.filter(s => selectedStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);

      // 查询数据（默认30天窗口 + KPI范围扩展部分）
      const warnings = await fetchDataWarnings(storeNames, fetchStart, fetchEnd);

      if (warnings.length === 0) {
        console.warn(`未从数据库获取到${fetchStart}至${fetchEnd}的数据，按0处理`);
      }

      // 缓存原始 warnings 供广告占比图表复用（仅默认30天窗口，保持图表口径不变）
      setAdWarnings(warnings.filter(w => w.date >= startDate && w.date <= endDate));

      const newStoresData: Record<string, StoreData> = {};
      let kpiTotalOrders = 0;
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

        // 当前指标：按KPI日期范围聚合（求和）
        const kpiStart = kpiDateRange?.[0]?.format('YYYY-MM-DD') || endDate;
        const kpiEnd = kpiDateRange?.[1]?.format('YYYY-MM-DD') || endDate;
        const kpiRangeWarnings = storeWarnings.filter(w => w.date >= kpiStart && w.date <= kpiEnd);

        let orders = 0, sales = 0, adSpend = 0, adSales = 0, adRatio = 0, acos = 0, gmv = 0, fbaTotalStock = 0, fbaStockDate = '', grossProfit = 0, storageRatio = 0, storageFee = 0, salesAmount = 0;

        // FBA库存/货值：始终取前一天（最新可用记录）的快照值，不跟随KPI日期范围
        for (let i = storeWarnings.length - 1; i >= 0; i--) {
          const w = storeWarnings[i];
          if (w.fba_total_stock) {
            fbaTotalStock = w.fba_total_stock;
            fbaStockDate = w.date;
            break;
          }
        }

        if (kpiRangeWarnings.length > 0) {
          kpiRangeWarnings.forEach(w => {
            orders += w.order_count || 0;
            gmv += w.gmv || 0;
            grossProfit += w.gross_profit || 0;
            adSpend += w.ad_spend || 0;
            storageFee += w.storage_fee || 0;
            salesAmount += w.sales_amount || 0;
          });
          sales = gmv;
          // 广告占比 = 广告费用总和 / 利润报表销售额总和
          adRatio = salesAmount > 0 ? parseFloat((adSpend / salesAmount * 100).toFixed(2)) : 0;
          // 仓储占比 = 仓储费用总和 / 利润报表销售额总和
          storageRatio = salesAmount > 0 ? parseFloat((storageFee / salesAmount * 100).toFixed(2)) : 0;
          // ACOS：取最后一天的值（单店，不聚合）
          const lastDayWarning = kpiRangeWarnings[kpiRangeWarnings.length - 1];
          acos = lastDayWarning.acos ? parseFloat((lastDayWarning.acos * 100).toFixed(2)) : 0;
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

        // 计算近30天平均广告占比（Σ广告费用 / Σ销售额，仅默认30天窗口，不随KPI扩展范围变化）
        const windowWarnings = storeWarnings.filter(w => w.date >= startDate && w.date <= endDate);
        const totalAdSpend30d = windowWarnings.reduce((sum, w) => sum + (w.ad_spend || 0), 0);
        const totalSalesAmount30d = windowWarnings.reduce((sum, w) => sum + (w.sales_amount || 0), 0);
        const avgAdRatio30d = totalSalesAmount30d > 0 ? parseFloat((totalAdSpend30d / totalSalesAmount30d * 100).toFixed(2)) : 0;

        const storeThresholds = getThresholdsForStore(store.id);
        if (avgAdRatio30d > storeThresholds.adRatio) {
          alerts.push({
            id: alertId++,
            time: dayjs().subtract(Math.floor(Math.random() * 60), 'minute').format('HH:mm:ss'),
            metricName: '广告占比',
            currentValue: avgAdRatio30d + '%',
            threshold: '>' + storeThresholds.adRatio + '%',
            suggestion: '广告花费偏高（近30天均值），建议优化投放',
            severity: avgAdRatio30d > storeThresholds.adRatio * 1.1 ? 'red' : 'orange',
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

        kpiTotalOrders += orders;

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
            fbaStockDate,
            grossProfit,
            storageRatio,
            storageFee,
            salesAmount,
          },
          ordersTrend,
          adRatioTrend,
          alerts,
          avgAdRatio30d,
        };
      });

      // --- 订单量单日对比：KPI选中单日时，取上月同日（月环比）与上周同日（周同比）的订单数据
      if (kpiDateRange?.[0] && kpiDateRange?.[1] && kpiDateRange[0].isSame(kpiDateRange[1], 'day')) {
        const monthDate = kpiDateRange[0].subtract(1, 'month').format('YYYY-MM-DD');
        const weekDate = kpiDateRange[0].subtract(7, 'day').format('YYYY-MM-DD');
        try {
          const [mRes, wRes] = await Promise.all([
            fetchDataWarnings(storeNames, monthDate, monthDate),
            fetchDataWarnings(storeNames, weekDate, weekDate),
          ]);
          const sumOrders = (rows: DataWarningRecord[]) => rows.reduce((s, w) => s + (w.order_count || 0), 0);
          setOrdersCompare({
            curOrders: kpiTotalOrders,
            monthDate,
            monthOrders: sumOrders(mRes),
            weekDate,
            weekOrders: sumOrders(wRes),
          });
        } catch (e) {
          console.error('获取订单量对比数据失败:', e);
          setOrdersCompare(null);
        }
      } else {
        setOrdersCompare(null);
      }

      setStoresData(newStoresData);
      setLastUpdated(dayjs().format('YYYY-MM-DD HH:mm:ss'));
      message.success('数据已从数据库加载');
    } catch (error) {
      console.error('从数据库加载数据失败:', error);
      message.error('从数据库加载数据失败，按0处理');
      setOrdersCompare(null);
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
              fbaStockDate: yesterday.format('YYYY-MM-DD'),
              grossProfit: 0,
              storageRatio: 0,
              storageFee: 0,
              salesAmount: 0,
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
  }, [selectedStoreIds, STORES, isTestMode, kpiDateRange]);

  // --- 从后端API加载商品销量数据
  const loadProductSalesData = useCallback(async () => {
    if (displayStoreIds.length === 0) {
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
      setSkuDailySalesData(prev => {
        if (trendDateMode === 'dateRange') return prev; // 按筛选日期模式：不覆盖趋势每日销量
        return dailySalesTestData;
      });
      console.log('tenant_id=6，使用测试商品销量数据');
      return;
    }

    try {
      const selectedStores = STORES.filter(s => displayStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);
      if (storeNames.length === 0) {
        setProductSalesData([]);
        setSkuDailySalesData([]);
        return;
      }
      
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
      setSkuDailySalesData(prev => {
        if (trendDateMode === 'dateRange') return prev; // 按筛选日期模式：不覆盖趋势每日销量
        return dailySales;
      });
    } catch (error) {
      console.error('加载商品销量数据失败:', error);
      setProductSalesData([]);
      setSkuDailySalesData(prev => {
        if (trendDateMode === 'dateRange') return prev; // 按筛选日期模式：不覆盖趋势每日销量
        return [];
      });
    }
  }, [displayStoreIds, STORES, isTestMode, trendDateMode]);

  // --- 加载SKU异动检测数据（取近14天全部SKU，基准为最后一天有销量的SKU）
  const loadSkuAnomalyData = useCallback(async () => {
    if (displayStoreIds.length === 0) {
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
        // 构建 14 天日期序列（i=0 对应 14 天前，i=13 对应昨天），共用共享计算函数
        const fullDates = item.daily.map((_, i) => yesterday.clone().subtract(13 - i, 'day').format('YYYY-MM-DD'));
        const salesByDate = new Map<string, number>(fullDates.map((d, i) => [d, item.daily[i]]));
        return {
          sku: item.sku,
          store: item.store,
          ...computeSkuAnomalyMetrics(salesByDate, fullDates, item.store, thresholds),
        };
      });
      setSkuAnomalyRealData(result);
      return;
    }

    try {
      const selectedStores = STORES.filter(s => displayStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);
      if (storeNames.length === 0) {
        setSkuAnomalyRealData([]);
        return;
      }

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

      // 计算异动指标（共享计算函数：评分/事件/分组判定；无记录日期不补0）
      const result: SkuAnomalyRecord[] = [];
      skuStoreMap.forEach((value, key) => {
        const [sku] = key.split('__');

        // 构建完整的 14 天日期序列
        const fullDates: string[] = [];
        for (let i = 0; i < 14; i++) {
          fullDates.push(queryStartDate.clone().add(i, 'day').format('YYYY-MM-DD'));
        }

        result.push({
          sku,
          store: value.store,
          ...computeSkuAnomalyMetrics(value.dailyMap, fullDates, value.store, thresholds),
        });
      });

      setSkuAnomalyRealData(result);
    } catch (error) {
      console.error('加载SKU异动数据失败:', error);
      setSkuAnomalyRealData([]);
    }
  }, [displayStoreIds, STORES, isTestMode, thresholds]);

  // --- 加载 SKU 超库龄数据
  const loadProductAgingData = useCallback(async () => {
    try {
      // 与店铺日期查询一致：跟随"店铺筛选"+"只显示"（displayStoreIds）；未选择时默认全部
      const selectedStores = STORES.filter(s => displayStoreIds.includes(s.id));
      const storeNames = selectedStores.map(s => s.name);

      if (isTestMode) {
        // 测试数据
        setProductAgingLatestDate(dayjs().subtract(2, 'day').format('YYYY-MM-DD'));
        setProductAgingData([
          { store: 'A加', sku: 'TEST-001', aging_181_270: 12, aging_271_365: 0, aging_366_455: 0, aging_456_plus: 0 },
          { store: 'A加', sku: 'TEST-002', aging_271_365: 8, aging_181_270: 0, aging_366_455: 0, aging_456_plus: 0 },
          { store: 'B美', sku: 'TEST-003', aging_366_455: 20, aging_456_plus: 5, aging_181_270: 0, aging_271_365: 0 },
          { store: 'B美', sku: 'TEST-004', aging_181_270: 15, aging_271_365: 0, aging_366_455: 0, aging_456_plus: 0 },
        ].filter(r => storeNames.length === 0 || storeNames.includes(r.store)));
        return;
      }

      const response = await apiClient.get('/product-aging/', {
        params: storeNames.length > 0 ? { stores: storeNames.join(',') } : {},
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
  }, [displayStoreIds, STORES, isTestMode]);

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
    }
    // SKU趋势处于按筛选日期模式时，店铺变化后按新店铺重拉每日销量（经ref调用，避免死循环）
    if (trendDateMode === 'dateRange') {
      loadSkuTrendRef.current?.();
    }
    // 超库龄：未选择店铺时也加载（默认全部）
    loadProductAgingData();
    setProductAgingDrillBucket(null);
  }, [displayStoreIds, loadStoreDataFromAPI, loadProductSalesData, loadSkuAnomalyData, loadProductAgingData, trendDateMode]);



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

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 500 }}>KPI日期:</span>
              {([['yesterday', '昨日'], ['7d', '近7天'], ['30d', '近30天'], ['lastMonth', '上月'], ['custom', '自定义']] as const).map(([key, label]) => (
                <span
                  key={key}
                  onClick={() => handleKpiQuick(key)}
                  title={key === 'custom' ? '在右侧选择日期范围' : `查看${label}数据`}
                  style={{
                    fontSize: 12,
                    padding: '3px 10px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                    background: kpiQuickKey === key ? '#1890ff' : '#f5f5f5',
                    color: kpiQuickKey === key ? '#ffffff' : '#666'
                  }}
                >
                  {label}
                </span>
              ))}
              <DatePicker.RangePicker
                value={kpiDateRange}
                onChange={(dates) => { setKpiQuickKey('custom'); setKpiDateRange(dates as [Dayjs | null, Dayjs | null] | null); }}
                style={{ width: 280 }}
                allowClear
                disabledDate={(current) => current && current > dayjs().endOf('day')}
              />
            </div>

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
      <div id="section-kpi" style={{
        display: 'flex',
        flexWrap: 'nowrap',
        gap: '12px',
        marginBottom: '16px'
      }}>
        {/* 订单量 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          data-kpi-card="orders"
          onClick={() => setPinnedKpi(prev => prev === 'orders' ? null : 'orders')}
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
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>单/{kpiDateLabel}</Text>
                {ordersCompare && (() => {
                  const pctChange = (prev: number) => prev > 0 ? parseFloat(((ordersCompare.curOrders - prev) / prev * 100).toFixed(1)) : null;
                  const renderCompare = (label: string, dateStr: string, prev: number) => {
                    const p = pctChange(prev);
                    const dateLabel = dateStr.slice(5).replace('-', '/');
                    return (
                      <div key={label} style={{ fontSize: '11px', lineHeight: 1.6, marginTop: '2px', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                        <span style={{ color: '#8c8c8c' }}>{label}</span>
                        {p === null ? (
                          <span style={{ color: '#8c8c8c' }}>{dateLabel}：{prev.toLocaleString()}单</span>
                        ) : (
                          <>
                            <span style={{ color: p > 0 ? '#52c41a' : p < 0 ? '#ff4d4f' : '#8c8c8c', fontWeight: 600 }}>
                              {p > 0 ? '↑' : p < 0 ? '↓' : '－'}{Math.abs(p)}%
                            </span>
                            <span style={{ color: '#8c8c8c' }}>({dateLabel}：{prev.toLocaleString()}单)</span>
                          </>
                        )}
                      </div>
                    );
                  };
                  return (
                    <div>
                      {renderCompare('月环比', ordersCompare.monthDate, ordersCompare.monthOrders)}
                      {renderCompare('周同比', ordersCompare.weekDate, ordersCompare.weekOrders)}
                    </div>
                  );
                })()}
              </div>
            </div>
          </Card>
          {(hoveredKpi === 'orders' || pinnedKpi === 'orders') && renderKpiDetail('orders')}
        </div>

        {/* GMV */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          data-kpi-card="gmv"
          onClick={() => setPinnedKpi(prev => prev === 'gmv' ? null : 'gmv')}
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
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>{kpiDateLabel}交易总额</Text>
              </div>
            </div>
          </Card>
          {(hoveredKpi === 'gmv' || pinnedKpi === 'gmv') && renderKpiDetail('gmv')}
        </div>

        {/* 平均客单价 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          data-kpi-card="avgOrderPrice"
          onClick={() => setPinnedKpi(prev => prev === 'avgOrderPrice' ? null : 'avgOrderPrice')}
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
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>GMV ÷ 订单量 · {kpiDateLabel}</Text>
              </div>
            </div>
          </Card>
          {(hoveredKpi === 'avgOrderPrice' || pinnedKpi === 'avgOrderPrice') && renderKpiDetail('avgOrderPrice')}
        </div>

        {/* 毛利润 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          data-kpi-card="grossProfit"
          onClick={() => setPinnedKpi(prev => prev === 'grossProfit' ? null : 'grossProfit')}
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
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>{kpiDateLabel}毛利润</Text>
              </div>
            </div>
          </Card>
          {(hoveredKpi === 'grossProfit' || pinnedKpi === 'grossProfit') && renderKpiDetail('grossProfit')}
        </div>

        {/* 广告占比 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          data-kpi-card="adRatio"
          onClick={() => setPinnedKpi(prev => prev === 'adRatio' ? null : 'adRatio')}
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
          {(hoveredKpi === 'adRatio' || pinnedKpi === 'adRatio') && renderKpiDetail('adRatio')}
        </div>

        {/* 仓储占比 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          data-kpi-card="storageRatio"
          onClick={() => setPinnedKpi(prev => prev === 'storageRatio' ? null : 'storageRatio')}
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
          {(hoveredKpi === 'storageRatio' || pinnedKpi === 'storageRatio') && renderKpiDetail('storageRatio')}
        </div>

        {/* ACOS */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          data-kpi-card="acos"
          onClick={() => setPinnedKpi(prev => prev === 'acos' ? null : 'acos')}
          onMouseEnter={() => setHoveredKpi('acos')}
          onMouseLeave={() => setHoveredKpi(null)}
        >
          <Card 
            size="small" 
            bordered 
            bodyStyle={{ padding: '8px 12px' }} 
            style={{ 
              ...getCardStyle(getMetricStatus('acos', acosCard.value)), 
              minHeight: 'auto', 
              height: 'auto'
            }} 
            hoverable
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '60px' }}>
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>ACOS</Text>
                <div style={{ fontSize: '24px', fontWeight: 600, color: getMetricStatus('acos', acosCard.value) === 'danger' ? '#ff4d4f' : '#333', lineHeight: 1.2 }}>
                  {acosCard.value}%
                </div>
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>{acosCard.storeName ? `${acosCard.storeName} · 广告效率` : '广告效率'}</Text>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                {getStatusIcon(getMetricStatus('acos', acosCard.value))}
                <Tag color={getMetricStatus('acos', acosCard.value) === 'normal' ? 'success' : getMetricStatus('acos', acosCard.value) === 'warning' ? 'warning' : 'error'} style={{ fontSize: '11px', padding: '0 6px', lineHeight: 1.6, height: 'auto' }}>
                  阈值: &gt;{getAggregateThresholds.acos}%
                </Tag>
              </div>
            </div>
          </Card>
          {(hoveredKpi === 'acos' || pinnedKpi === 'acos') && renderKpiDetail('acos')}
        </div>

        {/* FBA总库存 */}
        <div 
          style={{ flex: 1, position: 'relative' }}
          data-kpi-card="fbaTotalStock"
          onClick={() => setPinnedKpi(prev => prev === 'fbaTotalStock' ? null : 'fbaTotalStock')}
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
                <Text type="secondary" style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                  FBA总库存/货值
                  {kpiDateLabel.includes('~') && currentMetrics.fbaStockDate && (
                    <Tag color="blue" style={{ marginLeft: 6, fontSize: '11px', lineHeight: 1.6, padding: '0 6px' }}>
                      {currentMetrics.fbaStockDate.slice(5)} 数据
                    </Tag>
                  )}
                </Text>
                <div style={{ fontSize: '24px', fontWeight: 600, color: '#333', lineHeight: 1.2 }}>
                  {currentMetrics.fbaTotalStock} / ¥{currentMetrics.fbaStockValue.toLocaleString()}
                </div>
                <Text type="secondary" style={{ fontSize: '12px', lineHeight: 1.2 }}>
                  {kpiDateLabel.includes('~') ? '库存为快照值，不随日期范围累计' : 'FBA仓库总库存'}
                </Text>
              </div>
            </div>
          </Card>
          {(hoveredKpi === 'fbaTotalStock' || pinnedKpi === 'fbaTotalStock') && renderKpiDetail('fbaTotalStock')}
        </div>
      </div>

      {/* --- 中部区域：趋势分析和商品销量 */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
        {/* 左侧：趋势图表 */}
        <div style={{ flex: 1.4 }}>
          <Card title="📈 趋势分析" bordered={false} style={{ height: '100%', overflow: 'visible', position: 'relative' }}>
            <div style={{ marginBottom: '24px', overflow: 'visible', position: 'relative' }}>
              <Title level={5} style={{ marginBottom: '16px' }}>订单量趋势 (最近14天)</Title>
              <div style={{ overflow: 'visible', position: 'relative' }} ref={ordersChartWrapRef}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={ordersTrendData}
                    onMouseMove={handleTrendMouseMove('orders', ordersChartWrapRef)}
                    onMouseLeave={handleTrendMouseLeave}
                    onClick={handleTrendChartClick('orders')}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
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
                {renderTrendPiePopup('orders')}
              </div>
            </div>
            <Divider />
            <div style={{ overflow: 'visible', position: 'relative' }}>
              <Title level={5} style={{ marginBottom: '16px' }}>广告占比趋势 (最近7天)</Title>
              <div style={{ overflow: 'visible', position: 'relative' }} ref={adRatioChartWrapRef}>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart
                    data={adRatioTrendData}
                    onMouseMove={handleTrendMouseMove('adRatio', adRatioChartWrapRef)}
                    onMouseLeave={handleTrendMouseLeave}
                    onClick={handleTrendChartClick('adRatio')}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
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
                {renderTrendPiePopup('adRatio')}
              </div>
            </div>
          </Card>
        </div>

        {/* 右侧：实时预警消息列表 */}
        <div style={{ flex: 1 }}>
          <Card
            id="section-alerts"
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
              {([['yesterday', '昨日'], ['7d', '近7天'], ['30d', '近30天'], ['lastMonth', '上月'], ['custom', '自定义']] as const).map(([key, label]) => (
                <span
                  key={key}
                  onClick={() => handleDateQueryQuick(key)}
                  title={key === 'custom' ? '在右侧选择日期范围' : `查看${label}数据`}
                  style={{
                    fontSize: 12,
                    padding: '3px 10px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                    background: dateQueryQuickKey === key ? '#1890ff' : '#f5f5f5',
                    color: dateQueryQuickKey === key ? '#ffffff' : '#666'
                  }}
                >
                  {label}
                </span>
              ))}
              <DatePicker.RangePicker
                value={dateRange}
                onChange={(dates) => { setDateQueryQuickKey('custom'); setDateRange(dates as [Dayjs | null, Dayjs | null] | null); }}
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
          id="section-compare"
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
              { title: '订单量', dataIndex: 'orders', key: 'orders', width: 120,
                sorter: (a: any, b: any) => a.orders - b.orders,
              },
              { title: 'GMV', dataIndex: 'gmv', key: 'gmv', width: 150,
                defaultSortOrder: 'descend' as const,
                sorter: (a: any, b: any) => a.gmv - b.gmv,
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
              // 始终按顶部日期筛选范围汇总（dateRange变化自动重查），订单/GMV求和、广告占比加权平均
              displayStores.map(store => {
                const aggregated = storeAggregatedData[store.id];
                return {
                  ...store,
                  orders: aggregated ? aggregated.avgOrders : 0,
                  gmv: aggregated ? aggregated.avgGmv : 0,
                  adRatio: aggregated ? aggregated.avgAdRatio : 0,
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
              { title: '日期', dataIndex: 'date', key: 'date', width: 120,
                defaultSortOrder: 'ascend' as const,
                sorter: (a: any, b: any) => a.date.localeCompare(b.date) || a.storeName.localeCompare(b.storeName),
              },
              { title: '订单量', dataIndex: 'orders', key: 'orders', width: 120,
                sorter: (a: any, b: any) => a.orders - b.orders,
              },
              { title: 'GMV', dataIndex: 'gmv', key: 'gmv', width: 150,
                sorter: (a: any, b: any) => a.gmv - b.gmv,
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
              { title: '毛利润', dataIndex: 'grossProfit', key: 'grossProfit', width: 150,
                sorter: (a: any, b: any) => a.grossProfit - b.grossProfit,
                render: (val: number) => `¥${val.toLocaleString()}`,
              },
              { title: '仓储占比', dataIndex: 'storageRatio', key: 'storageRatio', width: 120,
                render: (val: number) => {
                  const parsedStorageRatioBase = storageRatioBase && storageRatioBase.trim() !== '' ? parseFloat(storageRatioBase) : null;
                  const enableStorageRatioTrend = parsedStorageRatioBase !== null && !isNaN(parsedStorageRatioBase);
                  if (!enableStorageRatioTrend) {
                    return <span>{fmtPct(val)}%</span>;
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
                  return <span style={{ color }}>{fmtPct(val)}% {trend}</span>;
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
          id="section-top10"
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span>🏆 商品销量TOP10</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {top10Mode === 'dateRange' && (
                  <Tag color="purple" style={{ margin: 0 }}>{top10DateLabel}</Tag>
                )}
                <Button
                  size="small"
                  type={top10Mode === 'recent7' ? 'primary' : 'default'}
                  onClick={handleSwitchTop10Recent7}
                >
                  近7天
                </Button>
                <Button
                  size="small"
                  type={top10Mode === 'dateRange' ? 'primary' : 'default'}
                  onClick={handleOpenSkuModalByDate}
                >
                  按筛选日期查看
                </Button>
                <Button
                  type="primary"
                  size="small"
                  onClick={handleOpenSkuModal}
                >
                  查看详情
                </Button>
              </div>
            </div>
          }
          bordered={false}
          style={{ flex: 0.8, minWidth: '350px', display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ padding: '4px 0' }}>
              {(top10Mode === 'dateRange' ? top10DateData : skuSalesData).map((record, index) => {
                const rank = index + 1;
                const maxSales = (top10Mode === 'dateRange' ? top10DateData : skuSalesData)[0]?.totalSales || 1;
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
        id="section-sku-trend"
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
                onClick={() => {
                  setTrendDateMode('dateRange');
                  loadSkuTrendForDateRange();
                }}
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
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              🔔 SKU销量异动检测
              <Tag color="red" style={{ marginLeft: 4 }}>P0 ×{skuAnomalySeverityStats.P0}</Tag>
              <Tag color="orange">P1 ×{skuAnomalySeverityStats.P1}</Tag>
              <Tag color="blue">P2 ×{skuAnomalySeverityStats.P2}</Tag>
            </span>
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

          // 严重度标签样式
          const severityTag = (sev: string | null) => {
            if (!sev) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
            const color = sev === 'P0' ? 'red' : sev === 'P1' ? 'orange' : 'blue';
            return <Tag color={color} style={{ marginRight: 0 }}>{sev}</Tag>;
          };
          // 最近事件摘要
          const latestEventText = (record: any) => {
            if (!record.events || record.events.length === 0) return <Text type="secondary" style={{ fontSize: 12 }}>无</Text>;
            const ev = record.events[0];
            const s = ev.startDate.slice(5).replace('-', '/');
            const e = ev.endDate.slice(5).replace('-', '/');
            const range = ev.days > 1 ? `${s}~${e}` : s;
            const arrow = ev.direction === 'up' ? '↑' : '↓';
            const color = ev.severity === 'P0' ? '#ff4d4f' : ev.severity === 'P1' ? '#fa8c16' : '#1890ff';
            return (
              <span style={{ fontSize: 12, color, whiteSpace: 'nowrap' }}>
                {range} {arrow}{ev.maxAbsChange}件
              </span>
            );
          };

          const commonColumns = [
            {
              title: 'SKU',
              dataIndex: 'sku',
              key: 'sku',
              width: 150,
              render: (text: string, record: any) => (
                <span style={{ fontWeight: record.severity ? 'bold' : 'normal' }}>{text}</span>
              ),
            },
            { title: '店铺', dataIndex: 'store', key: 'store', width: 70 },
            {
              title: '严重度',
              dataIndex: 'severity',
              key: 'severity',
              width: 70,
              render: (val: string | null) => severityTag(val),
            },
            {
              title: '异动评分',
              dataIndex: 'anomalyScore',
              key: 'anomalyScore',
              width: 90,
              sorter: (a: any, b: any) => a.anomalyScore - b.anomalyScore,
              defaultSortOrder: 'descend' as const,
              render: (val: number) => {
                const color = val >= 60 ? '#ff4d4f' : val >= 30 ? '#fa8c16' : val > 0 ? '#1890ff' : '#999';
                return <span style={{ color, fontWeight: 'bold' }}>{val}</span>;
              },
            },
            {
              title: '最近事件',
              key: 'latestEvent',
              width: 150,
              render: (_: any, record: any) => latestEventText(record),
            },
            { title: '最新销量', dataIndex: 'latestSales', key: 'latestSales', width: 80 },
            {
              title: '日均销量',
              dataIndex: 'avgSales',
              key: 'avgSales',
              width: 80,
              render: (val: number) => fmtPct(val),
            },
            {
              title: '近期趋势',
              key: 'recent',
              width: 80,
              render: (_: any, record: any) => {
                const d = record.latestDirection;
                const color = d === 'up' ? '#ff4d4f' : d === 'down' ? '#1890ff' : '#999';
                const arrow = d === 'up' ? '↑' : d === 'down' ? '↓' : '→';
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ color, fontWeight: 'bold', fontSize: 15 }}>{arrow}</span>
                    {record.dataIncomplete && (
                      <Tooltip title="昨日数据未完整，近期趋势按T-2计算">
                        <span style={{ fontSize: 12, color: '#faad14' }}>⚠</span>
                      </Tooltip>
                    )}
                  </span>
                );
              },
            },
            {
              title: '最大波动',
              dataIndex: 'fluctuation',
              key: 'fluctuation',
              width: 90,
              render: (val: number, record: any) => {
                const color = record.severity ? '#ff4d4f' : '#999';
                return <span style={{ color }}>{fmtPct(val)}%</span>;
              },
            },
          ];

          // 事件时间线（展开行顶部）
          const renderEvents = (record: any) => {
            if (!record.events || record.events.length === 0) return null;
            return (
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>异动事件（连续异动日合并）：</Text>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {record.events.map((ev: any, idx: number) => {
                    const color = ev.severity === 'P0' ? '#ff4d4f' : ev.severity === 'P1' ? '#fa8c16' : '#1890ff';
                    const s = ev.startDate.slice(5).replace('-', '/');
                    const e = ev.endDate.slice(5).replace('-', '/');
                    const range = ev.days > 1 ? `${s} ~ ${e}` : s;
                    const arrow = ev.direction === 'up' ? '↑ 上涨' : '↓ 下跌';
                    return (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <Tag color={ev.severity === 'P0' ? 'red' : ev.severity === 'P1' ? 'orange' : 'blue'} style={{ marginRight: 0 }}>{ev.severity}</Tag>
                        <span style={{ color: '#333' }}>{range}</span>
                        <span style={{ color: ev.direction === 'up' ? '#ff4d4f' : '#1890ff' }}>{arrow}</span>
                        <span>最大变化 <Text strong>{ev.maxAbsChange}件</Text>（{ev.maxRelChange}%）</span>
                        <Text type="secondary">持续{ev.days}天</Text>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          };

          const renderExpanded = (record: any) => (
            <div>
              {renderEvents(record)}
              <div style={{ marginBottom: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>最新(前日)销量：</Text>
                  <Text strong>{record.latestSales}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>14天日均：</Text>
                  <Text strong>{fmtPct(record.avgSales)}</Text>
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
                        <span style={{ fontWeight: row.isAnomaly ? 'bold' : 'normal', color: row.dataMissing ? '#bbb' : undefined }}>
                          {val}
                          {row.isAnomaly && <Tag color="red" style={{ marginLeft: 4 }}>异动</Tag>}
                          {row.channel === 'B' && <Tag color="orange" style={{ marginLeft: 4 }}>起量</Tag>}
                        </span>
                      ),
                    },
                    {
                      title: '销量',
                      dataIndex: 'sales',
                      key: 'sales',
                      width: 80,
                      render: (val: number | null, row: any) => row.dataMissing
                        ? <Text type="secondary" style={{ fontStyle: 'italic' }}>无记录</Text>
                        : val,
                    },
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
                      width: 110,
                      render: (val: number | null, row: any) => {
                        if (row.channel === 'B') return <Text type="secondary" style={{ fontStyle: 'italic' }}>起量(不计环比)</Text>;
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
                    {
                      title: '绝对变化',
                      dataIndex: 'absChange',
                      key: 'absChange',
                      width: 90,
                      render: (val: number | null, row: any) => {
                        if (val === null || val === 0) return <Text type="secondary">—</Text>;
                        const color = row.isAnomaly ? '#ff4d4f' : '#666';
                        return <Text style={{ color, fontWeight: row.isAnomaly ? 'bold' : 'normal' }}>{val > 0 ? '+' : ''}{val}</Text>;
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
                        rowClassName={(record: any) => record.severity ? 'anomaly-row' : ''}
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
        id="section-aging"
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>📦 超库龄SKU分布</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {productAgingLatestDate && (
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
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>全部 {drillData.length} 个 SKU 明细</span>
                          <Button
                            size="small"
                            onClick={() => {
                              if (drillData.length === 0) return;
                              const ws = XLSX.utils.json_to_sheet(drillData.map(d => ({
                                '店铺': d.store,
                                'SKU': d.sku,
                                '数量': d.qty,
                              })));
                              ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 10 }];
                              const wb = XLSX.utils.book_new();
                              XLSX.utils.book_append_sheet(wb, ws, '超库龄SKU明细');
                              XLSX.writeFile(wb, `超库龄SKU明细_${productAgingDrillBucket}_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
                              message.success('已生成Excel并开始下载');
                            }}
                          >
                            下载Excel
                          </Button>
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
      <Card id="section-ad-ratio" bordered={false} style={{ marginTop: 16 }}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>📊 广告占比周监控</span>
              <Tag color={adRatioKpis.sumRatio > adRatioKpis.TH ? 'red' : 'green'} style={{ marginLeft: 4 }}>
                阈值 {adRatioKpis.TH}% · 近14天
              </Tag>
            </div>
            <Button
              type="link"
              size="small"
              icon={adRatioExpanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setAdRatioExpanded(v => !v)}
            >
              {adRatioExpanded ? '收起' : '展开'}
            </Button>
          </div>
        }
      >
        {adRatioExpanded && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <div style={{ background: '#fafbfd', border: '1px solid #f0f2f8', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>汇总占比</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: adRatioKpis.sumRatio > adRatioKpis.TH ? '#f5222d' : '#52c41a' }}>
              {fmtPct(adRatioKpis.sumRatio)}%
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
              {adRatioKpis.weekChange == null ? '--' : `${adRatioKpis.weekChange >= 0 ? '+' : ''}${fmtPct(adRatioKpis.weekChange)}%`}
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
        <div style={{ marginTop: 16, overflow: 'visible' }}>
          {/* 每日趋势图（柱状图 + 折线图组合） */}
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
                    {fmtPct(v)}%
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
        </>)}
      </Card>

      {/* --- 购物车预警（product_buybox 未处理数据，按店铺分组：组头行带一键处理） */}
      <Card id="section-buybox" bordered={false} style={{ marginTop: 16 }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>🛒 购物车预警</span>
            <Tag color={buyboxRecords.length > 0 ? 'orange' : 'green'} style={{ marginLeft: 4 }}>
              {buyboxRecords.length > 0 ? `未处理 ${buyboxRecords.length} 条` : '暂无预警'}
            </Tag>
          </div>
        }
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              type="link"
              size="small"
              icon={buyboxExpanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setBuyboxExpanded(v => !v)}
            >
              {buyboxExpanded ? '收起' : '展开'}
            </Button>
            <Button size="small" onClick={openProcessedModal}>查看已处理</Button>
            <Button size="small" onClick={loadBuyboxRecords} loading={buyboxLoading}>刷新</Button>
          </div>
        }
      >
        {buyboxExpanded && (
        <Table<BuyboxRow>
          rowKey="id"
          size="small"
          tableLayout="fixed"
          className="buybox-table"
          loading={buyboxLoading}
          dataSource={buyboxTableRows}
          pagination={buyboxTableRows.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
          locale={{ emptyText: '当前筛选店铺下没有未处理的购物车预警' }}
          onRow={(record) => record.isGroup ? { style: { background: '#fafafa' } } : {}}
          columns={[
            {
              title: '日期', key: 'main', width: 160,
              onCell: (record: BuyboxRow) => ({ colSpan: record.isGroup ? 3 : 1 }),
              render: (_, record: BuyboxRow) => {
                if (record.isGroup) {
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>
                        <Text strong style={{ fontSize: 13 }}>🏪 {record.store}</Text>
                        <Tag color="orange" style={{ marginLeft: 8 }}>未处理 {record.count} 条</Tag>
                      </span>
                      <Button
                        type="primary"
                        size="small"
                        style={{ background: '#389e0d', borderColor: '#389e0d' }}
                        onClick={() => handleBuyboxProcessAll(record.store, record.groupIds || [])}
                      >
                        一键处理
                      </Button>
                    </div>
                  );
                }
                return record.date;
              },
            },
            {
              title: 'SKU', dataIndex: 'sku', key: 'sku', width: 180, ellipsis: true,
              onCell: (record: BuyboxRow) => ({ colSpan: record.isGroup ? 0 : 1 }),
            },
            {
              title: '品名', dataIndex: 'product_name', key: 'product_name', ellipsis: false,
              onCell: (record: BuyboxRow) => ({ colSpan: record.isGroup ? 0 : 1 }),
              render: (_, record: BuyboxRow) => {
                if (record.isGroup) return null;
                return (
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingRight: 110 }}>
                      {record.product_name || '--'}
                    </span>
                    <Button
                      className="row-process-btn"
                      type="primary"
                      size="small"
                      style={{
                        position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
                        background: '#52c41a', borderColor: '#52c41a',
                      }}
                      onClick={() => handleBuyboxProcess(record.id)}
                    >
                      已处理
                    </Button>
                  </div>
                );
              },
            },
          ]}
        />
        )}
      </Card>

      {/* --- 购物车预警：已处理记录弹窗 */}
      <Modal
        title={`已处理记录（${processedRecords.length} 条）`}
        visible={processedModalVisible}
        onCancel={() => setProcessedModalVisible(false)}
        footer={null}
        width={640}
      >
        <Table<BuyboxRecord>
          rowKey="id"
          size="small"
          loading={processedLoading}
          dataSource={processedRecords}
          pagination={processedRecords.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
          locale={{ emptyText: '暂无已处理记录' }}
          columns={[
            { title: '日期', dataIndex: 'date', key: 'date', width: 95 },
            { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 120, ellipsis: true },
            { title: '品名', dataIndex: 'product_name', key: 'product_name', ellipsis: true, render: (v: string | null) => v || '--' },
            { title: '店铺', dataIndex: 'store', key: 'store', width: 90 },
          ]}
        />
      </Modal>

      {/* --- 货件预警（product_shipment_notice 未处理数据，按店铺分组：组头行带一键处理） */}
      <Card id="section-shipment" bordered={false} style={{ marginTop: 16 }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>🚚 货件预警</span>
            <Tag color={shipmentRecords.length > 0 ? 'orange' : 'green'} style={{ marginLeft: 4 }}>
              {shipmentRecords.length > 0 ? `未处理 ${shipmentRecords.length} 条` : '暂无预警'}
            </Tag>
          </div>
        }
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              type="link"
              size="small"
              icon={shipmentExpanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setShipmentExpanded(v => !v)}
            >
              {shipmentExpanded ? '收起' : '展开'}
            </Button>
            <Button size="small" onClick={openShipmentProcessedModal}>查看已确认</Button>
            <Button size="small" onClick={loadShipmentRecords} loading={shipmentLoading}>刷新</Button>
          </div>
        }
      >
        {shipmentExpanded && (
        <Table<ShipmentRow>
          rowKey="id"
          size="small"
          tableLayout="fixed"
          className="buybox-table"
          loading={shipmentLoading}
          dataSource={shipmentTableRows}
          pagination={shipmentTableRows.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
          locale={{ emptyText: '当前筛选店铺下没有未处理的货件预警' }}
          onRow={(record) => (record.isGroup || record.isDateGroup) ? { style: { background: record.isGroup ? '#fafafa' : '#fcfcfc' } } : {}}
          columns={[
            {
              title: '日期', key: 'main', width: 160,
              onCell: (record: ShipmentRow) => ({ colSpan: (record.isGroup || record.isDateGroup) ? 3 : 1 }),
              render: (_, record: ShipmentRow) => {
                if (record.isGroup) {
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>
                        <Text strong style={{ fontSize: 13 }}>🏪 {record.store}</Text>
                        <Tag color="orange" style={{ marginLeft: 8 }}>未处理 {record.count} 条</Tag>
                      </span>
                      <Button
                        type="primary"
                        size="small"
                        style={{ background: '#389e0d', borderColor: '#389e0d' }}
                        onClick={() => handleShipmentProcessAll(record.store, record.groupIds || [])}
                      >
                        一键确认
                      </Button>
                    </div>
                  );
                }
                if (record.isDateGroup) {
                  return (
                    <span>
                      <Text type="secondary" style={{ fontSize: 12 }}>📅 {record.date}</Text>
                      <Tag style={{ marginLeft: 8 }}>{record.dateCount} 条</Tag>
                      <Button
                        type="primary"
                        size="small"
                        style={{ marginLeft: 8, background: '#52c41a', borderColor: '#52c41a' }}
                        onClick={() => handleShipmentConfirmDate(record.store, record.date, record.dateIds || [])}
                      >
                        已确认
                      </Button>
                    </span>
                  );
                }
                return record.date;
              },
            },
            {
              title: '店铺', dataIndex: 'store', key: 'store', width: 120,
              onCell: (record: ShipmentRow) => ({ colSpan: (record.isGroup || record.isDateGroup) ? 0 : 1 }),
            },
            {
              title: '货件编码', dataIndex: 'shipment_code', key: 'shipment_code', ellipsis: true,
              onCell: (record: ShipmentRow) => ({ colSpan: (record.isGroup || record.isDateGroup) ? 0 : 1 }),
              render: (v: string | null) => v || '--',
            },
          ]}
        />
        )}
      </Card>

      {/* --- 货件预警：已确认记录弹窗 */}
      <Modal
        title={`已确认记录（${shipmentProcessedRecords.length} 条）`}
        visible={shipmentProcessedModalVisible}
        onCancel={() => setShipmentProcessedModalVisible(false)}
        footer={null}
        width={640}
      >
        <Table<ShipmentRecord>
          rowKey="id"
          size="small"
          loading={shipmentProcessedLoading}
          dataSource={shipmentProcessedRecords}
          pagination={shipmentProcessedRecords.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
          locale={{ emptyText: '暂无已处理记录' }}
          columns={[
            { title: '日期', dataIndex: 'date', key: 'date', width: 95 },
            { title: '货件编码', dataIndex: 'shipment_code', key: 'shipment_code', width: 180, ellipsis: true },
            { title: '店铺', dataIndex: 'store', key: 'store', width: 90 },
          ]}
        />
      </Modal>

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

      {/* --- 悬浮球：悬停展开导航（可拖拽移动，菜单面板绝对定位，不挤压球的位置） */}
      {(() => {
        // 球在下半屏（或未拖动时的默认右下角）菜单向上弹出；上半屏向下弹出；左半屏左对齐、右半屏右对齐
        const menuAbove = ballPos ? ballPos.top >= window.innerHeight / 2 : true;
        const alignLeft = ballPos ? ballPos.left < window.innerWidth / 2 : false;
        return (
          <div
            style={{
              position: 'fixed',
              right: ballPos ? 'auto' : 24,
              bottom: ballPos ? 'auto' : 32,
              left: ballPos ? ballPos.left : 'auto',
              top: ballPos ? ballPos.top : 'auto',
              zIndex: 1050,
              width: 48,
              height: 48,
            }}
            onMouseEnter={() => setSectionNavOpen(true)}
            onMouseLeave={() => setSectionNavOpen(false)}
          >
            {sectionNavOpen && (
              <div style={{
                position: 'absolute',
                ...(menuAbove
                  ? { bottom: '100%', paddingBottom: 10 }
                  : { top: '100%', paddingTop: 10 }),
                ...(alignLeft ? { left: 0 } : { right: 0 }),
              }}>
                <div style={{
                  background: '#fff',
                  border: '1px solid #e8e8e8',
                  borderRadius: 10,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  padding: '8px 0',
                  minWidth: 180,
                }}>
                  {SECTION_NAVS.map(nav => (
                    <div
                      key={nav.id}
                      onClick={() => handleSectionNavClick(nav.id)}
                      style={{
                        padding: '7px 16px',
                        fontSize: 13,
                        color: '#333',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#f5f5f5'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                    >
                      {nav.title}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #7e57c2, #5e35b1)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'grab',
              boxShadow: '0 4px 12px rgba(94,53,177,0.4)',
              userSelect: 'none',
              transition: 'box-shadow 0.15s',
            }}
              onMouseDown={handleBallMouseDown}
              onClick={handleBallClick}
            >
              {sectionNavOpen ? '收起' : '导航'}
            </div>
          </div>
        );
      })()}

      {/* --- 商品销量详情弹窗 */}
      <Modal
        title={<span>📦 商品销量详情 {skuModalDateLabel && <Tag color="blue" style={{ marginLeft: 8 }}>{skuModalDateLabel}</Tag>}</span>}
        visible={showSkuModal}
        onCancel={() => {
          setShowSkuModal(false);
          setSkuSearchValue('');
        }}
        footer={null}
        width={800}
      >
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Input
            placeholder="搜索SKU"
            prefix={<SearchOutlined />}
            value={skuSearchValue}
            onChange={(e) => setSkuSearchValue(e.target.value)}
            style={{ width: 250 }}
          />
          <span style={{ fontSize: 12, color: '#888' }}>
            统计范围：近 7 天（{dayjs().subtract(1, 'day').subtract(6, 'day').format('YYYY-MM-DD')} ~ {dayjs().subtract(1, 'day').format('YYYY-MM-DD')}）
          </span>
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
                dataSource={[...record.stores].sort((a: any, b: any) =>
                  a.storeName.localeCompare(b.storeName) || (a.date < b.date ? -1 : 1)
                )}
                rowKey={(store: any) => `${store.storeName}-${store.date}`}
                pagination={false}
                size="small"
                style={{ margin: '16px 0 0 48px' }}
              />
            ),
            rowExpandable: () => true,
          }}
        />
      </Modal>

      {/* 趋势图日期饼图独立弹窗 */}
      <Modal
        open={!!trendPieModal}
        onCancel={() => setTrendPieModal(null)}
        footer={null}
        width={600}
        centered
        title={trendPieModal ? (
          <span>{trendPieModal.date} 各店铺{trendPieModal.chart === 'orders' ? '订单量' : '广告占比'}</span>
        ) : null}
      >
        {trendPieModal && (
          <>
            {trendPieModalData.length === 0 ? (
              <div style={{ fontSize: '14px', color: '#999', padding: '32px 0', textAlign: 'center' }}>当天暂无数据</div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <PieChart width={420} height={300}>
                    <Pie
                      data={trendPieModalData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={110}
                      paddingAngle={2}
                      stroke="#fff"
                      label={(entry: any) => entry.name}
                    >
                      {trendPieModalData.map(item => (
                        <Cell key={item.name} fill={item.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value: any, name: any) => [
                        trendPieModal.chart === 'orders' ? `${Number(value).toLocaleString()} 单` : `${fmtPct(Number(value))}%`,
                        name,
                      ]}
                      wrapperStyle={{ zIndex: 1200 }}
                    />
                  </PieChart>
                </div>
                <Table
                  size="small"
                  pagination={false}
                  dataSource={trendPieModalData.map((item, idx) => ({ key: idx, ...item }))}
                  columns={[
                    {
                      title: '店铺',
                      dataIndex: 'name',
                      render: (_: any, record: any) => (
                        <span style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: record.color, marginRight: 8, flexShrink: 0 }} />
                          {record.name}
                        </span>
                      ),
                    },
                    {
                      title: trendPieModal.chart === 'orders' ? '订单量' : '广告占比',
                      dataIndex: 'value',
                      align: 'right' as const,
                      render: (value: number) => (
                        <span style={{ fontWeight: 600 }}>
                          {trendPieModal.chart === 'orders' ? value.toLocaleString() : `${fmtPct(value)}%`}
                        </span>
                      ),
                    },
                    {
                      title: '占比',
                      align: 'right' as const,
                      defaultSortOrder: 'descend' as const,
                      sorter: (a: any, b: any) => a.value - b.value,
                      render: (_: any, record: any) => {
                        const total = trendPieModalData.reduce((s, i) => s + i.value, 0);
                        return <span style={{ color: '#999' }}>{total > 0 ? `${((record.value / total) * 100).toFixed(0)}%` : '0%'}</span>;
                      },
                    },
                  ]}
                />
              </>
            )}
          </>
        )}
      </Modal>

    </div>
  );
};

export default DataAlertBot;
