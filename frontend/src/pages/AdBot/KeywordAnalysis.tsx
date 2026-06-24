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
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
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
  }, [page, pageSize, selectedCountries, selectedStores, dateRange, acosMin, acosMax]);

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
          onChange={(p) => {
            setPage(p.current || 1);
            setPageSize(p.pageSize || 20);
          }}
          size="small"
          scroll={{ x: 800 }}
        />
      </Card>
    </Spin>
  );
};

export default KeywordAnalysis;
