import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Divider,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { inventoryApi, gradeApi, GradePoolItem, GradePoolResult } from "../api";
import { useAuth } from "../contexts/AuthContext";
import GradeBadge, {
  GRADE_LABEL,
  GRADE_MAIN_COLOR,
  GRADE_ORDER,
} from "../components/GradeBadge";

const { Text } = Typography;

const SOURCE_LABEL: Record<string, string> = {
  product_sales: "自然月精确",
  fallback_30d: "按30天销量折算",
  no_data: "无销量记录",
};

/** 各档运营语义短名 */
const GRADE_SHORT: Record<string, string> = {
  S: "爆款",
  A: "热销",
  B: "稳定动销",
  C: "缓慢动销",
  E: "微量动销",
  D: "未动销",
};
const GRADE_RANGE: Record<string, string> = {
  S: "月销 301+",
  A: "101 ~ 300",
  B: "31 ~ 100",
  C: "11 ~ 30",
  E: "1 ~ 10",
  D: "0 / 无销量",
};

/** 上期变动：↑n 绿 / ↓n 红 / - 灰 / 新 蓝 */
const PrevDelta: React.FC<{ item: GradePoolItem }> = ({ item }) => {
  const rank: Record<string, number> = { S: 6, A: 5, B: 4, C: 3, E: 2, D: 1 };
  if (!item.grade) return <span style={{ color: "#bbb" }}>-</span>;
  if (!item.prev_grade) return <Tag color="geekblue">新</Tag>;
  const delta = rank[item.grade] - rank[item.prev_grade];
  if (delta === 0) return <span style={{ color: "#bbb" }}>—</span>;
  return delta > 0 ? <Tag color="green">↑{delta}</Tag> : <Tag color="red">↓{-delta}</Tag>;
};

const GradePool: React.FC = () => {
  const { isAdmin } = useAuth();
  const [data, setData] = useState<GradePoolResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [gradeFilter, setGradeFilter] = useState<string[]>([]);
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [countryFilter, setCountryFilter] = useState<string[]>([]);
  const [accountOptions, setAccountOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [sortField, setSortField] = useState<string | undefined>("grade");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [recomputing, setRecomputing] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gradeParam = gradeFilter.join(",");
  const hasFilter =
    gradeFilter.length > 0 || accountFilter.length > 0 || countryFilter.length > 0 || !!keyword;

  const fetchPool = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      return gradeApi
        .getPool({
          keyword: keyword || undefined,
          grade: gradeParam || undefined,
          account: accountFilter.length ? accountFilter : undefined,
          country: countryFilter.length ? countryFilter : undefined,
          holiday_filter: "all",
          sort_field: sortField,
          sort_order: sortOrder,
          page,
          page_size: pageSize,
        })
        .then((res) => setData(res.data))
        .catch((err: any) => {
          if (!silent) message.error(err?.response?.data?.detail || "获取等级池失败");
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [keyword, gradeParam, accountFilter, countryFilter, page, pageSize, sortField, sortOrder],
  );

  useEffect(() => {
    fetchPool();
  }, [fetchPool]);

  useEffect(() => {
    inventoryApi
      .getFilterOptions()
      .then((res) => {
        const d = res.data?.data || res.data;
        if (d) {
          setAccountOptions(d.stores || []);
          setCountryOptions(d.countries || []);
        }
      })
      .catch(() => undefined);
  }, []);

  const handleRecompute = () => {
    Modal.confirm({
      title: "手动重算等级池",
      content:
        "将按上月销量重新计算全部产品等级（约 30 秒），期间页面数据保持可用。确定执行？",
      okText: "开始重算",
      cancelText: "取消",
      centered: true,
      onOk: async () => {
        setRecomputing(true);
        const hide = message.loading("正在重算等级池…", 0);
        try {
          const res = await gradeApi.recompute();
          const r: any = res.data;
          if (r?.ok) {
            message.success(
              `重算完成：${r.rows} 行，耗时 ${Math.round((r.elapsed_ms || 0) / 1000)} 秒`,
            );
            await fetchPool();
          } else {
            message.error(r?.error || "重算失败");
          }
        } catch (err: any) {
          message.error(err?.response?.data?.detail || "重算失败");
        } finally {
          hide();
          setRecomputing(false);
        }
      },
    });
  };

  const clearFilters = () => {
    setGradeFilter([]);
    setAccountFilter([]);
    setCountryFilter([]);
    setKeyword("");
    setPage(1);
  };

  const period = data?.period;
  const dist = data?.distribution || {};
  const totalGrades = GRADE_ORDER.reduce((a, g) => a + (dist[g] || 0), 0);

  /** 分布堆叠带分段（按数量占比） */
  const segments = GRADE_ORDER.map((g) => ({
    g,
    count: dist[g] || 0,
    pct: totalGrades ? ((dist[g] || 0) / totalGrades) * 100 : 0,
  }));

  const columns = [
    {
      title: "等级",
      dataIndex: "grade",
      key: "grade",
      width: 72,
      sorter: true,
      sortOrder:
        sortField === "grade" ? (sortOrder === "asc" ? "ascend" : "descend") : undefined,
      render: (_: any, record: GradePoolItem) => <GradeBadge grade={record.grade} />,
    },
    {
      title: "上月销量（件）",
      dataIndex: "monthly_sales",
      key: "monthly_sales",
      width: 130,
      align: "right" as const,
      sorter: true,
      sortOrder:
        sortField === "monthly_sales"
          ? sortOrder === "asc"
            ? "ascend"
            : "descend"
          : undefined,
      render: (v: number | null | undefined, record: GradePoolItem) => {
        if (record.grade == null) return <span style={{ color: "#bbb" }}>-</span>;
        return v ?? 0;
      },
    },
    {
      title: "销量口径",
      dataIndex: "sales_source",
      key: "sales_source",
      width: 120,
      render: (v: string | null | undefined) =>
        v ? <Text type="secondary">{SOURCE_LABEL[v] || v}</Text> : "-",
    },
    {
      title: "上期变动",
      key: "prev",
      width: 90,
      render: (_: any, record: GradePoolItem) => <PrevDelta item={record} />,
    },
    { title: "ASIN", dataIndex: "asin", key: "asin", width: 120 },
    {
      title: "品名",
      dataIndex: "product_name",
      key: "product_name",
      ellipsis: true,
      render: (v: string | undefined) => v || "-",
    },
    { title: "店铺", dataIndex: "account", key: "account", width: 210, ellipsis: true },
    { title: "国家", dataIndex: "country", key: "country", width: 100, ellipsis: true },
    {
      title: "计算时间",
      dataIndex: "computed_at",
      key: "computed_at",
      width: 130,
      render: (v: string | null | undefined) =>
        v ? <Text type="secondary">{v}</Text> : "-",
    },
  ];

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 16, boxSizing: "border-box" }}>
      <Card
        styles={{ body: { padding: "20px 24px" } }}
        style={{ borderRadius: 10 }}
        bordered={false}
      >
        {/* ===== 页头 ===== */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #FFF1B8 0%, #FFE58F 100%)",
              fontSize: 20,
              color: "#D48806",
              flexShrink: 0,
            }}
          >
            🏆
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: "24px" }}>
              产品月销量等级池
            </div>
            <div style={{ marginTop: 2 }}>
              {period ? (
                <Space size={6} wrap>
                  <Tag color="gold" style={{ marginRight: 0 }}>
                    数据期 {period}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    每月 3 号按上月销量自动更新 · 规则 S/A/B/C/D/E
                  </Text>
                </Space>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  等级池尚未生成 · 每月 3 号 06:30 自动生成
                </Text>
              )}
            </div>
          </div>
          <Space size={8}>
            <Tooltip title={isAdmin ? "按上月销量重新计算全部等级" : "仅管理员可手动重算"}>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRecompute}
                loading={recomputing}
                disabled={!isAdmin}
              >
                手动重算
              </Button>
            </Tooltip>
            <Button icon={<ReloadOutlined />} onClick={() => fetchPool()}>
              刷新
            </Button>
          </Space>
        </div>

        {/* ===== 完整性告警 ===== */}
        {period && data?.integrity_warning ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message={data.integrity_warning}
          />
        ) : null}

        {/* ===== 分布堆叠带 ===== */}
        <div style={{ margin: "20px 0 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <Text strong style={{ fontSize: 13 }}>
              等级分布
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {totalGrades.toLocaleString()} 行
            </Text>
          </div>
          <Tooltip
            title={segments
              .filter((s) => s.count > 0)
              .map((s) => `${s.g}：${s.count.toLocaleString()}（${s.pct.toFixed(1)}%）`)
              .join("\n")}
          >
            <div
              style={{
                display: "flex",
                height: 10,
                borderRadius: 5,
                overflow: "hidden",
                background: "#f0f0f0",
                cursor: "default",
              }}
            >
              {segments.map(
                (s) =>
                  s.pct > 0 && (
                    <div
                      key={s.g}
                      style={{
                        width: `${s.pct}%`,
                        background: GRADE_MAIN_COLOR[s.g],
                        opacity: s.g === "D" || s.g === "E" ? 0.45 : 0.9,
                      }}
                    />
                  ),
              )}
            </div>
          </Tooltip>
        </div>

        {/* ===== 六档统计卡 ===== */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 10,
          }}
        >
          {segments.map((s) => {
            const selected = gradeFilter.includes(s.g);
            const main = GRADE_MAIN_COLOR[s.g];
            return (
              <div
                key={s.g}
                onClick={() => {
                  setPage(1);
                  setGradeFilter((prev) =>
                    prev.includes(s.g) ? prev.filter((x) => x !== s.g) : [...prev, s.g],
                  );
                }}
                style={{
                  position: "relative",
                  padding: "12px 14px 10px",
                  borderRadius: 10,
                  cursor: "pointer",
                  border: `1.5px solid ${selected ? main : "#f0f0f0"}`,
                  background: selected ? `${main}0F` : "#fafafa",
                  transition: "all 0.18s ease",
                  overflow: "hidden",
                }}
                title={`${GRADE_LABEL[s.g]} · 点击${selected ? "取消" : ""}筛选该档`}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <GradeBadge grade={s.g} />
                  <span
                    style={{
                      fontSize: 12,
                      color: selected ? main : "#8c8c8c",
                      fontWeight: selected ? 600 : 400,
                    }}
                  >
                    {GRADE_SHORT[s.g]}
                  </span>
                  <span style={{ fontSize: 11, color: "#bfbfbf", marginLeft: "auto" }}>
                    {GRADE_RANGE[s.g]}
                  </span>
                </div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
                    {s.count.toLocaleString()}
                  </span>
                  <span style={{ fontSize: 12, color: "#8c8c8c" }}>
                    {s.pct.toFixed(1)}%
                  </span>
                </div>
                {/* 占比色条 */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    bottom: 0,
                    height: 3,
                    width: `${Math.max(s.pct, 2)}%`,
                    background: main,
                    opacity: 0.85,
                  }}
                />
              </div>
            );
          })}
        </div>

        <Divider style={{ margin: "16px 0 12px" }} />

        {/* ===== 筛选栏 ===== */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: "#bbb" }} />}
            placeholder="搜索 ASIN / 品名"
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => {
              const v = e.target.value;
              setKeyword(v);
              if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
              searchTimerRef.current = setTimeout(() => setPage(1), 300);
            }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="等级"
            style={{ minWidth: 190 }}
            value={gradeFilter}
            options={GRADE_ORDER.map((g) => ({
              value: g,
              label: `${g} · ${GRADE_LABEL[g]}`,
            }))}
            onChange={(v) => {
              setPage(1);
              setGradeFilter(v);
            }}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount={2}
            placeholder="店铺"
            style={{ minWidth: 190 }}
            value={accountFilter}
            options={accountOptions}
            onChange={(v) => {
              setPage(1);
              setAccountFilter(v);
            }}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount={2}
            placeholder="国家"
            style={{ minWidth: 150 }}
            value={countryFilter}
            options={countryOptions}
            onChange={(v) => {
              setPage(1);
              setCountryFilter(v);
            }}
          />
          {hasFilter && (
            <Button type="link" size="small" onClick={clearFilters} style={{ padding: 0 }}>
              清除筛选
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {data?.total?.toLocaleString() || 0} 行
          </Text>
        </div>

        {/* ===== 列表 ===== */}
        {!period ? (
          <Empty
            description="暂无等级数据：等级池尚未生成，等待每月 3 号自动生成或由管理员手动重算"
            style={{ padding: 48 }}
          />
        ) : (
          <>
            <Table
              size="small"
              rowKey={(r: GradePoolItem) => `${r.asin}-${r.account}`}
              columns={columns as never}
              dataSource={data?.items || []}
              loading={loading}
              pagination={false}
              onChange={(_p: unknown, _f: unknown, sorter: any) => {
                const s = Array.isArray(sorter) ? sorter[0] : sorter;
                if (s?.order) {
                  setSortField(s.field as string);
                  setSortOrder(s.order === "ascend" ? "asc" : "desc");
                } else {
                  setSortField(undefined);
                }
              }}
              scroll={{ x: 1100 }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <Pagination
                current={page}
                pageSize={pageSize}
                total={data?.total || 0}
                showSizeChanger={false}
                showTotal={(t) => `共 ${t} 行`}
                onChange={(p) => setPage(p)}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default GradePool;
