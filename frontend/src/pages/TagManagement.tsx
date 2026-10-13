/**
 * 标签管理页（US-8 / US-9 / US-4 / US-5 承载）
 * - 产品标签：全量标签查看、人工打标/解锁、override 设置与解除
 * - 节日词库：K6 枚举内条目管理（关键词 + 日期窗口）
 * - 审计记录：标签变更全程留痕查询（US-9）
 * - 数据链路：星拓拉取状态/手动拉取、自动打标手动触发、过滤阈值配置
 *
 * 依据：《系统设计》v1.0 §3.2.M2/M3；《UserStory》US-3/US-4/US-5/US-8/US-9
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  DatePicker,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { RefreshCw, Download, PlayCircle } from "lucide-react";
import { tagsApi } from "../api";

const { Title, Text } = Typography;

// K6 冻结枚举（与后端 tag_service.K6_HOLIDAY_NAMES 一致）
const K6_HOLIDAY_NAMES = [
  "万圣节",
  "感恩节黑五",
  "圣诞节",
  "情人节",
  "复活节",
  "独立日",
  "母亲节",
  "父亲节",
  "返校季",
  "PrimeDay",
  "其他",
];

interface ProductTagRow {
  id: number;
  asin: string;
  sku: string;
  tag_type: string;
  tag_value: string;
  source: string;
  locked: number;
  active: number;
  match_basis: string | null;
  reason: string | null;
  updated_at: string | null;
}

interface LexiconRow {
  id: number;
  holiday_name: string;
  keyword: string;
  match_type: string;
  site: string;
  window_start: string | null;
  window_end: string | null;
  status: number;
  remark: string | null;
  updated_at: string | null;
}

interface AuditRow {
  id: number;
  asin: string;
  sku: string;
  tag_type: string;
  action: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  operator: string;
  reason: string | null;
  created_at: string;
}

const TagManagement: React.FC = () => {
  const { message } = App.useApp();

  // ===== 产品标签 =====
  const [tagRows, setTagRows] = useState<ProductTagRow[]>([]);
  const [tagTotal, setTagTotal] = useState(0);
  const [tagQuery, setTagQuery] = useState<{ page: number; pageSize: number; keyword: string; tagType?: string }>({
    page: 1,
    pageSize: 20,
    keyword: "",
  });
  const [tagLoading, setTagLoading] = useState(false);

  // ===== 节日词库 =====
  const [lexRows, setLexRows] = useState<LexiconRow[]>([]);
  const [lexLoading, setLexLoading] = useState(false);
  const [lexModalOpen, setLexModalOpen] = useState(false);
  // lexForm.id 有值 = 编辑模式（US-4 AC2），无值 = 新增
  const [lexForm, setLexForm] = useState<{
    id?: number;
    holiday_name: string;
    keyword: string;
    match_type: string;
    site: string;
    status: number;
    remark: string;
    window: any;
  }>({
    holiday_name: "万圣节",
    keyword: "",
    match_type: "contains",
    site: "ALL",
    status: 1,
    remark: "",
    window: null,
  });

  // ===== 审计 =====
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditQuery, setAuditQuery] = useState<{ page: number; pageSize: number; asin?: string; source?: string }>({
    page: 1,
    pageSize: 20,
  });
  const [auditLoading, setAuditLoading] = useState(false);

  // ===== 数据链路 =====
  const [pullStatus, setPullStatus] = useState<any>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [threshold, setThreshold] = useState<number>(0);
  const [windowDays, setWindowDays] = useState<number>(28);

  const fetchTags = useCallback(async () => {
    setTagLoading(true);
    try {
      const resp = await tagsApi.list({
        page: tagQuery.page,
        page_size: tagQuery.pageSize,
        keyword: tagQuery.keyword || undefined,
        tag_type: tagQuery.tagType,
      });
      const data = resp.data?.data || resp.data;
      setTagRows(data?.items || []);
      setTagTotal(data?.total || 0);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "获取标签列表失败");
    } finally {
      setTagLoading(false);
    }
  }, [tagQuery, message]);

  const fetchLexicon = useCallback(async () => {
    setLexLoading(true);
    try {
      const resp = await tagsApi.listLexicon({ page: 1, page_size: 200 });
      const data = resp.data?.data || resp.data;
      setLexRows(data?.items || []);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "获取词库失败");
    } finally {
      setLexLoading(false);
    }
  }, [message]);

  const fetchAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const resp = await tagsApi.listAudit({
        page: auditQuery.page,
        page_size: auditQuery.pageSize,
        asin: auditQuery.asin || undefined,
        source: auditQuery.source,
      });
      const data = resp.data?.data || resp.data;
      setAuditRows(data?.items || []);
      setAuditTotal(data?.total || 0);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "获取审计记录失败");
    } finally {
      setAuditLoading(false);
    }
  }, [auditQuery, message]);

  const fetchLinkStatus = useCallback(async () => {
    setLinkLoading(true);
    try {
      const [statusResp, configResp] = await Promise.all([
        tagsApi.getStartopStatus(),
        tagsApi.getFilterConfig(),
      ]);
      setPullStatus(statusResp.data?.data || statusResp.data);
      const cfg = configResp.data?.data || configResp.data || {};
      setThreshold(cfg.negative_margin_threshold ?? 0);
      setWindowDays(cfg.tag_window_days ?? 28);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "获取链路状态失败");
    } finally {
      setLinkLoading(false);
    }
  }, [message]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);
  useEffect(() => {
    fetchLexicon();
  }, [fetchLexicon]);
  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);
  useEffect(() => {
    fetchLinkStatus();
  }, [fetchLinkStatus]);

  // ===== 操作：override 设置/解除 =====
  const openForceModal = (row: ProductTagRow) => {
    let reason = "";
    Modal.confirm({
      title: `设置强制补货：${row.asin}`,
      content: (
        <div>
          <p style={{ marginBottom: 4 }}>
            该商品将无视节日/负利润排除，始终参与补货（停售除外）。
          </p>
          <Input.TextArea
            placeholder="必填：请填写设置理由"
            onChange={(e) => (reason = e.target.value)}
          />
        </div>
      ),
      okText: "确认设置",
      cancelText: "取消",
      onOk: async () => {
        if (!reason.trim()) {
          message.error("必须填写理由");
          return Promise.reject();
        }
        try {
          await tagsApi.setForceReplenish(row.asin, reason.trim(), row.sku);
          message.success("已设置强制补货标签");
          fetchTags();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || "操作失败");
          return Promise.reject();
        }
      },
    });
  };

  // ===== 操作：人工打节日标签（K5 锁定） =====
  const openHolidayModal = (row: ProductTagRow) => {
    let holiday = "万圣节";
    Modal.confirm({
      title: `人工打节日标签：${row.asin}`,
      content: (
        <div>
          <p style={{ marginBottom: 4 }}>
            人工标签将被锁定（K5），自动打标不会覆盖；可随时解除锁定恢复自动。
          </p>
          <Select
            defaultValue="万圣节"
            style={{ width: 200 }}
            options={K6_HOLIDAY_NAMES.map((n) => ({ value: n, label: n }))}
            onChange={(v) => (holiday = v)}
          />
        </div>
      ),
      okText: "确认打标",
      cancelText: "取消",
      onOk: async () => {
        try {
          await tagsApi.setHoliday(row.asin, holiday, row.sku);
          message.success(`已人工标记为「${holiday}」`);
          fetchTags();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || "操作失败");
          return Promise.reject();
        }
      },
    });
  };

  // ===== 操作：解锁 =====
  const unlockTag = async (row: ProductTagRow, clear: boolean) => {
    try {
      await tagsApi.unlockHoliday(row.asin, row.tag_value, clear);
      message.success(clear ? "已解除锁定并清除标签" : "已解除锁定，恢复自动管辖");
      fetchTags();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "操作失败");
    }
  };

  // ===== 词库新增/编辑/删除（US-4 AC2） =====
  const emptyLexForm = {
    id: undefined as number | undefined,
    holiday_name: "万圣节",
    keyword: "",
    match_type: "contains",
    site: "ALL",
    status: 1,
    remark: "",
    window: null as any,
  };

  const openLexCreate = () => {
    setLexForm({ ...emptyLexForm });
    setLexModalOpen(true);
  };

  const openLexEdit = (row: LexiconRow) => {
    setLexForm({
      id: row.id,
      holiday_name: row.holiday_name,
      keyword: row.keyword,
      match_type: row.match_type,
      site: row.site || "ALL",
      status: row.status ?? 1,
      remark: row.remark || "",
      window:
        row.window_start && row.window_end
          ? [dayjs(row.window_start), dayjs(row.window_end)]
          : null,
    });
    setLexModalOpen(true);
  };

  const submitLexicon = async () => {
    if (!lexForm.keyword.trim()) {
      message.error("命中关键词不能为空");
      return;
    }
    const payload = {
      holiday_name: lexForm.holiday_name,
      keyword: lexForm.keyword.trim(),
      match_type: lexForm.match_type,
      site: lexForm.site,
      window_start: lexForm.window?.[0]?.format("YYYY-MM-DD") || null,
      window_end: lexForm.window?.[1]?.format("YYYY-MM-DD") || null,
    };
    try {
      if (lexForm.id) {
        // 编辑：连同启用状态与备注一起提交（后端只更新请求中出现的字段）
        await tagsApi.updateLexicon(lexForm.id, {
          ...payload,
          status: lexForm.status,
          remark: lexForm.remark,
        });
        message.success("词库条目已更新，下一轮自动打标生效");
      } else {
        await tagsApi.addLexicon(payload);
        message.success("词库条目已保存，下一轮自动打标生效");
      }
      setLexModalOpen(false);
      setLexForm({ ...emptyLexForm });
      fetchLexicon();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "保存失败");
    }
  };

  const deleteLexicon = async (row: LexiconRow) => {
    try {
      await tagsApi.deleteLexicon(row.id);
      message.success("词库条目已删除");
      fetchLexicon();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "删除失败");
    }
  };

  // ===== 手动触发 =====
  const runAutoTagging = async () => {
    try {
      const resp = await tagsApi.runAutoTagging();
      const data = resp.data?.data || resp.data;
      message.success(
        `自动打标完成：新打标 ${data?.tagged ?? 0}，清除 ${data?.cleared ?? 0}`,
      );
      fetchTags();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "自动打标失败");
    }
  };

  const manualPull = async () => {
    try {
      const resp = await tagsApi.pullStartop();
      const data = resp.data?.data || resp.data;
      message.success(
        `拉取完成：店铺 ${data?.pull?.stores ?? 0} 个，词数据 ${data?.pull?.rows ?? 0} 行，打标 ${data?.tagging?.tagged ?? 0}`,
      );
      fetchLinkStatus();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "拉取失败（可走定时报告导入兜底）");
    }
  };

  // F10 兜底通道：星拓定时报告导入（对齐《系统设计》§3.2.M1「MCP 故障时的兜底词数据来源」）
  // 幂等由后端文件哈希保证：同一文件重复上传返回 DUPLICATE，不会重复写库
  const [reportImporting, setReportImporting] = useState(false);
  const importReport = async (file: File) => {
    setReportImporting(true);
    try {
      const resp = await tagsApi.importStartopReport(file);
      const data = resp.data?.data || resp.data;
      const r = data?.import || {};
      if (r.status === "DUPLICATE") {
        message.warning(r.message || "该报告文件已导入过（哈希一致），本次已跳过");
      } else if (r.status === "SUCCESS") {
        message.success(
          `兜底导入完成：解析 ${r.rows_total ?? 0} 行，入库 ${r.rows_imported ?? 0} 行，跳过 ${r.rows_skipped ?? 0} 行`,
        );
      } else {
        message.error(r.message || "兜底报告导入失败");
      }
      fetchLinkStatus();
      fetchTags();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "兜底报告导入失败");
    } finally {
      setReportImporting(false);
    }
  };

  const saveConfig = async () => {
    try {
      await tagsApi.saveFilterConfig({
        negative_margin_threshold: Number(threshold) || 0,
        tag_window_days: Number(windowDays) || 28,
      });
      message.success("过滤配置已保存，下一轮查询/计算生效");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "保存失败");
    }
  };

  // ===== 列定义 =====
  const tagColumns: ColumnsType<ProductTagRow> = useMemo(
    () => [
      { title: "ASIN", dataIndex: "asin", key: "asin", width: 130 },
      { title: "SKU", dataIndex: "sku", key: "sku", width: 130 },
      {
        title: "标签类型",
        dataIndex: "tag_type",
        key: "tag_type",
        width: 110,
        render: (v: string) =>
          v === "force_replenish" ? (
            <Tag color="gold">强制补货</Tag>
          ) : (
            <Tag color="purple">节日</Tag>
          ),
      },
      { title: "标签值", dataIndex: "tag_value", key: "tag_value", width: 110 },
      {
        title: "来源",
        dataIndex: "source",
        key: "source",
        width: 80,
        render: (v: string) =>
          v === "auto" ? <Tag color="blue">自动</Tag> : <Tag color="orange">人工</Tag>,
      },
      {
        title: "锁定",
        dataIndex: "locked",
        key: "locked",
        width: 90,
        render: (v: number) => (v === 1 ? <Tag color="red">人工锁定</Tag> : "-"),
      },
      {
        title: "命中依据",
        dataIndex: "match_basis",
        key: "match_basis",
        ellipsis: true,
        render: (v: string | null) =>
          v ? (
            <Tooltip title={v}>
              <Text style={{ fontSize: 12 }}>{v}</Text>
            </Tooltip>
          ) : (
            "-"
          ),
      },
      { title: "理由", dataIndex: "reason", key: "reason", ellipsis: true },
      { title: "更新时间", dataIndex: "updated_at", key: "updated_at", width: 170 },
      {
        title: "操作",
        key: "action",
        width: 240,
        render: (_: any, row: ProductTagRow) => (
          <Space size={4}>
            {row.tag_type === "force_replenish" ? (
              <Popconfirm
                title="解除强制补货？"
                description="解除后恢复常规过滤规则"
                onConfirm={async () => {
                  try {
                    await tagsApi.clearForceReplenish(row.asin);
                    message.success("已解除强制补货标签");
                    fetchTags();
                  } catch (e: any) {
                    message.error(e?.response?.data?.detail || "操作失败");
                  }
                }}
                okText="确定"
                cancelText="取消"
              >
                <Button type="link" size="small" danger>
                  解除强制
                </Button>
              </Popconfirm>
            ) : (
              <>
                {row.source === "manual" && row.locked === 1 ? (
                  <>
                    <Button type="link" size="small" onClick={() => unlockTag(row, false)}>
                      解除锁定
                    </Button>
                    <Popconfirm
                      title="解除锁定并清除标签？"
                      onConfirm={() => unlockTag(row, true)}
                      okText="确定"
                      cancelText="取消"
                    >
                      <Button type="link" size="small" danger>
                        清除标签
                      </Button>
                    </Popconfirm>
                  </>
                ) : (
                  <Button type="link" size="small" onClick={() => openHolidayModal(row)}>
                    人工打标
                  </Button>
                )}
              </>
            )}
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tagRows],
  );

  const lexColumns: ColumnsType<LexiconRow> = [
    {
      title: "节日",
      dataIndex: "holiday_name",
      key: "holiday_name",
      width: 120,
      render: (v: string) => <Tag color="purple">{v}</Tag>,
    },
    { title: "命中关键词", dataIndex: "keyword", key: "keyword", width: 260 },
    {
      title: "匹配方式",
      dataIndex: "match_type",
      key: "match_type",
      width: 100,
      render: (v: string) => (v === "exact" ? "精确" : "包含"),
    },
    {
      title: "站点",
      dataIndex: "site",
      key: "site",
      width: 90,
      render: (v: string) =>
        ({ ALL: "全部", US: "美国站", UK: "英国站" } as Record<string, string>)[v] || v || "全部",
    },
    {
      title: "日期窗口",
      key: "window",
      width: 140,
      render: (_: any, row: LexiconRow) =>
        row.window_start ? `${row.window_start} ~ ${row.window_end}` : "不限",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (v: number) => (v === 1 ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    { title: "更新时间", dataIndex: "updated_at", key: "updated_at", width: 170 },
    {
      title: "操作",
      key: "action",
      width: 140,
      render: (_: any, row: LexiconRow) => (
        <Space size={2}>
          <Button type="link" size="small" onClick={() => openLexEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title="删除该词库条目？"
            description="删除后下一轮自动打标不再命中该词"
            onConfirm={() => deleteLexicon(row)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const auditColumns: ColumnsType<AuditRow> = [
    { title: "时间", dataIndex: "created_at", key: "created_at", width: 170 },
    { title: "ASIN", dataIndex: "asin", key: "asin", width: 130 },
    {
      title: "标签类型",
      dataIndex: "tag_type",
      key: "tag_type",
      width: 110,
      render: (v: string) =>
        v === "force_replenish" ? <Tag color="gold">强制补货</Tag> : <Tag color="purple">节日</Tag>,
    },
    { title: "动作", dataIndex: "action", key: "action", width: 100 },
    {
      title: "变更",
      key: "change",
      width: 180,
      render: (_: any, row: AuditRow) => (
        <span>
          {row.old_value || "∅"} → <b>{row.new_value || "∅"}</b>
        </span>
      ),
    },
    {
      title: "来源",
      dataIndex: "source",
      key: "source",
      width: 80,
      render: (v: string) =>
        v === "auto" ? <Tag color="blue">自动</Tag> : <Tag color="orange">人工</Tag>,
    },
    { title: "操作人", dataIndex: "operator", key: "operator", width: 120 },
    { title: "理由/依据", dataIndex: "reason", key: "reason", ellipsis: true },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={4}>标签管理</Title>
      <Tabs
        defaultActiveKey="tags"
        items={[
          {
            key: "tags",
            label: "产品标签",
            children: (
              <Card
                extra={
                  <Space>
                    <Input.Search
                      placeholder="搜索 ASIN / 产品名"
                      allowClear
                      style={{ width: 240 }}
                      onSearch={(v) =>
                        setTagQuery((q) => ({ ...q, keyword: v, page: 1 }))
                      }
                    />
                    <Select
                      allowClear
                      placeholder="标签类型"
                      style={{ width: 140 }}
                      options={[
                        { value: "holiday", label: "节日" },
                        { value: "force_replenish", label: "强制补货" },
                      ]}
                      onChange={(v) =>
                        setTagQuery((q) => ({ ...q, tagType: v, page: 1 }))
                      }
                    />
                    <Button
                      icon={<RefreshCw size={14} />}
                      onClick={() => runAutoTagging()}
                    >
                      手动触发自动打标
                    </Button>
                  </Space>
                }
              >
                <Table
                  rowKey="id"
                  loading={tagLoading}
                  columns={tagColumns}
                  dataSource={tagRows}
                  pagination={{
                    current: tagQuery.page,
                    pageSize: tagQuery.pageSize,
                    total: tagTotal,
                    showSizeChanger: true,
                    onChange: (p, ps) =>
                      setTagQuery((q) => ({ ...q, page: p, pageSize: ps })),
                  }}
                />
              </Card>
            ),
          },
          {
            key: "lexicon",
            label: "节日词库",
            children: (
              <Card
                extra={
                  <Button type="primary" onClick={openLexCreate}>
                    新增词库条目
                  </Button>
                }
              >
                <Table
                  rowKey="id"
                  loading={lexLoading}
                  columns={lexColumns}
                  dataSource={lexRows}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                />
              </Card>
            ),
          },
          {
            key: "audit",
            label: "审计记录",
            children: (
              <Card
                extra={
                  <Space>
                    <Input.Search
                      placeholder="按 ASIN 查询"
                      allowClear
                      style={{ width: 200 }}
                      onSearch={(v) =>
                        setAuditQuery((q) => ({ ...q, asin: v || undefined, page: 1 }))
                      }
                    />
                    <Select
                      allowClear
                      placeholder="来源"
                      style={{ width: 120 }}
                      options={[
                        { value: "auto", label: "自动" },
                        { value: "manual", label: "人工" },
                      ]}
                      onChange={(v) =>
                        setAuditQuery((q) => ({ ...q, source: v, page: 1 }))
                      }
                    />
                  </Space>
                }
              >
                <Table
                  rowKey="id"
                  loading={auditLoading}
                  columns={auditColumns}
                  dataSource={auditRows}
                  pagination={{
                    current: auditQuery.page,
                    pageSize: auditQuery.pageSize,
                    total: auditTotal,
                    showSizeChanger: true,
                    onChange: (p, ps) =>
                      setAuditQuery((q) => ({ ...q, page: p, pageSize: ps })),
                  }}
                />
              </Card>
            ),
          },
          {
            key: "pipeline",
            label: "数据链路",
            children: (
              <Card
                loading={linkLoading}
                extra={
                  <Space>
                    <Button
                      icon={<Download size={14} />}
                      onClick={manualPull}
                    >
                      手动拉取星拓搜索词
                    </Button>
                    <Button
                      icon={<RefreshCw size={14} />}
                      onClick={fetchLinkStatus}
                    >
                      刷新状态
                    </Button>
                  </Space>
                }
              >
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <div>
                    <Title level={5}>星拓 MCP 主通道状态</Title>
                    <Space size={24} wrap>
                      <Text>
                        配置状态：
                        {pullStatus?.configured ? (
                          <Tag color="green">已配置（X-Mcp-Key）</Tag>
                        ) : (
                          <Tag color="red">未配置（STARTOP_MCP_KEY）</Tag>
                        )}
                      </Text>
                      <Text>
                        最近拉取：
                        {pullStatus?.last_pull?.created_at
                          ? `${pullStatus.last_pull.created_at}（${pullStatus.last_pull.status}，解析 ${pullStatus.last_pull.rows_parsed ?? 0} 行）`
                          : "暂无记录"}
                      </Text>
                      <Text>
                        兜底就绪标记：
                        {pullStatus?.fallback_ready ? (
                          <Tag color="orange">FAILED_FALLBACK_READY</Tag>
                        ) : (
                          <Tag color="green">正常</Tag>
                        )}
                      </Text>
                    </Space>
                  </div>
                  <div>
                    <Title level={5}>兜底通道（星拓定时报告导入，F10）</Title>
                    <Space size={16} wrap align="center">
                      <Upload
                        accept=".xlsx,.xls,.csv"
                        showUploadList={false}
                        beforeUpload={(f) => {
                          importReport(f as unknown as File);
                          return false; // 阻止 antd 自动上传，交由 tagsApi 走带鉴权的 apiClient
                        }}
                      >
                        <Button icon={<UploadOutlined />} loading={reportImporting}>
                          上传星拓报告（兜底）
                        </Button>
                      </Upload>
                      <Text type="secondary">
                        MCP 主通道连续失败（FAILED_FALLBACK_READY）时，用星拓定时报告文件补齐词数据；
                        同一文件重复上传会自动去重（仅管理员可用）。
                      </Text>
                    </Space>
                  </div>
                  <div>
                    <Title level={5}>过滤引擎配置</Title>
                    <Space size={16} wrap align="center">
                      <span>
                        负利润阈值（毛利率小于该值排除）：
                        <Input
                          type="number"
                          step="0.01"
                          style={{ width: 120 }}
                          value={threshold}
                          onChange={(e) => setThreshold(Number(e.target.value))}
                        />
                      </span>
                      <span>
                        自动打标回看窗口（天）：
                        <Input
                          type="number"
                          style={{ width: 100 }}
                          value={windowDays}
                          onChange={(e) => setWindowDays(Number(e.target.value))}
                        />
                      </span>
                      <Button type="primary" onClick={saveConfig}>
                        保存配置
                      </Button>
                    </Space>
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary">
                        <PlayCircle size={12} /> 优先级链：停售 ＞ 强制补货 ＞
                        节日排除 ＞ 负利润排除；毛利为 NULL 的商品不会被误杀。
                      </Text>
                    </div>
                  </div>
                </Space>
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={lexForm.id ? `编辑词库条目 #${lexForm.id}` : "新增词库条目"}
        open={lexModalOpen}
        onOk={submitLexicon}
        onCancel={() => setLexModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <Text>节日（K6 枚举）</Text>
            <Select
              value={lexForm.holiday_name}
              style={{ width: "100%" }}
              options={K6_HOLIDAY_NAMES.map((n) => ({ value: n, label: n }))}
              onChange={(v) => setLexForm((f) => ({ ...f, holiday_name: v }))}
            />
          </div>
          <div>
            <Text>命中关键词（出单词/流量词）</Text>
            <Input
              value={lexForm.keyword}
              placeholder="如：halloween costume"
              onChange={(e) => setLexForm((f) => ({ ...f, keyword: e.target.value }))}
            />
          </div>
          <div>
            <Text>匹配方式</Text>
            <Select
              value={lexForm.match_type}
              style={{ width: "100%" }}
              options={[
                { value: "contains", label: "包含" },
                { value: "exact", label: "精确" },
              ]}
              onChange={(v) => setLexForm((f) => ({ ...f, match_type: v }))}
            />
          </div>
          <div>
            <Text>生效站点</Text>
            <Select
              value={lexForm.site}
              style={{ width: "100%" }}
              options={[
                { value: "ALL", label: "全部站点" },
                { value: "US", label: "美国站" },
                { value: "UK", label: "英国站" },
              ]}
              onChange={(v) => setLexForm((f) => ({ ...f, site: v }))}
            />
          </div>
          <div>
            <Text>节日日期窗口（可选，窗口内命中才打标）</Text>
            <DatePicker.RangePicker
              style={{ width: "100%" }}
              value={lexForm.window}
              onChange={(v) => setLexForm((f) => ({ ...f, window: v }))}
            />
          </div>
          {lexForm.id ? (
            <div>
              <Text>启用状态</Text>
              <Select
                value={lexForm.status}
                style={{ width: "100%" }}
                options={[
                  { value: 1, label: "启用（参与下一轮打标）" },
                  { value: 0, label: "停用（不参与打标）" },
                ]}
                onChange={(v) => setLexForm((f) => ({ ...f, status: v }))}
              />
            </div>
          ) : null}
          <div>
            <Text>备注</Text>
            <Input
              value={lexForm.remark}
              placeholder="可选，便于后续维护"
              onChange={(e) => setLexForm((f) => ({ ...f, remark: e.target.value }))}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
};

export default TagManagement;
