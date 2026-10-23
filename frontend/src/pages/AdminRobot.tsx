import React from "react";
import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Tag,
  Tooltip,
  Typography,
  message,
  Popconfirm,
} from "antd";
import { CalendarCheck, ClipboardList, Plus, UserRound } from "lucide-react";
import { adminRobotApi } from "../api";
import { useAuth } from "../contexts/AuthContext";

const { Title, Text } = Typography;

interface AdminItem {
  id: number;
  title: string;
  note?: string | null;
  assignee?: string | null;
  status: string;
}

interface AdminGroup {
  group: string;
  items: AdminItem[];
}

interface AdminCategory {
  category: string;
  groups: AdminGroup[];
  total: number;
  done: number;
}

const STATUS_OPTIONS = ["未开始", "进行中", "已完成"].map((v) => ({ value: v, label: v }));

const CATEGORY_ICONS: Record<string, string> = {
  招聘: "🧑‍💼",
  入职: "📋",
  解决公司内部需求: "🏢",
  完善公司规章制度事宜: "📖",
  离职: "👋",
};

const AdminRobot: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [categories, setCategories] = React.useState<AdminCategory[]>([]);
  const [total, setTotal] = React.useState(0);
  const [done, setDone] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [activeCat, setActiveCat] = React.useState<string>("");
  // 新增事项弹窗
  const [addOpen, setAddOpen] = React.useState(false);
  const [addCategory, setAddCategory] = React.useState("");
  const [addGroup, setAddGroup] = React.useState("");
  const [addTitle, setAddTitle] = React.useState("");
  const [addNote, setAddNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  // 负责人编辑
  const [assigneeEditId, setAssigneeEditId] = React.useState<number | null>(null);
  const [assigneeDraft, setAssigneeDraft] = React.useState("");

  const load = React.useCallback(() => {
    setLoading(true);
    adminRobotApi
      .getTree()
      .then((res) => {
        const d = res.data?.data;
        if (d) {
          setCategories(d.categories || []);
          setTotal(d.total || 0);
          setDone(d.done || 0);
          setActiveCat((prev) => prev || (d.categories?.[0]?.category ?? ""));
        }
      })
      .catch(() => message.error("加载行政事项失败"))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(load, [load]);

  const current = categories.find((c) => c.category === activeCat);

  const handleStatus = async (item: AdminItem, status: string) => {
    try {
      await adminRobotApi.updateItem(item.id, { status });
      setCategories((prev) =>
        prev.map((c) => {
          let delta = 0;
          const groups = c.groups.map((g) => ({
            ...g,
            items: g.items.map((it) => {
              if (it.id === item.id) {
                if (status === "已完成" && it.status !== "已完成") delta += 1;
                if (status !== "已完成" && it.status === "已完成") delta -= 1;
                return { ...it, status };
              }
              return it;
            }),
          }));
          return { ...c, groups, done: c.done + delta };
        }),
      );
      setDone((d) => d + (status === "已完成" ? 1 : 0) - (item.status === "已完成" ? 1 : 0));
    } catch {
      message.error("更新状态失败");
    }
  };

  const handleAssignee = async (item: AdminItem) => {
    setAssigneeEditId(null);
    if ((item.assignee || "") === assigneeDraft) return;
    try {
      await adminRobotApi.updateItem(item.id, { assignee: assigneeDraft || undefined });
      setCategories((prev) =>
        prev.map((c) => ({
          ...c,
          groups: c.groups.map((g) => ({
            ...g,
            items: g.items.map((it) => (it.id === item.id ? { ...it, assignee: assigneeDraft || null } : it)),
          })),
        })),
      );
      message.success("负责人已更新");
    } catch {
      message.error("更新负责人失败");
    }
  };

  const handleAdd = async () => {
    if (!addTitle.trim()) {
      message.warning("请输入事项标题");
      return;
    }
    setSaving(true);
    try {
      await adminRobotApi.createItem({
        category: addCategory || activeCat,
        item_group: addGroup,
        title: addTitle,
        note: addNote || undefined,
      });
      message.success("事项已添加");
      setAddOpen(false);
      setAddGroup("");
      setAddTitle("");
      setAddNote("");
      load();
    } catch {
      message.error("添加失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: AdminItem) => {
    try {
      await adminRobotApi.deleteItem(item.id);
      message.success("已删除");
      load();
    } catch {
      message.error("删除失败（仅管理员可删除）");
    }
  };

  return (
    <div style={{ padding: 24, background: "#f5f7fa", minHeight: "100%" }}>
      {/* 顶部：标题 + 总进度 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ClipboardList size={26} color="#1677ff" />
          <Title level={4} style={{ margin: 0 }}>行政机器人</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>行政人力资源官职责清单</Text>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 320 }}>
          <CalendarCheck size={18} color="#52c41a" />
          <Text style={{ whiteSpace: "nowrap" }}>
            总进度 <Text strong>{done}</Text>/{total}
          </Text>
          <Progress percent={total ? Math.round((done / total) * 100) : 0} style={{ flex: 1, marginBottom: 0 }} size="small" />
        </div>
      </div>

      <Row gutter={16}>
        {/* 左侧分类导航 */}
        <Col flex="220px">
          <Card bodyStyle={{ padding: 8 }} loading={loading}>
            {categories.map((c) => (
              <div
                key={c.category}
                onClick={() => setActiveCat(c.category)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  marginBottom: 4,
                  background: activeCat === c.category ? "#e6f4ff" : "transparent",
                  color: activeCat === c.category ? "#1677ff" : "inherit",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>
                  {CATEGORY_ICONS[c.category] || "📌"} {c.category}
                </span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {c.done}/{c.total}
                </Text>
              </div>
            ))}
          </Card>
        </Col>

        {/* 右侧事项列表 */}
        <Col flex="auto">
          <Card
            loading={loading}
            title={
              current ? (
                <span>
                  {CATEGORY_ICONS[current.category] || "📌"} {current.category}
                </span>
              ) : (
                "事项"
              )
            }
            extra={
              <Button
                type="primary"
                icon={<Plus size={16} />}
                onClick={() => {
                  setAddCategory(activeCat);
                  setAddOpen(true);
                }}
              >
                添加事项
              </Button>
            }
          >
            {!current ? (
              <Empty description="暂无分类" />
            ) : (
              current.groups.map((g) => (
                <div key={g.group} style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Tag color="blue">{g.group || "其他"}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>{g.items.length} 项</Text>
                  </div>
                  <Row gutter={[8, 8]}>
                    {g.items.map((it) => (
                      <Col xs={24} sm={12} lg={8} key={it.id}>
                        <div
                          style={{
                            border: "1px solid #f0f0f0",
                            borderRadius: 8,
                            padding: "8px 12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            background: it.status === "已完成" ? "#fafafa" : "#fff",
                            opacity: it.status === "已完成" ? 0.7 : 1,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                            <Text
                              strong
                              delete={it.status === "已完成"}
                              style={{ fontSize: 13, flex: 1 }}
                              ellipsis={{ tooltip: it.title }}
                            >
                              {it.title}
                            </Text>
                            <Select
                              size="small"
                              value={it.status}
                              options={STATUS_OPTIONS}
                              onChange={(v) => handleStatus(it, v)}
                              style={{ width: 92 }}
                            />
                          </div>
                          {it.note && (
                            <Tooltip title={it.note}>
                              <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                                💡 {it.note}
                              </Text>
                            </Tooltip>
                          )}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            {assigneeEditId === it.id ? (
                              <Input
                                size="small"
                                autoFocus
                                value={assigneeDraft}
                                placeholder="负责人姓名"
                                onChange={(e) => setAssigneeDraft(e.target.value)}
                                onBlur={() => handleAssignee(it)}
                                onPressEnter={() => handleAssignee(it)}
                                style={{ width: 120 }}
                              />
                            ) : (
                              <Tag
                                icon={<UserRound size={11} />}
                                style={{ cursor: "pointer", marginInlineEnd: 0 }}
                                onClick={() => {
                                  setAssigneeEditId(it.id);
                                  setAssigneeDraft(it.assignee || "");
                                }}
                              >
                                {it.assignee || "设置负责人"}
                              </Tag>
                            )}
                            {isAdmin && (
                              <Popconfirm title="确认删除该事项？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(it)}>
                                <Button type="text" size="small" danger style={{ height: 20, padding: 0 }}>
                                  删除
                                </Button>
                              </Popconfirm>
                            )}
                          </div>
                        </div>
                      </Col>
                    ))}
                  </Row>
                </div>
              ))
            )}
          </Card>
        </Col>
      </Row>

      {/* 新增事项弹窗 */}
      <Modal
        title="添加事项"
        open={addOpen}
        onOk={handleAdd}
        onCancel={() => setAddOpen(false)}
        confirmLoading={saving}
        okText="添加"
        cancelText="取消"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <Select
              value={addCategory}
              options={categories.map((c) => ({ value: c.category, label: c.category }))}
              onChange={setAddCategory}
              style={{ width: 200 }}
              placeholder="分类"
            />
            <Input value={addGroup} onChange={(e) => setAddGroup(e.target.value)} placeholder="分组（可选，如：入职资料）" />
          </div>
          <Input value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="事项标题（必填）" />
          <Input.TextArea value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="说明/备注（可选）" rows={3} />
        </div>
      </Modal>
    </div>
  );
};

export default AdminRobot;
