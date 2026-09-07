import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  DatePicker,
  Tag,
  Spin,
  message,
  Empty,
  Alert,
} from "antd";
import { ReloadOutlined, WarningOutlined, DownloadOutlined } from "@ant-design/icons";
import { adsApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";

const { RangePicker } = DatePicker;

interface SearchTermItem {
  id: number;
  search_term: string;
  keyword: string;
  match_type: string;
  spend: number;
  acos: number;
  orders: number;
  clicks: number;
  ctr: number;
}

interface NegativeSuggestionItem {
  search_term: string;
  related_keyword: string;
  match_type: string;
  spend: number;
  sales: number;
  acos: number;
  cvr: number;
  clicks: number;
  orders: number;
  impressions: number;
}

interface SearchTermAnalysisData {
  total: number;
  items: SearchTermItem[];
  negative_keyword_suggestions: NegativeSuggestionItem[];
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

const SearchTermAnalysis: React.FC = () => {
  const { currentTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SearchTermItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<string | undefined>("spend");
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

  // 深度分析（否定词推荐）
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState<SearchTermAnalysisData | null>(null);
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
        report_type: "search_term",
        page,
        page_size: pageSize,
      };
      if (selectedCountries.length) params.country = selectedCountries;
      if (selectedStores.length) params.account = selectedStores;
      if (dateRange?.[0]) params.date_from = dateRange[0].format("YYYY-MM-DD");
      if (dateRange?.[1]) params.date_to = dateRange[1].format("YYYY-MM-DD");
      if (sortBy) {
        params.sort_by = sortBy;
        params.sort_order = sortOrder;
      }

      const res = await adsApi.search(params);
      if (res.data.success) {
        const items = res.data.data?.items || res.data.data || [];
        setData(items);
        setTotal(res.data.data?.total || items.length || 0);
      }
    } catch (e) {
      message.error("获取搜索词数据失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, selectedCountries, selectedStores, dateRange]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fetchAnalysisData = useCallback(async () => {
    setAnalysisLoading(true);
    try {
      const params: any = {};
      if (selectedCountries.length) params.country = selectedCountries;
      if (selectedStores.length) params.account = selectedStores;
      if (dateRange?.[0]) params.date_from = dateRange[0].format("YYYY-MM-DD");
      if (dateRange?.[1]) params.date_to = dateRange[1].format("YYYY-MM-DD");
      const res = await adsApi.getSearchTermAnalysis(params);
      if (res.data.success) {
        setAnalysisData(res.data.data);
      }
    } catch (e) {
      message.error("获取搜索词深度分析失败");
    } finally {
      setAnalysisLoading(false);
    }
  }, [selectedCountries, selectedStores, dateRange]);

  useEffect(() => {
    fetchAnalysisData();
  }, [fetchAnalysisData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params: any = { report_type: "search_term" };
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
      a.download = `search_term_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`;
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

  const negativeColumns: ColumnsType<NegativeSuggestionItem> = [
    {
      title: "搜索词",
      dataIndex: "search_term",
      key: "search_term",
      ellipsis: true,
      width: 220,
    },
    {
      title: "关联关键词",
      dataIndex: "related_keyword",
      key: "related_keyword",
      ellipsis: true,
      width: 160,
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
    {
      title: "ACOS",
      dataIndex: "acos",
      key: "acos",
      render: (v: number) => `${(v || 0).toFixed(2)}%`,
    },
  ];

  const columns: ColumnsType<SearchTermItem> = [
    {
      title: "搜索词",
      dataIndex: "search_term",
      key: "search_term",
      ellipsis: true,
      width: 200,
    },
    {
      title: "触发关键词",
      dataIndex: "keyword",
      key: "keyword",
      ellipsis: true,
      width: 160,
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
      sorter: true,
      defaultSortOrder: "descend",
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

      <Card title="搜索词分析（按花费降序）">
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
          scroll={{ x: 850 }}
        />
      </Card>

      <Card
        title={
          <Space>
            <WarningOutlined style={{ color: "#ff4d4f" }} />
            <span>否定词推荐（高花费但 0 订单）</span>
          </Space>
        }
        style={{ marginTop: 16 }}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={fetchAnalysisData}
          >
            刷新
          </Button>
        }
      >
        <Spin spinning={analysisLoading}>
          {analysisData ? (
            <>
              <Alert
                message={`共识别 ${analysisData.total} 个搜索词，其中 ${analysisData.negative_keyword_suggestions.length} 个建议设为否定关键词`}
                description="建议将以下高花费但零转化的搜索词添加到否定关键词列表，避免无效花费"
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
              {analysisData.negative_keyword_suggestions.length ? (
                <Table
                  columns={negativeColumns}
                  dataSource={analysisData.negative_keyword_suggestions}
                  rowKey={(r) => `${r.search_term}_${r.related_keyword}_${r.match_type}`}
                  pagination={{ pageSize: 10, showSizeChanger: true }}
                  size="small"
                  scroll={{ x: 850 }}
                />
              ) : (
                <Empty description="暂无否定词推荐" />
              )}
            </>
          ) : (
            <Empty description="暂无深度分析数据" />
          )}
        </Spin>
      </Card>
    </Spin>
  );
};

export default SearchTermAnalysis;
