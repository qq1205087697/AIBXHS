import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Select,
  Tag,
  Spin,
  message,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { adExecutionLogsApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";

const { Text } = Typography;

interface ExecutionLog {
  id: number;
  executed_at: string;
  rule_name: string;
  action: string;
  target: string;
  status: string;
  executor: string;
  result: any;
  error_message: string | null;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  success: { color: "green", label: "成功" },
  failed: { color: "red", label: "失败" },
  error: { color: "red", label: "失败" },
  pending: { color: "orange", label: "执行中" },
};

const ExecutionLogView: React.FC = () => {
  const { currentTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ExecutionLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [ruleNameFilter, setRuleNameFilter] = useState<string | undefined>(undefined);
  const [ruleNameOptions, setRuleNameOptions] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, page_size: pageSize };
      if (ruleNameFilter) params.rule_name = ruleNameFilter;

      const res = await adExecutionLogsApi.list(params);
      if (res.data.success) {
        const items = res.data.data?.items || res.data.data || [];
        setData(items);
        setTotal(res.data.data?.total || items.length || 0);
        // 提取规则名选项
        const names: string[] = Array.from(
          new Set(items.map((i: ExecutionLog) => i.rule_name).filter(Boolean)),
        ) as string[];
        setRuleNameOptions(names);
      }
    } catch (e) {
      message.error("获取执行日志失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, ruleNameFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const columns: ColumnsType<ExecutionLog> = [
    {
      title: "时间",
      dataIndex: "executed_at",
      key: "executed_at",
      width: 170,
      render: (v: string) =>
        v ? dayjs(v).format("YYYY-MM-DD HH:mm:ss") : "-",
    },
    {
      title: "规则名",
      dataIndex: "rule_name",
      key: "rule_name",
      width: 160,
      ellipsis: true,
    },
    {
      title: "动作",
      dataIndex: "action",
      key: "action",
      width: 140,
    },
    {
      title: "目标",
      dataIndex: "target",
      key: "target",
      width: 160,
      ellipsis: true,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (v: string) => {
        const config = STATUS_CONFIG[v] || { color: "default", label: v };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: "执行人",
      dataIndex: "executor",
      key: "executor",
      width: 100,
      render: (v: string) => v || "系统",
    },
  ];

  const expandedRowRender = (record: ExecutionLog) => (
    <div style={{ padding: "8px 0" }}>
      {record.error_message && (
        <div style={{ marginBottom: 8 }}>
          <Text strong style={{ color: "#ff4d4f" }}>
            错误信息:
          </Text>
          <div style={{ marginTop: 4 }}>{record.error_message}</div>
        </div>
      )}
      <Text strong>执行结果:</Text>
      <pre
        style={{
          margin: "8px 0 0",
          padding: 12,
          background: "#f5f5f5",
          borderRadius: 4,
          maxHeight: 300,
          overflow: "auto",
          fontSize: 12,
        }}
      >
        {JSON.stringify(record.result || record, null, 2)}
      </pre>
    </div>
  );

  return (
    <Spin spinning={loading}>
      <Card style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          <span>规则名:</span>
          <Select
            style={{ minWidth: 200 }}
            placeholder="筛选规则名"
            value={ruleNameFilter}
            onChange={setRuleNameFilter}
            options={ruleNameOptions.map((r) => ({ label: r, value: r }))}
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

      <Card title="执行日志">
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          expandable={{
            expandedRowRender,
            rowExpandable: (record) => !!record.result || !!record.error_message,
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
          scroll={{ x: 850 }}
        />
      </Card>
    </Spin>
  );
};

export default ExecutionLogView;
