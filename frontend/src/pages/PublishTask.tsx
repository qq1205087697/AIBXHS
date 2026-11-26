import React, { useEffect, useState } from "react"
import {
  Card,
  Button,
  Form,
  Input,
  Select,
  DatePicker,
  Table,
  Tag,
  Space,
  Typography,
  Modal,
  message,
  Popconfirm,
  Progress,
} from "antd"
import {
  PlusOutlined,
  SendOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  TeamOutlined,
  GlobalOutlined,
} from "@ant-design/icons"
import dayjs from "dayjs"
import apiClient from "../api"
import { useAuth } from "../contexts/AuthContext"

const { Title, Text } = Typography
const { TextArea } = Input

interface TaskItem {
  id: number
  title: string
  description: string
  platforms: string[]
  assignees: string[]
  priority: string
  deadline: string
  created_at: string
  feedbacks: FeedbackItem[]
}

// 平台显示名映射（键统一小写）
const PLATFORM_LABELS: Record<string, string> = {
  amazon: "亚马逊",
  walmart: "沃尔玛",
  ebay: "eBay",
  shopee: "Shopee",
  lazada: "Lazada",
  temu: "Temu",
  aliexpress: "速卖通",
  shein: "SHEIN",
  tiktok: "TikTok",
  ozon: "Ozon",
  cdiscount: "Cdiscount",
  wildberries: "Wildberries",
}
// full/half 托管模式后缀
const PLATFORM_MODE_LABELS: Record<string, string> = {
  full: "全托管",
  half: "半托管",
}
const platformLabel = (p: string) => {
  const raw = (p || "").trim()
  // 拆分托管模式后缀：aliexpress_full → 速卖通（全托管）
  const [base, mode] = raw.split("_")
  const baseLabel = PLATFORM_LABELS[base.toLowerCase()] || base
  const modeLabel = mode ? PLATFORM_MODE_LABELS[mode.toLowerCase()] : undefined
  return modeLabel ? `${baseLabel}（${modeLabel}）` : baseLabel
}

// 演示兜底数据：接口失败时使用（真实数据来自 /store-groups/platform-owners，负责人携带 user_id）
const DEMO_PLATFORM_OWNERS: Record<string, { id: number; name: string }[]> = {
  amazon: [
    { id: 0, name: "张运营" },
    { id: 0, name: "李广告" },
    { id: 0, name: "陈运营" },
    { id: 0, name: "刘运营" },
    { id: 0, name: "王客服" },
    { id: 0, name: "赵美工" },
  ],
  walmart: [
    { id: 0, name: "孙梦琪" },
    { id: 0, name: "郑晓欧" },
  ],
  ebay: [{ id: 0, name: "林日和" }],
}

// 优先级前后端映射（前端 high/medium/low ↔ 后端 紧急/重要/普通）
const PRIO_TO_CN: Record<string, string> = { high: "紧急", medium: "重要", low: "普通" }
const CN_TO_PRIO: Record<string, string> = { 紧急: "high", 重要: "medium", 普通: "low" }
// 后端任务状态 → 前端反馈状态（未开始→未开始；发布时全部创建接收行，无"未反馈"态）
const ASSIGNEE_STATUS_MAP: Record<string, FeedbackItem["status"]> = {
  未开始: "received",
  进行中: "in_progress",
  已完成: "done",
}

// 优先级配置
const priorityConfig: Record<string, { color: string; label: string }> = {
  high: { color: "red", label: "紧急" },
  medium: { color: "orange", label: "重要" },
  low: { color: "blue", label: "普通" },
}

// 状态配置
const statusConfig: Record<string, { color: string; label: string }> = {
  pending: { color: "default", label: "待开始" },
  in_progress: { color: "processing", label: "进行中" },
  done: { color: "success", label: "已完成" },
}

// 反馈状态配置
interface FeedbackItem {
  name: string
  type: "platform" | "person"
  status: "done" | "in_progress" | "received" | "none"
  content: string
  time: string
  // 平台类型专用：平台下各店铺负责人的逐人反馈
  members?: FeedbackItem[]
}

const feedbackStatusConfig: Record<FeedbackItem["status"], { color: string; label: string }> = {
  done: { color: "success", label: "已完成" },
  in_progress: { color: "processing", label: "进行中" },
  received: { color: "cyan", label: "未开始" },
  none: { color: "default", label: "未反馈" },
}

// 平台级状态由各负责人反馈汇总：全部完成→已完成；有人未反馈→未反馈；有人进行中→进行中；否则→未开始
const aggregateGroupStatus = (members: FeedbackItem[]): FeedbackItem["status"] => {
  if (members.length === 0) return "none"
  if (members.every((m) => m.status === "done")) return "done"
  if (members.some((m) => m.status === "none")) return "none"
  if (members.some((m) => m.status === "in_progress")) return "in_progress"
  return "received"
}

// 反馈排序权重：未反馈最前提醒关注，已完成放最后
const feedbackSortWeight: Record<FeedbackItem["status"], number> = {
  none: 0,
  received: 1,
  in_progress: 2,
  done: 3,
}

// 反馈状态折算进度权重：已完成=100，进行中=50，未开始/未反馈=0
const feedbackProgressWeight: Record<FeedbackItem["status"], number> = {
  done: 100,
  in_progress: 50,
  received: 0,
  none: 0,
}

// 任务进度按反馈状态自动汇总：
// 人员条目按自身状态折算；平台条目取平台下各负责人折算值的平均；任务进度 = 全部条目的平均值
const computeTaskProgress = (task: TaskItem): number => {
  const fbs = task.feedbacks
  if (fbs.length === 0) return 0
  const sum = fbs.reduce((acc, fb) => {
    if (fb.type === "person") {
      return acc + feedbackProgressWeight[fb.status]
    }
    const members = fb.members || []
    if (members.length === 0) return acc
    const mSum = members.reduce((s, m) => s + feedbackProgressWeight[m.status], 0)
    return acc + mSum / members.length
  }, 0)
  return Math.round(sum / fbs.length)
}

// 任务状态由进度自动推导：0% → 待开始；100% → 已完成；其余 → 进行中
const deriveTaskStatus = (task: TaskItem): "pending" | "in_progress" | "done" => {
  const progress = computeTaskProgress(task)
  if (progress >= 100) return "done"
  if (progress > 0) return "in_progress"
  return "pending"
}

// 本地演示数据（后续可替换为接口数据）
const initialTasks: TaskItem[] = [
  {
    id: 1,
    title: "新品Listing文案优化",
    description: "整理A加店铺3款新品的核心卖点，输出英文Listing文案初稿",
    platforms: [],
    assignees: ["张运营", "赵美工"],
    priority: "high",
    deadline: "2026-11-06",
    created_at: "2026-11-02 10:30",
    feedbacks: [
      {
        name: "张运营",
        type: "person",
        status: "done",
        content: "3款新品的英文Listing文案初稿已完成，已上传共享文档，请查收审核。",
        time: "2026-11-03 16:20",
      },
      {
        name: "赵美工",
        type: "person",
        status: "in_progress",
        content: "主图设计已完成60%，预计明天上午可交付全部素材。",
        time: "2026-11-03 18:05",
      },
    ],
  },
  {
    id: 2,
    title: "广告数据周报汇总",
    description: "汇总本周各店铺广告花费与ACOS数据，输出周报",
    platforms: ["amazon"],
    assignees: [],
    priority: "medium",
    deadline: "2026-11-08",
    created_at: "2026-11-03 09:15",
    feedbacks: [
      {
        name: "amazon",
        type: "platform",
        status: "received",
        content: "",
        time: "2026-11-03 10:40",
        members: [
          {
            name: "李广告（组长）",
            type: "person",
            status: "received",
            content: "已代表小组接收任务，今日内拆解分配到组成员。",
            time: "2026-11-03 10:40",
          },
          {
            name: "陈运营",
            type: "person",
            status: "in_progress",
            content: "已领取A加、B美两个店铺的汇总工作，预计明天完成。",
            time: "2026-11-03 14:20",
          },
          {
            name: "刘运营",
            type: "person",
            status: "none",
            content: "",
            time: "",
          },
        ],
      },
    ],
  },
  {
    id: 3,
    title: "差评邮件跟进",
    description: "跟进近7天新增差评的3个订单，发送安抚邮件",
    platforms: ["amazon"],
    assignees: ["王客服"],
    priority: "high",
    deadline: "2026-11-04",
    created_at: "2026-11-01 14:00",
    feedbacks: [
      {
        name: "王客服",
        type: "person",
        status: "done",
        content: "3个差评订单的安抚邮件均已发送完毕，客户回复情况已记录在表格中。",
        time: "2026-11-02 17:30",
      },
      {
        name: "amazon",
        type: "platform",
        status: "none",
        content: "",
        time: "",
        members: [
          {
            name: "周客服",
            type: "person",
            status: "done",
            content: "分配给我的1个差评订单安抚邮件已发送，客户已回复。",
            time: "2026-11-02 17:30",
          },
          {
            name: "吴客服",
            type: "person",
            status: "in_progress",
            content: "剩余2个订单的跟进邮件正在整理中，今天下班前发出。",
            time: "2026-11-03 09:50",
          },
        ],
      },
    ],
  },
]

const PublishTask: React.FC = () => {
  const { user } = useAuth()
  // demo 账号（tenant_id=6 或用户名 demo）使用本地演示数据，不读写真实任务接口
  const isDemoUser =
    (user as { tenant_id?: number; username?: string } | null)?.tenant_id === 6 ||
    ((user as { username?: string } | null)?.username || "").toLowerCase() === "demo"
  const [tasks, setTasks] = useState<TaskItem[]>(isDemoUser ? initialTasks : [])
  // 真实用户首屏加载态：接口返回前表格显示转圈，不再用演示数据占位
  const [tasksLoading, setTasksLoading] = useState(!isDemoUser)
  const [modalOpen, setModalOpen] = useState(false)
  const [detailTask, setDetailTask] = useState<TaskItem | null>(null)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [form] = Form.useForm()
  // 平台列表与各平台店铺负责人（真实数据来自 /store-groups/platform-owners，失败时用演示数据）
  const [platforms, setPlatforms] = useState<string[]>(Object.keys(DEMO_PLATFORM_OWNERS))
  const [platformOwners, setPlatformOwners] = useState<Record<string, { id: number; name: string }[]>>(
    DEMO_PLATFORM_OWNERS
  )
  // 未分配店铺的用户（无平台归属，接口返回 unassigned_owners）
  const [unassignedOwners, setUnassignedOwners] = useState<{ id: number; name: string }[]>([])

  // 负责人姓名 → user_id 映射（落库时转换为接收人ID）
  const ownerNameToId: Record<string, number> = {}
  Object.values(platformOwners).forEach((owners) =>
    (owners || []).forEach((o) => {
      if (o.id > 0) ownerNameToId[o.name] = o.id
    })
  )
  unassignedOwners.forEach((o) => {
    if (o.id > 0) ownerNameToId[o.name] = o.id
  })

  // 加载平台与负责人数据
  useEffect(() => {
    let cancelled = false
    apiClient
      .get("/store-groups/platform-owners")
      .then((res) => {
        const data = res.data?.data
        if (!cancelled && data?.platforms?.length) {
          setPlatforms(data.platforms)
          if (data.platform_owners && Object.keys(data.platform_owners).length) {
            setPlatformOwners(data.platform_owners)
          }
          setUnassignedOwners(Array.isArray(data.unassigned_owners) ? data.unassigned_owners : [])
        }
      })
      .catch(() => {
        // 接口失败时保留演示数据
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 后端任务数据 → 前端 TaskItem（反馈按人逐条生成：状态映射 + 该人最新回复作为反馈内容）
  const mapApiTask = (t: Record<string, unknown>): TaskItem => {
    const assignees = (t.assignees as Record<string, unknown>[] | undefined) || []
    const replies = (t.replies as Record<string, unknown>[] | undefined) || []
    return {
      id: t.id as number,
      title: (t.subject as string) || "",
      description: (t.body as string) || "",
      platforms: Array.isArray(t.platforms) ? (t.platforms as string[]) : [],
      assignees: assignees.map((a) => (a.user_name as string) || "").filter(Boolean),
      priority: CN_TO_PRIO[t.priority as string] || "medium",
      deadline: ((t.deadline as string) || "").slice(0, 10) || "-",
      created_at: (t.created_at as string) || "",
      feedbacks: assignees.map((a) => {
        const name = (a.user_name as string) || ""
        const myReply = replies.filter((r) => r.sender_name === name).pop()
        return {
          name,
          type: "person" as const,
          status: ASSIGNEE_STATUS_MAP[a.status as string] || "received",
          content: (myReply?.content as string) || "",
          time:
            (a.completed_at as string) ||
            (myReply?.time as string) ||
            "",
        }
      }),
    }
  }

  // 加载我派发的任务列表（真实用户直接替换列表，接口失败显示错误提示；演示数据仅 demo 账号使用）
  const loadTasks = () => {
    if (isDemoUser) return
    setTasksLoading(true)
    apiClient
      .get("/tasks/published")
      .then((res) => {
        const data = res.data?.data
        setTasks(Array.isArray(data) ? data.map(mapApiTask) : [])
        setTasksLoading(false)
      })
      .catch(() => {
        setTasksLoading(false)
        message.error("任务列表加载失败，请点击刷新重试")
      })
  }

  useEffect(() => {
    loadTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemoUser])

  // 监听已选平台，用于负责人选项联动
  const selectedPlatforms: string[] = Form.useWatch("platforms", form) || []

  // 已选平台的全部店铺负责人姓名（去重）
  const selectedPlatformOwners = Array.from(
    new Set(selectedPlatforms.flatMap((p) => (platformOwners[p] || []).map((o) => o.name)))
  )
  const ownerSet = new Set(selectedPlatformOwners)

  // 负责人与店铺为一对多：同一负责人可能管理多个平台的店铺
  // 去重处理：已选平台合并时用 Set 去重；「其他负责人」按其所属的首个平台归组，避免重复出现
  const ownerPrimaryPlatform: Record<string, string> = {}
  Object.entries(platformOwners).forEach(([p, owners]) =>
    (owners || []).forEach((o) => {
      if (!ownerPrimaryPlatform[o.name]) ownerPrimaryPlatform[o.name] = p
    })
  )
  const otherOwners = Array.from(
    new Set(Object.values(platformOwners).flatMap((owners) => owners.map((o) => o.name)))
  ).filter((o) => !ownerSet.has(o))

  // 负责人选项：所选平台负责人优先展示（已跨平台去重），未分配店铺的用户单独成组，其余按首个所属平台分组（每人只出现一次）
  const unassignedOptions = unassignedOwners
    .filter((o) => !ownerSet.has(o.name))
    .map((o) => ({ label: o.name, value: o.name }))
  const personOptions = [
    ...(selectedPlatformOwners.length
      ? [
          {
            label: "所选平台负责人",
            options: selectedPlatformOwners.map((name) => ({ label: name, value: name })),
          },
        ]
      : []),
    ...(unassignedOptions.length ? [{ label: "未分配店铺", options: unassignedOptions }] : []),
    ...platforms
      .map((p) => ({
        label: `其他负责人 · ${platformLabel(p)}`,
        options: otherOwners
          .filter((o) => ownerPrimaryPlatform[o] === p)
          .map((o) => ({ label: o, value: o })),
      }))
      .filter((g) => g.options.length > 0),
  ]

  // 一键添加所选平台的全部店铺负责人
  const addSelectedPlatformOwners = () => {
    const current: string[] = form.getFieldValue("assignees") || []
    const merged = Array.from(new Set([...current, ...selectedPlatformOwners]))
    form.setFieldsValue({ assignees: merged })
    const added = merged.length - current.length
    message.info(added > 0 ? `已添加 ${added} 名平台负责人` : "平台负责人均已在负责人中")
  }

  // 平台选项
  const platformOptions = platforms.map((p) => ({ label: platformLabel(p), value: p }))

  // 打开新建弹窗
  const openCreateModal = () => {
    setEditingTask(null)
    form.resetFields()
    setModalOpen(true)
  }

  // 打开编辑弹窗（回填任务内容与负责人）
  const openEditModal = (record: TaskItem) => {
    setEditingTask(record)
    form.setFieldsValue({
      title: record.title,
      description: record.description,
      platforms: record.platforms,
      assignees: record.assignees,
      priority: record.priority,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(record.deadline) ? dayjs(record.deadline) : undefined,
    })
    setModalOpen(true)
  }

  // 发布/保存任务
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (!isDemoUser) {
        // 真实用户：写入 tasks 表（负责人姓名转 user_id，映射不到的说明非系统用户）
        const selectedNames: string[] = values.assignees || []
        const assigneeIds = selectedNames.map((n) => ownerNameToId[n]).filter(Boolean)
        if (selectedNames.length > 0 && assigneeIds.length === 0) {
          message.warning("所选负责人未关联系统用户，请重新选择负责人")
          return
        }
        const payload = {
          subject: values.title,
          body: values.description || "",
          deadline: values.deadline ? values.deadline.format("YYYY-MM-DD") : null,
          priority: PRIO_TO_CN[values.priority] || "普通",
          platforms: values.platforms || [],
          assignee_ids: assigneeIds,
        }
        try {
          if (editingTask) {
            await apiClient.put(`/tasks/${editingTask.id}`, payload)
            message.success("任务已更新")
          } else {
            await apiClient.post("/tasks", payload)
            message.success("任务发布成功")
          }
          setModalOpen(false)
          setEditingTask(null)
          form.resetFields()
          loadTasks()
        } catch {
          message.error("保存任务失败，请稍后重试")
        }
        return
      }
      // demo 账号：本地演示逻辑
      if (editingTask) {
        // 编辑模式：更新任务内容与负责人，反馈记录仅保留仍属于当前负责对象的条目
        setTasks((prev) =>
          prev.map((t) =>
            t.id === editingTask.id
              ? {
                  ...t,
                  title: values.title,
                  description: values.description || "",
                  platforms: values.platforms || [],
                  assignees: values.assignees || [],
                  priority: values.priority,
                  deadline: values.deadline ? values.deadline.format("YYYY-MM-DD") : "-",
                  feedbacks: t.feedbacks.filter(
                    (fb) =>
                      (fb.type === "platform" && (values.platforms || []).includes(fb.name)) ||
                      (fb.type === "person" && (values.assignees || []).includes(fb.name))
                  ),
                }
              : t
          )
        )
        message.success("任务已更新")
      } else {
        const newTask: TaskItem = {
          id: Date.now(),
          title: values.title,
          description: values.description || "",
          platforms: values.platforms || [],
          assignees: values.assignees || [],
          priority: values.priority,
          deadline: values.deadline ? values.deadline.format("YYYY-MM-DD") : "-",
          created_at: dayjs().format("YYYY-MM-DD HH:mm"),
          feedbacks: [],
        }
        setTasks((prev) => [newTask, ...prev])
        message.success("任务发布成功")
      }
      setModalOpen(false)
      setEditingTask(null)
      form.resetFields()
    } catch {
      // 校验失败，不处理
    }
  }

  // 删除任务
  const handleDelete = (id: number) => {
    if (!isDemoUser) {
      apiClient
        .delete(`/tasks/${id}`)
        .then(() => {
          message.success("任务已删除")
          loadTasks()
        })
        .catch(() => message.error("删除任务失败，请稍后重试"))
      return
    }
    setTasks((prev) => prev.filter((t) => t.id !== id))
    message.success("任务已删除")
  }

  const columns = [
    {
      title: "任务标题",
      dataIndex: "title",
      key: "title",
      width: 220,
      render: (text: string, record: TaskItem) => (
        <div>
          <Text strong>{text}</Text>
          {record.description && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {record.description.length > 40
                  ? record.description.slice(0, 40) + "…"
                  : record.description}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "负责人",
      key: "assignees",
      width: 200,
      render: (_: unknown, record: TaskItem) => (
        <Space size={4} wrap>
          {record.platforms.map((p) => (
            <Tag key={p} color="purple" style={{ marginInlineEnd: 0 }}>
              <GlobalOutlined style={{ marginRight: 3 }} />
              {platformLabel(p)}
            </Tag>
          ))}
          {record.assignees.map((name) => (
            <Tag key={name} style={{ marginInlineEnd: 0 }}>
              {name}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "优先级",
      dataIndex: "priority",
      key: "priority",
      width: 90,
      render: (val: string) => (
        <Tag color={priorityConfig[val]?.color}>{priorityConfig[val]?.label || val}</Tag>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 90,
      render: (_: unknown, record: TaskItem) => {
        const st = statusConfig[deriveTaskStatus(record)]
        return <Tag color={st?.color}>{st?.label}</Tag>
      },
    },
    {
      title: "截止日期",
      dataIndex: "deadline",
      key: "deadline",
      width: 120,
      render: (val: string) => (
        <Space size={4}>
          <ClockCircleOutlined style={{ color: "#8c8c8c" }} />
          <span>{val}</span>
        </Space>
      ),
    },
    {
      title: "进度",
      key: "progress",
      width: 140,
      render: (_: unknown, record: TaskItem) => (
        <Progress
          percent={computeTaskProgress(record)}
          size="small"
          style={{ maxWidth: 110 }}
        />
      ),
    },
    {
      title: "发布时间",
      dataIndex: "created_at",
      key: "created_at",
      width: 150,
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      render: (_: unknown, record: TaskItem) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              openEditModal(record)
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除该任务吗？"
            onConfirm={() => handleDelete(record.id)}
            onPopupClick={(e) => e.stopPropagation()}
          >
            <Button
              type="link"
              size="small"
              danger
              onClick={(e) => e.stopPropagation()}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // 统计数据（状态由反馈进度自动推导）
  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => deriveTaskStatus(t) === "pending").length,
    inProgress: tasks.filter((t) => deriveTaskStatus(t) === "in_progress").length,
    done: tasks.filter((t) => deriveTaskStatus(t) === "done").length,
  }

  return (
    <div style={{ padding: 20 }}>
      {/* 统计卡片 + 操作按钮（顶部大标题已去掉，内容直接顶到最上面） */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "stretch",
        }}
      >
        {[
          { label: "全部任务", value: stats.total, color: "#1677ff", icon: <FileTextOutlined /> },
          { label: "待开始", value: stats.pending, color: "#8c8c8c", icon: <ClockCircleOutlined /> },
          { label: "进行中", value: stats.inProgress, color: "#faad14", icon: <SendOutlined /> },
          { label: "已完成", value: stats.done, color: "#52c41a", icon: <CheckCircleOutlined /> },
        ].map((item) => (
          <Card
            key={item.label}
            size="small"
            style={{ flex: 1, minWidth: 150, borderRadius: 10 }}
            styles={{ body: { padding: "14px 18px" } }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {item.label}
                </Text>
                <div style={{ fontSize: 26, fontWeight: 700, color: item.color, lineHeight: 1.3 }}>
                  {item.value}
                </div>
              </div>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: `${item.color}18`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  color: item.color,
                }}
              >
                {item.icon}
              </div>
            </div>
          </Card>
        ))}
        <Space style={{ flexShrink: 0, alignItems: "center" }}>
          <Button icon={<ReloadOutlined />} onClick={loadTasks}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreateModal}
          >
            新建任务
          </Button>
        </Space>
      </div>

      {/* 任务列表 */}
      <Card style={{ borderRadius: 10 }} styles={{ body: { padding: "12px 16px" } }}>
        <Table
          columns={columns}
          dataSource={tasks}
          loading={tasksLoading}
          rowKey="id"
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
          size="middle"
          onRow={(record) => ({
            onClick: () => setDetailTask(record),
            style: { cursor: "pointer" },
          })}
        />
      </Card>

      {/* 新建/编辑任务弹窗 */}
      <Modal
        title={editingTask ? "编辑任务" : "新建任务"}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false)
          setEditingTask(null)
        }}
        footer={null}
        width={680}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="title"
            label="任务标题"
            rules={[{ required: true, message: "请输入任务标题" }]}
          >
            <Input placeholder="请输入任务标题" maxLength={50} />
          </Form.Item>
          <Form.Item name="description" label="任务描述">
            <TextArea placeholder="请输入任务描述（选填）" rows={3} maxLength={200} showCount />
          </Form.Item>
          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item
              name="platforms"
              label="负责平台"
              style={{ flex: 1 }}
              rules={[
                {
                  validator: (_, value) =>
                    value?.length || form.getFieldValue("assignees")?.length
                      ? Promise.resolve()
                      : Promise.reject(new Error("请至少选择一个平台或人员")),
                },
              ]}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="请选择平台（选项来自店铺平台，可多选，点击清除图标一键清空）"
                maxTagCount="responsive"
                optionFilterProp="label"
                options={platformOptions}
              />
            </Form.Item>
            <Form.Item
              name="assignees"
              label="负责人"
              style={{ flex: 1 }}
              extra={
                selectedPlatformOwners.length > 0 && (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: "auto" }}
                    onClick={addSelectedPlatformOwners}
                  >
                    一键添加所选平台全部负责人（{selectedPlatformOwners.length} 人）
                  </Button>
                )
              }
              rules={[
                {
                  validator: (_, value) =>
                    value?.length || form.getFieldValue("platforms")?.length
                      ? Promise.resolve()
                      : Promise.reject(new Error("请至少选择一个平台或人员")),
                },
              ]}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder={
                  selectedPlatformOwners.length > 0
                    ? "所选平台的店铺负责人排在最前，也可选择其他负责人"
                    : "可先选平台辅助筛选负责人，或直接选择负责人"
                }
                maxTagCount="responsive"
                optionFilterProp="label"
                options={personOptions}
              />
            </Form.Item>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Form.Item
              name="priority"
              label="优先级"
              style={{ flex: 1 }}
              initialValue="low"
              rules={[{ required: true, message: "请选择优先级" }]}
            >
              <Select
                options={[
                  { label: "紧急", value: "high" },
                  { label: "重要", value: "medium" },
                  { label: "普通", value: "low" },
                ]}
              />
            </Form.Item>
            <Form.Item name="deadline" label="截止日期" style={{ flex: 1 }}>
              <DatePicker style={{ width: "100%" }} placeholder="请选择截止日期" />
            </Form.Item>
          </div>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button
                onClick={() => {
                  setModalOpen(false)
                  setEditingTask(null)
                }}
              >
                取消
              </Button>
              <Button type="primary" icon={<SendOutlined />} onClick={handleSubmit}>
                {editingTask ? "保存修改" : "发布任务"}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 任务详情弹窗 */}
      <Modal
        title={
          <Space size={8}>
            <FileTextOutlined style={{ color: "#1677ff" }} />
            <span>{detailTask?.title}</span>
          </Space>
        }
        open={!!detailTask}
        onCancel={() => setDetailTask(null)}
        footer={
          <Space>
            <Button onClick={() => setDetailTask(null)}>关闭</Button>
            <Button
              type="primary"
              onClick={() => {
                const target = detailTask
                setDetailTask(null)
                if (target) openEditModal(target)
              }}
            >
              编辑任务
            </Button>
          </Space>
        }
        width={640}
        destroyOnHidden
      >
        {detailTask && (
          <>
            {/* 基本信息 */}
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <Tag color={priorityConfig[detailTask.priority]?.color}>
                {priorityConfig[detailTask.priority]?.label}
              </Tag>
              <Tag color={statusConfig[deriveTaskStatus(detailTask)]?.color}>
                {statusConfig[deriveTaskStatus(detailTask)]?.label}
              </Tag>
              <Text type="secondary" style={{ fontSize: 13 }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                截止：{detailTask.deadline}
              </Text>
              <Text type="secondary" style={{ fontSize: 13 }}>
                发布于 {detailTask.created_at}
              </Text>
            </div>

            {/* 任务描述 */}
            <div
              style={{
                background: "#fafafa",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 14,
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                任务描述
              </Text>
              <div style={{ marginTop: 4 }}>
                {detailTask.description || (
                  <Text type="secondary">暂无描述</Text>
                )}
              </div>
            </div>

            {/* 负责对象 */}
            <div style={{ marginBottom: 14 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                负责对象
              </Text>
              <div style={{ marginTop: 6 }}>
                <Space size={4} wrap>
                  {detailTask.platforms.map((p) => (
                    <Tag key={p} color="purple" style={{ marginInlineEnd: 0 }}>
                      <GlobalOutlined style={{ marginRight: 3 }} />
                      {platformLabel(p)}
                    </Tag>
                  ))}
                  {detailTask.assignees.map((name) => (
                    <Tag key={name} style={{ marginInlineEnd: 0 }}>
                      {name}
                    </Tag>
                  ))}
                </Space>
              </div>
            </div>

            {/* 反馈情况 */}
            <div
              style={{
                borderTop: "1px dashed #e8e8e8",
                paddingTop: 12,
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                反馈情况（{detailTask.feedbacks.length} 人/平台）
              </Text>
              {detailTask.feedbacks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <Text type="secondary">暂无反馈，负责人尚未开始任务</Text>
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  {[...detailTask.feedbacks]
                    .sort(
                      (a, b) =>
                        feedbackSortWeight[
                          a.type === "platform"
                            ? aggregateGroupStatus(a.members || [])
                            : a.status
                        ] -
                        feedbackSortWeight[
                          b.type === "platform"
                            ? aggregateGroupStatus(b.members || [])
                            : b.status
                        ]
                    )
                    .map((fb) => {
                      const status =
                        fb.type === "platform"
                          ? aggregateGroupStatus(fb.members || [])
                          : fb.status
                      const cfg = feedbackStatusConfig[status]
                      return (
                        <div
                          key={fb.name}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 8,
                            background: "#fafafa",
                            marginBottom: 8,
                          }}
                        >
                          {/* 条目头：平台或人员 */}
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <div style={{ minWidth: 110 }}>
                              {fb.type === "platform" ? (
                                <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                                  <GlobalOutlined style={{ marginRight: 3 }} />
                                  {platformLabel(fb.name)}
                                </Tag>
                              ) : (
                                <Tag style={{ marginInlineEnd: 0 }}>{fb.name}</Tag>
                              )}
                            </div>
                            <Tag color={cfg.color} style={{ marginInlineEnd: 0 }}>
                              {cfg.label}
                            </Tag>
                            {fb.type === "person" && fb.time && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {fb.time}
                              </Text>
                            )}
                            {fb.type === "platform" && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                平台负责人 {fb.members?.length || 0} 人
                              </Text>
                            )}
                          </div>

                          {/* 人员反馈内容 */}
                          {fb.type === "person" && fb.content && (
                            <div style={{ marginTop: 5, lineHeight: 1.6 }}>{fb.content}</div>
                          )}

                          {/* 平台：展开各店铺负责人逐人反馈 */}
                          {fb.type === "platform" && (fb.members?.length || 0) > 0 && (
                            <div
                              style={{
                                marginTop: 8,
                                marginLeft: 12,
                                paddingLeft: 12,
                                borderLeft: "2px solid #d3adf7",
                              }}
                            >
                              {(fb.members || []).map((m) => {
                                const mcfg = feedbackStatusConfig[m.status]
                                return (
                                  <div
                                    key={m.name}
                                    style={{ marginBottom: 6 }}
                                  >
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                      <Tag style={{ marginInlineEnd: 0 }}>{m.name}</Tag>
                                      <Tag color={mcfg.color} style={{ marginInlineEnd: 0 }}>
                                        {mcfg.label}
                                      </Tag>
                                      {m.time && (
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                          {m.time}
                                        </Text>
                                      )}
                                    </div>
                                    {m.content && (
                                      <div
                                        style={{
                                          marginTop: 3,
                                          fontSize: 13,
                                          lineHeight: 1.6,
                                        }}
                                      >
                                        {m.content}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

export default PublishTask
