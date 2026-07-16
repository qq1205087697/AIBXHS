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

interface CampaignItem {
  id: number;
  campaign_name: string;
  spend: number;
  sales: number;
  acos: number;
  roas: number;
  orders: number;
  clicks: number;
  impressions: number;
  ctr: number;
  health_score: number;
  health_level: string;
}

interface FilterOptions {
  countries: string[];
  stores: string[];
  report_types: string[];
}

const HEALTH_LEVEL_OPTIONS = [
  { label: "全部", value: "" },
  { label: "优秀", value: "优秀" },
  { label: "良好", value: "良好" },
  { label: "一般", value: "一般" },
  { label: "差", value: "差" },
];

const HEALTH_LEVEL_COLORS: Record<string, string> = {
  优秀: "green",
  良好: "blue",
  一般: "orange",
  差: "red",
};

const CampaignAnalysis: React.FC = () => {
  const { currentTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CampaignItem[]>([]);
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
  const [healthLevel, setHealthLevel] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("spend");
  const [sortOrder, setSortOrder] = useState<string>("desc");

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
        report_type: "campaign",
        page,
        page_size: pageSize,
        sort_by: sortBy,
        sort_order: sortOrder,
      };
      if (selectedCountries.length) params.country = selectedCountries;
      if (selectedStores.length) params.account = selectedStores;
      if (dateRange?.[0]) params.date_from = dateRange[0].format("YYYY-MM-DD");
      if (dateRange?.[1]) params.date_to = dateRange[1].format("YYYY-MM-DD");
      if (healthLevel) params.health_level = healthLevel;

      const res = await adsApi.search(params);
      if (res.data.success) {
        setData(res.data.data?.items || res.data.data || []);
        setTotal(res.data.data?.total || res.data.data?.length || 0);
      }
    } catch (e) {
      message.error("获取活动数据失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, selectedCountries, selectedStores, dateRange, healthLevel]);

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

  const columns: ColumnsType<CampaignItem> = [
    {
      title: "活动名称",
      dataIndex: "campaign_name",
      key: "campaign_name",
      ellipsis: true,
      width: 200,
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
      title: "ROAS",
      dataIndex: "roas",
      key: "roas",
      sorter: true,
      render: (v: number) => (v || 0).toFixed(2),
    },
    {
      title: "订单",
      dataIndex: "orders",
      key: "orders",
      render: (v: number) => v || 0,
    },
    {
      title: "点击",
      dataIndex: "clicks",
      key: "clicks",
      render: (v: number) => v || 0,
    },
    {
      title: "CTR",
      dataIndex: "ctr",
      key: "ctr",
      render: (v: number) => `${((v || 0) * 100).toFixed(2)}%`,
    },
    {
      title: "健康分",
      dataIndex: "health_level",
      key: "health_level",
      render: (level: string, record: CampaignItem) => {
        if (!level) return <Tag>未知</Tag>;
        return (
          <Tag color={HEALTH_LEVEL_COLORS[level] || "default"}>
            {level} ({record.health_score || 0})
          </Tag>
        );
      },
    },
  ];

  const handleTableChange = (pagination: any, _filters: any, sorter: any) => {
    setPage(pagination.current || 1);
    setPageSize(pagination.pageSize || 20);
    if (sorter.field) {
      setSortBy(sorter.field);
      setSortOrder(sorter.order === "ascend" ? "asc" : "desc");
    }
  };

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
          <span>健康分:</span>
          <Select
            style={{ width: 120 }}
            value={healthLevel}
            onChange={setHealthLevel}
            options={HEALTH_LEVEL_OPTIONS}
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

      <Card title="广告活动分析">
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
          onChange={handleTableChange}
          size="small"
          scroll={{ x: 900 }}
        />
      </Card>
    </Spin>
  );
};

export default CampaignAnalysis;
