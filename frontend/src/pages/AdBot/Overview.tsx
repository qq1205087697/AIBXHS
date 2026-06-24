import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  DatePicker,
  Row,
  Col,
  Statistic,
  Spin,
  message,
} from "antd";
import {
  EyeOutlined,
  AimOutlined,
  DollarOutlined,
  ShoppingCartOutlined,
  RiseOutlined,
  PercentageOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { adsApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import HealthScoreCard from "./components/HealthScoreCard";
import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";

const { RangePicker } = DatePicker;

interface OverviewData {
  total_impressions: number;
  total_clicks: number;
  total_spend: number;
  total_orders: number;
  total_sales: number;
  acos: number;
  roas: number;
  ctr: number;
}

interface HealthScoreData {
  score: number;
  level: string;
}

interface PerformanceItem {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
  roas: number;
  ctr: number;
}

interface FilterOptions {
  countries: string[];
  stores: string[];
  report_types: string[];
}

const Overview: React.FC = () => {
  const { currentTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [healthScore, setHealthScore] = useState<HealthScoreData | null>(null);
  const [performance, setPerformance] = useState<PerformanceItem[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    countries: [],
    stores: [],
    report_types: [],
  });

  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>([
    dayjs().subtract(7, "day"),
    dayjs(),
  ]);

  const fetchFilterOptions = useCallback(async (country?: string) => {
    try {
      const res = await adsApi.getFilterOptions(country);
      if (res.data.success) {
        setFilterOptions(res.data.data);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const buildParams = useCallback(() => {
    const params: any = {};
    if (selectedCountries.length) params.country = selectedCountries;
    if (selectedStores.length) params.account = selectedStores;
    if (dateRange?.[0]) params.date_from = dateRange[0].format("YYYY-MM-DD");
    if (dateRange?.[1]) params.date_to = dateRange[1].format("YYYY-MM-DD");
    return params;
  }, [selectedCountries, selectedStores, dateRange]);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams();
      const res = await adsApi.getOverview(params);
      if (res.data.success) {
        setOverview(res.data.data);
      }
    } catch (e) {
      message.error("获取概览数据失败");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  const fetchHealthScore = useCallback(async () => {
    try {
      const params = buildParams();
      const res = await adsApi.getHealthScore(params);
      if (res.data.success) {
        setHealthScore(res.data.data);
      }
    } catch (e) {
      // ignore
    }
  }, [buildParams]);

  const fetchPerformance = useCallback(async () => {
    try {
      const params = {
        ...buildParams(),
        date_from: dateRange?.[0]
          ? dateRange[0].format("YYYY-MM-DD")
          : dayjs().subtract(7, "day").format("YYYY-MM-DD"),
        date_to: dateRange?.[1]
          ? dateRange[1].format("YYYY-MM-DD")
          : dayjs().format("YYYY-MM-DD"),
      };
      const res = await adsApi.getPerformance(params);
      if (res.data.success) {
        setPerformance(res.data.data || []);
      }
    } catch (e) {
      // ignore
    }
  }, [buildParams, dateRange]);

  const fetchAll = useCallback(() => {
    fetchOverview();
    fetchHealthScore();
    fetchPerformance();
  }, [fetchOverview, fetchHealthScore, fetchPerformance]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleCountryChange = (values: string[]) => {
    setSelectedCountries(values);
    if (values.length === 1) {
      fetchFilterOptions(values[0]);
    } else {
      fetchFilterOptions();
    }
  };

  const performanceColumns: ColumnsType<PerformanceItem> = [
    { title: "日期", dataIndex: "date", key: "date" },
    {
      title: "曝光量",
      dataIndex: "impressions",
      key: "impressions",
      render: (v: number) => v?.toLocaleString(),
    },
    {
      title: "点击量",
      dataIndex: "clicks",
      key: "clicks",
      render: (v: number) => v?.toLocaleString(),
    },
    {
      title: "花费",
      dataIndex: "spend",
      key: "spend",
      render: (v: number) => `$${(v || 0).toFixed(2)}`,
    },
    {
      title: "销售额",
      dataIndex: "sales",
      key: "sales",
      render: (v: number) => `$${(v || 0).toFixed(2)}`,
    },
    {
      title: "ACOS",
      dataIndex: "acos",
      key: "acos",
      render: (v: number) => `${((v || 0) * 100).toFixed(2)}%`,
    },
    {
      title: "ROAS",
      dataIndex: "roas",
      key: "roas",
      render: (v: number) => (v || 0).toFixed(2),
    },
  ];

  return (
    <Spin spinning={loading}>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          <span>国家:</span>
          <Select
            mode="multiple"
            style={{ minWidth: 180 }}
            placeholder="选择国家"
            value={selectedCountries}
            onChange={handleCountryChange}
            options={filterOptions.countries.map((c) => ({ label: c, value: c }))}
            allowClear
          />
          <span>店铺:</span>
          <Select
            mode="multiple"
            style={{ minWidth: 180 }}
            placeholder="选择店铺"
            value={selectedStores}
            onChange={setSelectedStores}
            options={filterOptions.stores.map((s) => ({ label: s, value: s }))}
            allowClear
          />
          <span>日期范围:</span>
          <RangePicker
            value={dateRange}
            onChange={(dates) =>
              setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)
            }
          />
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={fetchAll}
            style={{ background: currentTheme.primary }}
          >
            刷新
          </Button>
        </Space>
      </Card>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6} lg={6}>
          <Card>
            {healthScore ? (
              <HealthScoreCard score={healthScore.score} level={healthScore.level} />
            ) : (
              <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
                暂无健康分数据
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} sm={12} md={18} lg={18}>
          <Row gutter={[12, 12]}>
            <Col xs={12} sm={8} md={6}>
              <Card>
                <Statistic
                  title="曝光量"
                  value={overview?.total_impressions || 0}
                  prefix={<EyeOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card>
                <Statistic
                  title="点击量"
                  value={overview?.total_clicks || 0}
                  prefix={<AimOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card>
                <Statistic
                  title="花费"
                  value={overview?.total_spend || 0}
                  precision={2}
                  prefix={<DollarOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card>
                <Statistic
                  title="订单数"
                  value={overview?.total_orders || 0}
                  prefix={<ShoppingCartOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card>
                <Statistic
                  title="销售额"
                  value={overview?.total_sales || 0}
                  precision={2}
                  prefix={<RiseOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card>
                <Statistic
                  title="ACOS"
                  value={((overview?.acos || 0) * 100).toFixed(2)}
                  suffix="%"
                  prefix={<PercentageOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card>
                <Statistic
                  title="ROAS"
                  value={overview?.roas || 0}
                  precision={2}
                  prefix={<ThunderboltOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Card>
                <Statistic
                  title="CTR"
                  value={((overview?.ctr || 0) * 100).toFixed(2)}
                  suffix="%"
                  prefix={<AimOutlined />}
                />
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>

      <Card title="近7天趋势">
        <Table
          columns={performanceColumns}
          dataSource={performance}
          rowKey="date"
          pagination={{ pageSize: 7, showSizeChanger: false }}
          size="small"
        />
      </Card>
    </Spin>
  );
};

export default Overview;
