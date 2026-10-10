import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Card,
  Upload,
  Button,
  DatePicker,
  Progress,
  Alert,
  Typography,
  Space,
  Descriptions,
  Tag,
  message,
  Spin,
} from "antd";
import {
  InboxOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { adsApi } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import dayjs from "dayjs";

const { Dragger } = Upload;
const { Text, Title, Paragraph } = Typography;

interface ImportStatus {
  running: boolean;
  total: number;
  processed: number;
  success: number;
  failed: number;
  message: string;
  started_at: string | null;
  finished_at: string | null;
}

const AdImport: React.FC = () => {
  const { currentTheme } = useTheme();
  const [uploading, setUploading] = useState(false);
  const [importDate, setImportDate] = useState<dayjs.Dayjs>(dayjs());
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await adsApi.getImportStatus();
      if (res.data.success) {
        const data = res.data.data;
        setStatus(data);
        return data;
      }
    } catch (e) {
      // 静默
    }
    return null;
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [fetchStatus]);

  // 轮询导入状态
  const startPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    setPolling(true);
    pollingRef.current = setInterval(async () => {
      const data = await fetchStatus();
      // 导入完成（running 转为 false）停止轮询
      if (data && !data.running) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setPolling(false);
        if (data.failed > 0) {
          message.warning(
            `导入完成：成功 ${data.success} 条，失败 ${data.failed} 条`,
          );
        } else if (data.success > 0) {
          message.success(`导入完成：共 ${data.success} 条记录`);
        }
      }
    }, 2000);
  }, [fetchStatus]);

  const handleUpload = async (file: File) => {
    // 文件类型校验
    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!validTypes.includes(file.type) && !["xlsx", "xls"].includes(ext || "")) {
      message.error("仅支持 .xlsx 或 .xls 格式的 Excel 文件");
      return false;
    }
    // 文件大小校验（10MB）
    if (file.size > 10 * 1024 * 1024) {
      message.error("文件大小不能超过 10MB");
      return false;
    }

    setUploading(true);
    try {
      const dateStr = importDate.format("YYYY-MM-DD");
      const res = await adsApi.import(file, dateStr);
      if (res.data.success) {
        message.success("导入任务已启动，正在后台处理...");
        startPolling();
      } else {
        message.error("启动导入失败");
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || "未知错误";
      message.error(`导入失败: ${detail}`);
    } finally {
      setUploading(false);
    }
    return false; // 阻止 antd 自动上传
  };

  const getProgressPercent = () => {
    if (!status || !status.total) return 0;
    return Math.round(((status.processed || 0) / status.total) * 100);
  };

  const getStatusTag = () => {
    if (!status) return null;
    if (status.running) {
      return (
        <Tag icon={<LoadingOutlined />} color="processing">
          导入中
        </Tag>
      );
    }
    if (status.failed > 0 && status.success > 0) {
      return (
        <Tag icon={<CheckCircleOutlined />} color="warning">
          部分成功
        </Tag>
      );
    }
    if (status.failed > 0 && status.success === 0) {
      return (
        <Tag icon={<CloseCircleOutlined />} color="error">
          失败
        </Tag>
      );
    }
    if (status.success > 0) {
      return (
        <Tag icon={<CheckCircleOutlined />} color="success">
          完成
        </Tag>
      );
    }
    return <Tag color="default">空闲</Tag>;
  };

  return (
    <Spin spinning={uploading || polling}>
      {/* 上传区域 */}
      <Card title="导入广告报表" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Alert
            message="支持文件类型"
            description="支持 5 种广告报表：广告活动数据.xlsx、广告数据.xlsx、关键词数据.xlsx、商品投放数据.xlsx、搜索词数据.xlsx。单文件大小不超过 10MB。导入完成后会自动触发规则引擎生成优化建议。"
            type="info"
            showIcon
          />

          <Space wrap size="middle">
            <span>报告日期:</span>
            <DatePicker
              value={importDate}
              onChange={(d) => d && setImportDate(d)}
              allowClear={false}
              disabledDate={(current) =>
                current && current > dayjs().endOf("day")
              }
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              (留空则从文件名提取，无法提取时使用当天日期)
            </Text>
          </Space>

          <Dragger
            accept=".xlsx,.xls"
            multiple={false}
            showUploadList={false}
            beforeUpload={handleUpload}
            disabled={uploading || polling}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: currentTheme.primary }} />
            </p>
            <p className="ant-upload-text">
              点击或拖拽 Excel 文件到此区域上传
            </p>
            <p className="ant-upload-hint">
              仅支持 .xlsx 或 .xls 格式，单文件不超过 10MB
            </p>
          </Dragger>
        </Space>
      </Card>

      {/* 导入状态 */}
      <Card
        title={
          <Space>
            <span>导入状态</span>
            {getStatusTag()}
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={fetchStatus}
            >
              刷新
            </Button>
          </Space>
        }
      >
        {status ? (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {status.running && (
              <Progress percent={getProgressPercent()} status="active" />
            )}

            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="总记录数">
                {status.total || 0}
              </Descriptions.Item>
              <Descriptions.Item label="已处理">
                {status.processed || 0}
              </Descriptions.Item>
              <Descriptions.Item label="成功">
                <Text type="success">{status.success || 0}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="失败">
                <Text type="danger">{status.failed || 0}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="开始时间">
                {status.started_at
                  ? dayjs(status.started_at).format("YYYY-MM-DD HH:mm:ss")
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="完成时间">
                {status.finished_at
                  ? dayjs(status.finished_at).format("YYYY-MM-DD HH:mm:ss")
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="消息" span={2}>
                {status.message || "-"}
              </Descriptions.Item>
            </Descriptions>

            {!status.running && status.success > 0 && (
              <Alert
                message="导入完成"
                description={
                  <span>
                    成功导入 {status.success} 条记录。规则引擎已自动触发，请到
                    <Text strong>「建议」</Text>Tab 查看优化建议。
                  </span>
                }
                type="success"
                showIcon
              />
            )}

            {!status.running && status.failed > 0 && (
              <Alert
                message="导入异常"
                description={`失败 ${status.failed} 条记录，请查看后端日志排查原因`}
                type="warning"
                showIcon
              />
            )}
          </Space>
        ) : (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
            暂无导入任务，请上传 Excel 文件开始导入
          </div>
        )}
      </Card>

      {/* 使用说明 */}
      <Card title="使用说明" style={{ marginTop: 16 }}>
        <Paragraph>
          <Title level={5}>1. 选择报告日期</Title>
          <Text>
            报告日期是导入数据所属的日期。如果不选择，系统会尝试从文件名中提取日期（如"广告活动数据_20260715.xlsx"），无法提取时使用当天日期。
          </Text>
        </Paragraph>
        <Paragraph>
          <Title level={5}>2. 上传 Excel 文件</Title>
          <Text>
            系统会自动识别 5 种报告类型（广告活动、广告数据、关键词、商品投放、搜索词），并解析字段映射。每日导入约 17 万条快照数据。
          </Text>
        </Paragraph>
        <Paragraph>
          <Title level={5}>3. 等待导入完成</Title>
          <Text>
            导入在后台异步执行，可在此页查看进度。完成后会自动触发 7 条预定义规则，生成的建议请到「建议」Tab 处理。
          </Text>
        </Paragraph>
        <Paragraph>
          <Title level={5}>4. 数据保留</Title>
          <Text>
            导入的数据默认保留 90 天，可到「数据保留」Tab 配置保留期。每日 03:00 自动清理过期数据。
          </Text>
        </Paragraph>
      </Card>
    </Spin>
  );
};

export default AdImport;
