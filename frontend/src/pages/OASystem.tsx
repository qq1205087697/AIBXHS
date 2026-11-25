import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  ConfigProvider,
  message,
} from "antd";
import {
  BarChart3,
  Building2,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Home,
  LayoutGrid,
  LogOut,
  PartyPopper,
  Plus,
  Trash2,
  Upload as UploadIcon,
  Users,
} from "lucide-react";
import dayjs, { Dayjs } from "dayjs";
import { useAuth } from "../contexts/AuthContext";
import { adminRobotApi, candidateApi, departmentsApi, oaApi, socialPriceApi, socialSecurityApi } from "../api";

const { TextArea } = Input;
const { Text } = Typography;

// 社保公积金缴纳单位选项
const COMPANY_OPTIONS = ["杰温莱文特", "宝鑫华盛", "东方嘉呈", "宝华德旺", "圆瑞源", "派园贸易"];

// ==================== 通用小工具 ====================

function pickUrl(res: any): string {
  const d = res?.data ?? res;
  return d?.url || d?.data?.url || d?.data?.url_path || "";
}

/** 后端响应统一为 {success, data: [...]}，data 直接是数组（部分为 {items}) */
function pickList(res: any): any[] {
  const d = res?.data?.data ?? res?.data;
  if (Array.isArray(d)) return d;
  return d?.items || d?.data || [];
}

const SUMMARY_LABELS: Record<string, string> = {
  todo_total: "待办事项总数",
  todo_done: "已完成事项",
  todo_mine: "我的待办",
  pending_leaves: "待审批请假",
  my_supplies_month: "本月耗材领用",
};

function statusTag(status?: string | null) {
  if (!status) return <Tag>未知</Tag>;
  if (status.includes("通过") && !status.includes("驳回")) return <Tag color="green">{status}</Tag>;
  if (status.includes("驳回") || status.includes("未")) return <Tag color="red">{status}</Tag>;
  if (status.includes("待")) return <Tag color="orange">{status}</Tag>;
  return <Tag color="blue">{status}</Tag>;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success("已复制");
  } catch {
    message.error("复制失败");
  }
}

// ==================== 工作台 ====================

function DashboardModule({ onNavigate }: { onNavigate: (key: string) => void }) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [offNotices, setOffNotices] = useState<any[]>([]);

  const loadOffNotices = useCallback(async () => {
    try {
      const r: any = await oaApi.offboardNotices();
      setOffNotices(r?.data?.data || []);
    } catch {
      /* 无权限或失败忽略 */
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const s = await oaApi.getSummary().catch(() => null);
        setSummary(s?.data?.data ?? s?.data ?? null);
      } finally {
        setLoading(false);
      }
      loadOffNotices();
    })();
  }, [loadOffNotices]);

  const statCards = useMemo(() => {
    if (!summary || typeof summary !== "object") return [];
    const skip = new Set(["success", "message", "detail", "announcements", "my_leaves"]);
    return Object.entries(summary)
      .filter(([k, v]) => !skip.has(k) && (typeof v === "number" || typeof v === "string"))
      .slice(0, 8);
  }, [summary]);

  const announcements: any[] = summary?.announcements || [];
  const myLeaves: any[] = summary?.my_leaves || [];

  // 社保/公积金缴纳期提醒：社保每月 16-19 号，公积金每月 25 号起
  const today = dayjs();
  const dayOfMonth = today.date();
  const curMonth = today.format("YYYY-MM");
  const [ssRecorded, setSsRecorded] = useState<boolean | null>(null); // 当月是否已有明细

  useEffect(() => {
    // 仅在提醒期查询当月是否已生成明细
    if (!(dayOfMonth >= 16 && dayOfMonth <= 19) && dayOfMonth < 25) return;
    socialSecurityApi.list(curMonth)
      .then((res: any) => setSsRecorded(pickList(res).length > 0))
      .catch(() => setSsRecorded(null));
  }, [curMonth, dayOfMonth]);

  const ssReminder = dayOfMonth >= 16 && dayOfMonth <= 19;
  const fundReminder = dayOfMonth >= 25;

  // 社保价目变动通知（未读 > 0 时提醒）
  const [priceChanges, setPriceChanges] = useState<any[]>([]);
  useEffect(() => {
    socialPriceApi.get()
      .then((res: any) => setPriceChanges(res?.data?.data?.unread_changes || []))
      .catch(() => setPriceChanges([]));
  }, []);

  // 集中审批中心：请假/加班/报销/招新申请统一展示与审批（管理员）
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "administrator";
  const [pendingLeaves, setPendingLeaves] = useState<any[]>([]);
  const [otPending, setOtPending] = useState<any[]>([]);
  const [pendingReimb, setPendingReimb] = useState<any[]>([]);
  const [pendingHiring, setPendingHiring] = useState<any[]>([]);
  const [hiringNotices, setHiringNotices] = useState<any[]>([]);

  const loadPending = useCallback(async () => {
    if (!isAdmin) return;
    const safe = <T,>(p: Promise<any>, pick: (r: any) => T[], fallback: T[]) =>
      p.then((r: any) => pick(r)).catch(() => fallback);
    const [leaves, ots, reimbs, hiring, notices] = await Promise.all([
      safe(oaApi.listLeaves("all"), (r) => (r?.data?.data || r?.data || []).filter((x: any) => x.status === "待审批"), []),
      safe(oaApi.listOvertimes("all"), (r) => (r?.data?.data || []).filter((x: any) => x.status === "待审批"), []),
      safe(oaApi.listReimbursements("all"), (r) => (r?.data?.data || []).filter((x: any) => x.status === "待审批"), []),
      safe(oaApi.listHiringRequests("all"), (r) => (r?.data?.data || []).filter((x: any) => x.status === "待审批"), []),
      safe(oaApi.hiringNotices(), (r) => r?.data?.data || [], []),
    ]);
    setPendingLeaves(leaves);
    setOtPending(ots);
    setPendingReimb(reimbs);
    setPendingHiring(hiring);
    setHiringNotices(notices);
  }, [isAdmin]);
  useEffect(() => { loadPending(); }, [loadPending]);

  const approveGeneric = async (
    kind: "leave" | "ot" | "rb" | "hr",
    id: number,
    status: "已通过" | "已驳回",
  ) => {
    let note = "";
    if (status === "已驳回") note = window.prompt("请输入驳回原因（可选）") || "";
    if (kind === "leave") await oaApi.reviewLeave(id, { status, approve_note: note });
    if (kind === "ot") await oaApi.reviewOvertime(id, { status, approve_note: note });
    if (kind === "rb") await oaApi.reviewReimbursement(id, { status, approve_note: note });
    if (kind === "hr") await oaApi.reviewHiringRequest(id, { status, approve_note: note });
    message.success(status === "已通过" ? "已通过该申请" : "已驳回该申请");
    loadPending();
  };

  return (
    <Spin spinning={loading}>
      {priceChanges.length > 0 && (
        <Card
          size="small"
          style={{ marginBottom: 12, borderColor: "#ffa39e", background: "#fff1f0" }}
          title={<span style={{ color: "#cf1322" }}>{priceChanges[0]?.item || "社保价目已变动"}</span>}
          extra={
            <Button
              size="small"
              type="primary"
              onClick={async () => {
                await socialPriceApi.readChanges();
                setPriceChanges([]);
                onNavigate("sub:social");
              }}
            >
              去查看缴纳明细
            </Button>
          }
        >
          <Text type="secondary" style={{ fontSize: 13 }}>
            {priceChanges
              .map((c) => c.detail || `${c.item}：${c.old_amount ?? "—"} → ${c.new_amount ?? "—"} 元/月`)
              .join("；")}
            ，请在「社保公积金缴纳情况」中核对并处理。
          </Text>
        </Card>
      )}
      {(ssReminder || fundReminder) && (
        <div style={{ marginBottom: 16, display: "grid", gap: 12 }}>
          {ssReminder && (
            <Card
              size="small"
              style={{ borderColor: "#ffd591", background: "#fffbe6" }}
              title={<span style={{ color: "#d46b08" }}>本月社保缴纳期（每月 16-19 日）</span>}
              extra={
                <Button size="small" type="primary" onClick={() => onNavigate("sub:social")}>
                  {ssRecorded ? "查看全员缴纳明细" : "生成全员缴纳明细"}
                </Button>
              }
            >
              <Text type="secondary" style={{ fontSize: 13 }}>
                {ssRecorded
                  ? `${curMonth} 的全员社保缴纳明细已生成，请核对档位与金额后及时缴纳。`
                  : `${curMonth} 的全员社保缴纳明细尚未生成，请及时在「社保公积金缴纳情况」板块生成并确认。`}
              </Text>
            </Card>
          )}
          {fundReminder && (
            <Card
              size="small"
              style={{ borderColor: "#91caff", background: "#f0f9ff" }}
              title={<span style={{ color: "#0958d9" }}>本月公积金缴纳期（每月 25 日起）</span>}
              extra={
                <Button size="small" type="primary" onClick={() => onNavigate("sub:social")}>
                  {ssRecorded ? "查看全员缴纳明细" : "生成全员缴纳明细"}
                </Button>
              }
            >
              <Text type="secondary" style={{ fontSize: 13 }}>
                公积金按月于 25 号前完成缴纳，请前往「社保公积金缴纳情况」核对或生成 {curMonth} 全员缴纳明细。
              </Text>
            </Card>
          )}
        </div>
      )}

      {/* 集中审批中心（管理员）：请假 / 加班 / 报销 / 招新申请 */}
      {isAdmin && (
        <Card
          size="small"
          style={{ marginBottom: 16 }}
          title={
            <Space wrap>
              <span style={{ fontWeight: 600 }}>集中审批中心</span>
              <Badge count={pendingLeaves.length + otPending.length + pendingReimb.length + pendingHiring.length} color="#faad14" overflowCount={99} />
            </Space>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            {[
              { key: "leave" as const, title: "请假申请", list: pendingLeaves, nav: "sub:ap-leave" },
              { key: "ot" as const, title: "加班申请", list: otPending, nav: "sub:ap-overtime" },
              { key: "rb" as const, title: "报销申请", list: pendingReimb, nav: "sub:ap-expense" },
              { key: "hr" as const, title: "岗位招新申请", list: pendingHiring, nav: "sub:ap-hiring" },
            ].map((g) => (
              <div key={g.key} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <Text strong>{g.title}（{g.list.length}）</Text>
                  <a onClick={() => onNavigate(g.nav)}>去处理</a>
                </div>
                {g.list.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>暂无待审批</Text>}
                {g.list.slice(0, 3).map((it: any) => (
                  <div key={it.id} style={{ padding: "6px 0", borderTop: "1px solid #f5f5f5" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <Text style={{ fontSize: 13 }}>
                        <b>{it.username || it.applicant || it.name || "—"}</b>
                        {it.leave_type ? ` · ${it.leave_type}` : it.category ? ` · ${it.category}` : it.position_name ? ` · ${it.position_name}` : ""}
                        {it.duration != null ? ` · ${it.duration}${it.unit || ""}` : ""}
                        {it.amount != null ? ` · ¥${it.amount}` : ""}
                      </Text>
                      <Space size={4}>
                        <Button size="small" type="primary" onClick={() => approveGeneric(g.key, it.id, "已通过")}>通过</Button>
                        <Button size="small" danger onClick={() => approveGeneric(g.key, it.id, "已驳回")}>驳回</Button>
                      </Space>
                    </div>
                    {(it.reason || it.note || it.requirement) && (
                      <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.reason || it.note || it.requirement}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 招新通知（管理层/人事可见） */}
      {hiringNotices.length > 0 && (
        <div style={{ marginBottom: 16, display: "grid", gap: 8 }}>
          {hiringNotices.slice(0, 5).map((n: any) => (
            <Alert
              key={n.id}
              type="info"
              showIcon
              message={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>{n.message || `${n.department || ""}新增岗位招新申请`}</span>
                  <Button size="small" onClick={async () => { await oaApi.readHiringNotice(n.id); loadPending(); }}>知道了</Button>
                </div>
              }
            />
          ))}
        </div>
      )}

      {/* 离职通知卡：准备离职（可挽留） / 已离职（财务人事） */}
      {offNotices.length > 0 && (
        <div style={{ marginBottom: 16, display: "grid", gap: 8 }}>
          {offNotices.map((n) => (
            <Alert
              key={n.id}
              type={n.kind === "apply" ? "warning" : "info"}
              showIcon
              message={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>
                    {n.kind === "apply" ? (
                      <>
                        <b>{n.name}</b> 准备离职（{n.level}）—— 是否需要挽留？
                      </>
                    ) : (
                      <>
                        <b>{n.name}</b> 已经离职（{n.target_dept}通知）
                      </>
                    )}
                  </span>
                  <Space size={6}>
                    {n.kind === "apply" ? (
                      <>
                        <Button size="small" type="primary" onClick={async () => { await oaApi.offboardRetain(n.id); message.success("已记录挽留，请尽快与员工沟通"); loadOffNotices(); }}>尝试挽留</Button>
                        <Button size="small" onClick={async () => { await oaApi.offboardIgnore(n.id); loadOffNotices(); }}>暂不挽留</Button>
                      </>
                    ) : (
                      <Button size="small" onClick={async () => { await oaApi.offboardIgnore(n.id); loadOffNotices(); }}>知道了</Button>
                    )}
                  </Space>
                </div>
              }
              description={
                n.kind === "apply" ? (
                  <span>
                    {n.message}
                    {n.attachment_url && (
                      <>
                        {" "}
                        <a href={n.attachment_url} target="_blank" rel="noreferrer">{n.attachment_name ? `下载附件：${n.attachment_name}` : "下载离职申请附件"}</a>
                      </>
                    )}
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16, marginBottom: 16 }}>
        {statCards.map(([k, v]) => (
          <Card key={k as string} size="small">
            <div style={{ fontSize: 13, color: "#8c8c8c" }}>{SUMMARY_LABELS[k as string] || k}</div>
            <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4 }}>{String(v)}</div>
          </Card>
        ))}
        {statCards.length === 0 && (
          <Card size="small" style={{ gridColumn: "1 / -1" }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无统计数据" />
          </Card>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
        <Card
          size="small"
          title="放假通知 / 公告"
          extra={<a onClick={() => onNavigate("__announcement__")}>查看全部</a>}
        >
          {announcements.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无公告" />}
          {announcements.slice(0, 5).map((it: any) => (
            <div key={it.id} style={{ padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
              <Space wrap>
                <Tag color={it.level === "重要" ? "red" : it.level === "紧急" ? "volcano" : "blue"}>{it.level || "通知"}</Tag>
                <Text strong>{it.title}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{it.created_at ? dayjs(it.created_at).format("MM-DD") : ""}</Text>
              </Space>
              {it.content && <div style={{ fontSize: 13, color: "#595959", marginTop: 4, whiteSpace: "pre-wrap" }}>{it.content}</div>}
            </div>
          ))}
        </Card>

        <Card
          size="small"
          title="我的审批单"
          extra={<a onClick={() => onNavigate("__leave__")}>去请假</a>}
        >
          {myLeaves.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无请假记录" />}
          {myLeaves.slice(0, 5).map((it: any) => (
            <div key={it.id} style={{ padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
              <Space wrap>
                <Text strong>{it.leave_type || it.type}</Text>
                <Text type="secondary">{it.start_date} ~ {it.end_date}</Text>
                {statusTag(it.status)}
              </Space>
              {it.approve_note && <div style={{ fontSize: 12, color: "#8c8c8c" }}>审批备注：{it.approve_note}</div>}
            </div>
          ))}
        </Card>
      </div>
    </Spin>
  );
}

// ==================== 招聘：招聘岗位 ====================

function PositionModule() {
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  // 结构化候选人：一人一行
  const [candidates, setCandidates] = useState<{ name: string; resume_url: string | null; id?: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await oaApi.listRecruit();
      setPositions(pickList(res));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // 与组织管理页（OrgManagement）同源：departmentsApi.getList() → {success, data: [{id, name, ...}]}
    departmentsApi.getList()
      .then((res: any) => {
        const list = res?.data?.data || [];
        setDepartments(list.map((d: any) => d.name).filter(Boolean));
      })
      .catch(() => setDepartments([]));
  }, []);

  const openModal = (pos?: any) => {
    setEditing(pos || null);
    setCandidates(
      pos?.candidates?.map((c: any) => ({ name: c.name, resume_url: c.resume_url ?? null, id: c.id })) || [],
    );
    form.setFieldsValue({
      position_name: pos?.position_name,
      requirement: pos?.requirement,
      salary: pos?.salary,
      department: pos?.department,
    });
    setModalOpen(true);
  };

  const uploadResume = async (file: File, idx: number) => {
    setUploading(true);
    try {
      const res = await oaApi.uploadResume(file);
      const url = pickUrl(res);
      if (!url) {
        message.error("上传失败");
        return;
      }
      setCandidates((prev) => prev.map((c, i) => (i === idx ? { ...c, resume_url: url } : c)));
      message.success("简历上传成功");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload = {
      position_name: values.position_name,
      requirement: values.requirement,
      salary: values.salary,
      department: values.department || null,
      candidates: candidates.filter((c) => c.name.trim()),
    };
    if (editing) {
      await oaApi.updatePosition(editing.id, { ...payload, id: editing.id });
      // 候选人整体替换（同名候选人后端保留 id 防面试断链）
      if (payload.candidates.length) {
        await oaApi.replaceCandidates(editing.id, payload.candidates).catch(() => undefined);
      }
      message.success("岗位已更新");
    } else {
      await oaApi.createPosition(payload);
      message.success("岗位已添加");
    }
    setModalOpen(false);
    load();
  };

  const startInterview = async (pos: any) => {
    await oaApi.createInterview(pos.id, { round: 1, result: "待面试" });
    message.success("已开始一轮面试");
    load();
  };

  return (
    <Spin spinning={loading}>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
        <Text type="secondary">岗位字段：岗位名称 / 岗位需求 / 薪资 / 候选人列表（一人一行，可各自上传简历附件）</Text>
        <Button type="primary" onClick={() => openModal()}>添加岗位</Button>
      </div>

      {positions.length === 0 && <Empty description="暂无招聘岗位" />}

      <div style={{ display: "grid", gap: 12 }}>
        {positions.map((pos) => (
          <Card key={pos.id} size="small">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <Space wrap>
                <Text strong style={{ fontSize: 15 }}>{pos.position_name}</Text>
                {pos.department && <Tag color="blue">{pos.department}</Tag>}
                {pos.salary && <Tag color="green">薪资：{pos.salary}</Tag>}
                {pos.status && statusTag(pos.status)}
                <Text type="secondary">候选人 {pos.candidates?.length || 0} 人</Text>
              </Space>
              <Space>
                <Button size="small" onClick={() => openModal(pos)}>编辑</Button>
                <Button size="small" type="primary" ghost onClick={() => startInterview(pos)}>开始一轮面试</Button>
                <Popconfirm title="确认删除该岗位？" onConfirm={async () => { await oaApi.deletePosition(pos.id); message.success("已删除"); load(); }}>
                  <Button size="small" danger icon={<Trash2 size={14} />} />
                </Popconfirm>
              </Space>
            </div>
            {pos.requirement && (
              <div style={{ marginTop: 8, fontSize: 13, color: "#595959", whiteSpace: "pre-wrap" }}>{pos.requirement}</div>
            )}
            {pos.candidates?.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {pos.candidates.map((c: any) => (
                  <Space key={c.id ?? c.name} size={4} style={{ border: "1px solid #f0f0f0", borderRadius: 6, padding: "2px 8px" }}>
                    <Text>{c.name}</Text>
                    {c.resume_url && (
                      <a onClick={() => window.open(c.resume_url, "_blank")}><Eye size={13} /></a>
                    )}
                  </Space>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Modal
        title={editing ? "编辑岗位" : "添加岗位"}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        width={720}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="position_name" label="岗位名称" rules={[{ required: true, message: "请输入岗位名称" }]}>
            <Input placeholder="如：运营专员" />
          </Form.Item>
          <Form.Item name="department" label="所属部门">
            <Select
              showSearch
              allowClear
              placeholder="选择部门"
              options={departments.map((d) => ({ value: d, label: d }))}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="salary" label="薪资">
            <Input placeholder="如：6k-9k" />
          </Form.Item>
          <Form.Item name="requirement" label="岗位需求">
            <TextArea rows={4} />
          </Form.Item>
        </Form>
        <div style={{ marginBottom: 4 }}>
          <Text strong>候选人列表（一人一行）</Text>
          <Button size="small" type="dashed" style={{ marginLeft: 8 }} onClick={() => setCandidates((p) => [...p, { name: "", resume_url: null }])}>
            添加候选人
          </Button>
        </div>
        {candidates.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <Input
              placeholder="候选人姓名"
              value={c.name}
              onChange={(e) => setCandidates((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              style={{ width: 200 }}
            />
            <label style={{ cursor: "pointer" }}>
              <Button size="small" icon={<Download size={14} />} loading={uploading && c.name === ""}>
                {c.resume_url ? "重新上传简历" : "上传简历"}
              </Button>
              <input
                type="file"
                style={{ display: "none" }}
                accept=".pdf,.doc,.docx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadResume(f, i);
                  e.target.value = "";
                }}
              />
            </label>
            {c.resume_url && <a onClick={() => window.open(c.resume_url!, "_blank")}>查看</a>}
            <Button size="small" danger onClick={() => setCandidates((p) => p.filter((_, j) => j !== i))}>移除</Button>
          </div>
        ))}
      </Modal>
    </Spin>
  );
}

// ==================== 招聘：面试 ====================

function InterviewModule() {
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await oaApi.listRecruit();
      setPositions(pickList(res));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const v = await form.validateFields();
    await oaApi.updateInterview(editing.id, { result: v.result, situation: v.situation });
    message.success("面试记录已更新");
    setEditing(null);
    load();
  };

  return (
    <Spin spinning={loading}>
      <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        点「开始一轮面试」按岗位下每位候选人各生成一条记录；结果标「通过」自动为该人生成下一轮待面试，三轮通过后岗位自动招满。
      </Text>
      {positions.length === 0 && <Empty description="暂无面试记录" />}
      {positions.map((pos) => {
        const interviews = pos.interviews || [];
        if (interviews.length === 0) return null;
        const byCandidate: Record<string, any[]> = {};
        interviews.forEach((iv: any) => {
          const key = iv.candidate_name || iv.candidate || "未关联候选人";
          (byCandidate[key] = byCandidate[key] || []).push(iv);
        });
        return (
          <Card key={pos.id} size="small" title={<Space><Text strong>{pos.position_name}</Text><Text type="secondary">{interviews.length} 条面试</Text></Space>}
            extra={
              <Popconfirm title="确认删除该岗位？" onConfirm={async () => { await oaApi.deletePosition(pos.id); message.success("已删除"); load(); }}>
                <Button size="small" danger icon={<Trash2 size={14} />} />
              </Popconfirm>
            }
            style={{ marginBottom: 12 }}
          >
            <Collapse
              items={Object.entries(byCandidate).map(([name, list]) => ({
                key: name,
                label: (
                  <Space wrap>
                    <Text strong>{name}</Text>
                    {list.map((iv) => (
                      <Tag key={iv.id} color={iv.result === "通过" ? "green" : iv.result === "未通过" ? "red" : "orange"}>
                        第{iv.round}轮 {iv.result || "待面试"}
                      </Tag>
                    ))}
                  </Space>
                ),
                children: (
                  <div>
                    {list.map((iv) => (
                      <div key={iv.id} style={{ padding: "8px 0", borderBottom: "1px dashed #f0f0f0", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0 }}>
                          <Space wrap>
                            <Text strong>第 {iv.round} 轮</Text>
                            {statusTag(iv.result || "待面试")}
                          </Space>
                          {iv.situation && <div style={{ fontSize: 13, color: "#595959", marginTop: 4, whiteSpace: "pre-wrap" }}>{iv.situation}</div>}
                        </div>
                        <Space>
                          <Button size="small" onClick={() => {
                            setEditing(iv);
                            form.setFieldsValue({ result: iv.result || "待面试", situation: iv.situation });
                          }}>编辑</Button>
                          <Popconfirm title="确认删除该面试记录？" onConfirm={async () => { await oaApi.deleteInterview(iv.id); message.success("已删除"); load(); }}>
                            <Button size="small" danger icon={<Trash2 size={13} />} />
                          </Popconfirm>
                        </Space>
                      </div>
                    ))}
                  </div>
                ),
              }))}
            />
          </Card>
        );
      })}
      <Modal
        title="编辑面试记录"
        open={!!editing}
        onOk={save}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="result" label="面试结果">
            <Select
              options={["待面试", "通过", "未通过"].map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          <Form.Item name="situation" label="面试情况">
            <TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
}

// ==================== 招聘：背景调查 ====================

function BackgroundCheckModule() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await oaApi.listBackgroundChecks();
      setItems(pickList(res));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const v = await form.validateFields();
    await oaApi.updateBackgroundCheck(editing.id, {
      job_performance: v.job_performance,
      resignation_match: v.resignation_match,
      resignation_remark: v.resignation_remark,
      previous_salary: v.previous_salary,
    });
    message.success("背调信息已保存");
    setEditing(null);
    load();
  };

  return (
    <Spin spinning={loading}>
      <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        面试三轮「通过」后自动生成背调记录；点击「背调通过」后自动为该候选人生成入职记录。
      </Text>
      {items.length === 0 && <Empty description="暂无背景调查记录" />}
      <div style={{ display: "grid", gap: 12 }}>
        {items.map((it) => (
          <Card key={it.id} size="small">
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <Space wrap>
                <Text strong style={{ fontSize: 15 }}>{it.candidate_name || it.name}</Text>
                {it.position_name && <Tag color="blue">{it.position_name}</Tag>}
                {it.passed ? <Tag color="green">已通过</Tag> : <Tag color="orange">待背调</Tag>}
                {it.operator_name && <Text type="secondary" style={{ fontSize: 12 }}>操作人：{it.operator_name}</Text>}
              </Space>
              <Space>
                <Button size="small" onClick={() => {
                  setEditing(it);
                  form.setFieldsValue({
                    job_performance: it.job_performance,
                    resignation_match: it.resignation_match || "未核实",
                    resignation_remark: it.resignation_remark,
                    previous_salary: it.previous_salary,
                  });
                }}>编辑</Button>
                {!it.passed && (
                  <Popconfirm title="确认背调通过？通过后将自动生成入职记录。" onConfirm={async () => { await oaApi.passBackgroundCheck(it.id); message.success("背调通过，已生成入职记录"); load(); }}>
                    <Button size="small" type="primary">背调通过</Button>
                  </Popconfirm>
                )}
                <Popconfirm title="确认删除该背调记录？" onConfirm={async () => { await oaApi.deleteBackgroundCheck(it.id); message.success("已删除"); load(); }}>
                  <Button size="small" danger icon={<Trash2 size={14} />} />
                </Popconfirm>
              </Space>
            </div>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
              <div><Text type="secondary">面试表现：</Text>{it.job_performance || "—"}</div>
              <div><Text type="secondary">离职原因是否一致：</Text>{it.resignation_match || "未核实"}{it.resignation_remark ? `（${it.resignation_remark}）` : ""}</div>
              <div><Text type="secondary">上家公司薪资：</Text>{it.previous_salary || "—"}</div>
            </div>
          </Card>
        ))}
      </div>
      <Modal title="编辑背调信息" open={!!editing} onOk={save} onCancel={() => setEditing(null)} okText="保存" cancelText="取消">
        <Form form={form} layout="vertical">
          <Form.Item name="job_performance" label="面试表现">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="resignation_match" label="离职原因是否一致">
            <Select options={["一致", "不一致", "未核实"].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="resignation_remark" label="备注">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="previous_salary" label="上家公司薪资">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
}

// ==================== 招聘：候选 ====================

function CandidateModule() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await candidateApi.pool();
      setItems(pickList(res));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resultTag = (v?: string | null) => {
    if (v === "入职") return <Tag color="green">入职</Tag>;
    if (v === "淘汰") return <Tag color="red">淘汰</Tag>;
    if (v === "待定") return <Tag color="orange">待定</Tag>;
    return <Tag color="default">未定</Tag>;
  };

  const setResult = async (record: any, val: string) => {
    await candidateApi.setResult(record.candidate_id, val);
    message.success(
      val === "入职"
        ? `已设为「入职」，入职板块已生成 ${record.name} 的入职记录`
        : `已设为「${val}」`,
    );
    load();
  };

  return (
    <Spin spinning={loading}>
      <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        候选池：有面试或背景调查记录的候选人；背调通过后在此定最终结果（待定/淘汰/入职），选「入职」自动在入职板块生成对应记录。
      </Text>
      {items.length === 0 ? (
        <Empty description="暂无候选人（需先有面试或背调记录）" />
      ) : (
        <Table
          rowKey="candidate_id"
          size="small"
          dataSource={items}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "姓名", dataIndex: "name", width: 110, render: (v) => <Text strong>{v}</Text> },
            { title: "应聘岗位", dataIndex: "position_name", width: 150, ellipsis: true, render: (v) => v || "—" },
            {
              title: "面试进度",
              dataIndex: "max_round",
              width: 150,
              render: (v, r) =>
                v ? (
                  <Space size={4}>
                    <Tag color="blue">第 {v} 轮</Tag>
                    {r.last_result && statusTag(r.last_result)}
                  </Space>
                ) : (
                  "未面试"
                ),
            },
            {
              title: "背景调查",
              dataIndex: "passed",
              width: 100,
              render: (v) =>
                v === 1 || v === true ? <Tag color="green">已通过</Tag> : v === 0 || v === false ? <Tag color="red">未通过</Tag> : <Tag color="default">未背调</Tag>,
            },
            {
              title: "最终结果",
              dataIndex: "final_result",
              width: 140,
              render: (v) => resultTag(v),
            },
            {
              title: "入职状态",
              dataIndex: "onboarding_status",
              width: 110,
              render: (v) => (v ? statusTag(v) : "—"),
            },
            {
              title: "设置结果",
              dataIndex: "op",
              width: 130,
              render: (_, r) => (
                <Select
                  size="small"
                  style={{ width: 105 }}
                  value={r.final_result || undefined}
                  placeholder="选择"
                  options={["待定", "淘汰", "入职"].map((v) => ({ value: v, label: v }))}
                  onChange={(val) => setResult(r, val)}
                />
              ),
            },
          ]}
        />
      )}
    </Spin>
  );
}

// ==================== 招聘：入职 ====================

function OnboardingModule() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await oaApi.listOnboardings();
      setItems(pickList(res));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const uploadFile = async (file: File, field: string) => {
    setUploading(true);
    try {
      const res = await oaApi.uploadResume(file);
      const url = pickUrl(res);
      if (url) {
        form.setFieldsValue({ [field]: url });
        message.success("上传成功");
      } else {
        message.error("上传失败");
      }
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const v = await form.validateFields();
    await oaApi.updateOnboarding(editing.id, {
      status: v.status,
      note: v.note,
      salary: v.salary,
      ...v,
    });
    // 入职状态改为「已入职」时，自动在系统注册账号（初始密码 123456）
    if (v.status === "已入职") {
      try {
        const res: any = await candidateApi.registerOnboarding(editing.id);
        const d = res?.data?.data || {};
        if (d.created) {
          Modal.success({
            title: "系统账号已创建",
            content: (
              <div>
                <div>账号：{d.username}，初始密码：{d.initial_password}，请提醒员工首次登录后修改密码。</div>
                {d.social_month && (
                  <div style={{ marginTop: 6 }}>
                    已在「社保公积金缴纳情况」的 <b>{d.social_month}</b> 生成缴纳记录
                    （每月15号前入职生成当月，之后生成下月）。
                  </div>
                )}
              </div>
            ),
          });
        } else if (d.username) {
          message.info(`该员工已有系统账号：${d.username}`);
        }
      } catch {
        message.warning("系统账号注册失败，请稍后在入职记录中重试");
      }
    } else {
      message.success("入职资料已保存");
    }
    setEditing(null);
    load();
  };

  const attachmentFields: { field: string; label: string; accept: string }[] = [
    { field: "id_card_url", label: "身份证", accept: "image/*,.pdf" },
    { field: "medical_report_url", label: "体检报告", accept: "image/*,.pdf" },
    { field: "diploma_url", label: "毕业证", accept: "image/*,.pdf" },
    { field: "resignation_cert_url", label: "上家公司离职证明", accept: "image/*,.pdf" },
  ];

  return (
    <Spin spinning={loading}>
      <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        背调通过后自动为候选人生成入职记录（一人一条）；展开条目可填写入职资料。
      </Text>
      {items.length === 0 && <Empty description="暂无入职记录" />}
      <Collapse
        items={items.map((it) => ({
          key: it.id,
          label: (
            <Space wrap>
              <Text strong>{it.name || it.candidate_name}</Text>
              {it.position_name && <Tag color="blue">{it.position_name}</Tag>}
              {it.salary && <Tag color="green">定薪：{it.salary}</Tag>}
              {it.status && statusTag(it.status)}
            </Space>
          ),
          extra: (
            <Space onClick={(e) => e.stopPropagation()}>
              <Button size="small" onClick={() => {
                setEditing(it);
                form.setFieldsValue({
                  ...it,
                  hire_date: it.hire_date ? dayjs(it.hire_date) : undefined,
                });
              }}>填写资料</Button>
              <Popconfirm title="确认删除该入职记录？" onConfirm={async () => { await oaApi.deleteOnboarding(it.id); message.success("已删除"); load(); }}>
                <Button size="small" danger icon={<Trash2 size={13} />} />
              </Popconfirm>
            </Space>
          ),
          children: (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
              <Card size="small" title="资料附件">
                {attachmentFields.map((f) => (
                  <div key={f.field} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Text style={{ width: 120 }}>{f.label}</Text>
                    {it[f.field] ? (
                      <a onClick={() => window.open(it[f.field], "_blank")}>查看</a>
                    ) : (
                      <Text type="secondary">未上传</Text>
                    )}
                  </div>
                ))}
              </Card>
              <Card size="small" title="银行卡 / 社保公积金">
                <div><Text type="secondary">银行卡号：</Text>{it.bank_card_no || "—"}</div>
                <div><Text type="secondary">开户行：</Text>{it.bank_name || "—"}</div>
                <div><Text type="secondary">社保：</Text>{it.social_security || "—"}</div>
                <div><Text type="secondary">公积金：</Text>{it.housing_fund || "—"}</div>
              </Card>
              <Card size="small" title="签署合同">
                <div>
                  <Text type="secondary">状态：</Text>
                  {it.contract_status === "已签署" ? <Tag color="green">已签署</Tag> : <Tag color="orange">{it.contract_status || "未签署"}</Tag>}
                </div>
                {it.contract_url ? (
                  <a onClick={() => window.open(it.contract_url, "_blank")}>查看合同</a>
                ) : (
                  <Text type="secondary">未上传合同</Text>
                )}
              </Card>
              <Card size="small" title="公司资料记录">
                <div><Text type="secondary">入职时间：</Text>{it.hire_date ? dayjs(it.hire_date).format("YYYY-MM-DD") : "—"}</div>
                <div><Text type="secondary">住址：</Text>{it.address || "—"}</div>
                <div><Text type="secondary">电话：</Text>{it.phone || "—"}</div>
                {it.note && <div style={{ marginTop: 4 }}><Text type="secondary">备注：</Text>{it.note}</div>}
              </Card>
            </div>
          ),
        }))}
      />

      <Modal
        title="填写入职资料"
        open={!!editing}
        onOk={save}
        onCancel={() => setEditing(null)}
        width={720}
        okText="保存"
        cancelText="取消"
        confirmLoading={uploading}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="资料附件（身份证 / 体检报告 / 毕业证 / 离职证明）">
            {attachmentFields.map((f) => (
              <div key={f.field} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Text style={{ width: 130 }}>{f.label}</Text>
                <label style={{ cursor: "pointer" }}>
                  <Button size="small">上传</Button>
                  <input
                    type="file"
                    style={{ display: "none" }}
                    accept={f.accept}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadFile(file, f.field);
                      e.target.value = "";
                    }}
                  />
                </label>
                <Form.Item name={f.field} noStyle>
                  <Input placeholder="上传后自动填入附件地址，也可直接粘贴URL" style={{ flex: 1 }} />
                </Form.Item>
              </div>
            ))}
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="bank_card_no" label="银行卡号"><Input /></Form.Item>
            <Form.Item name="bank_name" label="开户行"><Input /></Form.Item>
            <Form.Item name="social_security" label="社保"><Input /></Form.Item>
            <Form.Item name="housing_fund" label="公积金"><Input /></Form.Item>
            <Form.Item name="contract_status" label="合同签署状态">
              <Select options={["未签署", "已签署"].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="contract_url" label="合同附件URL"><Input /></Form.Item>
            <Form.Item name="salary" label="定薪"><Input /></Form.Item>
            <Form.Item name="hire_date" label="入职时间"><DatePicker style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="address" label="住址"><Input /></Form.Item>
            <Form.Item name="phone" label="电话"><Input /></Form.Item>
            <Form.Item name="status" label="入职状态">
              <Select options={["待入职", "已入职", "已放弃"].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </div>
          <Form.Item name="note" label="备注"><TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
}

// ==================== 公告管理 ====================

function AnnouncementModule() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await oaApi.listAnnouncements();
      setItems(pickList(res));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const v = await form.validateFields();
    await oaApi.createAnnouncement(v);
    message.success("公告已发布");
    setModalOpen(false);
    form.resetFields();
    load();
  };

  return (
    <Spin spinning={loading}>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
        <Text type="secondary">公告全员可见，重要公告将标红显示</Text>
        <Button type="primary" onClick={() => setModalOpen(true)}>发布公告</Button>
      </div>
      {items.length === 0 && <Empty description="暂无公告" />}
      <div style={{ display: "grid", gap: 12 }}>
        {items.map((it) => (
          <Card key={it.id} size="small">
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <Space wrap>
                <Tag color={it.level === "重要" ? "red" : it.level === "紧急" ? "volcano" : "blue"}>{it.level || "通知"}</Tag>
                <Text strong style={{ fontSize: 15 }}>{it.title}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {it.publisher || it.created_by || ""} {it.created_at ? dayjs(it.created_at).format("YYYY-MM-DD HH:mm") : ""}
                </Text>
              </Space>
              <Popconfirm title="确认删除该公告？" onConfirm={async () => { await oaApi.deleteAnnouncement(it.id); message.success("已删除"); load(); }}>
                <Button size="small" danger icon={<Trash2 size={14} />} />
              </Popconfirm>
            </div>
            {it.content && <div style={{ marginTop: 8, fontSize: 13, color: "#595959", whiteSpace: "pre-wrap" }}>{it.content}</div>}
          </Card>
        ))}
      </div>
      <Modal title="发布公告" open={modalOpen} onOk={submit} onCancel={() => setModalOpen(false)} okText="发布" cancelText="取消">
        <Form form={form} layout="vertical" initialValues={{ level: "普通" }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="level" label="级别">
            <Select options={["普通", "重要", "紧急"].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="content" label="内容"><TextArea rows={4} /></Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
}

// ==================== 耗材领用 ====================

function SupplyModule() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await oaApi.listSupplies();
      setItems(pickList(res));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const v = await form.validateFields();
    await oaApi.createSupply(v);
    message.success("领用申请已提交");
    form.resetFields();
    load();
  };

  return (
    <Spin spinning={loading}>
      <Card size="small" title="申请领用" style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={submit}>
          <Form.Item name="item_name" rules={[{ required: true, message: "请输入耗材名称" }]}>
            <Input placeholder="耗材名称" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="quantity" rules={[{ required: true, message: "请输入数量" }]}>
            <InputNumber placeholder="数量" min={1} style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="note">
            <Input placeholder="备注（可选）" style={{ width: 240 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">提交申请</Button>
          </Form.Item>
        </Form>
      </Card>
      {items.length === 0 ? (
        <Empty description="暂无领用记录" />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={items}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "耗材", dataIndex: "item_name" },
            { title: "数量", dataIndex: "quantity", width: 80 },
            { title: "备注", dataIndex: "note", ellipsis: true },
            { title: "申请人", dataIndex: "applicant", width: 100, render: (v) => v || "—" },
            { title: "时间", dataIndex: "created_at", width: 160, render: (v) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—") },
            {
              title: "操作",
              width: 80,
              render: (_, record) => (
                <Popconfirm title="确认删除？" onConfirm={async () => { await oaApi.deleteSupply(record.id); message.success("已删除"); load(); }}>
                  <Button size="small" danger icon={<Trash2 size={13} />} />
                </Popconfirm>
              ),
            },
          ]}
        />
      )}
    </Spin>
  );
}

// ==================== 验证码中心 ====================

function SmsModule() {
  const [items, setItems] = useState<any[]>([]);
  const [bindings, setBindings] = useState<any[]>([]);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [bindOpen, setBindOpen] = useState(false);
  const [bindForm] = Form.useForm();

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
          oaApi.listSms({ keyword: keyword || undefined, only_unread: onlyUnread || undefined }),
          oaApi.listSmsBindings().catch(() => null),
        ]);
        setItems(pickList(s));
        setBindings(pickList(b));
    } catch {
      /* 静默 */
    }
  }, [keyword, onlyUnread]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000); // 30 秒自动刷新
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <Space wrap>
          <Input.Search
            placeholder="搜索平台 / 内容"
            allowClear
            style={{ width: 220 }}
            onSearch={(v) => setKeyword(v)}
          />
          <Checkbox checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)}>仅看未读</Checkbox>
          <Button onClick={() => oaApi.markAllSmsRead().then(() => { message.success("已全部标记已读"); load(); })}>全部已读</Button>
        </Space>
        <Button onClick={() => setBindOpen(true)}>手机号绑定管理</Button>
      </div>

      <div>
        {items.length === 0 && <Empty description="暂无短信记录（安卓机 SmsForwarder 转发后自动入库）" />}
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((it) => {
            const isUnread = !it.is_read && !it.read_at;
            const expired = it.created_at ? dayjs(it.created_at).isBefore(dayjs().startOf("day")) : false;
            const phone = String(it.phone || it.sender || "");
            const maskedPhone = phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
            return (
              <Card
                key={it.id}
                size="small"
                className={isUnread ? "oa-sms-unread" : undefined}
                style={isUnread ? { borderColor: "#faad14" } : undefined}
              >
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <Space wrap>
                    {isUnread && <Badge status="warning" />}
                    <Text strong>{it.platform || it.sms_platform || "验证码"}</Text>
                    <Text type="secondary">{expired ? maskedPhone : phone || maskedPhone}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{it.created_at ? dayjs(it.created_at).format("MM-DD HH:mm:ss") : ""}</Text>
                  </Space>
                  <Space>
                    {isUnread && (
                      <Button size="small" onClick={async () => { await oaApi.markSmsRead(it.id); load(); }}>标为已读</Button>
                    )}
                    <Button size="small" onClick={() => copyText(it.code || it.content || "")}>复制</Button>
                    <Popconfirm title="确认删除该短信？" onConfirm={async () => { await oaApi.deleteSms(it.id); load(); }}>
                      <Button size="small" danger icon={<Trash2 size={13} />} />
                    </Popconfirm>
                  </Space>
                </div>
                <div style={{ marginTop: 6 }}>
                  <Text strong style={{ fontSize: 18, color: "#fa541c", marginRight: 12 }}>{it.code || "—"}</Text>
                  <Text type={expired ? "secondary" : undefined} style={{ fontSize: 13 }}>
                    {expired ? "验证码已过期（跨天自动脱敏）" : it.content}
                  </Text>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <Modal title="手机号绑定管理" open={bindOpen} onCancel={() => setBindOpen(false)} footer={null} width={640}>
        <Form
          form={bindForm}
          layout="inline"
          style={{ marginBottom: 12 }}
          onFinish={async (v) => {
            await oaApi.bindPhone(v);
            message.success("绑定成功");
            bindForm.resetFields();
            load();
          }}
        >
          <Form.Item name="phone" rules={[{ required: true, message: "请输入手机号" }, { pattern: /^\d{11}$/, message: "请输入11位手机号" }]}>
            <Input placeholder="手机号" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="username">
            <Input placeholder="绑定人账号（可选，默认自己）" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">绑定</Button>
          </Form.Item>
        </Form>
        {bindings.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无绑定" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            dataSource={bindings}
            pagination={false}
            columns={[
              { title: "手机号", dataIndex: "phone" },
              { title: "绑定人", dataIndex: "username", render: (v) => v || "—" },
              {
                title: "操作",
                width: 80,
                render: (_, record) => (
                  <Popconfirm title="确认解绑？" onConfirm={async () => { await oaApi.unbindPhone(record.id); message.success("已解绑"); load(); }}>
                    <Button size="small" danger>解绑</Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}

// ==================== 请假 ====================

function LeaveModule() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [dates, setDates] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await oaApi.listLeaves(scope);
      setItems(pickList(res));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const v = await form.validateFields();
    await oaApi.createLeave({
      leave_type: v.leave_type,
      start_date: v.range[0].format("YYYY-MM-DD"),
      end_date: v.range[1].format("YYYY-MM-DD"),
      reason: v.reason,
    });
    message.success("请假申请已提交");
    setModalOpen(false);
    form.resetFields();
    load();
  };

  return (
    <Spin spinning={loading}>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <Space>
          {isAdmin && (
            <Segmented
              value={scope}
              onChange={(v) => setScope(v as "mine" | "all")}
              options={[{ value: "mine", label: "我的请假" }, { value: "all", label: "全部（管理员）" }]}
            />
          )}
        </Space>
        <Button type="primary" onClick={() => setModalOpen(true)}>发起请假</Button>
      </div>
      {items.length === 0 ? (
        <Empty description="暂无请假记录" />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={items}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "申请人", dataIndex: "username", width: 100, render: (v, r) => v || r.applicant || "—" },
            { title: "类型", dataIndex: "leave_type", width: 90 },
            { title: "开始", dataIndex: "start_date", width: 110 },
            { title: "结束", dataIndex: "end_date", width: 110 },
            { title: "事由", dataIndex: "reason", ellipsis: true },
            { title: "状态", dataIndex: "status", width: 90, render: (v) => statusTag(v) },
            { title: "审批备注", dataIndex: "approve_note", ellipsis: true, render: (v) => v || "—" },
            {
              title: "操作",
              width: isAdmin ? 150 : 80,
              render: (_, record) => (
                <Space>
                  {isAdmin && record.status === "待审批" && (
                    <>
                      <Button size="small" type="primary" onClick={async () => { await oaApi.reviewLeave(record.id, { status: "已通过" }); message.success("已通过"); load(); }}>通过</Button>
                      <Button size="small" danger onClick={async () => { await oaApi.reviewLeave(record.id, { status: "已驳回" }); message.success("已驳回"); load(); }}>驳回</Button>
                    </>
                  )}
                  <Popconfirm title="确认删除？" onConfirm={async () => { await oaApi.deleteLeave(record.id); message.success("已删除"); load(); }}>
                    <Button size="small" danger icon={<Trash2 size={13} />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}
      <Modal title="发起请假" open={modalOpen} onOk={submit} onCancel={() => setModalOpen(false)} okText="提交" cancelText="取消">
        <Form form={form} layout="vertical">
          <Form.Item name="leave_type" label="请假类型" rules={[{ required: true, message: "请选择类型" }]}>
            <Select options={["事假", "病假", "年假", "调休", "婚假", "产假", "其他"].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="range" label="请假时间" rules={[{ required: true, message: "请选择时间范围" }]}>
            <DatePicker.RangePicker
              style={{ width: "100%" }}
              value={dates as any}
              onChange={(v) => setDates(v)}
            />
          </Form.Item>
          <Form.Item name="reason" label="事由"><TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
}

// ==================== 人事管理：社保公积金缴纳情况 ====================

function SocialSecurityModule() {
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const { user } = useAuth();
  const isAdmin = String((user as any)?.role || "").toLowerCase().includes("admin");

  // 深圳社保价目（不预填写、不展示，仅供补交差额计算参考）
  const [prices, setPrices] = useState<Record<string, number>>({});

  const loadPrices = useCallback(async () => {
    try {
      const res: any = await socialPriceApi.get();
      const d = res?.data?.data || {};
      const map: Record<string, number> = {};
      for (const p of d.prices || []) map[p.item] = Number(p.amount);
      setPrices(map);
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => { loadPrices(); }, [loadPrices]);

  const load = useCallback(async (m: Dayjs) => {
    setLoading(true);
    try {
      const key = m.format("YYYY-MM");
      const [usersRes, recRes] = await Promise.all([
        departmentsApi.getAllUsers(),
        socialSecurityApi.list(key),
      ]);
      const users = (usersRes?.data?.data || []).filter(
        (u: any) => u.status === undefined || u.status === null || u.status === "active",
      );
      const recList = pickList(recRes);
      const recMap: Record<string, any> = {};
      for (const r of recList) recMap[r.username] = r;
      // 名单 = 系统全员；已有当月记录的回填，新人生成空行
      const rows = users.map((u: any) => {
        const rec = recMap[u.username];
        return {
          username: u.username,
          name: u.nickname || u.username,
          department: u.department_names || "未分配",
          company: rec?.company || "",
          social_tier: rec?.social_tier || "",
          social_amount: rec?.social_amount != null ? Number(rec.social_amount) : null,
          social_unit_amount: rec?.social_unit_amount != null ? Number(rec.social_unit_amount) : null,
          social_person_amount: rec?.social_person_amount != null ? Number(rec.social_person_amount) : null,
          social_status: rec?.social_status || "未缴纳",
          fund_amount: rec?.fund_amount != null ? Number(rec.fund_amount) : null,
          fund_unit_amount: rec?.fund_unit_amount != null ? Number(rec.fund_unit_amount) : null,
          fund_person_amount: rec?.fund_person_amount != null ? Number(rec.fund_person_amount) : null,
          fund_status: rec?.fund_status || "未缴纳",
          note: rec?.note || "",
          hasRecord: !!rec,
        };
      });
      setStaff(rows);
    } catch {
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(month); }, [load, month]);

  const isPaid = (v?: string | null) => !!v && v !== "未缴纳";

  // 补交规则：已缴纳但记录金额低于当前价目 → 补交差额
  const backPayOf = (r: any): number => {
    if (r.social_status !== "已缴纳" || !r.social_tier) return 0;
    const cur = prices[r.social_tier];
    if (cur == null) return 0;
    return Math.max(0, Number(cur) - Number(r.social_amount || 0));
  };

  const stats = useMemo(() => {
    const ss = staff.filter((r) => isPaid(r.social_status));
    const hf = staff.filter((r) => isPaid(r.fund_status));
    const ssSum = ss.reduce((s, r) => s + (Number(r.social_amount) || 0), 0);
    const hfSum = hf.reduce((s, r) => s + (Number(r.fund_amount) || 0), 0);
    // 单位/个人按手动填写的金额合计
    const unitSum = staff.reduce(
      (s, r) => s + (isPaid(r.social_status) ? Number(r.social_unit_amount) || 0 : 0) + (isPaid(r.fund_status) ? Number(r.fund_unit_amount) || 0 : 0),
      0,
    );
    const personSum = staff.reduce(
      (s, r) => s + (isPaid(r.social_status) ? Number(r.social_person_amount) || 0 : 0) + (isPaid(r.fund_status) ? Number(r.fund_person_amount) || 0 : 0),
      0,
    );
    const backSum = staff.reduce((s, r) => s + backPayOf(r), 0);
    return { total: staff.length, ss: ss.length, hf: hf.length, ssSum, hfSum, allSum: ssSum + hfSum, backSum, unitSum, personSum };
  }, [staff, prices]);

  const updateRow = (username: string, patch: any) => {
    setStaff((prev) => prev.map((r) => (r.username === username ? { ...r, ...patch } : r)));
  };

  const onTierChange = (username: string, tier: string) => {
    // 仅选择档位，金额全部手动填写
    updateRow(username, { social_tier: tier });
  };

  const save = async (all: boolean) => {
    if (!isAdmin) {
      message.warning("仅管理员可修改缴纳明细");
      return;
    }
    (all ? setSavingAll : setSaving)(true);
    try {
      const items = (all ? staff : staff.filter((r) => r.hasRecord || isPaid(r.social_status) || isPaid(r.fund_status))).map((r) => ({
        username: r.username,
        name: r.name,
        department: r.department,
        company: r.company || null,
        social_tier: r.social_tier || null,
        social_amount: r.social_amount,
        social_unit_amount: r.social_unit_amount,
        social_person_amount: r.social_person_amount,
        social_status: r.social_status,
        fund_amount: r.fund_amount,
        fund_unit_amount: r.fund_unit_amount,
        fund_person_amount: r.fund_person_amount,
        fund_status: r.fund_status,
        note: r.note || null,
      }));
      await socialSecurityApi.save({ month: month.format("YYYY-MM"), items });
      message.success(`已保存 ${month.format("YYYY年MM月")} 缴纳明细（${items.length} 人）；如金额有变动将在工作台生成明细通知`);
      load(month);
      loadPrices();
    } finally {
      (all ? setSavingAll : setSaving)(false);
    }
  };

  // 导出当月全员缴纳明细 CSV（含单位/个人拆分）
  const exportCsv = () => {
    const header = ["姓名", "用户名", "部门", "缴纳单位", "社保档位", "社保单位(元)", "社保个人(元)", "社保合计(元)", "社保状态", "公积金单位(元)", "公积金个人(元)", "公积金合计(元)", "公积金状态", "补交金额(元)", "备注"];
    const lines = staff.map((r) => {
      return [r.name, r.username, r.department, r.company || "", r.social_tier || "", r.social_unit_amount ?? "", r.social_person_amount ?? "", r.social_amount ?? "", r.social_status, r.fund_unit_amount ?? "", r.fund_person_amount ?? "", r.fund_amount ?? "", r.fund_status, backPayOf(r).toFixed(2), r.note || ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = "\uFEFF" + [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `社保公积金缴纳明细_${month.format("YYYY-MM")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Spin spinning={loading}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <DatePicker picker="month" value={month} onChange={(v) => v && setMonth(v)} allowClear={false} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          名单来自系统组织管理全员；社保/公积金金额（单位、个人、合计）全部手动填写，保存后形成记录，金额变动将生成明细通知到工作台。
        </Text>
        <div style={{ flex: 1 }} />
        <Button onClick={exportCsv} icon={<Download size={14} />}>导出明细</Button>
        <Button onClick={() => save(false)} loading={saving} disabled={!isAdmin}>保存当月明细</Button>
        <Button type="primary" onClick={() => save(true)} loading={savingAll} disabled={!isAdmin}>生成全员明细并保存</Button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 16, marginBottom: 16 }}>
        <Card size="small"><div style={{ fontSize: 13, color: "#8c8c8c" }}>全员人数</div><div style={{ fontSize: 26, fontWeight: 600 }}>{stats.total}</div></Card>
        <Card size="small"><div style={{ fontSize: 13, color: "#8c8c8c" }}>已缴社保</div><div style={{ fontSize: 26, fontWeight: 600, color: "#3370ff" }}>{stats.ss}</div></Card>
        <Card size="small"><div style={{ fontSize: 13, color: "#8c8c8c" }}>社保合计（元）</div><div style={{ fontSize: 26, fontWeight: 600 }}>{stats.ssSum.toFixed(2)}</div></Card>
        <Card size="small"><div style={{ fontSize: 13, color: "#8c8c8c" }}>已缴公积金</div><div style={{ fontSize: 26, fontWeight: 600, color: "#3370ff" }}>{stats.hf}</div></Card>
        <Card size="small"><div style={{ fontSize: 13, color: "#8c8c8c" }}>公积金合计（元）</div><div style={{ fontSize: 26, fontWeight: 600 }}>{stats.hfSum.toFixed(2)}</div></Card>
        <Card size="small"><div style={{ fontSize: 13, color: "#8c8c8c" }}>当月合计（元）</div><div style={{ fontSize: 26, fontWeight: 600, color: "#fa8c16" }}>{stats.allSum.toFixed(2)}</div></Card>
        <Card size="small"><div style={{ fontSize: 13, color: "#8c8c8c" }}>单位缴纳合计（元）</div><div style={{ fontSize: 26, fontWeight: 600, color: "#3370ff" }}>{stats.unitSum.toFixed(2)}</div></Card>
        <Card size="small"><div style={{ fontSize: 13, color: "#8c8c8c" }}>个人缴纳合计（元）</div><div style={{ fontSize: 26, fontWeight: 600, color: "#722ed1" }}>{stats.personSum.toFixed(2)}</div></Card>
        <Card size="small"><div style={{ fontSize: 13, color: "#8c8c8c" }}>补交合计（元）</div><div style={{ fontSize: 26, fontWeight: 600, color: "#cf1322" }}>{stats.backSum.toFixed(2)}</div></Card>
      </div>

      {staff.length === 0 ? (
        <Empty description="暂无人员数据（来自系统组织管理）" />
      ) : (
        <Table
          rowKey="username"
          size="small"
          dataSource={staff}
          pagination={{ pageSize: 15 }}
          columns={[
            { title: "姓名", dataIndex: "name", width: 100, render: (v) => <Text strong>{v}</Text> },
            { title: "部门", dataIndex: "department", width: 130, ellipsis: true, render: (v) => v || "未分配" },
            {
              title: "缴纳单位",
              dataIndex: "company",
              width: 140,
              render: (v, r) =>
                isAdmin ? (
                  <Select
                    size="small"
                    style={{ width: 125 }}
                    allowClear
                    placeholder="选择单位"
                    value={v || undefined}
                    options={COMPANY_OPTIONS.map((c) => ({ value: c, label: c }))}
                    onChange={(val) => updateRow(r.username, { company: val || "" })}
                  />
                ) : (
                  v || "—"
                ),
            },
            {
              title: "社保档位（深圳）",
              dataIndex: "social_tier",
              width: 150,
              render: (v, r) =>
                isAdmin ? (
                  <Select
                    size="small"
                    style={{ width: 120 }}
                    allowClear
                    placeholder="选择档位"
                    value={v || undefined}
                    options={["社保一档", "社保二档"].map((t) => ({ value: t, label: t }))}
                    onChange={(val) => val && onTierChange(r.username, val)}
                  />
                ) : (
                  v || "—"
                ),
            },
            {
              title: "社保（单位 / 个人 / 合计）",
              children: [
                {
                  title: "单位",
                  dataIndex: "social_unit_amount",
                  width: 100,
                  render: (v, r) =>
                    isAdmin ? (
                      <InputNumber
                        size="small"
                        style={{ width: 90 }}
                        min={0}
                        value={v ?? undefined}
                        placeholder="0"
                        onChange={(val) => updateRow(r.username, { social_unit_amount: val })}
                      />
                    ) : (
                      v ?? "—"
                    ),
                },
                {
                  title: "个人",
                  dataIndex: "social_person_amount",
                  width: 100,
                  render: (v, r) =>
                    isAdmin ? (
                      <InputNumber
                        size="small"
                        style={{ width: 90 }}
                        min={0}
                        value={v ?? undefined}
                        placeholder="0"
                        onChange={(val) => updateRow(r.username, { social_person_amount: val })}
                      />
                    ) : (
                      v ?? "—"
                    ),
                },
                {
                  title: "合计",
                  dataIndex: "social_amount",
                  width: 110,
                  render: (v, r) =>
                    isAdmin ? (
                      <InputNumber
                        size="small"
                        style={{ width: 100 }}
                        min={0}
                        value={v ?? undefined}
                        placeholder="0"
                        onChange={(val) => updateRow(r.username, { social_amount: val })}
                      />
                    ) : (
                      v ?? "—"
                    ),
                },
              ],
            },
            {
              title: "社保状态",
              dataIndex: "social_status",
              width: 110,
              render: (v, r) =>
                isAdmin ? (
                  <Select
                    size="small"
                    style={{ width: 95 }}
                    value={v}
                    options={["未缴纳", "已缴纳", "已停缴"].map((s) => ({ value: s, label: s }))}
                    onChange={(val) => updateRow(r.username, { social_status: val })}
                  />
                ) : (
                  payStatusTag(v)
                ),
            },
            {
              title: "补交金额（元）",
              key: "backpay",
              width: 120,
              render: (_, r) => {
                const bp = backPayOf(r);
                return bp > 0 ? <Tag color="red">补交 {bp.toFixed(2)}</Tag> : <Text type="secondary">—</Text>;
              },
            },
            {
              title: "公积金（单位 / 个人 / 合计）",
              children: [
                {
                  title: "单位",
                  dataIndex: "fund_unit_amount",
                  width: 100,
                  render: (v, r) =>
                    isAdmin ? (
                      <InputNumber
                        size="small"
                        style={{ width: 90 }}
                        min={0}
                        value={v ?? undefined}
                        placeholder="0"
                        onChange={(val) => updateRow(r.username, { fund_unit_amount: val })}
                      />
                    ) : (
                      v ?? "—"
                    ),
                },
                {
                  title: "个人",
                  dataIndex: "fund_person_amount",
                  width: 100,
                  render: (v, r) =>
                    isAdmin ? (
                      <InputNumber
                        size="small"
                        style={{ width: 90 }}
                        min={0}
                        value={v ?? undefined}
                        placeholder="0"
                        onChange={(val) => updateRow(r.username, { fund_person_amount: val })}
                      />
                    ) : (
                      v ?? "—"
                    ),
                },
                {
                  title: "合计",
                  dataIndex: "fund_amount",
                  width: 110,
                  render: (v, r) =>
                    isAdmin ? (
                      <InputNumber
                        size="small"
                        style={{ width: 100 }}
                        min={0}
                        value={v ?? undefined}
                        placeholder="0"
                        onChange={(val) => updateRow(r.username, { fund_amount: val })}
                      />
                    ) : (
                      v ?? "—"
                    ),
                },
              ],
            },
            {
              title: "公积金状态",
              dataIndex: "fund_status",
              width: 110,
              render: (v, r) =>
                isAdmin ? (
                  <Select
                    size="small"
                    style={{ width: 95 }}
                    value={v}
                    options={["未缴纳", "已缴纳", "已停缴"].map((s) => ({ value: s, label: s }))}
                    onChange={(val) => updateRow(r.username, { fund_status: val })}
                  />
                ) : (
                  payStatusTag(v)
                ),
            },
            {
              title: "备注",
              dataIndex: "note",
              render: (v, r) =>
                isAdmin ? (
                  <Input
                    size="small"
                    value={v || ""}
                    placeholder="备注"
                    onChange={(e) => updateRow(r.username, { note: e.target.value })}
                  />
                ) : (
                  v || "—"
                ),
            },
          ]}
        />
      )}
    </Spin>
  );
}

// 缴纳状态标签
function payStatusTag(v?: string | null) {
  if (v === "已缴纳") return <Tag color="green">已缴纳</Tag>;
  if (v === "已停缴") return <Tag color="default">已停缴</Tag>;
  return <Tag color="orange">未缴纳</Tag>;
}

// ==================== 人事管理：人员信息（org 全员） ====================

function StaffModule() {
  const { user } = useAuth();
  const isAdmin = String((user as any)?.role || "").toLowerCase().includes("admin");
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<any>(null);
  const [offTarget, setOffTarget] = useState<any>(null);
  const [offConfirming, setOffConfirming] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    departmentsApi.getAllUsers()
      .then((res: any) => setUsers(res?.data?.data || []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [isAdmin, load]);

  // 确认离职：通知财务与人事部门并停用账号
  const confirmOffboard = async () => {
    if (!offTarget) return;
    setOffConfirming(true);
    try {
      await oaApi.offboardConfirm(offTarget.username);
      message.success(`已确认 ${offTarget.nickname || offTarget.username} 离职，已通知财务部与人事部`);
      setOffTarget(null);
      load();
    } finally {
      setOffConfirming(false);
    }
  };

  // 普通用户：仅看到自己
  const selfUser = useMemo(
    () => ({
      id: (user as any)?.id,
      username: user?.username,
      nickname: user?.nickname,
      email: (user as any)?.email,
      role: (user as any)?.role,
      department_names: (user as any)?.department_names,
      status: (user as any)?.status,
    }),
    [user],
  );

  // 管理员按部门分组（department_names 可能为逗号分隔多部门），无部门归入「未分配部门」
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const u of users) {
      const deps = String(u.department_names || "").split(/[,，、]/).map((s: string) => s.trim()).filter(Boolean);
      if (deps.length === 0) {
        if (!map.has("未分配部门")) map.set("未分配部门", []);
        map.get("未分配部门")!.push(u);
      } else {
        for (const d of deps) {
          if (!map.has(d)) map.set(d, []);
          map.get(d)!.push(u);
        }
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
  }, [users]);

  const roleLabel = (r?: string | null) => r || "—";

  const renderUserRow = (u: any) => (
    <div
      key={`${u.id}-${u.username}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        borderRadius: 8,
        cursor: "default",
      }}
      className="oa-staff-row"
    >
      <Avatar size={28} style={{ background: "#3370ff", fontSize: 13 }}>
        {(u.nickname || u.username || "?").slice(0, 1)}
      </Avatar>
      <Text strong>{u.nickname || u.username}</Text>
      <Text type="secondary" style={{ fontSize: 12 }}>@{u.username}</Text>
      <Tag style={{ marginLeft: 4 }}>{roleLabel(u.role)}</Tag>
      {u.status === "active" ? <Tag color="green">在职</Tag> : <Tag color="red">已离职</Tag>}
      <div style={{ flex: 1 }} />
      {isAdmin && u.status === "active" && (
        <Button size="small" danger style={{ marginRight: 6 }} onClick={() => setOffTarget(u)}>
          离职选项
        </Button>
      )}
      <Button size="small" onClick={() => setViewing(u)}>查看</Button>
    </div>
  );

  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 720 }}>
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          人员信息板块：普通用户仅可查看本人信息，管理员可查看公司全员。
        </Text>
        <Card size="small" title="我的信息">
          {renderUserRow(selfUser)}
        </Card>
        <Modal
          title="个人信息"
          open={!!viewing}
          footer={null}
          onCancel={() => setViewing(null)}
        >
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="用户名">{viewing?.username || "—"}</Descriptions.Item>
            <Descriptions.Item label="昵称">{viewing?.nickname || "—"}</Descriptions.Item>
            <Descriptions.Item label="邮箱">{viewing?.email || "—"}</Descriptions.Item>
            <Descriptions.Item label="角色">{roleLabel(viewing?.role)}</Descriptions.Item>
            <Descriptions.Item label="部门">{viewing?.department_names || "未分配"}</Descriptions.Item>
            <Descriptions.Item label="状态">{viewing?.status === "active" ? "在职" : viewing?.status || "—"}</Descriptions.Item>
          </Descriptions>
        </Modal>
      </div>
    );
  }

  return (
    <Spin spinning={loading}>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <Users size={16} color="#3370ff" />
        <Text strong>公司全员（{users.length} 人）</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>按部门分组，数据来自系统组织管理</Text>
      </div>
      {/* 离职确认弹窗 */}
      <Modal
        open={!!offTarget}
        title="离职确认"
        onOk={confirmOffboard}
        confirmLoading={offConfirming}
        onCancel={() => setOffTarget(null)}
        okText="确认离职"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <Text>
          该员工是否依旧离职？确认后 <b>{offTarget?.nickname || offTarget?.username}</b> 的系统账号将被停用，
          并自动通知<b>财务部</b>与<b>人事部</b>处理交接与结算事宜。
        </Text>
      </Modal>
      {users.length === 0 ? (
        <Empty description="暂无人员数据" />
      ) : (
        <Collapse
          defaultActiveKey={groups.map(([dep]) => dep)}
          items={groups.map(([dep, list]) => ({
            key: dep,
            label: (
              <Space>
                <Text strong>{dep}</Text>
                <Tag>{list.length} 人</Tag>
              </Space>
            ),
            children: (
              <div style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                {list.map(renderUserRow)}
              </div>
            ),
          }))}
        />
      )}
      <Modal
        title={`人员信息 - ${viewing?.nickname || viewing?.username || ""}`}
        open={!!viewing}
        footer={null}
        onCancel={() => setViewing(null)}
      >
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="ID">{viewing?.id ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="用户名">{viewing?.username || "—"}</Descriptions.Item>
          <Descriptions.Item label="昵称">{viewing?.nickname || "—"}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{viewing?.email || "—"}</Descriptions.Item>
          <Descriptions.Item label="角色">{roleLabel(viewing?.role)}</Descriptions.Item>
          <Descriptions.Item label="部门">{viewing?.department_names || "未分配"}</Descriptions.Item>
          <Descriptions.Item label="状态">{viewing?.status === "active" ? "在职" : viewing?.status || "—"}</Descriptions.Item>
        </Descriptions>
      </Modal>
    </Spin>
  );
}

// ==================== 人事管理：个人中心 ====================

function PersonalCenterModule() {
  const { user } = useAuth();
  const [bindings, setBindings] = useState<any[]>([]);
  const [bindForm] = Form.useForm();
  const [quota, setQuota] = useState<any>(null);
  const [quotaEditing, setQuotaEditing] = useState<number | null>(null);
  const [savingQuota, setSavingQuota] = useState(false);
  const isAdmin = String((user as any)?.role || "").toLowerCase().includes("admin");

  const load = useCallback(async () => {
    try {
      const res = await oaApi.listSmsBindings();
      const list = pickList(res);
      setBindings(list.filter((b) => !user?.username || !b.username || b.username === user.username));
    } catch {
      setBindings([]);
    }
    // 年假额度（以个人中心为准）
    try {
      const r: any = await oaApi.getLeaveQuota();
      setQuota(r?.data?.data || null);
      setQuotaEditing(r?.data?.data?.annual_days ?? null);
    } catch {
      /* 忽略 */
    }
  }, [user?.username]);

  useEffect(() => { load(); }, [load]);

  const saveQuota = async () => {
    if (quotaEditing == null || !user?.username) return;
    setSavingQuota(true);
    try {
      await oaApi.setLeaveQuota({ username: user.username, annual_days: Number(quotaEditing) });
      message.success("年假额度已更新");
      load();
    } finally {
      setSavingQuota(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div><Text type="secondary">用户名：</Text><Text strong>{user?.username || "—"}</Text></div>
          <div><Text type="secondary">昵称：</Text><Text strong>{user?.nickname || "—"}</Text></div>
          <div><Text type="secondary">邮箱：</Text><Text strong>{(user as any)?.email || "—"}</Text></div>
          <div><Text type="secondary">角色：</Text>{(user as any)?.role ? <Tag color="blue">{(user as any).role}</Tag> : <Tag>普通成员</Tag>}</div>
        </div>
      </Card>

      <Card size="small" title="年假额度" style={{ marginBottom: 16 }}>
        {quota ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: quotaEditing != null && isAdmin ? 12 : 0 }}>
              <div><Text type="secondary">本年度：</Text><Text strong>{quota.year}</Text></div>
              <div><Text type="secondary">年假总额度：</Text><Text strong style={{ color: "#3370ff" }}>{quota.annual_days} 天</Text></div>
              <div><Text type="secondary">已休：</Text><Text strong>{quota.used_days} 天</Text></div>
              <div><Text type="secondary">剩余：</Text><Text strong style={{ color: quota.remaining_days > 0 ? "#52c41a" : "#ff4d4f" }}>{quota.remaining_days} 天</Text></div>
            </div>
            {isAdmin && (
              <Space size={8}>
                <Text type="secondary" style={{ fontSize: 12 }}>设置年假额度（天）：</Text>
                <InputNumber size="small" min={0} step={0.5} value={quotaEditing ?? undefined} onChange={(v) => setQuotaEditing(v)} />
                <Button size="small" type="primary" loading={savingQuota} onClick={saveQuota}>保存</Button>
                <Text type="secondary" style={{ fontSize: 12 }}>年假请假按小时扣减（8小时 = 1天）</Text>
              </Space>
            )}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无年假额度数据" />
        )}
      </Card>

      <Card size="small" title="验证码手机号绑定" style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          绑定手机号后，安卓机短信转发（SmsForwarder）推送的验证码才会关联到你的账号。
        </Text>
        <Form
          form={bindForm}
          layout="inline"
          style={{ marginBottom: 12 }}
          onFinish={async (v) => {
            await oaApi.bindPhone(v);
            message.success("绑定成功");
            bindForm.resetFields();
            load();
          }}
        >
          <Form.Item name="phone" rules={[{ required: true, message: "请输入手机号" }, { pattern: /^\d{11}$/, message: "请输入11位手机号" }]}>
            <Input placeholder="手机号" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">绑定</Button>
          </Form.Item>
        </Form>
        {bindings.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无绑定" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            dataSource={bindings}
            pagination={false}
            columns={[
              { title: "手机号", dataIndex: "phone" },
              { title: "绑定人", dataIndex: "username", render: (v) => v || user?.username || "—" },
              {
                title: "操作",
                width: 80,
                render: (_, record) => (
                  <Popconfirm title="确认解绑？" onConfirm={async () => { await oaApi.unbindPhone(record.id); message.success("已解绑"); load(); }}>
                    <Button size="small" danger>解绑</Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

// ==================== 通用清单（数据库分类的其他板块） ====================

// ==================== 加班申请 ====================

function OvertimeModule() {
  const [form] = Form.useForm();
  const [mine, setMine] = useState<any[]>([]);
  const [all, setAll] = useState<any[]>([]);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "administrator";

  const load = useCallback(async () => {
    try { const r: any = await oaApi.listOvertimes("mine"); setMine(r?.data?.data || []); } catch { setMine([]); }
    if (isAdmin) {
      try { const r: any = await oaApi.listOvertimes("all"); setAll(r?.data?.data || []); } catch { setAll([]); }
    }
  }, [isAdmin]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const v = await form.validateFields();
    await oaApi.createOvertime({ ...v });
    message.success("加班申请已提交");
    form.resetFields();
    load();
  };

  const review = async (id: number, status: "已通过" | "已驳回") => {
    let note = "";
    if (status === "已驳回") note = window.prompt("请输入驳回原因（可选）") || "";
    await oaApi.reviewOvertime(id, { status, approve_note: note });
    message.success(status === "已通过" ? "已通过" : "已驳回");
    load();
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card size="small" title="申请加班">
        <Form form={form} layout="vertical" style={{ maxWidth: 520 }}>
          <Form.Item name="start_at" label="开始时间" rules={[{ required: true, message: "请选择开始时间" }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="end_at" label="结束时间" rules={[{ required: true, message: "请选择结束时间" }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="duration" label="时长（小时）" rules={[{ required: true, message: "请填写时长" }]}>
            <InputNumber min={0.5} step={0.5} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reason" label="加班事由" rules={[{ required: true, message: "请填写事由" }]}>
            <TextArea rows={3} placeholder="请填写加班原因" />
          </Form.Item>
          <Button type="primary" onClick={submit}>提交申请</Button>
        </Form>
      </Card>
      <Card size="small" title="我的加班记录">
        <Table
          size="small"
          rowKey="id"
          dataSource={mine}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "开始", dataIndex: "start_at", width: 150 },
            { title: "结束", dataIndex: "end_at", width: 150 },
            { title: "时长(h)", dataIndex: "duration", width: 80 },
            { title: "事由", dataIndex: "reason", ellipsis: true },
            { title: "状态", dataIndex: "status", width: 90, render: (s: string) => statusTag(s) },
            { title: "备注", dataIndex: "approve_note", ellipsis: true },
          ]}
        />
      </Card>
      {isAdmin && (
        <Card size="small" title="全部加班申请（管理员）">
          <Table
            size="small"
            rowKey="id"
            dataSource={all}
            pagination={{ pageSize: 8 }}
            columns={[
              { title: "申请人", dataIndex: "username", width: 100 },
              { title: "开始", dataIndex: "start_at", width: 150 },
              { title: "结束", dataIndex: "end_at", width: 150 },
              { title: "时长(h)", dataIndex: "duration", width: 80 },
              { title: "事由", dataIndex: "reason", ellipsis: true },
              { title: "状态", dataIndex: "status", width: 90, render: (s: string) => statusTag(s) },
              {
                title: "操作", width: 130,
                render: (_: any, it: any) => it.status === "待审批" ? (
                  <Space size={4}>
                    <Button size="small" type="primary" onClick={() => review(it.id, "已通过")}>通过</Button>
                    <Button size="small" danger onClick={() => review(it.id, "已驳回")}>驳回</Button>
                  </Space>
                ) : <Text type="secondary" style={{ fontSize: 12 }}>{it.approve_note || "—"}</Text>,
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

// ==================== 报销申请 ====================

/** 报销费用明细展开展示（含下午茶推送的账目明细） */
function ReimbDetails({ details }: { details?: any }) {
  if (!Array.isArray(details) || details.length === 0) return null;
  return (
    <div style={{ fontSize: 12, lineHeight: 1.9 }}>
      {details.map((d: any, i: number) => (
        <div key={i}>
          <Text type="secondary">{d.date || "—"}｜</Text>
          {d.content || d.name || "—"}
          <Text strong style={{ marginLeft: 8, color: "#fa541c" }}>¥{Number(d.amount || 0).toFixed(2)}</Text>
        </div>
      ))}
    </div>
  );
}

function ReimbursementModule() {
  const [form] = Form.useForm();
  const [mine, setMine] = useState<any[]>([]);
  const [all, setAll] = useState<any[]>([]);
  const [editItem, setEditItem] = useState<any>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "administrator";

  const load = useCallback(async () => {
    try { const r: any = await oaApi.listReimbursements("mine"); setMine(r?.data?.data || []); } catch { setMine([]); }
    if (isAdmin) {
      try { const r: any = await oaApi.listReimbursements("all"); setAll(r?.data?.data || []); } catch { setAll([]); }
    }
  }, [isAdmin]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const v = await form.validateFields();
    const details = (v.details || []).filter((d: any) => d && d.content)
      .map((d: any) => ({ ...d, date: d.date ? dayjs(d.date).format("YYYY-MM-DD") : "" }));
    const total = details.reduce((s: number, d: any) => s + Number(d.amount || 0), 0);
    await oaApi.createReimbursement({ ...v, details, total });
    message.success("报销申请已提交");
    form.resetFields();
    load();
  };

  const review = async (id: number, status: "已通过" | "已驳回") => {
    let note = "";
    if (status === "已驳回") note = window.prompt("请输入驳回原因（可选）") || "";
    await oaApi.reviewReimbursement(id, { status, approve_note: note });
    message.success(status === "已通过" ? "已通过" : "已驳回");
    load();
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card size="small" title="发起报销">
        <Form form={form} layout="vertical" style={{ maxWidth: 640 }}>
          <Form.Item name="type" label="报销类型" rules={[{ required: true, message: "请选择类型" }]}>
            <Select options={["差旅报销", "办公用品", "招待费", "交通费", "其他"].map((t) => ({ value: t, label: t }))} placeholder="选择报销类型" />
          </Form.Item>
          <Form.Item name="details" label="费用明细" rules={[{ required: true, message: "请添加至少一条明细" }]}>
            <Form.List name="details">
              {(fields, { add, remove }) => (
                <div style={{ display: "grid", gap: 8 }}>
                  {fields.map((f) => (
                    <Space key={f.key} align="baseline" style={{ display: "flex" }}>
                      <Form.Item name={[f.name, "content"]} noStyle rules={[{ required: true, message: "必填" }]}>
                        <Input placeholder="费用名目" style={{ width: 160 }} />
                      </Form.Item>
                      <Form.Item name={[f.name, "date"]} noStyle rules={[{ required: true, message: "必填" }]}>
                        <DatePicker style={{ width: 130 }} />
                      </Form.Item>
                      <Form.Item name={[f.name, "amount"]} noStyle rules={[{ required: true, message: "必填" }]}>
                        <InputNumber min={0} placeholder="金额" style={{ width: 100 }} />
                      </Form.Item>
                      <Button size="small" type="text" danger onClick={() => remove(f.name)} icon={<Trash2 size={14} />} />
                    </Space>
                  ))}
                  <Button size="small" type="dashed" onClick={() => add()} icon={<Plus size={14} />} style={{ width: 120 }}>添加明细</Button>
                </div>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="reason" label="报销事由" rules={[{ required: true, message: "请填写事由" }]}>
            <TextArea rows={3} placeholder="请填写报销原因" />
          </Form.Item>
          <Button type="primary" onClick={submit}>提交报销申请</Button>
        </Form>
      </Card>
      <Card size="small" title="我的报销记录">
        <Table
          size="small"
          rowKey="id"
          dataSource={mine}
          pagination={{ pageSize: 8 }}
          expandable={{
            expandedRowRender: (r: any) => <ReimbDetails details={r.details} />,
            rowExpandable: (r: any) => Array.isArray(r.details) && r.details.length > 0,
          }}
          columns={[
            { title: "类型", dataIndex: "type", width: 100 },
            { title: "金额", dataIndex: "total", width: 100, render: (v: number) => `¥${v}` },
            { title: "事由", dataIndex: "reason", ellipsis: true },
            { title: "状态", dataIndex: "status", width: 90, render: (s: string) => statusTag(s) },
            { title: "备注", dataIndex: "approve_note", ellipsis: true },
            {
              title: "操作", width: 90,
              render: (_: any, it: any) => it.status === "待审批" ? (
                <a onClick={() => setEditItem(it)}>编辑</a>
              ) : null,
            },
          ]}
        />
      </Card>
      {isAdmin && (
        <Card size="small" title="全部报销申请（管理员）">
          <Table
            size="small"
            rowKey="id"
            dataSource={all}
            pagination={{ pageSize: 8 }}
            expandable={{
              expandedRowRender: (r: any) => <ReimbDetails details={r.details} />,
              rowExpandable: (r: any) => Array.isArray(r.details) && r.details.length > 0,
            }}
            columns={[
              { title: "申请人", dataIndex: "username", width: 100 },
              { title: "类型", dataIndex: "type", width: 100 },
              { title: "金额", dataIndex: "total", width: 100, render: (v: number) => `¥${v}` },
              { title: "事由", dataIndex: "reason", ellipsis: true },
              { title: "状态", dataIndex: "status", width: 90, render: (s: string) => statusTag(s) },
              {
                title: "操作", width: 130,
                render: (_: any, it: any) => it.status === "待审批" ? (
                  <Space size={4}>
                    <Button size="small" type="primary" onClick={() => review(it.id, "已通过")}>通过</Button>
                    <Button size="small" danger onClick={() => review(it.id, "已驳回")}>驳回</Button>
                  </Space>
                ) : <Text type="secondary" style={{ fontSize: 12 }}>{it.approve_note || "—"}</Text>,
              },
            ]}
          />
        </Card>
      )}
      <Modal
        title="编辑报销申请"
        open={!!editItem}
        onCancel={() => setEditItem(null)}
        onOk={async () => {
          await oaApi.updateReimbursement(editItem.id, {
            type: editItem.type, reason: editItem.reason, total: editItem.total, details: editItem.details,
          });
          message.success("已更新");
          setEditItem(null);
          load();
        }}
      >
        {editItem && (
          <div style={{ display: "grid", gap: 12 }}>
            <Input value={editItem.type} onChange={(e) => setEditItem({ ...editItem, type: e.target.value })} placeholder="报销类型" />
            <TextArea value={editItem.reason} rows={3} onChange={(e) => setEditItem({ ...editItem, reason: e.target.value })} placeholder="报销事由" />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>金额总额</Text>
              <InputNumber value={editItem.total} onChange={(v) => setEditItem({ ...editItem, total: v ?? 0 })} style={{ width: "100%", marginTop: 4 }} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ==================== 岗位招新申请 ====================

function HiringRequestModule() {
  const [form] = Form.useForm();
  const [mine, setMine] = useState<any[]>([]);
  const [all, setAll] = useState<any[]>([]);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "administrator";

  const load = useCallback(async () => {
    try { const r: any = await oaApi.listHiringRequests("mine"); setMine(r?.data?.data || []); } catch { setMine([]); }
    if (isAdmin) {
      try { const r: any = await oaApi.listHiringRequests("all"); setAll(r?.data?.data || []); } catch { setAll([]); }
    }
  }, [isAdmin]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const v = await form.validateFields();
    await oaApi.createHiringRequest({ ...v });
    message.success("招新申请已提交，已通知管理层");
    form.resetFields();
    load();
  };

  const review = async (id: number, status: "已通过" | "已驳回") => {
    let note = "";
    if (status === "已驳回") note = window.prompt("请输入驳回原因（可选）") || "";
    await oaApi.reviewHiringRequest(id, { status, approve_note: note });
    message.success(status === "已通过" ? "已通过，招聘任务已自动创建" : "已驳回");
    load();
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card size="small" title="发起岗位招新申请">
        <Form form={form} layout="vertical" style={{ maxWidth: 520 }}>
          <Form.Item name="position_name" label="岗位名称" rules={[{ required: true, message: "请填写岗位名称" }]}>
            <Input placeholder="例如：RPA 实施工程师" />
          </Form.Item>
          <Form.Item name="department" label="所属部门">
            <Input placeholder="例如：交付部" />
          </Form.Item>
          <Form.Item name="headcount" label="需求人数" rules={[{ required: true, message: "请填写人数" }]}>
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="expected_date" label="期望到岗日期">
            <DatePicker format="YYYY-MM-DD" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="requirement" label="岗位要求">
            <TextArea rows={3} placeholder="学历、经验、技能要求等" />
          </Form.Item>
          <Form.Item name="reason" label="申请原因">
            <TextArea rows={2} placeholder="为什么要新增/补充该岗位" />
          </Form.Item>
          <Button type="primary" onClick={submit}>提交申请</Button>
        </Form>
      </Card>
      <Card size="small" title="我的招新申请">
        <Table
          size="small"
          rowKey="id"
          dataSource={mine}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: "岗位", dataIndex: "position_name", width: 160 },
            { title: "部门", dataIndex: "department", width: 110 },
            { title: "人数", dataIndex: "headcount", width: 70 },
            { title: "期望到岗", dataIndex: "expected_date", width: 110 },
            { title: "状态", dataIndex: "status", width: 90, render: (s: string) => statusTag(s) },
            { title: "备注", dataIndex: "approve_note", ellipsis: true },
          ]}
        />
      </Card>
      {isAdmin && (
        <Card size="small" title="全部招新申请（管理员）">
          <Table
            size="small"
            rowKey="id"
            dataSource={all}
            pagination={{ pageSize: 8 }}
            columns={[
              { title: "申请人", dataIndex: "username", width: 100 },
              { title: "岗位", dataIndex: "position_name", width: 160 },
              { title: "部门", dataIndex: "department", width: 110 },
              { title: "人数", dataIndex: "headcount", width: 70 },
              { title: "要求", dataIndex: "requirement", ellipsis: true },
              { title: "状态", dataIndex: "status", width: 90, render: (s: string) => statusTag(s) },
              {
                title: "操作", width: 130,
                render: (_: any, it: any) => it.status === "待审批" ? (
                  <Space size={4}>
                    <Button size="small" type="primary" onClick={() => review(it.id, "已通过")}>通过</Button>
                    <Button size="small" danger onClick={() => review(it.id, "已驳回")}>驳回</Button>
                  </Space>
                ) : <Text type="secondary" style={{ fontSize: 12 }}>{it.approve_note || "—"}</Text>,
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

// ==================== 下午茶点单 ====================

const TEA_BRANDS = ["喜茶", "霸王茶姬", "瑞幸咖啡", "沪上阿姨", "古茗", "茶百道", "奈雪的茶", "CoCo都可", "蜜雪冰城"];

const TEA_FALLBACK: Record<string, { name: string; price: number; description?: string }[]> = {
  "喜茶": [
    { name: "多肉葡萄", price: 29, description: "芝士茶经典款" },
    { name: "芝芝莓莓", price: 29, description: "草莓芝士茶" },
    { name: "椰椰芒芒", price: 25, description: "椰乳芒果茶" },
    { name: "烤黑糖波波牛乳", price: 24, description: "波波牛乳系列" },
  ],
  "霸王茶姬": [
    { name: "伯牙绝弦", price: 17, description: "茉莉雪芽轻乳茶" },
    { name: "桂花乌龙", price: 16, description: "桂花香轻乳茶" },
    { name: "青青糯山", price: 16, description: "糯米香轻乳茶" },
    { name: "万里木兰", price: 17, description: "原叶鲜奶茶" },
  ],
  "瑞幸咖啡": [
    { name: "生椰拿铁", price: 13, description: "经典椰香拿铁" },
    { name: "丝绒拿铁", price: 15, description: "丝绒质感拿铁" },
    { name: "冰吸生椰拿铁", price: 13, description: "夏日限定" },
    { name: "美式", price: 10, description: "经典美式咖啡" },
  ],
  "沪上阿姨": [
    { name: "血糯米奶茶", price: 14, description: "招牌奶茶" },
    { name: "五谷茶乳", price: 15, description: "五谷杂粮茶乳" },
    { name: "茶仙露", price: 13, description: "鲜果茶" },
    { name: "厚芋泥波波", price: 16, description: "芋泥系列" },
  ],
  "古茗": [
    { name: "超A芝士葡萄", price: 16, description: "芝士果茶" },
    { name: "轻乳茶", price: 12, description: "清香轻乳茶" },
    { name: "珍珠奶茶", price: 12, description: "经典奶茶" },
    { name: "百香双响炮", price: 13, description: "水果茶" },
  ],
  "茶百道": [
    { name: "豆乳玉麒麟", price: 14, description: "豆乳奶茶" },
    { name: "杨枝甘露", price: 17, description: "经典杨枝甘露" },
    { name: "乌漆嘛黑", price: 14, description: "桑葚茶饮" },
  ],
  "奈雪的茶": [
    { name: "霸气玉油柑", price: 19, description: "油柑鲜果茶" },
    { name: "霸气芝士草莓", price: 22, description: "芝士鲜果茶" },
    { name: "茉莉初雪", price: 15, description: "轻乳茶" },
  ],
  "CoCo都可": [
    { name: "三兄弟", price: 13, description: "珍珠布丁鲜奶" },
    { name: "鲜芋青稞牛奶", price: 14, description: "芋泥系列" },
    { name: "百香双响炮", price: 12, description: "水果茶" },
  ],
  "蜜雪冰城": [
    { name: "冰鲜柠檬水", price: 4, description: "经典柠檬水" },
    { name: "珍珠奶茶", price: 6, description: "经典奶茶" },
    { name: "摩天轮脆脆冰淇淋", price: 3, description: "冰淇淋" },
  ],
};

// 通用规格选项（抓包数据未入库规格字段，先用通用选项兜底；菜单项若带 specs 字段则优先使用）
const TEA_SWEETNESS = ["正常糖", "九分糖", "七分糖", "五分糖", "三分糖", "无糖"];
const TEA_ICE = ["正常冰", "少冰", "去冰", "常温", "热饮"];

function TeaModule() {
  const [menus, setMenus] = useState<{ menus: Record<string, any[]>; sources: Record<string, string> }>({ menus: {}, sources: {} });
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [cart, setCart] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<"order" | "mine" | "all">("order");
  const [showMine, setShowMine] = useState(false);
  const [openDay, setOpenDay] = useState<string>(dayjs().format("YYYY-MM-DD"));
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrlList, setImportUrlList] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importJson, setImportJson] = useState("");
  const [importBrand, setImportBrand] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "administrator";

  const loadMenus = useCallback(async () => {
    setLoading(true);
    try {
      const r: any = await oaApi.loadTeaMenus();
      const d = r?.data?.data || {};
      setMenus({ menus: d.menus || {}, sources: d.sources || {} });
    } catch {
      setMenus({ menus: {}, sources: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    const scope = viewMode === "all" && isAdmin ? "all" : "mine";
    try {
      const r: any = await oaApi.listTeaOrders(scope);
      setOrders(r?.data?.data || []);
    } catch {
      setOrders([]);
    }
  }, [viewMode, isAdmin]);

  useEffect(() => { loadMenus(); }, [loadMenus]);
  useEffect(() => { if (viewMode !== "order") { loadOrders(); setShowMine(true); } }, [viewMode, loadOrders]);

  // 品牌 → 菜单（数据库优先，缺失时兜底菜单）
  const brandMenus = useMemo(() => {
    const db = (menus.menus?.[selectedBrand] || []).map((m: any) => ({
      name: m.name, price: m.price, description: m.desc || m.description || "",
      source: menus.sources?.[selectedBrand] || "ai",
    }));
    if (db.length > 0) return db;
    return (TEA_FALLBACK[selectedBrand] || []).map((m, i) => ({ ...m, id: `fb-${i}`, source: "ai" }));
  }, [menus, selectedBrand]);

  const brandList = useMemo(() => {
    const dbBrands = Object.keys(menus.menus || {});
    return Array.from(new Set([...dbBrands, ...TEA_BRANDS]));
  }, [menus]);

  const addToCart = (m: any) => {
    setCart((prev) => {
      const found = prev.find((c) => c.item === m.name && c.sweetness === (m.sweetnessOptions?.[0] || "七分糖") && c.ice === (m.iceOptions?.[0] || "正常冰"));
      if (found) return prev.map((c) => (c === found ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, {
        item: m.name,
        description: m.description || "",
        sweetness: m.sweetnessOptions?.[0] || "七分糖",
        ice: m.iceOptions?.[0] || "正常冰",
        sweetnessOptions: m.sweetnessOptions || null,
        iceOptions: m.iceOptions || null,
        spec: "标准",
        qty: 1,
        unit_price: Number(m.price) || 0,
      }];
    });
    message.success(`已加入购物车：${m.name}`);
  };

  // 提交时把甜度/冰量组合进 spec（后端 TeaOrderItem.spec 为单字符串字段）
  const buildCartPayload = () =>
    cart.map((c) => {
      const parts = [c.ice, c.sweetness].filter(Boolean);
      return {
        item: c.item,
        spec: parts.length ? parts.join("·") : "标准",
        qty: c.qty,
        unit_price: c.unit_price,
      };
    });

  const cartTotal = cart.reduce((s, c) => s + c.qty * c.unit_price, 0);

  const submitOrder = async () => {
    if (cart.length === 0) return;
    try {
      await oaApi.submitTeaOrder({ brand: selectedBrand, items: buildCartPayload() });
      message.success("点单提交成功，请等待统一下单");
      setCart([]);
      setShowMine(true);
      setViewMode("mine");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "提交失败，请稍后重试");
    }
  };

  const cancelOrder = async (id: number) => {
    await oaApi.cancelTeaOrder(id);
    message.success("已删除该点单");
    loadOrders();
  };

  // 后端返回平铺行（同一 order_no 一行一个商品），聚合为单 + 按天分组，新→旧排序
  const groupedByDay = useMemo(() => {
    const orderMap = new Map<string, any>();
    (orders || []).forEach((o: any) => {
      const g = orderMap.get(o.order_no);
      if (g) {
        g.items.push(o);
        g.total += Number(o.total || 0);
      } else {
        orderMap.set(o.order_no, {
          id: o.id,
          order_no: o.order_no,
          username: o.username,
          brand: o.brand,
          status: o.status,
          created_at: o.created_at,
          note: o.note,
          items: [o],
          total: Number(o.total || 0),
        });
      }
    });
    const dayMap = new Map<string, any[]>();
    Array.from(orderMap.values())
      .sort((a: any, b: any) => (b.created_at || "").localeCompare(a.created_at || ""))
      .forEach((g: any) => {
        const day = (g.created_at || "").slice(0, 10) || "未知日期";
        if (!dayMap.has(day)) dayMap.set(day, []);
        dayMap.get(day)!.push(g);
      });
    return Array.from(dayMap.entries());
  }, [orders]);

  const finishOrder = async (id: number) => {
    await oaApi.finishTeaOrder(id);
    message.success("已标记为已完成");
    loadOrders();
  };

  // 推送账目明细：只推送今天的点单，汇总生成报销申请，交财务管理员审批
  const pushToFinance = () => {
    const today = dayjs().format("YYYY-MM-DD");
    const todayOrders = groupedByDay
      .filter(([day]: any) => day === today)
      .flatMap(([, ds]: any) => ds);
    if (todayOrders.length === 0) {
      message.warning("今天暂无点单记录，无法推送账目明细");
      return;
    }
    const total = todayOrders.reduce((s: number, o: any) => s + Number(o.total || 0), 0);
    const details = todayOrders.map((o: any) => {
      const items = (o.items || []).map((it: any) => `${it.qty}×${it.item}(${it.spec || "标准"})`).join("、");
      return {
        content: `${o.username || "—"}｜${o.brand}｜${items}`,
        date: today,
        amount: Number(o.total || 0),
      };
    });
    const detailText = details.map((d) => `${d.content}｜¥${d.amount.toFixed(2)}`).join("\n");
    Modal.confirm({
      title: "推送账目明细给财务管理员",
      width: 560,
      content: (
        <div style={{ fontSize: 13 }}>
          <div>今日共 {todayOrders.length} 单，合计 <Text type="danger" strong>¥{total.toFixed(2)}</Text></div>
          <div style={{ marginTop: 8, maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", background: "#fafafa", padding: 8, borderRadius: 6, fontSize: 12, lineHeight: 1.8 }}>
            {detailText}
          </div>
          <div style={{ marginTop: 8, color: "#8c8c8c" }}>将以「下午茶点单」类型生成报销申请，进入报销审批流程。</div>
        </div>
      ),
      okText: "确认推送",
      onOk: async () => {
        try {
          await oaApi.createReimbursement({
            type: "下午茶点单",
            reason: `${dayjs().format("YYYY-MM-DD")} 下午茶点单账目（今日共 ${todayOrders.length} 单）`,
            details,
            total: Number(total.toFixed(2)),
          });
          message.success("已推送账目明细，等待财务管理员审批");
        } catch (e: any) {
          message.error(e?.response?.data?.detail || "推送失败，请稍后重试");
        }
      },
    });
  };

  const showErrorDetail = (e: any) => {
    const detail = e?.response?.data?.detail || e?.message || "导入失败，请稍后重试";
    Modal.error({
      title: "导入失败",
      width: 580,
      content: (
        <div style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto", fontSize: 13, lineHeight: 1.8 }}>
          {typeof detail === "string" ? detail : JSON.stringify(detail)}
        </div>
      ),
    });
  };

  const submitImport = async () => {
    if (!importBrand.trim()) { message.warning("请先选择或输入品牌"); return; }
    setImportLoading(true);
    try {
      if (importUrlList.trim()) {
        const url_list = importUrlList.split(/\n+/).map((u) => u.trim()).filter((u) => u.startsWith("http"));
        if (url_list.length === 0) { message.warning("未识别到有效 URL（需以 http 开头）"); return; }
        await oaApi.importTeaMenuSmart({ brand: importBrand.trim(), url_list });
        message.success(`AI 识别导入成功：${importBrand}`);
      } else if (importUrl.trim()) {
        await oaApi.importTeaMenu({ brand: importBrand.trim(), url: importUrl.trim() });
        message.success(`URL 导入成功：${importBrand}`);
      } else if (importJson.trim()) {
        const items: any[] = [];
        const walk = (obj: any) => {
          if (!obj || typeof obj !== "object") return;
          if (Array.isArray(obj)) { obj.forEach(walk); return; }
          const name = obj.name || obj.productName || obj.itemName || obj.title;
          const price = obj.price ?? obj.showPriceLow ?? obj.salePrice ?? obj.sellPrice ?? obj.minPrice;
          if (typeof name === "string" && name && (price != null || obj.description)) {
            items.push({ name: name.trim(), price: Number(price) || 0, description: obj.description || "" });
          }
          Object.values(obj).forEach((v) => { if (v && typeof v === "object") walk(v); });
        };
        try { walk(JSON.parse(importJson)); } catch { message.error("响应 JSON 解析失败，请粘贴完整响应体"); return; }
        if (items.length === 0) { message.error("未在 JSON 中找到含名称/价格的饮品条目"); return; }
        await oaApi.importTeaMenu({ brand: importBrand.trim(), items });
        message.success(`导入成功：${importBrand} 共 ${items.length} 款`);
      } else {
        message.warning("请填写任一导入方式的内容");
        return;
      }
      setImportOpen(false);
      setImportUrlList(""); setImportUrl(""); setImportJson("");
      loadMenus();
    } catch (e: any) {
      showErrorDetail(e);
    } finally {
      setImportLoading(false);
    }
  };

  const refreshAI = async () => {
    setAiLoading(true);
    try {
      const r: any = await oaApi.refreshTeaMenus();
      const d = r?.data?.data || {};
      message.success(`AI 菜单更新完成：${d.updated ?? "—"}`);
      loadMenus();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "AI 更新失败");
    } finally {
      setAiLoading(false);
    }
  };

  const teaStickyStyle: React.CSSProperties = {
    position: "sticky", top: 0, zIndex: 20,
    margin: "-20px -20px 0",
    padding: "12px 20px 0",
    background: "rgba(255,255,255,0.96)",
    backdropFilter: "blur(8px)",
    borderBottom: "1px solid #f0f0f0",
  };

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 吸顶区：操作 + 品牌 */}
        <div style={teaStickyStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              选品牌 → 点饮品加入购物车 → 提交点单，统一汇总下单
            </Text>
            <Space size={8} style={{ marginLeft: "auto" }}>
              <Segmented
                value={viewMode}
                onChange={(v: any) => setViewMode(v)}
                options={[{ label: "点单", value: "order" }, { label: "我的点单", value: "mine" }, ...(isAdmin ? [{ label: "全部点单", value: "all" }] : [])]}
              />
              {isAdmin && (
                <>
                  <Button size="small" onClick={() => { setImportOpen(true); if (!importBrand && brandList.length) setImportBrand(brandList[0]); }}>
                    导入真实菜单
                  </Button>
                  <Button size="small" loading={aiLoading} onClick={refreshAI}>AI 更新菜单</Button>
                </>
              )}
              {viewMode === "order" && (
                <Button size="small" type="primary" onClick={() => setShowMine((s) => !s)} icon={<ClipboardList size={14} />}>
                  我的点单
                </Button>
              )}
            </Space>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 12px" }}>
            {brandList.map((b) => {
              const isReal = menus.sources?.[b] === "real";
              return (
                <div
                  key={b}
                  onClick={() => setSelectedBrand(b)}
                  style={{
                    padding: "7px 14px", borderRadius: 18, cursor: "pointer", fontSize: 13,
                    border: `1px solid ${selectedBrand === b ? "#3370ff" : "#e5e6eb"}`,
                    background: selectedBrand === b ? "#3370ff" : "#ffffff",
                    color: selectedBrand === b ? "#ffffff" : "#4e5969",
                    fontWeight: selectedBrand === b ? 600 : 400,
                  }}
                >
                  {b}
                  {isReal && <span style={{ marginLeft: 4, fontSize: 11 }}>✓</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* 菜单网格 */}
        <Spin spinning={loading}>
          {!selectedBrand && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先在上方选择品牌" style={{ marginTop: 60 }} />}
          {selectedBrand && brandMenus.length === 0 && !loading && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该品牌暂无菜单数据" style={{ marginTop: 60 }} />
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginTop: 12 }}>
            {brandMenus.map((m: any, idx: number) => (
              <Card
                key={`${m.id}-${idx}`}
                size="small"
                hoverable
                onClick={() => addToCart(m)}
                styles={{ body: { padding: 12 } }}
              >
                <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.name}
                </div>
                <div style={{ color: "#fa541c", fontSize: 15, fontWeight: 600, marginTop: 4 }}>¥{Number(m.price) || 0}</div>
                {m.description && (
                  <div style={{ color: "#8c8c8c", fontSize: 12, marginTop: 4, height: 32, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {m.description}
                  </div>
                )}
                <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Tag color={m.source === "real" ? "green" : "blue"} style={{ fontSize: 11, marginRight: 0 }}>
                    {m.source === "real" ? "已校准" : "AI 数据"}
                  </Tag>
                  <Plus size={16} color="#3370ff" />
                </div>
              </Card>
            ))}
          </div>
        </Spin>
      </div>

      {/* 右侧栏：购物车 / 点单记录（挤压布局，不遮盖菜单） */}
      {showMine && (
        <div style={{ width: 330, flexShrink: 0, borderLeft: "1px solid #f0f0f0", paddingLeft: 12 }}>
          {viewMode === "order" ? (
            <Card size="small" title={<span>购物车（{selectedBrand || "未选品牌"}）</span>} extra={<a onClick={() => setShowMine(false)}>收起</a>}>
              {cart.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击左侧饮品加入购物车" />}
              {cart.map((c, i) => {
                const sweetOpts = c.sweetnessOptions || TEA_SWEETNESS;
                const iceOpts = c.iceOptions || TEA_ICE;
                return (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Text strong style={{ fontSize: 13 }}>{c.item}</Text>
                    <Text type="danger" strong style={{ fontSize: 13 }}>¥{(c.qty * c.unit_price).toFixed(2)}</Text>
                    <Button size="small" type="text" danger icon={<Trash2 size={13} />} onClick={() => setCart(cart.filter((_, j) => j !== i))} />
                  </div>
                  {c.description && (
                    <div style={{ color: "#8c8c8c", fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{c.description}</div>
                  )}
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <Select
                      size="small"
                      value={c.ice}
                      onChange={(v) => setCart(cart.map((x, j) => (j === i ? { ...x, ice: v } : x)))}
                      options={iceOpts.map((s: string) => ({ label: s, value: s }))}
                      style={{ flex: 1 }}
                    />
                    <Select
                      size="small"
                      value={c.sweetness}
                      onChange={(v) => setCart(cart.map((x, j) => (j === i ? { ...x, sweetness: v } : x)))}
                      options={sweetOpts.map((s: string) => ({ label: s, value: s }))}
                      style={{ flex: 1 }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                    <Button size="small" onClick={() => setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>-</Button>
                    <span style={{ minWidth: 20, textAlign: "center" }}>{c.qty}</span>
                    <Button size="small" onClick={() => setCart(cart.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>+</Button>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: "auto" }}>¥{c.unit_price} × {c.qty}</Text>
                  </div>
                </div>
                );
              })}
              {cart.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 600 }}>
                    <span>合计</span><span style={{ color: "#fa541c" }}>¥{cartTotal}</span>
                  </div>
                  <Button type="primary" block style={{ marginTop: 10 }} disabled={!selectedBrand} onClick={submitOrder}>
                    提交点单
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <Card
              size="small"
              title={viewMode === "all" ? "全部点单（管理员）" : "我的点单"}
              extra={
                <Space size={8}>
                  {viewMode === "all" && (
                    <Button size="small" type="primary" disabled={orders.length === 0} onClick={pushToFinance}>
                      推送账目明细
                    </Button>
                  )}
                  <a onClick={() => setShowMine(false)}>收起</a>
                </Space>
              }
            >
              {orders.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无点单记录" />}
              {groupedByDay.length > 0 && (
                <Collapse
                  size="small"
                  activeKey={openDay}
                  onChange={(keys) => setOpenDay(Array.isArray(keys) ? keys[keys.length - 1] || "" : keys)}
                  items={groupedByDay.map(([day, dayOrders]: any) => ({
                    key: day,
                    label: (
                      <Space size={8}>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>{day === dayjs().format("YYYY-MM-DD") ? `${day}（今天）` : day}</span>
                        <Text type="secondary" style={{ fontSize: 12 }}>{dayOrders.length} 单</Text>
                        <Text strong style={{ fontSize: 12, color: "#fa541c" }}>
                          ¥{dayOrders.reduce((s: number, o: any) => s + Number(o.total || 0), 0).toFixed(1)}
                        </Text>
                      </Space>
                    ),
                    children: dayOrders.map((o: any) => {
                      // 我的点单 = 全部是自己的单；全部点单 = 管理员可管理所有单
                      const canManage = viewMode === "mine" || isAdmin;
                      return (
                      <div key={o.order_no} style={{ padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <Space wrap size={6}>
                            <Tag color="geekblue">{o.brand}</Tag>
                            <Text type="secondary" style={{ fontSize: 12 }}>{o.username || ""}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>{(o.created_at || "").slice(11, 16)}</Text>
                            {statusTag(o.status)}
                          </Space>
                        </div>
                        <div style={{ fontSize: 13, marginTop: 4 }}>
                          {(o.items || []).map((it: any, i: number) => {
                            const itemManageable = canManage && (it.status === "已下单" || it.status === "待下单");
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ flex: 1 }}>
                                  {it.qty} × {it.item}（{it.spec}） <Text type="secondary">¥{(it.qty * it.unit_price).toFixed(1)}</Text>
                                </span>
                                {itemManageable && (
                                  <>
                                    <Button size="small" type="text" style={{ padding: "0 4px" }} onClick={() => finishOrder(it.id)}>完成</Button>
                                    <Popconfirm title={`确定删除「${it.item}」？`} onConfirm={() => cancelOrder(it.id)}>
                                      <Button size="small" type="text" danger style={{ padding: "0 4px" }}>删除</Button>
                                    </Popconfirm>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {o.note && <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 4 }}>备注：{o.note}</div>}
                        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: "#fa541c" }}>合计 ¥{Number(o.total || 0).toFixed(1)}</div>
                      </div>
                      );
                    }),
                  }))}
                />
              )}
            </Card>
          )}
        </div>
      )}

      {/* 导入真实菜单弹窗 */}
      <Modal
        title="导入真实菜单"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        width={640}
        footer={[
          <Button key="cancel" onClick={() => setImportOpen(false)}>取消</Button>,
          <Button key="ok" type="primary" loading={importLoading} onClick={submitImport}>导入</Button>,
        ]}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <Collapse
            size="small"
            items={[{
              key: "guide",
              label: "导入方法说明（如何抓包获取菜单数据）",
              children: (
                <div style={{ fontSize: 13, lineHeight: 1.9 }}>
                  <div>1. 下载抓包工具 <a href="https://reqable.com/zh-CN/download/" target="_blank" rel="noreferrer">Reqable</a> 并安装</div>
                  <div>2. 打开 Reqable，确保顶部开关为「已启用」状态（本机抓包无需配证书）</div>
                  <div>3. 电脑微信打开目标品牌小程序（如喜茶/霸王茶姬），进入点单页面并下拉浏览</div>
                  <div>4. 回到 Reqable，在请求列表中找到菜单接口（域名含品牌关键词、响应含商品名和价格）</div>
                  <div>5. 判断方法：点击请求 → 「响应」标签 → JSON 里能搜到「拿铁」「奶茶」等品名</div>
                  <div>6. 方式一（URL）：右键请求 → 复制 URL，若响应是公开 JSON（如喜茶 CDN）直接导入成功</div>
                  <div>7. 方式三（推荐）：右键请求 → 复制响应体，粘贴到下方「粘贴响应 JSON」框</div>
                  <div>8. 全部 URL 列表也可以整包粘贴到方式一，系统会 AI 自动识别菜单接口</div>
                </div>
              ),
            }]}
          />
          <div>
            <Text strong style={{ fontSize: 13 }}>品牌</Text>
            <Select
              mode="tags" showSearch
              value={importBrand ? [importBrand] : []}
              onChange={(vals: string[]) => setImportBrand((vals[0] || "").slice(0, 50))}
              options={brandList.map((b) => ({ value: b, label: b }))}
              placeholder="点此下拉选择品牌；直接输入名称可导入新品牌"
              maxCount={1}
              optionFilterProp="label"
              style={{ width: "100%", marginTop: 6 }}
            />
          </div>
          <div>
            <Text strong style={{ fontSize: 13 }}>方式一：粘贴 URL 列表（AI 自动识别菜单接口）</Text>
            <TextArea
              rows={4}
              value={importUrlList}
              onChange={(e) => setImportUrlList(e.target.value)}
              placeholder="把 Reqable 里复制的 URL 列表整包粘贴进来（每行一个）"
              style={{ marginTop: 6 }}
            />
          </div>
          <div>
            <Text strong style={{ fontSize: 13 }}>方式二：单个菜单接口 URL（响应为公开 JSON 时）</Text>
            <Input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://static-cos-menu.example.com/menu.json?..."
              style={{ marginTop: 6 }}
            />
          </div>
          <div>
            <Text strong style={{ fontSize: 13 }}>方式三：粘贴响应 JSON（企迈系/登录态品牌推荐）</Text>
            <TextArea
              rows={6}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder="右键请求 → 复制响应体，完整粘贴；陌生格式将自动调用 AI 解析"
              style={{ marginTop: 6 }}
            />
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            三种方式按顺序自动择一执行；导入成功后该品牌标记为「已校准」，每周 AI 更新自动跳过。
          </Text>
        </div>
      </Modal>
    </div>
  );
}

function GenericChecklistModule({ category }: { category: string }) {
  const [groups, setGroups] = useState<{ group: string; items: any[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRobotApi.getTree();
      const cats: any[] = res?.data?.data?.categories || [];
      const cat = cats.find((c) => c.category === category);
      const g = Object.values(cat?.groups || {}).map((x: any) => ({ group: x.group || "", items: x.items || [] }));
      setGroups(g);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const v = await form.validateFields();
    await adminRobotApi.createItem({
      category,
      item_group: v.item_group || "",
      title: v.title,
      note: v.note,
      assignee: v.assignee,
    });
    message.success("事项已添加");
    setModalOpen(false);
    form.resetFields();
    load();
  };

  return (
    <Spin spinning={loading}>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
        <Text type="secondary">{category} · 事项清单</Text>
        <Button type="primary" onClick={() => setModalOpen(true)}>添加事项</Button>
      </div>
      {groups.length === 0 && <Empty description="暂无事项" />}
      {groups.map((g) => (
        <Card key={g.group || "default"} size="small" title={g.group || "事项"} style={{ marginBottom: 12 }}>
          {g.items.map((it) => (
            <div key={it.id} style={{ padding: "8px 0", borderBottom: "1px dashed #f0f0f0", display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Space wrap>
                <Text strong>{it.title}</Text>
                {it.assignee && <Tag color="blue">{it.assignee}</Tag>}
                {it.status && statusTag(it.status)}
                {it.note && <Text type="secondary" style={{ fontSize: 12 }}>{it.note}</Text>}
              </Space>
              <Popconfirm title="确认删除该事项？" onConfirm={async () => { await adminRobotApi.deleteItem(it.id); message.success("已删除"); load(); }}>
                <Button size="small" danger icon={<Trash2 size={13} />} />
              </Popconfirm>
            </div>
          ))}
        </Card>
      ))}
      <Modal title="添加事项" open={modalOpen} onOk={submit} onCancel={() => setModalOpen(false)} okText="添加" cancelText="取消">
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="事项" rules={[{ required: true, message: "请输入事项" }]}><Input /></Form.Item>
          <Form.Item name="item_group" label="分组（可选）"><Input /></Form.Item>
          <Form.Item name="assignee" label="负责人（可选）"><Input /></Form.Item>
          <Form.Item name="note" label="备注（可选）"><TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
}

// ==================== 离职申请（审批板块） ====================
function OffboardApplyModule() {
  const [askOpen, setAskOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fileList, setFileList] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [form] = Form.useForm();

  const submit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      // 上传离职申请附件（可选）
      let attUrl = "";
      let attName = "";
      if (fileList.length > 0 && fileList[0].originFileObj) {
        setUploading(true);
        try {
          const res = await oaApi.uploadResume(fileList[0].originFileObj);
          attUrl = res?.data?.data?.url || res?.data?.url || "";
          attName = fileList[0].name;
        } finally {
          setUploading(false);
        }
      }
      // 按层级通知：主管层→管理员层，基层→主管层（附件随通知传递）
      let notified = "";
      try {
        const r: any = await oaApi.offboardApply({
          reason: v.title,
          assignee: v.assignee,
          note: v.note,
          attachment_url: attUrl,
          attachment_name: attName,
        });
        notified = r?.data?.data?.notified || "";
      } catch {
        /* 通知失败不影响申请提交 */
      }
      message.success(notified ? `离职申请已提交，附件已随申请送达${notified}` : "离职申请已提交，请等待管理员审批");
      setFormOpen(false);
      setAskOpen(false);
      form.resetFields();
      setFileList([]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Spin spinning={uploading} tip="附件上传中...">
      <Card style={{ marginBottom: 16 }}>
        <div style={{ textAlign: "center", padding: "12px 0 16px" }}>
          <Text strong style={{ fontSize: 16 }}>离职申请</Text>
          <div style={{ margin: "8px auto 0", maxWidth: 560 }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              感谢您一直以来对团队的辛勤付出与陪伴。如果经过慎重考虑，您决定开启新的旅程，
              我们完全理解并尊重您的选择。点击下方按钮提交离职申请（可上传离职申请附件），
              我们会尽快安排专人跟进您的交接与离职事宜。
            </Text>
          </div>
          <Button type="primary" style={{ marginTop: 14 }} onClick={() => setAskOpen(true)}>
            申请离职
          </Button>
        </div>
      </Card>
      {/* 亲切语气的确认弹窗 */}
      <Modal
        open={askOpen}
        onCancel={() => setAskOpen(false)}
        footer={[
          <Button key="no" onClick={() => setAskOpen(false)}>再想想</Button>,
          <Button key="yes" type="primary" danger onClick={() => { setAskOpen(false); setFormOpen(true); }}>
            填写离职申请
          </Button>,
        ]}
      >
        <div style={{ textAlign: "center", padding: "10px 0" }}>
          <div style={{ fontSize: 40 }}>🤝</div>
          <Text strong style={{ fontSize: 15, display: "block", marginTop: 8 }}>真的决定要离开我们了吗？</Text>
          <Text type="secondary" style={{ fontSize: 13, display: "block", marginTop: 10 }}>
            这段时间谢谢您的努力与陪伴，团队真的非常舍不得您。
            如果您已经做好了决定，我们会尊重并祝福您的选择；
            如果只是一时困扰，也欢迎随时和上级或人事聊聊，也许事情并没有那么糟。
          </Text>
        </div>
      </Modal>
      {/* 离职申请表单 */}
      <Modal title="填写离职申请" open={formOpen} onOk={submit} confirmLoading={submitting || uploading} onCancel={() => setFormOpen(false)} okText="提交申请" cancelText="取消">
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="离职原因" rules={[{ required: true, message: "请填写离职原因" }]}>
            <TextArea rows={2} placeholder="请简单说明离职原因" />
          </Form.Item>
          <Form.Item name="assignee" label="交接负责人（可选）"><Input placeholder="请填写交接负责人姓名" /></Form.Item>
          <Form.Item name="note" label="备注（可选）"><TextArea rows={2} placeholder="期望离职日期或其他需要说明的事项" /></Form.Item>
          <Form.Item label="离职申请附件（可选）" extra="支持 PDF/图片/Word 等常见格式，附件将随申请一并送达主管或管理员">
            <Upload
              maxCount={1}
              fileList={fileList}
              beforeUpload={() => false}
              onRemove={() => setFileList([])}
              onChange={({ fileList: fl }: { fileList: any[] }) => setFileList(fl)}
            >
              <Button icon={<UploadIcon size={14} />}>选择附件</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
}

// ==================== 请假申请（审批板块，飞书式时长） ====================

// 请假类型 → 时长单位（仿飞书：事假/年假按小时，病假按天）
const LEAVE_UNITS: Record<string, "小时" | "天"> = {
  事假: "小时",
  病假: "天",
  年假: "小时",
  调休: "小时",
  婚假: "天",
  产假: "天",
  丧假: "天",
  其他: "天",
};

function LeaveRequestModule() {
  const [rows, setRows] = useState<any[]>([]);
  const [extMap, setExtMap] = useState<Record<number, string>>({});
  const [timeAtMap, setTimeAtMap] = useState<Record<number, { start: string; end: string }>>({});
  const [quota, setQuota] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "administrator";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await oaApi.listLeaves(isAdmin ? "all" : "mine");
      setRows(res?.data?.data || res?.data || []);
      const extRes: any = await oaApi.listLeaveExt();
      const m: Record<number, string> = {};
      const tm: Record<number, { start: string; end: string }> = {};
      for (const e of extRes?.data?.data || []) {
        m[e.leave_id] = `${e.duration}${e.unit}`;
        if (e.start_at || e.end_at) tm[e.leave_id] = { start: e.start_at || "", end: e.end_at || "" };
      }
      setExtMap(m);
      setTimeAtMap(tm);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    oaApi.getLeaveQuota().then((r: any) => setQuota(r?.data?.data || null)).catch(() => {});
  }, []);

  // 所选类型的时长单位
  const watchType = Form.useWatch("leave_type", form);
  const watchStart = Form.useWatch("startTime", form);
  const watchEnd = Form.useWatch("endTime", form);
  const unit = watchType ? LEAVE_UNITS[watchType] || "天" : "小时";
  // 自动计算时长（飞书式）：小时按分钟差折算（半小时粒度）；天=按8小时/天向上取整
  const autoDuration = useMemo(() => {
    if (!watchStart || !watchEnd) return null;
    const minutes = watchEnd.diff(watchStart, "minute");
    if (minutes <= 0) return null;
    if (unit === "天") return Math.max(1, Math.ceil(minutes / 480));
    const hours = Math.round((minutes / 60) * 2) / 2;
    return Math.max(0.5, hours);
  }, [watchStart, watchEnd, unit]);

  // 选好日期后自动带出时长（可手动修改）
  useEffect(() => {
    if (autoDuration != null) form.setFieldValue("duration", autoDuration);
  }, [autoDuration, form]);

  const submit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const start: string = v.startTime.format("YYYY-MM-DD");
      const end: string = v.endTime.format("YYYY-MM-DD");
      const startAt: string = v.startTime.format("YYYY-MM-DD HH:mm");
      const endAt: string = v.endTime.format("YYYY-MM-DD HH:mm");
      const duration = v.duration ?? autoDuration ?? 1;
      await oaApi.createLeave({
        leave_type: v.leave_type,
        start_date: start,
        end_date: end,
        reason: v.reason,
      });
      // 关联时长扩展（找到刚创建的请假单）
      try {
        const list: any = await oaApi.listLeaves("mine");
        const mine = list?.data?.data || list?.data || [];
        const latest = mine.find((r: any) => r.leave_type === v.leave_type && r.start_date === start && r.end_date === end);
        if (latest?.id) {
          await oaApi.saveLeaveExt({ leave_id: latest.id, duration: Number(duration), unit: LEAVE_UNITS[v.leave_type] || "天", start_at: startAt, end_at: endAt });
        }
      } catch {
        /* 时长关联失败不影响申请 */
      }
      message.success("请假申请已提交，等待审批");
      setOpen(false);
      form.resetFields();
      load();
      oaApi.getLeaveQuota().then((r: any) => setQuota(r?.data?.data || null)).catch(() => {});
    } finally {
      setSubmitting(false);
    }
  };

  const review = async (id: number, status: "已通过" | "已驳回") => {
    let note: string | undefined;
    if (status === "已驳回") {
      note = window.prompt("请输入驳回原因（可选）") || undefined;
    }
    await oaApi.reviewLeave(id, { status, approve_note: note });
    message.success(status === "已通过" ? "已通过该请假申请" : "已驳回该请假申请");
    load();
  };

  const leaveStatusTag = (s: string) => {
    const map: Record<string, { c: string; t: string }> = {
      待审批: { c: "orange", t: "待审批" },
      已通过: { c: "green", t: "已通过" },
      已驳回: { c: "red", t: "已驳回" },
    };
    const m = map[s] || { c: "default", t: s };
    return <Tag color={m.c}>{m.t}</Tag>;
  };

  const typeColor: Record<string, string> = { 事假: "blue", 病假: "red", 年假: "green", 调休: "cyan", 婚假: "purple", 产假: "magenta", 丧假: "gray", 其他: "default" };

  return (
    <Spin spinning={loading}>
      {/* 飞书式额度概览 */}
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Space size={16}>
          {quota && (
            <>
              <Text type="secondary">本年度年假：</Text>
              <Text strong style={{ color: "#3370ff" }}>总额度 {quota.annual_days} 天</Text>
              <Text type="secondary">已休 {quota.used_days} 天</Text>
              <Text strong style={{ color: quota.remaining_days > 0 ? "#52c41a" : "#ff4d4f" }}>剩余 {quota.remaining_days} 天</Text>
            </>
          )}
        </Space>
        <Button type="primary" onClick={() => setOpen(true)}>申请请假</Button>
      </div>
      <Table
        rowKey="id"
        size="small"
        dataSource={rows}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        columns={[
          ...(isAdmin ? [{ title: "申请人", dataIndex: "nickname", width: 100, render: (v: string, r: any) => v || r.username }] : []),
          { title: "请假类型", dataIndex: "leave_type", width: 100, render: (v: string) => <Tag color={typeColor[v] || "default"}>{v}</Tag> },
          { title: "时长", width: 90, render: (_: any, r: any) => extMap[r.id] ? <Text strong>{extMap[r.id]}</Text> : "—" },
          { title: "开始时间", dataIndex: "start_date", width: 150, render: (v: string, r: any) => timeAtMap[r.id]?.start || v },
          { title: "结束时间", dataIndex: "end_date", width: 150, render: (v: string, r: any) => timeAtMap[r.id]?.end || v },
          { title: "事由", dataIndex: "reason", ellipsis: true, render: (v: string) => v || "—" },
          { title: "状态", dataIndex: "status", width: 90, render: (v: string) => leaveStatusTag(v) },
          { title: "审批人", dataIndex: "approver", width: 90, render: (v: string) => v || "—" },
          ...(isAdmin
            ? [
                {
                  title: "操作",
                  width: 130,
                  render: (_: any, r: any) =>
                    r.status === "待审批" ? (
                      <Space size={4}>
                        <Button size="small" type="primary" onClick={() => review(r.id, "已通过")}>通过</Button>
                        <Button size="small" danger onClick={() => review(r.id, "已驳回")}>驳回</Button>
                      </Space>
                    ) : (
                      <Button size="small" danger icon={<Trash2 size={13} />} onClick={async () => { await oaApi.deleteLeave(r.id); message.success("已删除"); load(); }} />
                    ),
                },
              ]
            : []),
        ]}
      />
      <Modal title="申请请假" open={open} onOk={submit} confirmLoading={submitting} onCancel={() => setOpen(false)} okText="提交申请" cancelText="取消">
        <Form form={form} layout="vertical" initialValues={{ leave_type: "事假" }}>
          <Form.Item name="leave_type" label="请假类型" rules={[{ required: true, message: "请选择请假类型" }]}>
            <Select
              options={Object.keys(LEAVE_UNITS).map((t) => ({ value: t, label: t }))}
              placeholder="请选择"
            />
          </Form.Item>
          {watchType === "年假" && quota && (
            <Alert
              type={quota.remaining_days * 8 >= (autoDuration || 0) ? "info" : "warning"}
              showIcon
              style={{ marginBottom: 12 }}
              message={`本年度年假剩余 ${quota.remaining_days} 天（${quota.annual_days} 天额度，已休 ${quota.used_days} 天），时长以小时折算（8小时 = 1天）`}
            />
          )}
          <Form.Item name="startTime" label="开始时间" rules={[{ required: true, message: "请选择开始时间" }]}>
            <DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" minuteStep={30} style={{ width: "100%" }} placeholder="请选择开始时间" />
          </Form.Item>
          <Form.Item name="endTime" label="结束时间" rules={[{ required: true, message: "请选择结束时间" }]}>
            <DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" minuteStep={30} style={{ width: "100%" }} placeholder="请选择结束时间" />
          </Form.Item>
          <Form.Item name="duration" label="请假时长（自动计算可修改）" rules={[{ required: true, message: "请填写请假时长" }]}>
            <InputNumber style={{ width: 160 }} min={0.5} step={unit === "天" ? 1 : 0.5} addonAfter={unit} />
          </Form.Item>
          <Form.Item
            name="reason"
            label="请假事由"
            rules={[
              {
                validator: (_: any, v: string) => {
                  if (watchType === "事假" && (!v || v.trim().length < 10)) {
                    return Promise.reject("事假请假事由不得少于10个字，请详细说明");
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <TextArea rows={2} placeholder={watchType === "事假" ? "请填写请假事由（不少于10个字）" : "请填写请假事由（可选）"} />
          </Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
}

// ==================== 主页面 ====================

type SpecialKind = "recruit" | "announcement" | "supply" | "sms" | "leave" | null;

function specialKind(category: string): SpecialKind {
  if (category.includes("招聘")) return "recruit";
  if (category.includes("公告")) return "announcement";
  if (category.includes("耗材")) return "supply";
  if (category.includes("验证码")) return "sms";
  if (category.includes("请假")) return "leave";
  return null;
}

export default function OASystem() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#3370ff",
          colorInfo: "#3370ff",
          borderRadius: 8,
        },
      }}
    >
      <OASystemInner />
    </ConfigProvider>
  );
}

function OASystemInner() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState<string>("dashboard");
  const [categories, setCategories] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ hr: true, admin: true });

  useEffect(() => {
    (async () => {
      try {
        const res = await adminRobotApi.getTree();
        const cats: any[] = res?.data?.data?.categories || [];
        // 过滤数据库来源的「入职」分类，仅保留手动渲染的独立顶级入口
        setCategories(cats.map((c) => c.category).filter((n: string) => !n.includes("入职")));
      } catch {
        setCategories([]);
      }
    })();
  }, []);

  // 六大板块导航：人事管理（招聘/入职/离职）、行政管理（固定五项）、绩效统计、审批板块、规章制度、企业文化建设
  const navSections: { key: string; label: string; icon: React.ReactNode; subs: { key: string; label: string }[] }[] = useMemo(
    () => [
      {
        key: "hr",
        label: "人事管理",
        icon: <Users size={16} />,
        subs: [
          { key: "sub:recruit", label: "招聘" },
          { key: "sub:onboard", label: "入职" },
          { key: "sub:social", label: "社保公积金缴纳情况" },
          { key: "sub:staff", label: "人员信息" },
          { key: "sub:profile", label: "个人中心" },
        ],
      },
      {
        key: "admin",
        label: "行政管理",
        icon: <LayoutGrid size={16} />,
        subs: [
          { key: "cat:外出团建", label: "外出团建" },
          { key: "cat:公司聚餐", label: "公司聚餐" },
          { key: "cat:下午茶", label: "下午茶" },
          { key: "cat:客人接待", label: "客人接待" },
          { key: "cat:公司耗材申请", label: "公司耗材申请" },
        ],
      },
      {
        key: "perf",
        label: "绩效统计",
        icon: <BarChart3 size={16} />,
        subs: [{ key: "sec:绩效统计", label: "绩效统计" }],
      },
      {
        key: "approval",
        label: "审批板块",
        icon: <ClipboardList size={16} />,
        subs: [
          { key: "sub:ap-offboard", label: "离职申请" },
          { key: "sub:ap-leave", label: "请假" },
          { key: "sub:ap-overtime", label: "加班申请" },
          { key: "sub:ap-outing", label: "外出" },
          { key: "sub:ap-expense", label: "报销" },
          { key: "sub:ap-hiring", label: "主管申请岗位招聘" },
        ],
      },
      {
        key: "policy",
        label: "规章制度",
        icon: <FileText size={16} />,
        subs: [{ key: "sec:规章制度", label: "规章制度" }],
      },
      {
        key: "culture",
        label: "企业文化建设",
        icon: <PartyPopper size={16} />,
        subs: [{ key: "sec:企业文化建设", label: "企业文化建设" }],
      },
    ],
    [],
  );

  const handleNavigate = (key: string) => {
    if (key === "__announcement__") {
      const cat = categories.find((n) => n.includes("公告"));
      if (cat) { setActive(`cat:${cat}`); return; }
    }
    if (key === "__leave__") {
      const cat = categories.find((n) => n.includes("请假"));
      if (cat) { setActive(`cat:${cat}`); return; }
    }
    setActive(key);
  };

  const currentLabel = useMemo(() => {
    for (const sec of navSections) {
      for (const s of sec.subs) {
        if (s.key === active) return s.label;
      }
    }
    return active === "dashboard" ? "工作台" : "";
  }, [active, navSections]);

  const renderContent = () => {
    if (active === "dashboard") return <DashboardModule onNavigate={handleNavigate} />;
    if (active === "sub:recruit") {
      return (
        <Tabs
          defaultActiveKey="position"
          items={[
            { key: "position", label: "招聘岗位", children: <PositionModule /> },
            { key: "interview", label: "面试", children: <InterviewModule /> },
            { key: "background", label: "背景调查", children: <BackgroundCheckModule /> },
            { key: "candidate", label: "候选", children: <CandidateModule /> },
          ]}
        />
      );
    }
    if (active === "sub:onboard") return <OnboardingModule />;
    if (active === "sub:ap-offboard") return <OffboardApplyModule />;
    if (active === "sub:ap-leave") return <LeaveRequestModule />;
    if (active === "sub:ap-overtime") return <OvertimeModule />;
    if (active === "sub:ap-outing") return <GenericChecklistModule category="外出" />;
    if (active === "sub:ap-expense") return <ReimbursementModule />;
    if (active === "sub:ap-hiring") return <HiringRequestModule />;
    if (active === "sub:social") return <SocialSecurityModule />;
    if (active === "sub:staff") return <StaffModule />;
    if (active === "sub:profile") return <PersonalCenterModule />;
    if (active.startsWith("sec:")) return <GenericChecklistModule category={active.slice(4)} />;
    if (active.startsWith("cat:")) {
      const category = active.slice(4);
      const kind = specialKind(category);
      if (kind === "announcement") return <AnnouncementModule />;
      if (kind === "supply") return <SupplyModule />;
      if (kind === "sms") return <SmsModule />;
      if (kind === "leave") return <LeaveModule />;
      if (category === "下午茶") return <TeaModule />;
      return <GenericChecklistModule category={category} />;
    }
    return <Empty description="请选择左侧板块" />;
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#f5f6f8" }}>
      {/* 侧边栏（飞书式白底） */}
      <div style={{ width: 220, background: "#ffffff", color: "#1f2329", flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid #e5e6eb" }}>
        <div style={{ padding: "18px 16px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #f0f1f5", color: "#3370ff" }}>
          <Building2 size={20} />
          <span style={{ fontSize: 16, fontWeight: 600, color: "#1f2329" }}>行政OA系统</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {/* 工作台 */}
          <div
            onClick={() => setActive("dashboard")}
            style={{
              margin: "2px 8px",
              padding: "9px 12px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderRadius: 8,
              background: active === "dashboard" ? "#eaf2ff" : "transparent",
              color: active === "dashboard" ? "#3370ff" : "#4e5969",
              fontWeight: active === "dashboard" ? 600 : 400,
              fontSize: 14,
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => { if (active !== "dashboard") e.currentTarget.style.background = "#f2f3f5"; }}
            onMouseLeave={(e) => { if (active !== "dashboard") e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ color: active === "dashboard" ? "#3370ff" : "#8f959e", display: "flex" }}><Home size={16} /></span>
            工作台
          </div>

          {/* 六大板块分组 */}
          {navSections.map((sec) => {
            const isOpen = !!expanded[sec.key];
            const secActive = sec.subs.some((s) => s.key === active);
            const single = sec.subs.length === 1;
            return (
              <div key={sec.key}>
                <div
                  onClick={() => {
                    if (single) setActive(sec.subs[0].key);
                    setExpanded((p) => ({ ...p, [sec.key]: !isOpen }));
                  }}
                  style={{
                    margin: "2px 8px",
                    padding: "9px 12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    borderRadius: 8,
                    background: secActive && !isOpen ? "#eaf2ff" : "transparent",
                    color: secActive ? "#3370ff" : "#1f2329",
                    fontWeight: 600,
                    fontSize: 14,
                    transition: "background 0.2s, color 0.2s",
                  }}
                  onMouseEnter={(e) => { if (!secActive) e.currentTarget.style.background = "#f2f3f5"; }}
                  onMouseLeave={(e) => { if (!secActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ color: secActive ? "#3370ff" : "#8f959e", display: "flex" }}>{sec.icon}</span>
                  <span style={{ flex: 1 }}>{sec.label}</span>
                  <span style={{ color: "#8f959e", fontSize: 12, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</span>
                </div>
                {isOpen &&
                  sec.subs.map((s) => {
                    const isActive = active === s.key;
                    return (
                      <div
                        key={s.key}
                        onClick={() => setActive(s.key)}
                        style={{
                          margin: "2px 8px 2px 28px",
                          padding: "8px 12px",
                          cursor: "pointer",
                          borderRadius: 8,
                          background: isActive ? "#eaf2ff" : "transparent",
                          color: isActive ? "#3370ff" : "#4e5969",
                          fontWeight: isActive ? 600 : 400,
                          fontSize: 13.5,
                          transition: "background 0.2s, color 0.2s",
                        }}
                        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "#f2f3f5"; }}
                        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                      >
                        {s.label}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid #f0f1f5" }}>
          <Button
            block
            icon={<LogOut size={14} />}
            style={{ color: "#4e5969", borderColor: "#e5e6eb" }}
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            退出登录
          </Button>
        </div>
      </div>

      {/* 主内容 */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #e5e6eb", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", flexShrink: 0 }}>
          <Text strong style={{ fontSize: 16 }}>
            {currentLabel || "行政OA系统"}
          </Text>
          <Space>
            <Text type="secondary">{user?.nickname || user?.username}</Text>
            <Button
              size="small"
              style={{ color: "#3370ff", borderColor: "#3370ff" }}
              onClick={() => navigate("/")}
            >
              返回系统
            </Button>
          </Space>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
