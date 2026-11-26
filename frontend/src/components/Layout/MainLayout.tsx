import React, { useState, useEffect, useRef } from "react";
import {
  Layout,
  Menu,
  theme,
  Dropdown,
  Avatar,
  Space,
  Typography,
  Badge,
  List,
  Button,
  Popover,
  Empty,
  Input,
  Spin,
  Modal,
  Breadcrumb,
} from "antd";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Home,
  Package,
  MessageSquare,
  Bot,
  LogOut,
  User,
  Bell,
  Key,
  ClipboardList,
  Store,
  ShoppingBag,
  Users,
  Building2,
  Target,
  ArrowDownCircle,
  ArrowUpCircle,
  Truck,
  ArrowLeftRight,
  Shield,
  Warehouse,
  Boxes,
  Settings,
  Mail,
  Megaphone,
  PackagePlus,
  Ship,
  Contact,
  ChevronLeft,
  ChevronRight,
  Search,
  Star,
  AlertTriangle,
  Sparkles,
  Table2,
  Rocket,
  Video,
  Film,
  Image as ImageIcon,
  UploadCloud,
  Layers,
  Trophy,
  ClipboardCheck,
  ChevronDown,
  X,
  Send,
  Wallet,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import ThemeSwitcher from "../ThemeSwitcher";
import ChangePasswordModal from "../ChangePasswordModal";
import ErrorBoundary from "../ErrorBoundary";
import KeepAliveHost from "../KeepAliveHost";
import { notificationsApi } from "../../api";
import dayjs from "dayjs";

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

interface MainLayoutProps {
  children: React.ReactNode;
}

interface Notification {
  id: number;
  type: string;
  title: string;
  content: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

interface PageTab {
  path: string;
  title: string;
}

const PAGE_TAB_STORAGE_KEY = "app-page-tabs";
const HOME_TAB: PageTab = { path: "/", title: "首页" };

// 不在侧边栏菜单中的页面：补充面包屑层级（不含首页）
const EXTRA_PAGE_TRAILS: Record<string, string[]> = {
  "/business-settings": ["系统设置", "业务设置"],
  "/development/new": ["开发机器人", "添加新品"],
  "/video-binding-review": ["媒体创作中心", "媒体任务中心", "媒体绑定审核"],
  "/inventory/allocate-test": ["进销存", "分配发货测试"],
};

// 在菜单树中查找路径对应的标签链（含自身）
const findMenuTrail = (items: any[], path: string): string[] | null => {
  for (const item of items) {
    if (item.key === path) return [String(item.label)];
    if (item.children && item.children.length > 0) {
      const childTrail = findMenuTrail(item.children, path);
      if (childTrail) return [String(item.label), ...childTrail];
    }
  }
  return null;
};

// 从 sessionStorage 恢复已打开的页签（刷新不丢失）
const loadStoredTabs = (): PageTab[] => {
  try {
    const raw = sessionStorage.getItem(PAGE_TAB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const tabs = parsed.filter(
          (tab): tab is PageTab =>
            !!tab &&
            typeof tab.path === "string" &&
            typeof tab.title === "string",
        );
        if (tabs.length > 0) {
          return tabs.some((tab) => tab.path === HOME_TAB.path)
            ? tabs
            : [HOME_TAB, ...tabs];
        }
      }
    }
  } catch {
    // 本地缓存损坏时忽略，回落到首页页签
  }
  return [HOME_TAB];
};

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [menuSearchText, setMenuSearchText] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuth();
  const { currentTheme } = useTheme();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] =
    useState<Notification | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  // 面包屑页签：访问过的页面依次生成页签，刷新后从会话缓存恢复
  const [pageTabs, setPageTabs] = useState<PageTab[]>(loadStoredTabs);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAdmin = user?.role === "admin";

  // 从通知列表计算未读数量
  const calculateUnreadCount = (notifList: Notification[]) => {
    return notifList.filter((n) => !n.is_read).length;
  };

  useEffect(() => {
    if (user) {
      fetchNotifications();
      fetchUnreadCount();
      pollRef.current = setInterval(fetchUnreadCount, 60000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user]);

  const fetchUnreadCount = async () => {
    try {
      const res = await notificationsApi.getUnreadCount();
      if (res.data.success) setUnreadCount(res.data.data.count);
    } catch (e) {
      // ignore
    }
  };

  const fetchNotifications = async () => {
    setNotifLoading(true);
    try {
      const res = await notificationsApi.getList({ page: 1, page_size: 10 });
      if (res.data.success) {
        const newNotifications = res.data.data;
        setNotifications(newNotifications);
        // 获取完整的未读总数
        const countRes = await notificationsApi.getUnreadCount();
        if (countRes.data.success) setUnreadCount(countRes.data.data.count);
      }
    } catch (e) {
      // ignore
    } finally {
      setNotifLoading(false);
    }
  };

  const handleNotifOpen = (visible: boolean) => {
    setNotifOpen(visible);
    if (visible) fetchNotifications();
  };

  const handleMarkAsRead = async (id: number) => {
    try {
      await notificationsApi.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (e) {
      // ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (e) {
      // ignore
    }
  };

  const handleNotifClick = (notif: Notification) => {
    setSelectedNotification(notif);
    setDetailModalOpen(true);
    setNotifOpen(false);

    if (!notif.is_read) {
      handleMarkAsRead(notif.id);
    }
  };

  const handleGoToReview = () => {
    if (selectedNotification?.link) {
      navigate(selectedNotification.link);
    } else {
      navigate("/review");
    }
    setDetailModalOpen(false);
  };

  const inventoryPaths = [
    "/grade-pool",
    "/replenishment",
    "/purchase",
    "/inbound",
    "/outbound",
    "/stock-transfer",
    "/shipment",
    "/warehouses",
    "/suppliers",
    "/base-table",
  ];
  const systemPaths = [
    "/org",
    "/permissions",
    "/operation-logs",
    "/tenants",
    "/stores",
  ];
  // AI生图是媒体创作中心下的二级菜单（只有分组，本身无路由），A+套图/主副图是三级
  const imagePaths = ["/ai-image", "/ai-image-aplus", "/ai-image-main"];
  const mediaPaths = ["/ai-creation", ...imagePaths];
  // 机器人中心下的各机器人页面（/development/new 也归属开发机器人）
  const robotPaths = [
    "/inventory",
    "/review",
    "/email",
    "/rating-optimization",
    "/ads",
    "/product-selection",
    "/development",
  ];
  const inRobotGroup = (path: string) =>
    robotPaths.includes(path) || path.startsWith("/development/");

  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const currentPath = location.pathname;
    const keys: string[] = [];
    if (inRobotGroup(currentPath)) keys.push("robot-group");
    if (inventoryPaths.includes(currentPath)) keys.push("inventory-group");
    if (systemPaths.includes(currentPath)) keys.push("system-group");
    if (mediaPaths.includes(currentPath)) keys.push("media-creation");
    if (imagePaths.includes(currentPath)) keys.push("ai-image-group");
    return keys;
  });

  useEffect(() => {
    const currentPath = location.pathname;
    setOpenKeys((prev) => {
      const next = [...prev];
      if (inRobotGroup(currentPath) && !next.includes("robot-group")) {
        next.push("robot-group");
      }
      if (
        inventoryPaths.includes(currentPath) &&
        !next.includes("inventory-group")
      ) {
        next.push("inventory-group");
      }
      if (systemPaths.includes(currentPath) && !next.includes("system-group")) {
        next.push("system-group");
      }
      if (mediaPaths.includes(currentPath) && !next.includes("media-creation")) {
        next.push("media-creation");
      }
      // 三级菜单：进入 A+套图 / 主副图 时同时展开 AI生图 这一层
      if (imagePaths.includes(currentPath) && !next.includes("ai-image-group")) {
        next.push("ai-image-group");
      }
      return next;
    });
  }, [location.pathname]);

  const menuItems = [
    {
      key: "/",
      icon: <Home size={20} />,
      label: "首页",
    },
    {
      key: "/todo",
      icon: <ClipboardList size={20} />,
      label: "KPI",
    },
    // 机器人中心：统一收纳各业务机器人页面
    {
      key: "robot-group",
      icon: <Bot size={20} />,
      label: "机器人中心",
      shortLabel: "机器人",
      children: [
        ...(hasPermission("robot:inventory:view")
          ? [{ key: "/inventory", icon: <Package size={18} />, label: "库存机器人" }]
          : []),
        ...(hasPermission("robot:review:view")
          ? [{ key: "/review", icon: <MessageSquare size={18} />, label: "差评机器人" }]
          : []),
        ...(hasPermission("robot:email:view")
          ? [{ key: "/email", icon: <Mail size={18} />, label: "邮件机器人" }]
          : []),
        ...(hasPermission("robot:rating:view")
          ? [{ key: "/rating-optimization", icon: <Star size={18} />, label: "页面优化机器人" }]
          : []),
        ...(hasPermission("robot:ad:view")
          ? [{ key: "/ads", icon: <Megaphone size={18} />, label: "广告机器人" }]
          : []),
        ...(hasPermission('product_selection:view')
          ? [{ key: '/product-selection', icon: <Target size={18} />, label: '选品机器人' }]
          : []),
        ...(hasPermission("development:view")
          ? [{ key: "/development", icon: <Rocket size={18} />, label: "开发机器人" }]
          : []),
      ] as any[],
    },
    ...(hasPermission("chat:use")
      ? [
          {
            key: "/chat",
            icon: <Bot size={20} />,
            label: "AI聊天助手",
            shortLabel: "AI",
          },
        ]
      : []),
    ...(hasPermission('ai_video:use') || hasPermission('ai_image:use')
      ? [{
          key: 'media-creation',
          icon: <Sparkles size={20} />,
          label: '媒体创作中心',
          shortLabel: '媒体',
          children: [
            ...(hasPermission('ai_video:use')
              ? [{
                  key: '/ai-creation',
                  icon: <Video size={18} />,
                  label: 'AI视频',
                }]
              : []),
            // AI生图有独立权限码：只给美工开生图、不给视频时也要能进。
            // 结构：媒体创作中心 > AI生图（分组，无路由）> A+套图 / 主副图（共用 ai_image:use）
            ...(hasPermission('ai_image:use')
              ? [{
                  key: 'ai-image-group',
                  icon: <ImageIcon size={18} />,
                  label: 'AI生图',
                  children: [
                    {
                      key: '/ai-image-aplus',
                      icon: <ImageIcon size={16} />,
                      label: 'A+套图',
                    },
                    {
                      key: '/ai-image-main',
                      icon: <Layers size={16} />,
                      label: '主副图',
                    },
                  ],
                }]
              : []),
            ...(hasPermission('ai_video:use')
              ? [{
                  key: '/upscale-center',
                  icon: <Film size={18} />,
                  label: '高清处理',
                }]
              : []),
            ...(hasPermission('product:edit') || hasPermission('ai_video:approve')
              ? [{
                  key: '/video-upload',
                  icon: <UploadCloud size={18} />,
                  label: '媒体任务中心',
                }]
              : []),
          ],
        }] : []),
    ...(hasPermission("data_alert:view")
      ? [
          {
            key: "/data-alert",
            icon: <AlertTriangle size={20} />,
            label: "数据驾驶舱",
          },
        ]
      : []),
    {
      key: "/finance",
      icon: <Wallet size={20} />,
      label: "财务机器人",
      shortLabel: "财务",
    },
    ...(hasPermission("product:view")
      ? [
          {
            key: "/products",
            icon: <ShoppingBag size={20} />,
            label: "产品管理",
            shortLabel: "产品",
          },
        ]
      : []),
    {
      key: "inventory-group",
      icon: <Boxes size={20} />,
      label: "进销存",
      children: [
        ...(hasPermission('robot:inventory:view')
          ? [{
              key: '/grade-pool',
              icon: <Trophy size={18} />,
              label: '等级池',
            }] : []),
        ...(hasPermission('replenishment:view')
          ? [{
              key: '/replenishment',
              icon: <PackagePlus size={18} />,
              label: '补货管理',
            }] : []),
        ...(hasPermission('purchase:view')
          ? [{
              key: '/purchase',
              icon: <Truck size={18} />,
              label: '采购管理',
            }] : []),
        ...(hasPermission('inbound:view')
          ? [{
              key: '/inbound',
              icon: <ArrowDownCircle size={18} />,
              label: '入库管理',
            }] : []),
        ...(hasPermission('outbound:view')
          ? [{
              key: '/outbound',
              icon: <ArrowUpCircle size={18} />,
              label: '出库管理',
            }] : []),
        ...(hasPermission('stock_transfer:view')
          ? [{
              key: '/stock-transfer',
              icon: <ArrowLeftRight size={18} />,
              label: '挪货管理',
            }] : []),
        ...(hasPermission('shipment:view')
          ? [{
              key: '/shipment',
              icon: <Ship size={18} />,
              label: '发货管理',
            }] : []),
        ...(hasPermission('warehouse:view')
          ? [{
              key: '/warehouses',
              icon: <Warehouse size={18} />,
              label: '仓库管理',
            }] : []),
        ...(hasPermission('supplier:view')
          ? [{
              key: '/suppliers',
              icon: <Contact size={18} />,
              label: '供应商管理',
            }] : []),
        ...(hasPermission('base_table:view')
          ? [{
              key: '/base-table',
              icon: <Table2 size={18} />,
              label: '底表管理',
            }] : []),
      ] as any[],
    },
    {
      key: "system-group",
      icon: <Settings size={20} />,
      label: "系统设置",
      shortLabel: "系统",
      children: [
        ...(hasPermission("org:view")
          ? [
              {
                key: "/org",
                icon: <Users size={18} />,
                label: "组织管理",
              },
            ]
          : []),
        ...(hasPermission("permission:view")
          ? [
              {
                key: "/permissions",
                icon: <Shield size={18} />,
                label: "权限管理",
              },
            ]
          : []),
        ...(hasPermission("log:view")
          ? [
              {
                key: "/operation-logs",
                icon: <ClipboardList size={18} />,
                label: "操作日志",
              },
            ]
          : []),
        {
          key: "/tenants",
          icon: <Building2 size={18} />,
          label: "公司设置",
        },
        ...(hasPermission("robot:inventory:settings")
          ? [
              {
                key: "/business-settings",
                icon: <Settings size={20} />,
                label: "业务设置",
              },
            ]
          : []),
        ...(hasPermission("store:view")
          ? [
              {
                key: "/stores",
                icon: <Store size={18} />,
                label: "店铺管理",
              },
            ]
          : []),
        {
          key: "/publish-task",
          icon: <Send size={18} />,
          label: "发布任务",
        },
      ] as any[],
    },
  ].filter((item) => !item.children || item.children.length > 0);

  // 菜单搜索：按名称过滤菜单项（支持三级：命中三级项保留两级父节点并展开）
  const menuKeyword = menuSearchText.trim().toLowerCase();
  const isMenuSearching = menuKeyword.length > 0;
  const filterMenuByKeyword = (items: any[], kw: string): any[] =>
    items
      .map((item: any) => {
        if (item.children && item.children.length > 0) {
          const matchedChildren = filterMenuByKeyword(item.children, kw);
          if (matchedChildren.length > 0) {
            return { ...item, children: matchedChildren };
          }
          return String(item.label || "").toLowerCase().includes(kw) ? item : null;
        }
        return String(item.label || "").toLowerCase().includes(kw) ? item : null;
      })
      .filter(Boolean);
  const filteredMenuItems = isMenuSearching
    ? filterMenuByKeyword(menuItems as any[], menuKeyword)
    : (menuItems as any[]);
  // 收集所有「带子项」的 key（含二级 AI生图），搜索时一并展开
  const collectSubMenuKeys = (items: any[]): string[] =>
    items.flatMap((item: any) =>
      item.children && item.children.length > 0
        ? [item.key, ...collectSubMenuKeys(item.children)]
        : [],
    );
  const searchedOpenKeys = collectSubMenuKeys(filteredMenuItems);

  const getPageTitle = () => {
    const pathMap: Record<string, string> = {
      "/": "首页",
      "/todo": "KPI",
      "/chat": "AI聊天助手",
      "/inventory": "库存机器人",
      "/grade-pool": "等级池",
      "/business-settings": "业务设置",
      "/review": "差评机器人",
      "/email": "邮件机器人",
      "/ads": "广告机器人",
      "/rating-optimization": "页面优化机器人",
      "/data-alert": "数据驾驶舱",
      "/finance": "财务机器人",
      "/org": "组织管理",
      "/permissions": "权限管理",
      "/stores": "店铺管理",
      "/products": "产品管理",
      "/inbound": "入库管理",
      "/outbound": "出库管理",
      "/purchase": "采购管理",
      "/replenishment": "补货管理",
      "/stock-transfer": "挪货管理",
      "/shipment": "发货管理",
      "/suppliers": "供应商管理",
      "/warehouses": "仓库管理",
      '/base-table': '底表管理',
      "/operation-logs": "操作日志",
      "/tenants": "公司设置",
      "/product-selection": "选品机器人",
      "/development": "开发机器人",
      "/development/new": "添加新品",
      '/ai-creation': 'AI视频',
      '/ai-image-aplus': 'A+套图',
      '/ai-image-main': '主副图',
      '/ai-image': 'AI生图',
      '/upscale-center': '高清处理',
      '/video-binding-review': '媒体绑定审核',
      "/publish-task": "发布任务",
      '/video-upload': '媒体任务中心',
    };
    return pathMap[location.pathname] || "未知页面";
  };

  // 面包屑层级：首页 / 一级菜单 / 二级菜单 / 当前页
  const breadcrumbLabels = (() => {
    if (location.pathname === "/") return ["首页"];
    const menuTrail = findMenuTrail(menuItems as any[], location.pathname);
    if (menuTrail) return ["首页", ...menuTrail];
    const extraTrail = EXTRA_PAGE_TRAILS[location.pathname];
    if (extraTrail) return ["首页", ...extraTrail];
    return ["首页", getPageTitle()];
  })();
  const currentPageTitle = breadcrumbLabels[breadcrumbLabels.length - 1];

  // 进入新页面时自动追加页签
  useEffect(() => {
    setPageTabs((prev) =>
      prev.some((tab) => tab.path === location.pathname)
        ? prev
        : [...prev, { path: location.pathname, title: currentPageTitle }],
    );
  }, [location.pathname, currentPageTitle]);

  // 页签持久化：刷新/重新登录前保留已打开的页签
  useEffect(() => {
    sessionStorage.setItem(PAGE_TAB_STORAGE_KEY, JSON.stringify(pageTabs));
  }, [pageTabs]);

  // 页签过多出现横向滚动时，保证当前页签始终可见
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [location.pathname]);

  const closeTab = (path: string) => {
    if (path === HOME_TAB.path) return;
    const index = pageTabs.findIndex((tab) => tab.path === path);
    if (index === -1) return;
    const nextTabs = pageTabs.filter((tab) => tab.path !== path);
    setPageTabs(nextTabs);
    // 关闭的是当前页时，切到相邻页签（优先右侧，没有则左侧）
    if (location.pathname === path) {
      const fallback = nextTabs[Math.min(index, nextTabs.length - 1)];
      navigate(fallback ? fallback.path : HOME_TAB.path);
    }
  };

  const closeOtherTabs = () => {
    setPageTabs((prev) =>
      prev.filter(
        (tab) =>
          tab.path === HOME_TAB.path || tab.path === location.pathname,
      ),
    );
  };

  const closeAllTabs = () => {
    setPageTabs([HOME_TAB]);
    if (location.pathname !== HOME_TAB.path) navigate(HOME_TAB.path);
  };

  const userMenuItems: any[] = [
    {
      key: "changePassword",
      icon: <Key size={16} />,
      label: "修改密码",
      onClick: () => {
        setChangePasswordOpen(true);
      },
    },
    {
      type: "divider",
    },
    {
      key: "logout",
      icon: <LogOut size={16} />,
      label: "退出登录",
      onClick: () => {
        logout();
        navigate("/login");
      },
    },
  ];

  const notificationContent = (
    <div
      style={{
        width: 400,
        maxHeight: 500,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid #f0f0f0",
          marginBottom: 0,
        }}
      >
        <Text strong style={{ fontSize: 14 }}>
          消息通知
        </Text>
        {unreadCount > 0 && (
          <Button type="link" size="small" onClick={handleMarkAllRead}>
            全部已读
          </Button>
        )}
      </div>
      {notifLoading ? (
        <div style={{ textAlign: "center", padding: 32 }}>
          <Spin />
        </div>
      ) : notifications.length === 0 ? (
        <Empty description="暂无通知" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          style={{ overflow: "auto", flex: 1, padding: "4px 0" }}
          dataSource={notifications}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: "12px 16px",
                cursor: "pointer",
                background: item.is_read ? "transparent" : "#f6ffed",
                borderRadius: 6,
                marginBottom: 4,
                margin: "0 8px",
                border: "1px solid #f0f0f0",
              }}
              onClick={() => handleNotifClick(item)}
            >
              <List.Item.Meta
                avatar={
                  <Badge dot={!item.is_read}>
                    <Bell
                      size={18}
                      color={item.is_read ? "#999" : currentTheme.primary}
                    />
                  </Badge>
                }
                title={
                  <Text style={{ fontSize: 14 }} strong={!item.is_read}>
                    {item.title}
                  </Text>
                }
                description={
                  <div>
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 12,
                        lineHeight: 1.6,
                        display: "block",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {item.content}
                    </Text>
                    <Text
                      type="secondary"
                      style={{ fontSize: 11, marginTop: 4, display: "block" }}
                    >
                      {dayjs(item.created_at).format("YYYY-MM-DD HH:mm")}
                    </Text>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  // 折叠菜单项：图标 + 小字标题
  const CollapsedMenuItem = ({
    icon,
    label,
    shortLabel,
    active,
    onClick,
    children,
  }: {
    icon: React.ReactNode;
    label: string;
    shortLabel?: string;
    active?: boolean;
    onClick?: () => void;
    children?: React.ReactNode;
  }) => {
    const itemContent = (
      <div
        onClick={onClick}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px 0",
          cursor: "pointer",
          color: active ? currentTheme.primary : "#666",
          background: active ? currentTheme.selectedBg : "transparent",
          transition: "all 0.2s",
          height: 56,
          width: "100%",
          borderRight: active ? `2px solid ${currentTheme.primary}` : "none",
        }}
      >
        {icon}
        <span
          style={{
            fontSize: 10,
            marginTop: 3,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 64,
            textAlign: "center",
          }}
        >
          {shortLabel || label}
        </span>
      </div>
    );

    if (children) {
      // 折叠态：一级分组 hover 出 Dropdown；二级子菜单（如 AI生图）渲染成分组标题，
      // 其三级项（A+套图/主副图）平铺在该标题下，避免 Dropdown 只支持一层的限制
      return (
        <Dropdown
          menu={{
            items: (children as any[]).map((child) =>
              child.children && child.children.length > 0
                ? {
                    type: 'group' as const,
                    key: child.key,
                    label: child.label,
                    children: (child.children as any[]).map((g) => ({
                      key: g.key,
                      icon: g.icon,
                      label: g.label,
                    })),
                  }
                : {
                    key: child.key,
                    icon: child.icon,
                    label: child.label,
                  },
            ),
            selectedKeys: [location.pathname],
            onClick: ({ key }) => navigate(key),
            style: { minWidth: 160 },
          }}
          placement="bottomLeft"
          getPopupContainer={() => document.body}
        >
          {itemContent}
        </Dropdown>
      );
    }

    return itemContent;
  };

  // 构建折叠状态的菜单列表
  const renderCollapsedMenu = () => (
    <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
      {menuItems.map((item: any) => {
        if (item.children && item.children.length > 0) {
          // 子菜单组：图标+小字，hover显示Dropdown
          return (
            <CollapsedMenuItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              shortLabel={item.shortLabel}
            >
              {item.children}
            </CollapsedMenuItem>
          );
        }
        // 普通菜单项
        return (
          <CollapsedMenuItem
            key={item.key}
            icon={item.icon}
            label={item.label}
            shortLabel={item.shortLabel}
            active={location.pathname.startsWith("/development") ? item.key === "/development" : location.pathname === item.key}
            onClick={() => navigate(item.key as string)}
          />
        );
      })}
    </div>
  );

  return (
    <div style={{ height: "100vh", overflowX: "auto", overflowY: "hidden" }}>
      <Layout style={{ minWidth: 1510, height: "100%" }}>
        {/* 固定侧边栏：小屏也保持桌面布局，通过整体横向滚动查看 */}
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          theme="light"
          width={200}
          collapsedWidth={80}
          style={{
            height: "100vh",
            position: "sticky",
            top: 0,
            flexShrink: 0,
            overflow: "visible",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              overflow: "visible",
            }}
          >
            {/* Logo */}
            <div
              style={{
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: collapsed ? 8 : 16,
                flexShrink: 0,
              }}
            >
              <Bot size={collapsed ? 28 : 32} color={currentTheme.primary} />
              {!collapsed && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 18,
                    fontWeight: "bold",
                    color: currentTheme.primary,
                  }}
                >
                  宝鑫华盛AI
                </span>
              )}
            </div>

            {/* 菜单搜索框（折叠时显示搜索图标，点击展开侧边栏） */}
            {collapsed ? (
              <div
                style={{
                  padding: "8px 0",
                  flexShrink: 0,
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <Button
                  type="text"
                  icon={<Search size={18} />}
                  onClick={() => setCollapsed(false)}
                />
              </div>
            ) : (
              <div style={{ padding: "0 12px 8px", flexShrink: 0 }}>
                <Input
                  size="small"
                  placeholder="搜索菜单..."
                  prefix={<Search size={14} color="#999" />}
                  value={menuSearchText}
                  onChange={(e) => setMenuSearchText(e.target.value)}
                  allowClear
                />
              </div>
            )}

            {/* 菜单区域 */}
            {collapsed ? (
              renderCollapsedMenu()
            ) : isMenuSearching && filteredMenuItems.length === 0 ? (
              <Empty
                description="无匹配菜单"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ marginTop: 48 }}
              />
            ) : (
              <Menu
                mode="inline"
                inlineIndent={16}
                selectedKeys={[location.pathname.startsWith("/development") ? "/development" : location.pathname]}
                openKeys={isMenuSearching ? searchedOpenKeys : openKeys}
                onOpenChange={(keys) => setOpenKeys(keys)}
                items={filteredMenuItems.map(
                  ({ shortLabel, ...rest }: any) => rest,
                )}
                onClick={({ key }) => navigate(key)}
                style={
                  {
                    flex: 1,
                    overflowY: "auto",
                    overflowX: "visible",
                    "--ant-menu-item-selected-bg": currentTheme.selectedBg,
                    "--ant-menu-item-selected-color": currentTheme.primary,
                    "--ant-menu-item-color": currentTheme.primary,
                    "--ant-color-primary": currentTheme.primary,
                  } as React.CSSProperties
                }
              />
            )}

            {/* 折叠/展开按钮 */}
            <div
              onClick={() => setCollapsed(!collapsed)}
              style={{
                height: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                borderTop: "1px solid #f0f0f0",
                color: "#999",
                transition: "color 0.2s",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#333")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#999")}
            >
              {collapsed ? (
                <ChevronRight size={18} />
              ) : (
                <ChevronLeft size={18} />
              )}
            </div>
          </div>
        </Sider>
        <Layout
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 1280,
            flexShrink: 0,
          }}
        >
          <Header
            style={{
              padding: "0 24px",
              background: colorBgContainer,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
              height: 56,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
              }}
            >
              <Breadcrumb
                style={{ fontSize: 14 }}
                items={breadcrumbLabels.map((label, index) => {
                  const isLast = index === breadcrumbLabels.length - 1;
                  return {
                    icon: index === 0 ? <Home size={14} /> : undefined,
                    title:
                      index === 0 && !isLast ? (
                        <a
                          onClick={() => navigate("/")}
                          style={{ color: "#999", cursor: "pointer" }}
                        >
                          首页
                        </a>
                      ) : (
                        <span
                          style={{
                            color: isLast ? "#333" : "#999",
                            fontWeight: isLast ? 600 : 400,
                          }}
                        >
                          {label}
                        </span>
                      ),
                  };
                })}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexShrink: 0,
              }}
            >
              <Popover
                content={notificationContent}
                trigger="click"
                open={notifOpen}
                onOpenChange={handleNotifOpen}
                placement="bottomRight"
              >
                <Badge count={unreadCount} size="small" offset={[-2, 2]}>
                  <Button
                    type="text"
                    icon={<Bell size={20} />}
                    style={{ color: "#666" }}
                  />
                </Badge>
              </Popover>
              <ThemeSwitcher />
              <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
                <Space style={{ cursor: "pointer" }}>
                  <Avatar
                    size="default"
                    style={{ backgroundColor: currentTheme.avatarBg }}
                    icon={<User size={16} />}
                  />
                  <span>{user?.nickname || user?.username}</span>
                </Space>
              </Dropdown>
            </div>
          </Header>
          {/* 面包屑页签栏：访问过的页面生成页签，可切换、关闭 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "5px 16px",
              background: colorBgContainer,
              borderBottom: "1px solid #f0f0f0",
              flexShrink: 0,
              minHeight: 40,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                minWidth: 0,
                overflowX: "auto",
                overflowY: "hidden",
              }}
            >
              {pageTabs.map((tab) => {
                const active = tab.path === location.pathname;
                const closable = tab.path !== HOME_TAB.path;
                return (
                  <div
                    key={tab.path}
                    ref={active ? activeTabRef : undefined}
                    onClick={() => {
                      if (!active) navigate(tab.path);
                    }}
                    title={tab.title}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      height: 28,
                      padding: closable ? "0 4px 0 10px" : "0 10px",
                      borderRadius: 6,
                      border: `1px solid ${active ? currentTheme.primaryLight : "#e8e8e8"}`,
                      background: active ? currentTheme.selectedBg : "#fff",
                      color: active ? currentTheme.primary : "#666",
                      fontSize: 13,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      transition: "all 0.2s",
                      userSelect: "none",
                    }}
                  >
                    <span>{tab.title}</span>
                    {closable && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.path);
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 16,
                          height: 16,
                          borderRadius: 4,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(0,0,0,0.06)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <X size={12} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <Dropdown
              placement="bottomRight"
              menu={{
                items: [
                  { key: "closeOthers", label: "关闭其他页签" },
                  { key: "closeAll", label: "关闭全部页签" },
                ],
                onClick: ({ key }) => {
                  if (key === "closeOthers") closeOtherTabs();
                  if (key === "closeAll") closeAllTabs();
                },
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<ChevronDown size={14} />}
                style={{ flexShrink: 0, color: "#999", marginLeft: 8 }}
              />
            </Dropdown>
          </div>
          <Content
            style={{
              margin: "16px 16px 0 16px",
              padding: 0,
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
              display: "flex",
              flexDirection: "column",
              /* 必须 hidden（与合并前一致）：本布局高度链被 100vh 锁死，
                 Content 是一个「高度=视口剩余」的固定滚动容器。子页面
                 （如库存页）根 div 为 height:100% + overflowY:auto，
                 其 position:sticky 分页控件相对它吸附，才能恒贴视口底。
                 改成 visible/auto 会让页面根 div 随内容撑高、自身永不
                 滚动，sticky 失效，分页掉到内容底部（合并后的回归根因）。 */
              overflow: "hidden",
              flex: 1,
              minHeight: 0,
              minWidth: 1280,
            }}
          >
            {/* 页面级错误边界：单个页面崩溃不影响侧边栏/顶栏，切换路由自动重置 */}
            <ErrorBoundary resetKey={location.pathname}>
              {children}
            </ErrorBoundary>
            {/* keep-alive宿主：常驻缓存页面，切换路由仅隐藏不卸载；独立错误边界避免被页面崩溃波及 */}
            <ErrorBoundary>
              <KeepAliveHost />
            </ErrorBoundary>
          </Content>
        </Layout>
        <ChangePasswordModal
          open={changePasswordOpen}
          onCancel={() => setChangePasswordOpen(false)}
        />
        <Modal
          title="通知详情"
          open={detailModalOpen}
          onCancel={() => setDetailModalOpen(false)}
          footer={
            selectedNotification &&
            (selectedNotification.title?.includes("未处理差评") ||
              selectedNotification.type === "warning") ? (
              <div
                style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
              >
                <Button onClick={() => setDetailModalOpen(false)}>关闭</Button>
                <Button type="primary" onClick={handleGoToReview}>
                  前往处理
                </Button>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button onClick={() => setDetailModalOpen(false)}>关闭</Button>
              </div>
            )
          }
          width={500}
        >
          {selectedNotification && (
            <div style={{ padding: "8px 0" }}>
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ fontSize: 16 }}>
                  {selectedNotification.title}
                </Text>
              </div>

              <div
                style={{
                  background: "#f5f5f5",
                  padding: 16,
                  borderRadius: 8,
                  marginBottom: 16,
                  lineHeight: 1.8,
                }}
              >
                <Text
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                >
                  {selectedNotification.content}
                </Text>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#999",
                  fontSize: 13,
                }}
              >
                <span>
                  <Bell
                    size={14}
                    style={{ marginRight: 4, display: "inline" }}
                  />
                  {selectedNotification.type === "warning" ? "警告" : "通知"}
                </span>
                <span>
                  {dayjs(selectedNotification.created_at).format(
                    "YYYY年MM月DD日 HH:mm",
                  )}
                </span>
              </div>
            </div>
          )}
        </Modal>
      </Layout>
    </div>
  );
};

export default MainLayout;
