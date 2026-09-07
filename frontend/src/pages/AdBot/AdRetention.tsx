import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Button,
  InputNumber,
  Space,
  Spin,
  message,
  Modal,
  Tag,
  Typography,
  Descriptions,
  Alert,
} from "antd";
import {
  ReloadOutlined,
  SaveOutlined,
  DeleteOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
} from "@ant-design/icons";
import { adsApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";

const { Text } = Typography;

interface RetentionTableInfo {
  table: string;
  count: number;
  earliest_date: string | null;
  error?: string;
}

interface RetentionStatus {
  retention_days: number;
  tenant_id: number | null;
  tables: RetentionTableInfo[];
  total_count: number;
  next_cleanup_at: string;
}

interface CleanupResult {
  retention_days: number;
  cutoff_date: string;
  tables: Array<{
    table: string;
    deleted: number;
    error: string | null;
  }>;
  total_deleted: number;
  success_count: number;
  failed_count: number;
}

// 表名中文映射
const TABLE_LABELS: Record<string, string> = {
  ad_optimization_suggestion: "广告建议池",
  ad_execution_log: "执行日志",
  ad_campaign_daily: "活动日度分表",
  ad_keyword_daily: "关键词日度分表",
  ad_search_term_daily: "搜索词日度分表",
  ad_product_daily: "商品日度分表",
  ad_report_snapshots: "广告快照主表",
};

const AdRetention: React.FC = () => {
  const { currentTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [status, setStatus] = useState<RetentionStatus | null>(null);
  const [editDays, setEditDays] = useState<number>(90);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adsApi.getRetentionStatus();
      if (res.data.success) {
        setStatus(res.data.data);
        setEditDays(res.data.data.retention_days);
      }
    } catch (e) {
      message.error("获取保留策略状态失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSaveConfig = () => {
    if (editDays < 7 || editDays > 365) {
      message.warning("保留天数必须在 7-365 之间");
      return;
    }
    Modal.confirm({
      title: "确认修改保留天数",
      content: `确定要将广告数据保留天数修改为 ${editDays} 天吗？下次清理任务将按新保留期执行。`,
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        setSaving(true);
        try {
          const res = await adsApi.updateRetentionConfig(editDays);
          if (res.data.success) {
            message.success(`保留天数已更新为 ${editDays} 天`);
            fetchStatus();
          }
        } catch (e: any) {
          const detail = e?.response?.data?.detail || "未知错误";
          message.error(`更新失败: ${detail}`);
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const handleCleanup = () => {
    Modal.confirm({
      title: "确认手动清理",
      content: `将立即清理超过 ${status?.retention_days || 90} 天的广告数据。此操作不可撤销，确定继续吗？`,
      okText: "确定清理",
      cancelText: "取消",
      okType: "danger",
      onOk: async () => {
        setCleaning(true);
        try {
          const res = await adsApi.triggerRetentionCleanup();
          if (res.data.success) {
            const data: CleanupResult = res.data.data;
            message.success(
              `清理完成：共删除 ${data.total_deleted} 条记录（成功 ${data.success_count} 表，失败 ${data.failed_count} 表）`,
            );
            fetchStatus();
          }
        } catch (e: any) {
          const detail = e?.response?.data?.detail || "未知错误";
          message.error(`清理失败: ${detail}`);
        } finally {
          setCleaning(false);
        }
      },
    });
  };

  const columns: ColumnsType<RetentionTableInfo> = [
    {
      title: "表名",
      dataIndex: "table",
      key: "table",
      width: 240,
      render: (v: string) => (
        <Space>
          <DatabaseOutlined />
          <Text strong>{TABLE_LABELS[v] || v}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>({v})</Text>
        </Space>
      ),
    },
    {
      title: "数据量",
      dataIndex: "count",
      key: "count",
      width: 120,
      render: (v: number) => v?.toLocaleString() || 0,
      sorter: (a, b) => a.count - b.count,
    },
    {
      title: "最早数据日期",
      dataIndex: "earliest_date",
      key: "earliest_date",
      width: 200,
      render: (v: string | null) =>
        v ? dayjs(v).format("YYYY-MM-DD HH:mm:ss") : "-",
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_: any, record: RetentionTableInfo) =>
        record.error ? (
          <Tag color="red">查询失败</Tag>
        ) : record.count > 0 ? (
          <Tag color="green">正常</Tag>
        ) : (
          <Tag color="default">空表</Tag>
        ),
    },
  ];

  return (
    <Spin spinning={loading}>
      {/* 顶部说明 */}
      <Alert
        message="广告数据保留策略"
        description="每日凌晨 03:00 自动清理超过保留期的广告数据。保留期默认 90 天，可配置 7-365 天。清理使用硬删除，分批 5000 条避免锁表。仅影响广告模块 7 张表，不影响其他模块。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* 顶部统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="当前保留天数"
              value={status?.retention_days || 0}
              suffix="天"
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="数据总量"
              value={status?.total_count || 0}
              suffix="条"
              prefix={<DatabaseOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="监控表数量"
              value={status?.tables?.length || 0}
              suffix="张"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="下次清理时间"
              value={
                status?.next_cleanup_at
                  ? dayjs(status.next_cleanup_at).format("MM-DD HH:mm")
                  : "-"
              }
              prefix={<CalendarOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 配置与操作 */}
      <Card title="保留策略配置" style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          <span>保留天数:</span>
          <InputNumber
            min={7}
            max={365}
            value={editDays}
            onChange={(v) => setEditDays(v || 90)}
            style={{ width: 120 }}
            suffix="天"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            (允许范围: 7-365 天)
          </Text>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSaveConfig}
            disabled={editDays === status?.retention_days}
            style={{ background: currentTheme.primary }}
          >
            保存配置
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={cleaning}
            onClick={handleCleanup}
          >
            手动清理
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchStatus}>
            刷新
          </Button>
        </Space>
      </Card>

      {/* 各表数据量统计 */}
      <Card title="各表数据量统计">
        <Table
          columns={columns}
          dataSource={status?.tables || []}
          rowKey="table"
          pagination={false}
          size="small"
          summary={(data) => {
            const total = data.reduce((sum, r) => sum + (r.count || 0), 0);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>
                  <Text strong>合计</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1}>
                  <Text strong>{total.toLocaleString()}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2}>-</Table.Summary.Cell>
                <Table.Summary.Cell index={3}>-</Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      </Card>

      {/* 清理顺序说明 */}
      <Card title="清理顺序说明" style={{ marginTop: 16 }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="清理顺序">
            建议池 → 执行日志 → 4 个日度分表 → 快照主表（子表先于主表）
          </Descriptions.Item>
          <Descriptions.Item label="清理方式">
            硬删除（DELETE），不使用软删除
          </Descriptions.Item>
          <Descriptions.Item label="分批策略">
            每批 5000 条，避免长事务锁表
          </Descriptions.Item>
          <Descriptions.Item label="异常隔离">
            单表清理失败不影响其他表，错误记录到日志
          </Descriptions.Item>
          <Descriptions.Item label="调度时间">
            每日 03:00 自动执行（cron: hour=3, minute=0）
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </Spin>
  );
};

export default AdRetention;
