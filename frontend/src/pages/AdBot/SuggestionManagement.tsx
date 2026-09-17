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
  Select,
  Modal,
} from "antd";
import {
  CheckOutlined,
  StopOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { adSuggestionsApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import SuggestionStatusTag from "./components/SuggestionStatusTag";
import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";

interface SuggestionItem {
  id: number;
  rule_name: string;
  rule_priority: string; // 后端字段: rule_priority（中文 高/中）
  rule_version?: string;
  target_type: string;
  target_id?: string;
  target_name: string;
  condition_metrics?: any;
  current_value: number | null;
  threshold: number | null;
  suggestion_action: string;
  suggestion_reason: string;
  ai_analysis?: any;
  status: string;
  created_by?: number;
  confirmed_by?: number;
  confirmed_at?: string | null;
  executed_at?: string | null;
  expired_at?: string | null;
  evaluation_date?: string;
  created_at: string;
  updated_at?: string;
}

// 优先级映射：后端返回中文 高/中
const PRIORITY_COLORS: Record<string, string> = {
  "高": "red",
  "中": "orange",
  "低": "blue",
  high: "red",
  medium: "orange",
  low: "blue",
};

const PRIORITY_LABELS: Record<string, string> = {
  "高": "高",
  "中": "中",
  "低": "低",
  high: "高",
  medium: "中",
  low: "低",
};

// 目标类型映射
const TARGET_TYPE_LABELS: Record<string, string> = {
  campaign: "广告活动",
  keyword: "关键词",
  search_term: "搜索词",
  product: "商品",
};

const STATUS_TABS = [
  { key: "all", label: "全部" },
  { key: "待处理", label: "待处理" },
  { key: "已确认", label: "已确认" },
  { key: "已执行", label: "已执行" },
  { key: "已忽略", label: "已忽略" },
  { key: "已失效", label: "已失效" },
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
  const [priorityFilter, setPriorityFilter] = useState<string | undefined>(undefined);
  const [targetTypeFilter, setTargetTypeFilter] = useState<string | undefined>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentSuggestion, setCurrentSuggestion] = useState<SuggestionItem | null>(null);
  const [runDate, setRunDate] = useState<dayjs.Dayjs>(dayjs());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, page_size: pageSize };
      if (activeTab !== "all") params.status = activeTab;
      if (priorityFilter) params.priority = priorityFilter;
      if (targetTypeFilter) params.target_type = targetTypeFilter;

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
  }, [page, pageSize, activeTab, priorityFilter, targetTypeFilter]);

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

  const handleUpdateStatusConfirm = (id: number, status: string, label: string) => {
    Modal.confirm({
      title: `确认${label}`,
      content: `确定要将该建议状态更改为"${label}"吗？`,
      okText: "确定",
      cancelText: "取消",
      onOk: () => handleUpdateStatus(id, status),
    });
  };

  const handleBatchUpdate = async (status: string) => {
    if (selectedRowKeys.length === 0) {
      message.warning("请先选择建议");
      return;
    }
    try {
      const results = await Promise.allSettled(
        selectedRowKeys.map((id) => adSuggestionsApi.updateStatus(id as number, status)),
      );
      const successCount = results.filter((r) => r.status === "fulfilled").length;
      const failedCount = results.length - successCount;
      if (failedCount === 0) {
        message.success(`批量操作 ${successCount} 条成功`);
      } else {
        message.warning(`批量操作完成：成功 ${successCount} 条，失败 ${failedCount} 条`);
      }
      setSelectedRowKeys([]);
      fetchData();
    } catch (e) {
      message.error("批量操作失败");
    }
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: "确认删除",
      content: "确定要删除该建议吗？删除后不可恢复。",
      okText: "确定",
      cancelText: "取消",
      okType: "danger",
      onOk: async () => {
        try {
          const res = await adSuggestionsApi.delete(id);
          if (res.data.success) {
            message.success("删除成功");
            fetchData();
          }
        } catch (e) {
          message.error("删除失败");
        }
      },
    });
  };

  const handleRunRules = async () => {
    setRunLoading(true);
    try {
      const res = await adSuggestionsApi.runRules(runDate.format("YYYY-MM-DD"));
      if (res.data.success) {
        const data = res.data.data || {};
        message.success(
          `规则执行成功：触发 ${data.total_triggered || 0} 条，保存 ${data.saved_count || 0} 条`,
        );
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

  const formatValue = (v: any, suffix: string = "") => {
    if (v === null || v === undefined) return "-";
    if (typeof v === "number") return `${v}${suffix}`;
    return `${v}${suffix}`;
  };

  const formatMetrics = (metrics: any) => {
    if (!metrics) return null;
    try {
      const obj = typeof metrics === "string" ? JSON.parse(metrics) : metrics;
      return (
        <pre style={{ margin: 0, maxHeight: 300, overflow: "auto", fontSize: 12 }}>
          {JSON.stringify(obj, null, 2)}
        </pre>
      );
    } catch {
      return String(metrics);
    }
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
      dataIndex: "rule_priority",
      key: "rule_priority",
      width: 80,
      render: (v: string) => (
        <Tag color={PRIORITY_COLORS[v] || "default"}>
          {PRIORITY_LABELS[v] || v}
        </Tag>
      ),
    },
    {
      title: "目标类型",
      dataIndex: "target_type",
      key: "target_type",
      width: 90,
      render: (v: string) => TARGET_TYPE_LABELS[v] || v || "-",
    },
    {
      title: "目标",
      dataIndex: "target_name",
      key: "target_name",
      width: 160,
      ellipsis: true,
      render: (v: string, record) => v || record.target_type || "-",
    },
    {
      title: "当前值",
      dataIndex: "current_value",
      key: "current_value",
      width: 100,
      render: (v: number) => (v !== undefined && v !== null ? v : "-"),
    },
    {
      title: "阈值",
      dataIndex: "threshold",
      key: "threshold",
      width: 100,
      render: (v: number) => (v !== undefined && v !== null ? v : "-"),
    },
    {
      title: "建议动作",
      dataIndex: "suggestion_action",
      key: "suggestion_action",
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
      width: 240,
      fixed: "right",
      render: (_: any, record: SuggestionItem) => (
        <Space size="small">
          <Button size="small" onClick={() => showDetail(record)}>
            详情
          </Button>
          {record.status === "待处理" && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => handleUpdateStatusConfirm(record.id, "已确认", "确认")}
              >
                确认
              </Button>
              <Button
                size="small"
                icon={<StopOutlined />}
                onClick={() => handleUpdateStatusConfirm(record.id, "已忽略", "忽略")}
              >
                忽略
              </Button>
            </>
          )}
          {record.status === "已确认" && (
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => handleUpdateStatusConfirm(record.id, "已执行", "执行")}
            >
              执行
            </Button>
          )}
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          />
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
            disabledDate={(current) => current && current > dayjs().endOf("day")}
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
        <Space style={{ marginBottom: 16 }} wrap>
          <span>优先级:</span>
          <Select
            allowClear
            placeholder="全部优先级"
            style={{ width: 120 }}
            value={priorityFilter}
            onChange={(v) => {
              setPriorityFilter(v);
              setPage(1);
            }}
            options={[
              { value: "高", label: "高" },
              { value: "中", label: "中" },
            ]}
          />
          <span>目标类型:</span>
          <Select
            allowClear
            placeholder="全部目标"
            style={{ width: 140 }}
            value={targetTypeFilter}
            onChange={(v) => {
              setTargetTypeFilter(v);
              setPage(1);
            }}
            options={[
              { value: "campaign", label: "广告活动" },
              { value: "keyword", label: "关键词" },
              { value: "search_term", label: "搜索词" },
              { value: "product", label: "商品" },
            ]}
          />
        </Space>

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
              onClick={() => handleBatchUpdate("已确认")}
            >
              批量确认
            </Button>
            <Button
              icon={<StopOutlined />}
              onClick={() => handleBatchUpdate("已忽略")}
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
              disabled: record.status !== "待处理",
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
          scroll={{ x: 1200 }}
        />
      </Card>

      <Drawer
        title="建议详情"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={640}
      >
        {currentSuggestion && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="ID">
              {currentSuggestion.id}
            </Descriptions.Item>
            <Descriptions.Item label="规则名">
              {currentSuggestion.rule_name}
            </Descriptions.Item>
            <Descriptions.Item label="规则版本">
              {currentSuggestion.rule_version || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="优先级">
              <Tag color={PRIORITY_COLORS[currentSuggestion.rule_priority] || "default"}>
                {PRIORITY_LABELS[currentSuggestion.rule_priority] || currentSuggestion.rule_priority}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="目标类型">
              {TARGET_TYPE_LABELS[currentSuggestion.target_type] || currentSuggestion.target_type}
            </Descriptions.Item>
            <Descriptions.Item label="目标ID">
              {currentSuggestion.target_id || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="目标名称">
              {currentSuggestion.target_name}
            </Descriptions.Item>
            <Descriptions.Item label="当前值">
              {formatValue(currentSuggestion.current_value)}
            </Descriptions.Item>
            <Descriptions.Item label="阈值">
              {formatValue(currentSuggestion.threshold)}
            </Descriptions.Item>
            <Descriptions.Item label="建议动作">
              {currentSuggestion.suggestion_action}
            </Descriptions.Item>
            <Descriptions.Item label="建议原因">
              {currentSuggestion.suggestion_reason}
            </Descriptions.Item>
            <Descriptions.Item label="评估日期">
              {currentSuggestion.evaluation_date || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <SuggestionStatusTag status={currentSuggestion.status} />
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {currentSuggestion.created_at
                ? dayjs(currentSuggestion.created_at).format("YYYY-MM-DD HH:mm:ss")
                : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="确认时间">
              {currentSuggestion.confirmed_at
                ? dayjs(currentSuggestion.confirmed_at).format("YYYY-MM-DD HH:mm:ss")
                : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="执行时间">
              {currentSuggestion.executed_at
                ? dayjs(currentSuggestion.executed_at).format("YYYY-MM-DD HH:mm:ss")
                : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="失效时间">
              {currentSuggestion.expired_at
                ? dayjs(currentSuggestion.expired_at).format("YYYY-MM-DD HH:mm:ss")
                : "-"}
            </Descriptions.Item>
            {currentSuggestion.condition_metrics && (
              <Descriptions.Item label="条件指标">
                {formatMetrics(currentSuggestion.condition_metrics)}
              </Descriptions.Item>
            )}
            {currentSuggestion.ai_analysis && (
              <Descriptions.Item label="AI 分析">
                {formatMetrics(currentSuggestion.ai_analysis)}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Drawer>
    </Spin>
  );
};

export default SuggestionManagement;
