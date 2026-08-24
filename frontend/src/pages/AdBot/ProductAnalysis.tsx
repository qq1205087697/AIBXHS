import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  DatePicker,
  Spin,
  message,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { adsApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";

const { RangePicker } = DatePicker;

interface ProductItem {
  id: number;
  advertised_asin: string;
  advertised_sku: string;
  campaign_name: string;
  spend: number;
  acos: number;
  roas: number;
  orders: number;
  clicks: number;
  ctr: number;
}

interface FilterOptions {
  countries: string[];
  stores: string[];
  report_types: string[];
}

const ProductAnalysis: React.FC = () => {
  const { currentTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProductItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    countries: [],
    stores: [],
    report_types: [],
  });
  const [campaignOptions, setCampaignOptions] = useState<string[]>([]);

  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>([
    dayjs().subtract(7, "day"),
    dayjs(),
  ]);
  const [selectedCampaign, setSelectedCampaign] = useState<string | undefined>(undefined);

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

  const fetchCampaigns = useCallback(async () => {
    try {
      const params: any = { report_type: "campaign" };
      if (selectedCountries.length) params.country = selectedCountries;
      if (selectedStores.length) params.account = selectedStores;
      const res = await adsApi.search(params);
      if (res.data.success) {
        const items = res.data.data?.items || res.data.data || [];
        const names: string[] = Array.from(
          new Set(items.map((i: ProductItem) => i.campaign_name).filter(Boolean)),
        ) as string[];
        setCampaignOptions(names);
      }
    } catch (e) {
      // ignore
    }
  }, [selectedCountries, selectedStores]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        report_type: "product",
        page,
        page_size: pageSize,
      };
      if (selectedCountries.length) params.country = selectedCountries;
      if (selectedStores.length) params.account = selectedStores;
      if (dateRange?.[0]) params.date_from = dateRange[0].format("YYYY-MM-DD");
      if (dateRange?.[1]) params.date_to = dateRange[1].format("YYYY-MM-DD");
      if (selectedCampaign) params.campaign_name = selectedCampaign;

      const res = await adsApi.search(params);
      if (res.data.success) {
        setData(res.data.data?.items || res.data.data || []);
        setTotal(res.data.data?.total || res.data.data?.length || 0);
      }
    } catch (e) {
      message.error("获取产品数据失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, selectedCountries, selectedStores, dateRange, selectedCampaign]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

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

  const columns: ColumnsType<ProductItem> = [
    {
      title: "ASIN",
      dataIndex: "advertised_asin",
      key: "advertised_asin",
      width: 130,
    },
    {
      title: "SKU",
      dataIndex: "advertised_sku",
      key: "advertised_sku",
      width: 130,
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
          <span>活动:</span>
          <Select
            style={{ minWidth: 180 }}
            placeholder="选择活动"
            value={selectedCampaign}
            onChange={setSelectedCampaign}
            options={campaignOptions.map((c) => ({ label: c, value: c }))}
            allowClear
            showSearch
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

      <Card title="产品广告分析">
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
          scroll={{ x: 750 }}
        />
      </Card>
    </Spin>
  );
};

export default ProductAnalysis;
