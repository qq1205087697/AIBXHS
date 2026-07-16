import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Tabs,
  Tag,
  Drawer,
  DatePicker,
  Spin,
  message,
  Descriptions,
} from "antd";
import {
  CheckOutlined,
  StopOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { adSuggestionsApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import SuggestionStatusTag from "./components/SuggestionStatusTag";
import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";

interface SuggestionItem {
  id: number;
  rule_name: string;
  priority: string;
  target_type: string;
  target_name: string;
  current_value: number;
  suggested_action: string;
  suggested_value: number;
  reason: string;
  status: string;
  created_at: string;
  executed_at: string | null;
  details: any;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "red",
  medium: "orange",
  low: "blue",
};

const PRIORITY_LABELS: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const STATUS_TABS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "confirmed", label: "已确认" },
  { key: "executed", label: "已执行" },
  { key: "ignored", label: "已忽略" },
  { key: "expired", label: "已失效" },
];

const SuggestionManagement: React.FC = () => {
  const { currentTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [data, setData] = useState<SuggestionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [activeTab, setActiveTab] = useState("all");
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentSuggestion, setCurrentSuggestion] = useState<SuggestionItem | null>(null);
  const [runDate, setRunDate] = useState<dayjs.Dayjs>(dayjs());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, page_size: pageSize };
      if (activeTab !== "all") params.status = activeTab;

      const res = await adSuggestionsApi.list(params);
      if (res.data.success) {
        setData(res.data.data?.items || res.data.data || []);
        setTotal(res.data.data?.total || res.data.data?.length || 0);
      }
    } catch (e) {
      message.error("获取建议列表失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      const res = await adSuggestionsApi.updateStatus(id, status);
      if (res.data.success) {
        message.success("状态更新成功");
        fetchData();
      }
    } catch (e) {
      message.error("状态更新失败");
    }
  };

  const handleBatchUpdate = async (status: string) => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先选择建议");
      return;
    }
    try {
      await Promise.all(
        selectedRowKeys.map((id) => adSuggestionsApi.updateStatus(id as number, status)),
      );
      message.success(`批量操作 ${selectedRowKeys.length} 条成功`);
      setSelectedRowKeys([]);
      fetchData();
    } catch (e) {
      message.error("批量操作失败");
    }
  };

  const handleRunRules = async () => {
    setRunLoading(true);
    try {
      const res = await adSuggestionsApi.runRules(runDate.format("YYYY-MM-DD"));
      if (res.data.success) {
        message.success("规则执行成功");
        fetchData();
      }
    } catch (e) {
      message.error("规则执行失败");
    } finally {
      setRunLoading(false);
    }
  };

  const showDetail = async (record: SuggestionItem) => {
    try {
      const res = await adSuggestionsApi.getById(record.id);
      if (res.data.success) {
        setCurrentSuggestion(res.data.data);
      } else {
        setCurrentSuggestion(record);
      }
    } catch (e) {
      setCurrentSuggestion(record);
    }
    setDrawerOpen(true);
  };

  const columns: ColumnsType<SuggestionItem> = [
    {
      title: "规则名",
      dataIndex: "rule_name",
      key: "rule_name",
      width: 160,
      ellipsis: true,
    },
    {
      title: "优先级",
      dataIndex: "priority",
      key: "priority",
      width: 80,
      render: (v: string) => (
        <Tag color={PRIORITY_COLORS[v] || "default"}>
          {PRIORITY_LABELS[v] || v}
        </Tag>
      ),
    },
    {
      title: "目标",
      dataIndex: "target_name",
      key: "target_name",
      width: 160,
      ellipsis: true,
      render: (v: string, record) => v || record.target_type,
    },
    {
      title: "当前值",
      dataIndex: "current_value",
      key: "current_value",
      width: 100,
      render: (v: number) => (v !== undefined && v !== null ? v : "-"),
    },
    {
      title: "建议动作",
      dataIndex: "suggested_action",
      key: "suggested_action",
      width: 200,
      ellipsis: true,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (v: string) => <SuggestionStatusTag status={v} />,
    },
    {
      title: "操作",
      key: "action",
      width: 200,
      render: (_: any, record: SuggestionItem) => (
        <Space size="small">
          <Button size="small" onClick={() => showDetail(record)}>
            详情
          </Button>
          {record.status === "pending" && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => handleUpdateStatus(record.id, "confirmed")}
              >
                确认
              </Button>
              <Button
                size="small"
                icon={<StopOutlined />}
                onClick={() => handleUpdateStatus(record.id, "ignored")}
              >
                忽略
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Spin spinning={loading}>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          <span>执行日期:</span>
          <DatePicker
            value={runDate}
            onChange={(d) => d && setRunDate(d)}
            allowClear={false}
          />
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={runLoading}
            onClick={handleRunRules}
            style={{ background: currentTheme.primary }}
          >
            执行规则
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>
            刷新
          </Button>
        </Space>
      </Card>

      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key);
            setPage(1);
            setSelectedRowKeys([]);
          }}
          items={STATUS_TABS.map((t) => ({ key: t.key, label: t.label }))}
        />

        {selectedRowKeys.length > 0 && (
          <Space style={{ marginBottom: 16 }}>
            <span>已选 {selectedRowKeys.length} 项</span>
            <Button
              icon={<CheckOutlined />}
              onClick={() => handleBatchUpdate("confirmed")}
            >
              批量确认
            </Button>
            <Button
              icon={<StopOutlined />}
              onClick={() => handleBatchUpdate("ignored")}
            >
              批量忽略
            </Button>
          </Space>
        )}

        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            getCheckboxProps: (record: SuggestionItem) => ({
              disabled: record.status !== "pending",
            }),
          }}
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
          scroll={{ x: 1000 }}
        />
      </Card>

      <Drawer
        title="建议详情"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={560}
      >
        {currentSuggestion && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="ID">
              {currentSuggestion.id}
            </Descriptions.Item>
            <Descriptions.Item label="规则名">
              {currentSuggestion.rule_name}
            </Descriptions.Item>
            <Descriptions.Item label="优先级">
              <Tag color={PRIORITY_COLORS[currentSuggestion.priority] || "default"}>
                {PRIORITY_LABELS[currentSuggestion.priority] || currentSuggestion.priority}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="目标类型">
              {currentSuggestion.target_type}
            </Descriptions.Item>
            <Descriptions.Item label="目标名称">
              {currentSuggestion.target_name}
            </Descriptions.Item>
            <Descriptions.Item label="当前值">
              {currentSuggestion.current_value}
            </Descriptions.Item>
            <Descriptions.Item label="建议动作">
              {currentSuggestion.suggested_action}
            </Descriptions.Item>
            <Descriptions.Item label="建议值">
              {currentSuggestion.suggested_value}
            </Descriptions.Item>
            <Descriptions.Item label="原因">
              {currentSuggestion.reason}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <SuggestionStatusTag status={currentSuggestion.status} />
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {currentSuggestion.created_at
                ? dayjs(currentSuggestion.created_at).format("YYYY-MM-DD HH:mm:ss")
                : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="执行时间">
              {currentSuggestion.executed_at
                ? dayjs(currentSuggestion.executed_at).format("YYYY-MM-DD HH:mm:ss")
                : "-"}
            </Descriptions.Item>
            {currentSuggestion.details && (
              <Descriptions.Item label="详细信息">
                <pre style={{ margin: 0, maxHeight: 300, overflow: "auto" }}>
                  {JSON.stringify(currentSuggestion.details, null, 2)}
                </pre>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Drawer>
    </Spin>
  );
};

export default SuggestionManagement;
