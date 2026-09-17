import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  DatePicker,
  InputNumber,
  Tag,
  Spin,
  message,
  Tabs,
  Statistic,
  Row,
  Col,
  Empty,
} from "antd";
import { ReloadOutlined, StarOutlined, FireOutlined, BulbOutlined, DownloadOutlined } from "@ant-design/icons";
import { adsApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";

const { RangePicker } = DatePicker;

interface KeywordItem {
  id: number;
  keyword: string;
  match_type: string;
  bid: number;
  spend: number;
  acos: number;
  orders: number;
  clicks: number;
  ctr: number;
}

interface KeywordGradeItem {
  keyword: string;
  match_type: string;
  spend: number;
  sales: number;
  acos: number;
  cvr: number;
  clicks: number;
  orders: number;
  impressions: number;
  grade: string;
}

interface KeywordGradeData {
  total: number;
  high_conversion: KeywordGradeItem[];
  money_burner: KeywordGradeItem[];
  potential: KeywordGradeItem[];
  normal: KeywordGradeItem[];
  all: KeywordGradeItem[];
}

interface FilterOptions {
  countries: string[];
  stores: string[];
  report_types: string[];
}

const MATCH_TYPE_COLORS: Record<string, string> = {
  exact: "blue",
  phrase: "green",
  broad: "orange",
  negativeExact: "red",
  negativePhrase: "volcano",
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  exact: "精确",
  phrase: "词组",
  broad: "广泛",
  negativeExact: "否定精确",
  negativePhrase: "否定词组",
};

const KeywordAnalysis: React.FC = () => {
  const { currentTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<KeywordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
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
  const [acosMin, setAcosMin] = useState<number | undefined>(undefined);
  const [acosMax, setAcosMax] = useState<number | undefined>(undefined);

  // 关键词分级分析
  const [gradeLoading, setGradeLoading] = useState(false);
  const [gradeData, setGradeData] = useState<KeywordGradeData | null>(null);
  const [exporting, setExporting] = useState(false);

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        report_type: "keyword",
        page,
        page_size: pageSize,
      };
      if (selectedCountries.length) params.country = selectedCountries;
      if (selectedStores.length) params.account = selectedStores;
      if (dateRange?.[0]) params.date_from = dateRange[0].format("YYYY-MM-DD");
      if (dateRange?.[1]) params.date_to = dateRange[1].format("YYYY-MM-DD");
      if (acosMin !== undefined) params.acos_min = acosMin / 100;
      if (acosMax !== undefined) params.acos_max = acosMax / 100;
      if (sortBy) {
        params.sort_by = sortBy;
        params.sort_order = sortOrder;
      }

      const res = await adsApi.search(params);
      if (res.data.success) {
        setData(res.data.data?.items || res.data.data || []);
        setTotal(res.data.data?.total || res.data.data?.length || 0);
      }
    } catch (e) {
      message.error("获取关键词数据失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, selectedCountries, selectedStores, dateRange, acosMin, acosMax]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchGradeData = useCallback(async () => {
    setGradeLoading(true);
    try {
      const params: any = {};
      if (selectedCountries.length) params.country = selectedCountries;
      if (selectedStores.length) params.account = selectedStores;
      if (dateRange?.[0]) params.date_from = dateRange[0].format("YYYY-MM-DD");
      if (dateRange?.[1]) params.date_to = dateRange[1].format("YYYY-MM-DD");
      const res = await adsApi.getKeywordAnalysis(params);
      if (res.data.success) {
        setGradeData(res.data.data);
      }
    } catch (e) {
      message.error("获取关键词分级分析失败");
    } finally {
      setGradeLoading(false);
    }
  }, [selectedCountries, selectedStores, dateRange]);

  useEffect(() => {
    fetchGradeData();
  }, [fetchGradeData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params: any = { report_type: "keyword" };
      if (selectedCountries.length) params.country = selectedCountries;
      if (selectedStores.length) params.account = selectedStores;
      if (dateRange?.[0]) params.date_from = dateRange[0].format("YYYY-MM-DD");
      if (dateRange?.[1]) params.date_to = dateRange[1].format("YYYY-MM-DD");
      const res = await adsApi.export(params);
      const blob = new Blob([res.data as unknown as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `keyword_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success("导出成功");
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || "未知错误";
      message.error(`导出失败: ${detail}`);
    } finally {
      setExporting(false);
    }
  };

  const handleCountryChange = (values: string[]) => {
    setSelectedCountries(values);
    if (values.length === 1) {
      fetchFilterOptions(values[0]);
    } else {
      fetchFilterOptions();
    }
  };

  const gradeColumns: ColumnsType<KeywordGradeItem> = [
    {
      title: "关键词",
      dataIndex: "keyword",
      key: "keyword",
      ellipsis: true,
      width: 200,
    },
    {
      title: "匹配类型",
      dataIndex: "match_type",
      key: "match_type",
      width: 100,
      render: (v: string) => (
        <Tag color={MATCH_TYPE_COLORS[v] || "default"}>
          {MATCH_TYPE_LABELS[v] || v}
        </Tag>
      ),
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
      render: (v: number) => `${(v || 0).toFixed(2)}%`,
    },
    {
      title: "CVR",
      dataIndex: "cvr",
      key: "cvr",
      render: (v: number) => `${(v || 0).toFixed(2)}%`,
    },
    {
      title: "点击",
      dataIndex: "clicks",
      key: "clicks",
      render: (v: number) => v || 0,
    },
    {
      title: "订单",
      dataIndex: "orders",
      key: "orders",
      render: (v: number) => v || 0,
    },
  ];

  const columns: ColumnsType<KeywordItem> = [
    {
      title: "关键词",
      dataIndex: "keyword",
      key: "keyword",
      ellipsis: true,
      width: 200,
    },
    {
      title: "匹配类型",
      dataIndex: "match_type",
      key: "match_type",
      width: 100,
      render: (v: string) => (
        <Tag color={MATCH_TYPE_COLORS[v] || "default"}>
          {MATCH_TYPE_LABELS[v] || v}
        </Tag>
      ),
    },
    {
      title: "竞价",
      dataIndex: "bid",
      key: "bid",
      render: (v: number) => `$${(v || 0).toFixed(2)}`,
    },
    {
      title: "花费",
      dataIndex: "spend",
      key: "spend",
      sorter: true,
      render: (v: number) => `$${(v || 0).toFixed(2)}`,
    },
    {
      title: "ACOS",
      dataIndex: "acos",
      key: "acos",
      sorter: true,
      render: (v: number) => `${((v || 0) * 100).toFixed(2)}%`,
    },
    {
      title: "订单",
      dataIndex: "orders",
      key: "orders",
      sorter: true,
      render: (v: number) => v || 0,
    },
    {
      title: "CTR",
      dataIndex: "ctr",
      key: "ctr",
      sorter: true,
      render: (v: number) => `${((v || 0) * 100).toFixed(2)}%`,
    },
  ];

  return (
    <Spin spinning={loading}>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          <span>国家:</span>
          <Select
            mode="multiple"
            style={{ minWidth: 160 }}
            placeholder="选择国家"
            value={selectedCountries}
            onChange={handleCountryChange}
            options={filterOptions.countries.map((c) => ({ label: c, value: c }))}
            allowClear
          />
          <span>店铺:</span>
          <Select
            mode="multiple"
            style={{ minWidth: 160 }}
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
          <span>ACOS范围:</span>
          <InputNumber
            placeholder="最小%"
            min={0}
            max={100}
            value={acosMin}
            onChange={(v) => setAcosMin(v ?? undefined)}
            style={{ width: 90 }}
          />
          <span>-</span>
          <InputNumber
            placeholder="最大%"
            min={0}
            max={100}
            value={acosMax}
            onChange={(v) => setAcosMax(v ?? undefined)}
            style={{ width: 90 }}
          />
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={fetchData}
            style={{ background: currentTheme.primary }}
          >
            刷新
          </Button>
          <Button
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={handleExport}
          >
            导出
          </Button>
        </Space>
      </Card>

      <Card title="关键词分析">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
          onChange={(p, _f, sorter) => {
            setPage(p.current || 1);
            setPageSize(p.pageSize || 20);
            const s = Array.isArray(sorter) ? sorter[0] : sorter;
            if (s && s.field && s.order) {
              setSortBy(s.field as string);
              setSortOrder(s.order === "ascend" ? "asc" : "desc");
              setPage(1);
            } else if (s && !s.order) {
              setSortBy(undefined);
            }
          }}
          size="small"
          scroll={{ x: 800 }}
        />
      </Card>

      <Card
        title="关键词分级分析"
        style={{ marginTop: 16 }}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={fetchGradeData}
          >
            刷新
          </Button>
        }
      >
        <Spin spinning={gradeLoading}>
          {gradeData ? (
            <>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={6}>
                  <Card size="small">
                    <Statistic
                      title="高转化词"
                      value={gradeData.high_conversion.length}
                      prefix={<StarOutlined style={{ color: "#52c41a" }} />}
                      valueStyle={{ color: "#52c41a" }}
                    />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small">
                    <Statistic
                      title="烧钱词"
                      value={gradeData.money_burner.length}
                      prefix={<FireOutlined style={{ color: "#ff4d4f" }} />}
                      valueStyle={{ color: "#ff4d4f" }}
                    />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small">
                    <Statistic
                      title="潜力词"
                      value={gradeData.potential.length}
                      prefix={<BulbOutlined style={{ color: "#faad14" }} />}
                      valueStyle={{ color: "#faad14" }}
                    />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small">
                    <Statistic
                      title="总关键词数"
                      value={gradeData.total}
                    />
                  </Card>
                </Col>
              </Row>

              <Tabs
                defaultActiveKey="high_conversion"
                items={[
                  {
                    key: "high_conversion",
                    label: `高转化词 (${gradeData.high_conversion.length})`,
                    children: gradeData.high_conversion.length ? (
                      <Table
                        columns={gradeColumns}
                        dataSource={gradeData.high_conversion}
                        rowKey={(r) => `${r.keyword}_${r.match_type}`}
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        size="small"
                        scroll={{ x: 800 }}
                      />
                    ) : (
                      <Empty description="暂无高转化词" />
                    ),
                  },
                  {
                    key: "money_burner",
                    label: `烧钱词 (${gradeData.money_burner.length})`,
                    children: gradeData.money_burner.length ? (
                      <Table
                        columns={gradeColumns}
                        dataSource={gradeData.money_burner}
                        rowKey={(r) => `${r.keyword}_${r.match_type}`}
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        size="small"
                        scroll={{ x: 800 }}
                      />
                    ) : (
                      <Empty description="暂无烧钱词" />
                    ),
                  },
                  {
                    key: "potential",
                    label: `潜力词 (${gradeData.potential.length})`,
                    children: gradeData.potential.length ? (
                      <Table
                        columns={gradeColumns}
                        dataSource={gradeData.potential}
                        rowKey={(r) => `${r.keyword}_${r.match_type}`}
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        size="small"
                        scroll={{ x: 800 }}
                      />
                    ) : (
                      <Empty description="暂无潜力词" />
                    ),
                  },
                  {
                    key: "normal",
                    label: `普通词 (${gradeData.normal.length})`,
                    children: gradeData.normal.length ? (
                      <Table
                        columns={gradeColumns}
                        dataSource={gradeData.normal}
                        rowKey={(r) => `${r.keyword}_${r.match_type}`}
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        size="small"
                        scroll={{ x: 800 }}
                      />
                    ) : (
                      <Empty description="暂无普通词" />
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <Empty description="暂无分级分析数据" />
          )}
        </Spin>
      </Card>
    </Spin>
  );
};

export default KeywordAnalysis;
