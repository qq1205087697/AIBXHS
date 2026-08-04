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
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        report_type: "search_term",
        page,
        page_size: pageSize,
        sort_by: "spend",
        sort_order: "desc",
      };
      if (selectedCountries.length) params.country = selectedCountries;
      if (selectedStores.length) params.account = selectedStores;
      if (dateRange?.[0]) params.date_from = dateRange[0].format("YYYY-MM-DD");
      if (dateRange?.[1]) params.date_to = dateRange[1].format("YYYY-MM-DD");

      const res = await adsApi.search(params);
      if (res.data.success) {
        const items = res.data.data?.items || res.data.data || [];
        // 按花费降序排列
        items.sort((a: SearchTermItem, b: SearchTermItem) => (b.spend || 0) - (a.spend || 0));
        setData(items);
        setTotal(res.data.data?.total || items.length || 0);
      }
    } catch (e) {
      message.error("获取搜索词数据失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, selectedCountries, selectedStores, dateRange]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCountryChange = (values: string[]) => {
    setSelectedCountries(values);
    if (values.length === 1) {
      fetchFilterOptions(values[0]);
    } else {
      fetchFilterOptions();
    }
  };

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
      sorter: (a, b) => (a.spend || 0) - (b.spend || 0),
      defaultSortOrder: "descend",
      render: (v: number) => `$${(v || 0).toFixed(2)}`,
    },
    {
      title: "ACOS",
      dataIndex: "acos",
      key: "acos",
      render: (v: number) => `${((v || 0) * 100).toFixed(2)}%`,
    },
    {
      title: "订单",
      dataIndex: "orders",
      key: "orders",
      render: (v: number) => v || 0,
    },
    {
      title: "CTR",
      dataIndex: "ctr",
      key: "ctr",
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
          onChange={(p) => {
            setPage(p.current || 1);
            setPageSize(p.pageSize || 20);
          }}
          size="small"
          scroll={{ x: 850 }}
        />
      </Card>
    </Spin>
  );
};

export default SearchTermAnalysis;
