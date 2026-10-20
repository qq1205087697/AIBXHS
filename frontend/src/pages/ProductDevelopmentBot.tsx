import React, { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Cascader,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Popover,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  ImageOff,
  ImagePlus,
  Info,
  MinusCircle,
  Pencil,
  Plus,
  PlusCircle,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  Warehouse,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import {
  departmentsApi,
  developmentBotApi,
  storeGroupsApi,
  type DevelopmentProject,
  type DevMyRoles,
  type ProductDevelopmentPayload,
  type ProjectDocInfo,
} from "../api";
import { useAuth } from "../contexts/AuthContext";
import ImagesUpload from "../components/ImagesUpload";

const { Title, Text } = Typography;
const PAGE_SIZE = 12;

// 卡片操作栏图标按钮统一样式
const CardOpBtnStyle = () => (
  <style>{`
    .card-op-btn { width: 34px; height: 30px; display: inline-flex; align-items: center; justify-content: center; color: #475569; }
    .card-op-btn:hover { color: #1677ff !important; background: #eff6ff !important; }
    .card-op-btn.ant-btn-dangerous, .card-op-btn.ant-btn-dangerous:hover { color: #ef4444; }
  `}</style>
);

// 数据库 ad_product_info 商品类目真实取值
const CATEGORY_OPTIONS = [
  "BALLOON",
  "CAKE TOPPER",
  "PARTY SUPPLIES",
  "PARTY FAVOR",
  "DISHWARE PLATE",
  "ADULT COSTUME",
  "BANNER",
  "BACKDROP",
  "GIFT WRAP",
  "DISPOSABLE NAPKIN",
  "HANDBAG",
  "FIGURINE",
  "COSTUME HEADWEAR",
  "PET SUPPLIES",
  "ART CRAFT KIT",
  "CARRIER BAG CASE",
  "COSTUME OUTFIT",
].map((value) => ({ label: value, value }));

const URGENCY_OPTIONS = ["一般", "十分紧急"].map((value) => ({ label: value, value }));

// 待办状态筛选（与 KPI 卡片联动：?tab=purchase|six_face|designer|review）
const STATUS_FILTER_OPTIONS = [
  { label: "待填采购单价", value: "purchase" },
  { label: "待上传六面图", value: "six_face" },
  { label: "待上传产品图", value: "designer" },
  { label: "待审核产品图", value: "review" },
  { label: "美工未通过", value: "review_rejected" },
  { label: "待生成采购单", value: "not_ordered" },
];

// 信息缺失筛选：下拉选择缺失字段，筛选出该字段为空的商品
const MISSING_FIELD_OPTIONS = [
  { label: "英文标题", value: "title" },
  { label: "产品中文名", value: "product_name_zh" },
  { label: "商品类目", value: "category" },
  { label: "关键词", value: "keywords" },
  { label: "采购单价", value: "purchase_price" },
  { label: "关联店铺", value: "related_store" },
  { label: "采购链接", value: "purchase_links" },
  { label: "采购图片/信息分组", value: "purchase_items" },
  { label: "仓库备注", value: "warehouse_note" },
  { label: "站点负责人", value: "site_owners" },
  { label: "竞品ASIN", value: "competitors" },
  { label: "德语关键词", value: "de_keywords" },
  { label: "英语关键词", value: "en_keywords" },
  { label: "澳洲关键词", value: "au_keywords" },
];

const SEASONALITY_OPTIONS = [
  "日常",
  "夏季",
  "圣诞节",
  "万圣节",
  "狂欢节",
  "跨年",
  "冬季",
  "感恩节",
  "复活节",
  "5月毕业季",
  "斋月",
  "四叶草",
  "独立日",
].map((value) => ({ label: value, value }));

interface EmployeeItem {
  nickname?: string | null;
  username?: string;
  department_names?: string;
}

const purchasedTagColor = (value?: string | null) => {
  if (value === "已采购") return "green";
  if (value === "已生成采购单") return "blue";
  return "orange";
};

const getValidImageUrl = (images: string[]) => images.find((image) => /^(https?:\/\/|\/)/i.test(image));

const ProductVisual: React.FC<{ images: string[]; unapprovedWithImages?: boolean }> = ({ images, unapprovedWithImages }) => {
  const [failed, setFailed] = useState(false);
  const imageUrl = getValidImageUrl(images);
  const showImage = Boolean(imageUrl) && !failed;

  return (
    <div style={{ height: 190, background: "#f1f5f9", position: "relative", overflow: "hidden" }}>
      {showImage ? (
        <img src={imageUrl} alt="新品美工图" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#94a3b8" }}>
          <ImageOff size={34} strokeWidth={1.5} />
          <Text type="secondary">{unapprovedWithImages ? "美工图片暂未通过" : images.length ? "图片待上传" : "暂无美工图片"}</Text>
        </div>
      )}
      {images.length > 1 && <Tag style={{ position: "absolute", right: 12, bottom: 12, margin: 0 }}>{images.length} 张</Tag>}
    </div>
  );
};

const urgencyTagColor = (value?: string | null) => {
  if (value === "十分紧急" || value === "高") return "red";
  if (value === "中") return "orange";
  return "default";
};

// TOS 图片命名规范：新品_中文名_日期_序号（清洗文件名非法字符，日期 YYYYMMDD）
const sanitizeFileNamePart = (s?: string | null) =>
  (s || "").trim().replace(/[\\/:*?"<>|\s,，;；]/g, "").slice(0, 40) || "未命名";

const buildDevImageName = (nameZh: string | null | undefined, dateStr: string | null | undefined, index: number) => {
  const d = (dateStr || "").replace(/-/g, "").slice(0, 8) || dayjs().format("YYYYMMDD");
  return `新品_${sanitizeFileNamePart(nameZh)}_${d}_${index + 1}`;
};

// 详情弹窗分区标题
const DetailSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginTop: 18 }}>
    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: "#1e293b", display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 3, height: 14, background: "#1677ff", borderRadius: 2, display: "inline-block" }} />
      {title}
    </div>
    {children}
  </div>
);

// 飞书文档/采购详情按钮：点击弹窗分三段展示（文档链接/采购图片/采购信息）；无文档链接时按记录字段显示
const DocButton: React.FC<{ record: DevelopmentProject }> = ({ record }) => {
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [doc, setDoc] = useState<ProjectDocInfo | null>(null);

  const hasDocLink = Boolean(record.doc_link);

  const loadDoc = async () => {
    if (!hasDocLink) return;
    setLoading(true);
    try {
      const res = await developmentBotApi.getDoc(record.record_id);
      setDoc(res.data?.data || null);
    } catch (e: any) {
      setDoc({ message: e?.response?.data?.detail || "文档加载失败" });
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && !loaded && !loading) loadDoc();
  };

  const handleOpenModal = () => {
    setModalOpen(true);
    setOpen(false);
    if (!loaded && !loading) loadDoc();
  };

  const docTitle = record.doc_name || (hasDocLink ? "飞书文档" : "采购详情");

  // 文档模式数据
  const docImages = (doc?.elements || []).filter((el) => el.type === "image" && el.file_token);
  const docText = (doc?.elements || [])
    .filter((el) => el.type !== "image" && el.content)
    .map((el) => el.content)
    .join("\n");
  // 记录字段模式数据（文档链接为空时）
  const recordLinks = record.purchase_links || [];
  const recordImages = (record.purchase_images || []).filter((u) => /^(https?:\/\/|\/)/i.test(u));

  const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ marginBottom: 14, minWidth: 0 }}>
      <Text strong style={{ display: "block", marginBottom: 6, fontSize: 13, color: "#1e293b" }}>{label}</Text>
      {children}
    </div>
  );

  const linkStyle: React.CSSProperties = { display: "block", color: "#1677ff", wordBreak: "break-all", fontSize: 13, lineHeight: 1.8 };

  const renderSections = (compact: boolean) => {
    if (loading && hasDocLink) {
      return <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>;
    }
    if (!hasDocLink) {
      // 文档链接为空：按新品填写的采购链接/采购图片/采购信息字段显示
      return (
        <>
          <Section label="采购链接">
            {recordLinks.length > 0 ? (
              recordLinks.map((l, i) => (
                <a key={i} href={l} target="_blank" rel="noreferrer" style={linkStyle}>{l}</a>
              ))
            ) : (
              <Text type="secondary" style={{ fontSize: 13 }}>暂无</Text>
            )}
          </Section>
          <Section label="采购图片">
            {recordImages.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8 }}>
                {recordImages.map((u, i) => (
                  <img key={i} src={u} alt={`采购图${i + 1}`} loading="lazy"
                    style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 4, background: "#f8fafc" }}
                    onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                ))}
              </div>
            ) : (
              <Text type="secondary" style={{ fontSize: 13 }}>暂无</Text>
            )}
          </Section>
          <Section label="采购信息">
            {record.purchase_info ? (
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, lineHeight: 1.8, color: "#334155" }}>{record.purchase_info}</div>
            ) : (
              <Text type="secondary" style={{ fontSize: 13 }}>暂无</Text>
            )}
          </Section>
        </>
      );
    }
    // 文档模式：文档链接 + 文档内图片 + 文档文字
    return (
      <>
        {doc?.links_hidden ? (
          <div style={{ marginBottom: 10, padding: "4px 10px", borderRadius: 4, background: "#fff7e6", border: "1px solid #ffd591", color: "#d46b08", fontSize: 12 }}>
            文档中含 {doc.links_hidden} 个采购链接，仅采购部可见
          </div>
        ) : null}
        <Section label="文档链接">
          {doc?.doc_link ? (
            <a href={doc.doc_link} target="_blank" rel="noreferrer" style={linkStyle}>{doc.doc_link}</a>
          ) : (
            <Text type="secondary" style={{ fontSize: 13 }}>暂无</Text>
          )}
        </Section>
        <Section label="采购图片">
          {docImages.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, maxHeight: compact ? 260 : 380, overflowY: "auto" }}>
              {docImages.map((el, i) => (
                <img key={i} src={`/api/product-development/doc-image/${el.file_token}`} alt={`文档图${i + 1}`} loading="lazy"
                  style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 4, background: "#f8fafc" }}
                  onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              ))}
            </div>
          ) : (
            <Text type="secondary" style={{ fontSize: 13 }}>暂无</Text>
          )}
        </Section>
        <Section label="采购信息">
          {docText || doc?.content ? (
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, lineHeight: 1.8, color: "#334155", maxHeight: compact ? 200 : 320, overflowY: "auto" }}>
              {docText || doc?.content}
            </div>
          ) : (
            <Text type="secondary" style={{ fontSize: 13 }}>{doc?.message || "暂无"}</Text>
          )}
        </Section>
      </>
    );
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
        trigger="hover"
        mouseEnterDelay={0.35}
        title={
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FileText size={14} /> {docTitle}
          </span>
        }
        content={<div style={{ width: 420, maxWidth: "70vw", overflow: "hidden" }}>{renderSections(true)}</div>}
      >
        <Tooltip title={docTitle}>
          <Button type="text" icon={<FileText size={15} />} onClick={handleOpenModal} />
        </Tooltip>
      </Popover>
      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={880}
        title={
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileText size={16} /> {docTitle}
            {doc?.doc_link && (
              <Button
                type="link"
                size="small"
                icon={<ExternalLink size={13} />}
                onClick={(e) => { e.stopPropagation(); window.open(doc.doc_link!, "_blank"); }}
              >
                在飞书中打开
              </Button>
            )}
          </span>
        }
      >
        <div style={{ overflow: "hidden" }}>{renderSections(false)}</div>
      </Modal>
    </>
  );
};

const ProductDevelopmentBot: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<DevelopmentProject[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [roles, setRoles] = useState<DevMyRoles | null>(null);

  // 自定义类目（管理员可添加）
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);

  const categorySelectOptions = useMemo(
    () => [
      ...Array.from(new Set([...customCategories])).map((c) => ({ label: c, value: c })),
      ...(roles?.is_admin ? [{ label: "＋ 新增类目", value: "__add_category__" }] : []),
    ],
    [customCategories, roles?.is_admin],
  );

  const loadCustomCategories = () => {
    developmentBotApi
      .getCategories()
      .then((res) => setCustomCategories(res.data?.data || []))
      .catch(() => {});
  };

  const handleAddCategory = async () => {
    const name = categoryName.trim();
    if (!name) {
      message.warning("请输入类目名称");
      return;
    }
    setCategorySaving(true);
    try {
      await developmentBotApi.addCategory(name);
      message.success(`类目「${name}」已添加`);
      loadCustomCategories();
      setCategoryFilter(name);
      setPage(1);
      setCategoryModalOpen(false);
      setCategoryName("");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "添加失败，请稍后重试");
    } finally {
      setCategorySaving(false);
    }
  };


  // 勾选生成补货单
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [replenishOpen, setReplenishOpen] = useState(false);
  const [replenishQty, setReplenishQty] = useState<Record<string, number>>({});
  const [replenishNotes, setReplenishNotes] = useState("");
  const [storeGroupId, setStoreGroupId] = useState<number>();
  const [storeGroups, setStoreGroups] = useState<{ id: number; name: string }[]>([]);
  const [replenishSaving, setReplenishSaving] = useState(false);

  // 四类部门协作弹窗
  const [purchaseRecord, setPurchaseRecord] = useState<DevelopmentProject | null>(null);
  const [purchaseForm] = Form.useForm();
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [warehouseRecord, setWarehouseRecord] = useState<DevelopmentProject | null>(null);
  const [warehouseImages, setWarehouseImages] = useState<string[]>([]);
  const [warehouseNote, setWarehouseNote] = useState("");
  const [warehouseSaving, setWarehouseSaving] = useState(false);
  const [designerRecord, setDesignerRecord] = useState<DevelopmentProject | null>(null);
  const [designerImages, setDesignerImages] = useState<string[]>([]);
  const [designerSaving, setDesignerSaving] = useState(false);
  const [reviewRecord, setReviewRecord] = useState<DevelopmentProject | null>(null);
  const [detailRecord, setDetailRecord] = useState<DevelopmentProject | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);

  const [editing, setEditing] = useState<DevelopmentProject | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm] = Form.useForm();
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const { user } = useAuth();

  // 店铺分组树（编辑弹窗级联选项）+ 站点负责人站点映射
  interface StoreNode { id: number; name: string; stores: { id: number; name: string; site?: string | null }[] }
  const [storeTree, setStoreTree] = useState<{ groups: StoreNode[]; owner_sites: Record<string, string[]> }>({ groups: [], owner_sites: {} });
  React.useEffect(() => {
    storeGroupsApi
      .getTree()
      .then((res) => {
        const d = res.data?.data;
        if (d) setStoreTree({ groups: d.groups || [], owner_sites: d.owner_sites || {} });
      })
      .catch(() => {});
  }, []);

  const storeToGroup = useMemo(() => {
    const map: Record<string, string> = {};
    storeTree.groups.forEach((g) => g.stores.forEach((s) => { map[s.name] = g.name; }));
    return map;
  }, [storeTree]);

  // 编辑弹窗店铺选择与添加新品一致：只到分组一级，数量对应分组下所有店铺
  const editSiteOwners = Form.useWatch("site_owners", editForm) as string[] | undefined;
  const editStoreOptions = useMemo(() => {
    let allowed: Set<string> | null = null;
    if (editSiteOwners?.length) {
      allowed = new Set<string>();
      editSiteOwners.forEach((o) => (storeTree.owner_sites[o] || []).forEach((s) => allowed!.add(s)));
      if (allowed.size === 0) allowed = null;
    }
    return storeTree.groups
      .filter((g) => !allowed || g.stores.some((s) => s.site && allowed.has(s.site)))
      .map((g) => ({ label: g.name, value: g.name }));
  }, [storeTree, editSiteOwners]);

  // 站点负责人员选项（全部员工昵称去重）
  const siteOwnerOptions = useMemo(() => {
    const names = new Set<string>();
    employees.forEach((emp) => {
      const name = (emp.nickname || emp.username || "").trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, "zh")).map((n) => ({ label: n, value: n }));
  }, [employees]);

  // 筛选栏状态（与选品机器人筛选栏一致）
  const [categoryFilter, setCategoryFilter] = useState<string>();
  const [urgencyFilter, setUrgencyFilter] = useState<string>();
  const [seasonalityFilter, setSeasonalityFilter] = useState<string>();
  const [developerFilter, setDeveloperFilter] = useState<string>();
  const [dateFilter, setDateFilter] = useState<dayjs.Dayjs | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>();
  const [missingFilter, setMissingFilter] = useState<string>();
  const [filterOptions, setFilterOptions] = useState<{
    categories: string[];
    urgencies: string[];
    seasonalities: string[];
    developers: string[];
  }>({ categories: [], urgencies: [], seasonalities: [], developers: [] });

  // 筛选下拉选项（取自数据库去重）+ 当前用户角色
  React.useEffect(() => {
    developmentBotApi
      .getFilters()
      .then((res) => {
        if (res.data?.success) setFilterOptions(res.data.data || { categories: [], urgencies: [], seasonalities: [], developers: [] });
      })
      .catch(() => {});
    developmentBotApi
      .getMyRoles()
      .then((res) => {
        if (res.data?.success) setRoles(res.data.data);
      })
      .catch(() => {});
    loadCustomCategories();
  }, []);

  // 数据加载
  const fetchData = React.useCallback(async (targetPage = page, targetSearch = search) => {
    setLoading(true);
    try {
      const res = await developmentBotApi.list({
        page: targetPage,
        page_size: PAGE_SIZE,
        search: targetSearch || undefined,
        category: categoryFilter,
        urgency: urgencyFilter,
        seasonality: seasonalityFilter,
        developer: developerFilter,
        date: dateFilter ? dateFilter.format("YYYY-MM-DD") : undefined,
        status: statusFilter,
        missing: missingFilter,
      });
      if (res.data?.success) {
        setItems(res.data.data?.items || []);
        setTotal(res.data.data?.total || 0);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "加载新品记录失败");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, categoryFilter, urgencyFilter, seasonalityFilter, developerFilter, dateFilter, statusFilter, missingFilter]);

  React.useEffect(() => {
    fetchData(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, categoryFilter, urgencyFilter, seasonalityFilter, developerFilter, dateFilter, statusFilter, missingFilter]);

  // 搜索防抖
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // 员工列表（按部门分组）；非管理员 403 时降级为当前登录用户
  React.useEffect(() => {
    let cancelled = false;
    departmentsApi
      .getAllUsers()
      .then((res) => {
        if (!cancelled) setEmployees(res.data?.data || []);
      })
      .catch(() => {
        if (!cancelled) setEmployees([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const employeeOptions = useMemo(() => {
    const groups = new Map<string, string[]>();
    employees.forEach((emp) => {
      const name = (emp.nickname || emp.username || "").trim();
      if (!name) return;
      const depts = (emp.department_names || "")
        .split(/[,，、;；]/)
        .map((s) => s.trim())
        .filter(Boolean);
      (depts.length ? depts : ["未分配部门"]).forEach((dept) => {
        if (!groups.has(dept)) groups.set(dept, []);
        const list = groups.get(dept)!;
        if (!list.includes(name)) list.push(name);
      });
    });
    return Array.from(groups.entries()).map(([dept, names]) => ({
      label: dept,
      title: dept,
      options: names.map((name) => ({ label: name, value: name })),
    }));
  }, [employees]);

  // KPI 通知跳转：?record=xxx&tab=purchase|six_face|designer|review 直接打开对应弹窗；仅 tab 时切换待办筛选
  React.useEffect(() => {
    const record = searchParams.get("record");
    const tab = searchParams.get("tab");
    if (!record && !tab) return;
    if (tab && !record) {
      if (STATUS_FILTER_OPTIONS.some((o) => o.value === tab)) setStatusFilter(tab);
      setSearchParams({}, { replace: true });
      return;
    }
    const openFor = (item: DevelopmentProject) => {
      if (tab === "purchase") {
        purchaseForm.setFieldsValue({ purchase_price: item.purchase_price, purchased: item.purchased || "未采购", purchase_note: item.purchase_note || "" });
        setPurchaseRecord(item);
      } else if (tab === "six_face" || tab === "warehouse") {
        setWarehouseImages(item.six_face_images || []);
        setWarehouseNote(item.warehouse_note || "");
        setWarehouseRecord(item);
      } else if (tab === "designer") {
        setDesignerImages(item.designer_images || []);
        setDesignerRecord(item);
      } else if (tab === "review") {
        setReviewRecord(item);
      }
      setSearchParams({}, { replace: true });
    };
    const found = items.find((i) => i.record_id === record);
    if (found) {
      openFor(found);
    } else if (!loading) {
      developmentBotApi
        .getDetail(record!)
        .then((res) => {
          if (res.data?.success && res.data.data) openFor(res.data.data);
          else message.warning("未找到对应新品记录");
        })
        .catch(() => message.warning("未找到对应新品记录或无权查看"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, items, loading]);

  // 店铺分组（生成补货单选择）
  React.useEffect(() => {
    storeGroupsApi
      .getList()
      .then((res) => {
        const list = res.data?.data || res.data || [];
        if (Array.isArray(list)) setStoreGroups(list.map((g: any) => ({ id: g.id, name: g.name })).filter((g: any) => g.id));
      })
      .catch(() => {});
  }, []);

  const selectedRecords = useMemo(() => items.filter((i) => selectedIds.has(i.record_id)), [items, selectedIds]);

  const toggleSelect = (recordId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  };

  const handleReplenishSubmit = async () => {
    if (selectedRecords.length === 0) return;
    setReplenishSaving(true);
    try {
      const res = await developmentBotApi.createReplenishment({
        store_group_id: storeGroupId,
        notes: replenishNotes.trim() || undefined,
        items: selectedRecords.map((r) => ({ record_id: r.record_id, quantity: replenishQty[r.record_id] ?? 100 })),
      });
      if (res.data?.success) {
        const d = res.data.data || {};
        message.success(`补货单 ${d.order_number || ""} 已生成（${d.item_count} 条明细），可在进销存-补货管理中查看`);
        setReplenishOpen(false);
        setSelectedIds(new Set());
        setReplenishQty({});
        setReplenishNotes("");
        fetchData();
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "生成补货单失败，请稍后重试");
    } finally {
      setReplenishSaving(false);
    }
  };

  const handlePurchaseSave = async (values: any) => {
    if (!purchaseRecord) return;
    setPurchaseSaving(true);
    try {
      await developmentBotApi.updatePurchase(purchaseRecord.record_id, {
        purchase_price: values.purchase_price,
        purchased: values.purchased || "已采购",
        purchase_note: (values.purchase_note || "").trim() || undefined,
      });
      message.success("已保存采购信息");
      setPurchaseRecord(null);
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "保存失败，请稍后重试");
    } finally {
      setPurchaseSaving(false);
    }
  };

  const handleWarehouseSave = async () => {
    if (!warehouseRecord) return;
    setWarehouseSaving(true);
    try {
      await developmentBotApi.updateWarehouse(warehouseRecord.record_id, {
        six_face_images: warehouseImages,
        warehouse_note: warehouseNote.trim() || undefined,
      });
      message.success("已保存六面图与仓库备注");
      setWarehouseRecord(null);
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "保存失败，请稍后重试");
    } finally {
      setWarehouseSaving(false);
    }
  };

  const handleDesignerSave = async () => {
    if (!designerRecord) return;
    if (designerImages.length === 0) {
      message.warning("请先上传产品图片");
      return;
    }
    setDesignerSaving(true);
    try {
      await developmentBotApi.uploadDesignerImage(designerRecord.record_id, designerImages);
      message.success("产品图片已上传，完成日期已自动记录，并已推送管理层审核");
      setDesignerRecord(null);
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "上传失败，请稍后重试");
    } finally {
      setDesignerSaving(false);
    }
  };

  const handleReview = async (approved: boolean) => {
    if (!reviewRecord) return;
    setReviewSaving(true);
    try {
      await developmentBotApi.reviewImage(reviewRecord.record_id, approved);
      message.success(approved ? "审核通过，首页将展示该产品图片" : "已标记为不通过");
      setReviewRecord(null);
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "审核失败，请稍后重试");
    } finally {
      setReviewSaving(false);
    }
  };

  // 打开编辑弹窗并回填表单（关键词列在库中是合并值，回填到"英文标题关键词"，"关键词"留空避免重复）
  React.useEffect(() => {
    if (!editing) return;
    editForm.setFieldsValue({
      title: editing.title || "",
      product_title: editing.keywords || "",
      product_name_zh: editing.product_name_zh || "",
      category: editing.category || undefined,
      developer: editing.developer || undefined,
      urgency: editing.urgency || "一般",
      seasonality: editing.seasonality || undefined,
      competitors: editing.competitors || "",
      purchase_price: editing.purchase_price ?? undefined,
      de_keywords: editing.de_keywords || "",
      en_keywords: editing.en_keywords || "",
      au_keywords: editing.au_keywords || "",
      development_date: editing.development_date ? dayjs(editing.development_date) : undefined,
      reference_images: editing.purchase_images || [],
      site_owners: editing.site_owners
        ? String(editing.site_owners).split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
        : [],
      store_rows: (editing.store_quantities && editing.store_quantities.length > 0
        ? editing.store_quantities.map((s) => ({
            path: storeToGroup[s.store] ? [storeToGroup[s.store]] : [s.store],
            quantity: s.quantity,
          }))
        : [{ path: undefined, quantity: undefined }]),
      purchase_items: editing.purchase_items && editing.purchase_items.length > 0
        ? editing.purchase_items.map((it) => ({ link: it.link || "", images: it.images || [], info: it.info || "" }))
        : [{ link: "", images: [], info: "" }],
      purchase_info: editing.purchase_info || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editForm]);

  const handleEditSave = async (values: any) => {
    if (!editing) return;
    const payload: ProductDevelopmentPayload = {
      title: values.title?.trim() || "",
      product_title: values.product_title?.trim() || "",
      product_name_zh: values.product_name_zh?.trim() || "",
      category: values.category || "",
      developer: values.developer || "",
      urgency: values.urgency || "一般",
      seasonality: values.seasonality || "",
      competitors: values.competitors?.trim() || "",
      purchase_price: values.purchase_price,
      de_keywords: values.de_keywords?.trim() || "",
      en_keywords: values.en_keywords?.trim() || "",
      au_keywords: values.au_keywords?.trim() || "",
      development_date: values.development_date ? dayjs(values.development_date).format("YYYY-MM-DD") : "",
      reference_images: values.reference_images || [],
      site_owners: (values.site_owners || []).join(",") || undefined,
      related_store: (values.store_rows || [])
        .map((r: any) => (r?.path?.[0] || "").trim())
        .filter(Boolean)
        .join("，") || undefined,
      store_quantities: (values.store_rows || [])
        .map((r: any) => ({ store: (r?.path?.[0] || "").trim(), quantity: r?.quantity ?? 0 }))
        .filter((s: any) => s.store),
      purchase_items: (values.purchase_items || [])
        .map((it: any) => ({ link: (it?.link || "").trim() || undefined, images: it?.images || [], info: (it?.info || "").trim() || undefined }))
        .filter((it: any) => it.link || (it.images && it.images.length) || it.info),
      purchase_info: values.purchase_info?.trim() || undefined,
      warehouse_note: values.warehouse_note?.trim() || undefined,
    };
    setSavingEdit(true);
    try {
      await developmentBotApi.update(editing.record_id, payload);
      message.success("已保存修改");
      setEditing(null);
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "保存失败，请稍后重试");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (record: DevelopmentProject) => {
    try {
      await developmentBotApi.remove(record.record_id);
      message.success("已删除该新品记录");
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "删除失败，请稍后重试");
    }
  };

  // 生成采购单：按店铺分组采购数量在进销存采购管理创建采购单
  const [orderingId, setOrderingId] = useState<string | null>(null);
  const handleCreatePurchaseOrder = async (record: DevelopmentProject) => {
    setOrderingId(record.record_id);
    try {
      const res = await developmentBotApi.createPurchaseOrder(record.record_id);
      message.success(`已生成采购单 ${res.data?.data?.order_number || ""}`);
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "生成采购单失败，请稍后重试");
    } finally {
      setOrderingId(null);
    }
  };

  // 回传飞书：新增/修改多维表记录并回传记录 ID
  const [pushingId, setPushingId] = useState<string | null>(null);
  const handlePushToFeishu = async (record: DevelopmentProject) => {
    setPushingId(record.record_id);
    try {
      const res = await developmentBotApi.pushToFeishu(record.record_id);
      const d = res.data?.data || {};
      message.success(
        d.mode === "created"
          ? `已新增飞书记录 ${d.record_id}（回填 ${d.fields_filled ?? 0} 个字段${d.images_attached ? `，附图 ${d.images_attached} 张` : ""}）`
          : `已更新飞书记录 ${d.record_id}`,
      );
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "回传飞书失败，请稍后重试");
    } finally {
      setPushingId(null);
    }
  };

  // 复制商品：以原记录字段生成一条新记录（开发人员为当前账号），随后可编辑修改
  const handleCopyProduct = async (record: DevelopmentProject) => {
    setCopyingId(record.record_id);
    try {
      const payload: ProductDevelopmentPayload = {
        title: record.title || "",
        product_title: record.keywords || "",
        product_name_zh: record.product_name_zh || "",
        category: record.category || "",
        developer: user?.nickname || record.developer || "",
        urgency: record.urgency || "一般",
        seasonality: record.seasonality || "",
        competitors: record.competitors || "",
        purchase_price: record.purchase_price,
        de_keywords: record.de_keywords || "",
        en_keywords: record.en_keywords || "",
        au_keywords: record.au_keywords || "",
        development_date: dayjs().format("YYYY-MM-DD"),
        reference_images: record.purchase_images || [],
        site_owners: record.site_owners || undefined,
        related_store: record.related_store || undefined,
        store_quantities: record.store_quantities,
        purchase_items: record.purchase_items,
        purchase_info: record.purchase_info || undefined,
        warehouse_note: record.warehouse_note || undefined,
      };
      await developmentBotApi.create(payload);
      message.success("已复制为一条新品记录，可点击「编辑」修改内容");
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "复制失败，请稍后重试");
    } finally {
      setCopyingId(null);
    }
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", background: "#fff" }}>
      <CardOpBtnStyle />
      <div style={{ padding: "24px 28px 40px", maxWidth: 1720, margin: "0 auto" }}>
        <Card bordered={false} style={{ marginBottom: 20 }} styles={{ body: { padding: "22px 26px" } }}>
          <Space align="start" size={14}>
            <div style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: "#e0e7ff", color: "#4338ca" }}><Rocket size={23} /></div>
            <div>
              <Title level={2} style={{ margin: 0 }}>开发机器人</Title>
              <Text type="secondary">连接产品开发数据库（ad_product_info），支持查询、编辑与删除</Text>
            </div>
          </Space>
          <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <Space wrap>
              <Input
                allowClear
                prefix={<Search size={16} />}
                placeholder="搜索英文标题、关键词、中文名称、类目"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                style={{ width: 250 }}
              />
              <Select
                placeholder="类目"
                options={[...filterOptions.categories.map((c) => ({ label: c, value: c })), ...categorySelectOptions]}
                value={categoryFilter}
                onChange={(v) => { setCategoryFilter(v === "__add_category__" ? undefined : v); if (v === "__add_category__") { setCategoryName(""); setCategoryModalOpen(true); } else { setPage(1); } }}
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 150 }}
              />
              <Select
                placeholder="紧急程度"
                options={filterOptions.urgencies.map((u) => ({ label: u, value: u }))}
                value={urgencyFilter}
                onChange={(v) => { setUrgencyFilter(v); setPage(1); }}
                allowClear
                style={{ width: 120 }}
              />
              <Select
                placeholder="季节性"
                options={filterOptions.seasonalities.map((s) => ({ label: s, value: s }))}
                value={seasonalityFilter}
                onChange={(v) => { setSeasonalityFilter(v); setPage(1); }}
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 130 }}
              />
              <Select
                placeholder="开发人员"
                options={filterOptions.developers.map((d) => ({ label: d, value: d }))}
                value={developerFilter}
                onChange={(v) => { setDeveloperFilter(v); setPage(1); }}
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 130 }}
              />
              <DatePicker
                placeholder="日期"
                value={dateFilter}
                onChange={(v) => { setDateFilter(v); setPage(1); }}
                allowClear
                style={{ width: 130 }}
              />
              <Select
                placeholder="待办状态"
                options={STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onChange={(v) => { setStatusFilter(v); setPage(1); }}
                allowClear
                style={{ width: 140 }}
              />
              <Select
                placeholder="信息缺失"
                options={MISSING_FIELD_OPTIONS}
                value={missingFilter}
                onChange={(v) => { setMissingFilter(v); setPage(1); }}
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 150 }}
              />
              <Button
                icon={<RotateCcw size={15} />}
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                  setCategoryFilter(undefined);
                  setUrgencyFilter(undefined);
                  setSeasonalityFilter(undefined);
                  setDeveloperFilter(undefined);
                  setDateFilter(null);
                  setStatusFilter(undefined);
                  setMissingFilter(undefined);
                  setPage(1);
                }}
              >
                重置
              </Button>
              <Button icon={<RefreshCw size={15} />} onClick={() => fetchData()}>刷新</Button>
            </Space>
            <Button type="primary" icon={<Plus size={16} />} onClick={() => navigate("/development/new")}>添加新品</Button>
          </div>
        </Card>

        <Spin spinning={loading}>
          {selectedRecords.length > 0 && (
            <Alert
              style={{ marginBottom: 16 }}
              type="info"
              showIcon={false}
              message={
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span>已勾选 <Text strong>{selectedRecords.length}</Text> 件商品</span>
                  <Space>
                    <Button type="primary" icon={<ShoppingCart size={15} />} onClick={() => setReplenishOpen(true)}>生成补货单</Button>
                    <Button onClick={() => setSelectedIds(new Set())}>取消勾选</Button>
                  </Space>
                </div>
              }
            />
          )}
          {items.length === 0 && !loading ? (
            <Card bordered={false}><Empty description="暂无新品记录，点击右上角「添加新品」开始录入" /></Card>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(262px, 1fr))", gap: 18 }}>
              {items.map((product) => {
                const reviewText = product.image_review || "";
                const reviewed = reviewText.includes("通过") && !reviewText.includes("不通过");
                // 只显示美工图片；未审核一律不显示图片
                const displayImages = reviewed ? product.designer_images || [] : [];
                const hasRoleAction = roles?.can_purchase || roles?.can_warehouse || roles?.can_design || roles?.can_review;
                return (
                <div key={product.record_id}>
                  <Card
                    bordered={false}
                    styles={{ body: { padding: 0 } }}
                    hoverable
                    actions={[
                      <div key="ops" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, width: "100%" }}>
                        <Tooltip title="编辑商品信息">
                          <Button className="card-op-btn" type="text" icon={<Pencil size={16} />} onClick={() => setEditing(product)} />
                        </Tooltip>
                        <Tooltip title="复制为一条新品，可再编辑">
                          <Button className="card-op-btn" type="text" icon={<Copy size={16} />} loading={copyingId === product.record_id} onClick={() => handleCopyProduct(product)} />
                        </Tooltip>
                        <span style={{ width: 1, height: 16, background: "#e2e8f0", margin: "0 6px" }} />
                        <Tooltip title="回传飞书多维表（已存在则修改，否则新增并回传记录ID）">
                          <Button className="card-op-btn" type="text" icon={<Rocket size={16} />} loading={pushingId === product.record_id} onClick={() => handlePushToFeishu(product)} />
                        </Tooltip>
                        <DocButton record={product} />
                        <Popconfirm title="确认删除这条新品记录？" description="删除后不可恢复" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(product)}>
                          <Tooltip title="删除">
                            <Button className="card-op-btn" type="text" danger icon={<Trash2 size={16} />} />
                          </Tooltip>
                        </Popconfirm>
                      </div>,
                    ]}
                  >
                    <div style={{ position: "relative" }}>
                      <ProductVisual images={displayImages} unapprovedWithImages={!reviewed && (product.designer_images || []).length > 0} />
                      <div style={{ position: "absolute", left: 10, top: 10, zIndex: 2 }}>
                        <Checkbox checked={selectedIds.has(product.record_id)} onChange={(e) => toggleSelect(product.record_id, e.target.checked)} />
                      </div>
                      {reviewed
                        ? <Tag color="green" style={{ position: "absolute", right: 12, top: 10, margin: 0 }}>已审核</Tag>
                        : reviewText.includes("不通过")
                          ? <Tag color="red" style={{ position: "absolute", right: 12, top: 10, margin: 0 }}>未通过</Tag>
                          : <Tag color="orange" style={{ position: "absolute", right: 12, top: 10, margin: 0 }}>未审核</Tag>}
                    </div>
                    <div style={{ padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>{product.category || "-"}</Text>
                            {product.product_code
                              ? <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{product.product_code}</Tag>
                              : <Tag style={{ margin: 0, fontSize: 11, color: "#94a3b8", borderColor: "#e2e8f0", background: "#f8fafc" }}>产品编码：暂无</Tag>}
                          </div>
                          <Text strong ellipsis={{ tooltip: product.product_name_zh }} style={{ display: "block", marginTop: 6, minWidth: 0, fontSize: 15 }}>{product.product_name_zh || "-"}</Text>
                        </div>
                        {product.urgency && <Tag color={urgencyTagColor(product.urgency)}>{product.urgency}</Tag>}
                        <Tag color={purchasedTagColor(product.purchased)} style={{ margin: 0 }}>{product.purchased || "未采购"}</Tag>
                      </div>

                      {product.purchase_note && (
                        <div style={{ marginTop: 8, padding: "6px 10px", background: "#fff7e6", border: "1px solid #ffd591", borderRadius: 4, fontSize: 12, color: "#d46b08" }}>
                          <Text type="secondary" style={{ fontSize: 12, color: "#d46b08" }}>采购备注：</Text>
                          <span style={{ wordBreak: "break-all" }}>{product.purchase_note}</span>
                        </div>
                      )}

                      {hasRoleAction && (
                        <Space wrap size={6} style={{ marginTop: 10 }}>
                          {roles?.can_purchase && (
                            <Button size="small" icon={<span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1 }}>¥</span>} onClick={() => { purchaseForm.setFieldsValue({ purchase_price: product.purchase_price, purchased: product.purchased || "未采购", purchase_note: product.purchase_note || "" }); setPurchaseRecord(product); }}>采购填写</Button>
                          )}
                          {roles?.can_warehouse && (
                            <Button size="small" icon={<Warehouse size={13} />} onClick={() => { setWarehouseImages(product.six_face_images || []); setWarehouseNote(product.warehouse_note || ""); setWarehouseRecord(product); }}>仓库上传</Button>
                          )}
                          {roles?.can_design && (
                            <Button size="small" icon={<ImagePlus size={13} />} onClick={() => { setDesignerImages(product.designer_images || []); setDesignerRecord(product); }}>美工传图</Button>
                          )}
                          {roles?.can_review && (
                            <Button size="small" icon={<CheckCircle2 size={13} />} onClick={() => setReviewRecord(product)}>审核</Button>
                          )}
                        </Space>
                      )}

                      <Button
                        type="link"
                        size="small"
                        icon={<Info size={14} />}
                        style={{ padding: 0, marginTop: 12, height: "auto" }}
                        onClick={() => setDetailRecord(product)}
                      >
                        查看详细信息
                      </Button>
                    </div>
                  </Card>
                </div>
                );
              })}
            </div>
          )}

          <Modal
            open={categoryModalOpen}
            title="新增类目"
            okText="添加"
            cancelText="取消"
            confirmLoading={categorySaving}
            onOk={handleAddCategory}
            onCancel={() => setCategoryModalOpen(false)}
            destroyOnHidden
          >
            <Input
              placeholder="输入新类目名称（如 PARTY GAMES）"
              value={categoryName}
              maxLength={100}
              showCount
              autoFocus
              onChange={(e) => setCategoryName(e.target.value)}
              onPressEnter={handleAddCategory}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>仅管理人员可添加，添加后可在类目筛选与新品表单中使用。</Text>
          </Modal>

          {/* 新品详情大弹窗 */}
          <Modal
            open={!!detailRecord}
            onCancel={() => setDetailRecord(null)}
            footer={null}
            width={960}
            title={
              detailRecord ? (
                <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <Info size={17} color="#1677ff" />
                  {detailRecord.product_name_zh || detailRecord.title || "新品详情"}
                  {detailRecord.product_code
                    ? <Tag color="blue" style={{ margin: 0 }}>{detailRecord.product_code}</Tag>
                    : <Tag style={{ margin: 0, color: "#94a3b8" }}>产品编码：暂无</Tag>}
                </span>
              ) : "新品详情"
            }
          >
            {detailRecord && (
              <div style={{ maxHeight: "72vh", overflowY: "auto", paddingRight: 6 }}>
                {(() => {
                  const reviewText = detailRecord.image_review || "";
                  const detailReviewed = reviewText.includes("通过") && !reviewText.includes("不通过");
                  const imgs = (detailReviewed ? detailRecord.designer_images || [] : [])
                    .filter((u) => /^(https?:\/\/|\/)/i.test(u));
                  return imgs.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
                      {imgs.map((u, i) => (
                        <img key={i} src={u} alt={`图${i + 1}`} loading="lazy"
                          style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 6, background: "#f8fafc" }}
                          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                      ))}
                    </div>
                  ) : null;
                })()}

                <DetailSection title="基础资料">
                  <Descriptions column={2} size="small" bordered labelStyle={{ width: 110, color: "#64748b" }}>
                    <Descriptions.Item label="英文标题" span={2}>{detailRecord.title || "-"}</Descriptions.Item>
                    <Descriptions.Item label="关键词" span={2}>{detailRecord.keywords || "-"}</Descriptions.Item>
                    <Descriptions.Item label="产品中文名称">{detailRecord.product_name_zh || "-"}</Descriptions.Item>
                    <Descriptions.Item label="类目">{detailRecord.category || "-"}</Descriptions.Item>
                    <Descriptions.Item label="产品季节性">{detailRecord.seasonality || "-"}</Descriptions.Item>
                    <Descriptions.Item label="产品紧急度">{detailRecord.urgency || "-"}</Descriptions.Item>
                    <Descriptions.Item label="日期">{detailRecord.development_date || "-"}</Descriptions.Item>
                    <Descriptions.Item label="开发人员">{detailRecord.developer || "-"}</Descriptions.Item>
                    <Descriptions.Item label="关联店铺">{detailRecord.related_store || "-"}</Descriptions.Item>
                    <Descriptions.Item label="产品编码">{detailRecord.product_code || "暂无"}</Descriptions.Item>
                  </Descriptions>
                </DetailSection>

                {(detailRecord.platform_items || []).length > 0 && (
                  <DetailSection title="平台商品（产品库店铺对应）">
                    <div style={{ border: "1px solid #f0f0f0", borderRadius: 6, overflow: "hidden" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1fr", background: "#fafafa", padding: "8px 12px", fontWeight: 600, fontSize: 13, color: "#475569" }}>
                        <span>店铺</span><span>SKU</span><span>ASIN</span>
                      </div>
                      {(detailRecord.platform_items || []).map((it: { store?: string; sku?: string; asin?: string }, i: number) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1fr", padding: "8px 12px", fontSize: 13, borderTop: i === 0 ? "none" : "1px solid #f0f0f0", color: "#334155" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.store || "-"}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sku || "-"}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.asin || "-"}</span>
                        </div>
                      ))}
                    </div>
                  </DetailSection>
                )}

                <DetailSection title="价格与采购">
                  <Descriptions column={2} size="small" bordered labelStyle={{ width: 110, color: "#64748b" }}>
                    <Descriptions.Item label="采购单价">{detailRecord.purchase_price == null ? "-" : `¥${Number(detailRecord.purchase_price).toFixed(2)}`}</Descriptions.Item>
                    <Descriptions.Item label="采购状态">
                      <Space size={8}>
                        <Tag color={purchasedTagColor(detailRecord.purchased)} style={{ margin: 0 }}>{detailRecord.purchased || "未采购"}</Tag>
                        {(detailRecord.purchased || "未采购") === "未采购" && (
                          <Button size="small" icon={<ShoppingCart size={13} />} loading={orderingId === detailRecord.record_id} onClick={() => handleCreatePurchaseOrder(detailRecord)}>
                            采购
                          </Button>
                        )}
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="采购备注" span={2}>{detailRecord.purchase_note || "-"}</Descriptions.Item>
                    <Descriptions.Item label="竞品ASIN" span={2}>{detailRecord.competitors || "-"}</Descriptions.Item>
                    {(detailRecord.store_quantities || []).length > 0 && (
                      <Descriptions.Item label="店铺采购数量" span={2}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {detailRecord.store_quantities!.map((s, i) => (
                            <Tag key={i} style={{ margin: 0 }}>{s.store} × {s.quantity}</Tag>
                          ))}
                        </div>
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                  {(detailRecord.purchase_items || []).length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      <Text strong style={{ display: "block", marginBottom: 8, fontSize: 13 }}>采购链接 / 图片 / 信息（一一对应）</Text>
                      {(detailRecord.purchase_items || []).map((it, i) => {
                        const imgs = (it.images || []).filter((u) => /^(https?:\/\/|\/)/i.test(u));
                        return (
                          <div key={i} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: "10px 14px", marginBottom: 8, background: "#fafbfc" }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                              <Tag color="blue">组 {i + 1}</Tag>
                              {it.link ? (
                                <a href={it.link} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all", fontSize: 13 }}>{it.link}</a>
                              ) : (
                                <Text type="secondary" style={{ fontSize: 13 }}>无链接</Text>
                              )}
                            </div>
                            {it.info && (
                              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, color: "#334155", marginBottom: imgs.length ? 8 : 0 }}>{it.info}</div>
                            )}
                            {imgs.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {imgs.map((u, j) => (
                                  <img key={j} src={u} alt={`采购图${i + 1}-${j + 1}`} loading="lazy"
                                    style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 6, background: "#f8fafc" }} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <Descriptions column={1} size="small" bordered labelStyle={{ width: 110, color: "#64748b" }} style={{ marginTop: 12 }}>
                      <Descriptions.Item label="采购链接">
                        {(detailRecord.purchase_links || []).length > 0 ? (
                          <div>
                            {detailRecord.purchase_links!.map((l, i) => (
                              <a key={i} href={l} target="_blank" rel="noreferrer" style={{ display: "block", wordBreak: "break-all", lineHeight: 1.8 }}>{l}</a>
                            ))}
                          </div>
                        ) : "-"}
                      </Descriptions.Item>
                      <Descriptions.Item label="采购信息">
                        <div style={{ whiteSpace: "pre-wrap" }}>{detailRecord.purchase_info || "-"}</div>
                      </Descriptions.Item>
                    </Descriptions>
                  )}
                </DetailSection>

                <DetailSection title="多语言资料">
                  <Descriptions column={1} size="small" bordered labelStyle={{ width: 110, color: "#64748b" }}>
                    <Descriptions.Item label="德语关键词">{detailRecord.de_keywords || "-"}</Descriptions.Item>
                    <Descriptions.Item label="英语关键词">{detailRecord.en_keywords || "-"}</Descriptions.Item>
                    <Descriptions.Item label="澳洲关键词">{detailRecord.au_keywords || "-"}</Descriptions.Item>
                  </Descriptions>
                </DetailSection>

                <DetailSection title="部门协作">
                  <Descriptions column={2} size="small" bordered labelStyle={{ width: 110, color: "#64748b" }}>
                    <Descriptions.Item label="图片审核">{detailRecord.image_review || "未审核"}</Descriptions.Item>
                    <Descriptions.Item label="完成图片日期">{detailRecord.designer_complete_date || "-"}</Descriptions.Item>
                    <Descriptions.Item label="仓库备注" span={2}>{detailRecord.warehouse_note || "-"}</Descriptions.Item>
                    <Descriptions.Item label="站点负责人员" span={2}>{detailRecord.site_owners || "-"}</Descriptions.Item>
                  </Descriptions>
                </DetailSection>
              </div>
            )}
          </Modal>

          {total > PAGE_SIZE && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
              <Pagination current={page} pageSize={PAGE_SIZE} total={total} onChange={(p) => setPage(p)} showTotal={(t) => `共 ${t} 条`} />
            </div>
          )}
        </Spin>
      </div>

      <Modal
        open={!!editing}
        title="编辑新品记录"
        width={920}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingEdit}
        onOk={() => editForm.submit()}
        onCancel={() => setEditing(null)}
        forceRender
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditSave}>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={8}>
              <Form.Item name="title" label="英文标题" rules={[{ required: true, message: "请输入英文标题" }, { max: 75, message: "英文标题不能超过 75 个字符" }]}>
                <Input placeholder="只填英文" showCount maxLength={75} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="product_title" label="英文标题关键词" rules={[{ required: true, message: "请输入英文标题关键词" }]}>
                <Input.TextArea rows={1} placeholder="只填英文，多个关键词用逗号分隔" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="product_name_zh" label="产品中文名称" rules={[{ required: true, message: "请输入产品中文名称" }]}>
                <Input placeholder="产品中文名称" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="category" label="类目" rules={[{ required: true, message: "请选择类目" }]}>
                <Select showSearch optionFilterProp="label" placeholder="选择商品类目" options={[...CATEGORY_OPTIONS, ...categorySelectOptions.filter((o) => o.value !== "__add_category__")]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="seasonality" label="产品季节性">
                <Select showSearch optionFilterProp="label" placeholder="选择季节性" options={SEASONALITY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="developer" label="开发人员" rules={[{ required: true, message: "请选择开发人员" }]}>
                <Select showSearch optionFilterProp="label" placeholder="选择开发人员" options={employeeOptions} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="urgency" label="产品紧急度" rules={[{ required: true, message: "请选择紧急度" }]}>
                <Select options={URGENCY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="development_date" label="日期" rules={[{ required: true, message: "请选择日期" }]}>
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="purchase_price" label="进货价">
                <InputNumber min={0} precision={2} addonBefore="$" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="competitors" label="竞品ASIN">
                <Input placeholder="多个 ASIN 用逗号分隔" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="de_keywords" label="德语关键词">
                <Input.TextArea rows={1} placeholder="德语关键词，用逗号分隔" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="en_keywords" label="英语关键词">
                <Input.TextArea rows={1} placeholder="英语关键词，用逗号分隔" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="au_keywords" label="澳洲关键词">
                <Input.TextArea rows={1} placeholder="澳洲关键词，用逗号分隔" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="site_owners" label="相关站点负责人员">
                <Select
                  mode="multiple"
                  showSearch
                  allowClear
                  maxTagCount="responsive"
                  placeholder="选择站点负责人员（可多选，筛选下方店铺选项）"
                  options={siteOwnerOptions}
                  optionFilterProp="label"
                />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14, marginTop: 4 }}>
            <Text strong style={{ display: "block", marginBottom: 10 }}>关联店铺分组与采购数量（选择分组一级，数量对应分组下所有店铺）</Text>
            <Form.List name="store_rows">
              {(storeFields, { add: addStore, remove: removeStore }) => (
                <>
                  {storeFields.map((sf) => (
                    <div key={sf.key} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                      <Form.Item name={[sf.name, "path"]} style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                        <Cascader options={editStoreOptions} showSearch placeholder="店铺分组" changeOnSelect={false} />
                      </Form.Item>
                      <Form.Item name={[sf.name, "quantity"]} style={{ width: 120, marginBottom: 0 }}>
                        <InputNumber min={0} precision={0} placeholder="采购数量" style={{ width: "100%" }} />
                      </Form.Item>
                      {storeFields.length > 1 && (
                        <Button type="text" danger icon={<MinusCircle size={15} />} onClick={() => removeStore(sf.name)} />
                      )}
                    </div>
                  ))}
                  <Button type="dashed" size="small" icon={<PlusCircle size={15} />} onClick={() => addStore({ path: undefined, quantity: undefined })}>
                    添加店铺
                  </Button>
                </>
              )}
            </Form.List>
          </div>
          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14, marginTop: 14 }}>
            <Text strong style={{ display: "block", marginBottom: 10 }}>采购链接 / 图片 / 信息（一一对应）</Text>
            <Form.List name="purchase_items">
              {(itemFields, { add: addItem, remove: removeItem }) => (
                <>
                  {itemFields.map((pf) => (
                    <div key={pf.key} style={{ border: "1px solid #f1f5f9", borderRadius: 8, padding: "12px 14px 4px", marginBottom: 10, background: "#fafbfc" }}>
                      <Form.Item name={[pf.name, "link"]} label={<Text type="secondary" style={{ fontSize: 12 }}>采购链接 {pf.name + 1}</Text>} style={{ marginBottom: 10 }}>
                        <Input placeholder="粘贴采购链接（1688/淘宝等）" allowClear />
                      </Form.Item>
                      <Form.Item name={[pf.name, "images"]} label={<Text type="secondary" style={{ fontSize: 12 }}>对应采购图片（支持拖拽上传）</Text>} style={{ marginBottom: 10 }}>
                        <ImagesUpload maxCount={9} placeholder="上传/拖入该链接的采购图片" />
                      </Form.Item>
                      <Form.Item name={[pf.name, "info"]} label={<Text type="secondary" style={{ fontSize: 12 }}>对应采购信息</Text>} style={{ marginBottom: 10 }}>
                        <Input.TextArea rows={2} maxLength={2000} placeholder="该链接对应的供应商、交期、质量要求等信息" />
                      </Form.Item>
                      {itemFields.length > 1 && (
                        <div style={{ textAlign: "right", paddingBottom: 6 }}>
                          <Button type="text" danger size="small" icon={<MinusCircle size={15} />} onClick={() => removeItem(pf.name)}>删除该组</Button>
                        </div>
                      )}
                    </div>
                  ))}
                  <Button type="dashed" size="small" icon={<PlusCircle size={15} />} onClick={() => addItem({ link: "", images: [], info: "" })}>
                    添加链接和图片
                  </Button>
                </>
              )}
            </Form.List>
            <Form.Item name="purchase_info" label="采购信息" style={{ marginTop: 14 }}>
              <Input.TextArea rows={3} maxLength={2000} showCount placeholder="供应商、交期、质量要求等采购信息" />
            </Form.Item>
            <Form.Item name="warehouse_note" label="仓库备注">
              <Input.TextArea rows={2} placeholder="填写仓库备注" />
            </Form.Item>
          </div>
          <Form.Item name="reference_images" label="采购图片">
            <ImagesUpload maxCount={9} placeholder="上传图片" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 勾选生成补货单 */}
      <Modal
        open={replenishOpen}
        title="生成进销存补货单"
        width={800}
        okText="生成补货单"
        cancelText="取消"
        confirmLoading={replenishSaving}
        onOk={handleReplenishSubmit}
        onCancel={() => setReplenishOpen(false)}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary">勾选的商品将生成一张补货申请单（状态：待审批），可在「进销存 - 补货管理」中查看与审批。</Text>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, marginBottom: 12 }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>店铺分组（可选）</Text>
            <Select
              showSearch
              optionFilterProp="label"
              allowClear
              placeholder="选择店铺分组"
              style={{ width: "100%", marginTop: 4 }}
              value={storeGroupId}
              onChange={(v) => setStoreGroupId(v)}
              options={storeGroups.map((g) => ({ label: g.name, value: g.id }))}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>补货单备注（可选）</Text>
            <Input style={{ marginTop: 4 }} value={replenishNotes} onChange={(e) => setReplenishNotes(e.target.value)} placeholder="备注" />
          </div>
        </div>
        <div style={{ maxHeight: 320, overflowY: "auto", display: "grid", gap: 8 }}>
          {selectedRecords.map((r) => (
            <div key={r.record_id} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #f1f5f9", borderRadius: 8, padding: "8px 12px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text ellipsis={{ tooltip: r.title }} style={{ display: "block", maxWidth: "100%" }}>{r.title || "-"}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{r.product_code || "暂无"} · {r.product_name_zh || "-"}</Text>
              </div>
              <span style={{ fontSize: 12, color: "#64748b", flexShrink: 0 }}>数量</span>
              <InputNumber
                min={1}
                precision={0}
                value={replenishQty[r.record_id] ?? 100}
                onChange={(v) => setReplenishQty((prev) => ({ ...prev, [r.record_id]: v || 1 }))}
                style={{ width: 100, flexShrink: 0 }}
              />
            </div>
          ))}
        </div>
      </Modal>

      {/* 采购填写弹窗：采购状态 + 生成采购单按钮 + 采购链接/图片/信息 + 采购单价/状态/备注 */}
      <Modal
        open={!!purchaseRecord}
        title={`采购填写 - ${purchaseRecord?.product_name_zh || purchaseRecord?.title || ""}`}
        width={720}
        okText="保存"
        cancelText="取消"
        confirmLoading={purchaseSaving}
        onOk={() => purchaseForm.submit()}
        onCancel={() => setPurchaseRecord(null)}
        forceRender
      >
        {purchaseRecord && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text strong style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 3, height: 14, background: "#1677ff", borderRadius: 2, display: "inline-block" }} />
                采购链接信息
              </Text>
              <Space size={10}>
                <Tag color={purchasedTagColor(purchaseRecord.purchased)} style={{ margin: 0, fontSize: 13, padding: "3px 12px" }}>
                  {purchaseRecord.purchased || "未采购"}
                </Tag>
                {(purchaseRecord.purchased || "未采购") === "未采购" && (
                  <Button
                    icon={<ShoppingCart size={15} />}
                    loading={orderingId === purchaseRecord.record_id}
                    onClick={async () => {
                      await handleCreatePurchaseOrder(purchaseRecord);
                      setPurchaseRecord(null);
                    }}
                  >
                    采购
                  </Button>
                )}
              </Space>
            </div>
            {(purchaseRecord.store_quantities || []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>采购店铺 / 数量：</Text>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {purchaseRecord.store_quantities!.map((s, i) => (
                    <Tag key={i} style={{ margin: 0 }}>{s.store} × {s.quantity}</Tag>
                  ))}
                </div>
              </div>
            )}
            {(purchaseRecord.purchase_items || []).length > 0 ? (
              (purchaseRecord.purchase_items || []).map((it, i) => (
                <div key={i} style={{ border: "1px solid #f1f5f9", borderRadius: 8, padding: "8px 12px", marginBottom: 8, background: "#fafbfc" }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>采购组 {i + 1}</Text>
                  {it.link ? (
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      <Text type="secondary">链接：</Text>
                      <a href={it.link} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>{it.link}</a>
                    </div>
                  ) : null}
                  {((it.images || []).filter((u) => /^(https?:\/\/|\/)/i.test(u))).length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {(it.images || []).filter((u) => /^(https?:\/\/|\/)/i.test(u)).map((u, j) => (
                        <img key={j} src={u} alt={`采购图${i + 1}-${j + 1}`} loading="lazy"
                          style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 4, background: "#f8fafc" }}
                          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                      ))}
                    </div>
                  )}
                  {it.info ? (
                    <div style={{ fontSize: 12, color: "#334155", marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      <Text type="secondary">信息：</Text>{it.info}
                    </div>
                  ) : null}
                </div>
              ))
            ) : purchaseRecord.purchase_info ? (
              <div style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#334155" }}>{purchaseRecord.purchase_info}</div>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>暂无采购链接信息</Text>
            )}
          </div>
        )}
        <Form form={purchaseForm} layout="vertical" onFinish={handlePurchaseSave}>
          <Form.Item name="purchase_price" label="采购单价" rules={[{ required: true, message: "请输入采购单价" }]}>
            <InputNumber min={0} precision={2} addonBefore="¥" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="purchased" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="purchase_note" label="采购备注">
            <Input.TextArea rows={3} maxLength={500} showCount placeholder="选填，如供应商、交期、质量要求等" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 仓库上传六面图 + 仓库备注弹窗 */}
      <Modal
        open={!!warehouseRecord}
        title={`仓库上传 - ${warehouseRecord?.product_name_zh || warehouseRecord?.title || ""}`}
        width={720}
        okText="保存"
        cancelText="取消"
        confirmLoading={warehouseSaving}
        onOk={handleWarehouseSave}
        onCancel={() => setWarehouseRecord(null)}
      >
        <Form.Item label="六面图" style={{ marginBottom: 16 }}>
          <ImagesUpload maxCount={9} placeholder="上传六面图" value={warehouseImages} onChange={setWarehouseImages} />
        </Form.Item>
        <Form.Item label="仓库备注" style={{ marginBottom: 0 }}>
          <Input.TextArea rows={3} value={warehouseNote} onChange={(e) => setWarehouseNote(e.target.value)} placeholder="填写仓库备注" />
        </Form.Item>
      </Modal>

      {/* 美工上传产品图片弹窗 */}
      <Modal
        open={!!designerRecord}
        title={`美工上传产品图片 - ${designerRecord?.product_name_zh || designerRecord?.title || ""}`}
        width={760}
        okText="提交并推送审核"
        cancelText="取消"
        confirmLoading={designerSaving}
        onOk={handleDesignerSave}
        onCancel={() => setDesignerRecord(null)}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          提交后系统自动生成「完成图片日期」，并推送管理层负责人审核；审核通过后开发机器人首页将展示该产品图片。
        </Text>
        <ImagesUpload
          maxCount={9}
          placeholder="上传产品图片"
          value={designerImages}
          onChange={setDesignerImages}
          customName={(_f, i) => buildDevImageName(designerRecord?.product_name_zh, designerRecord?.development_date, i)}
        />
      </Modal>

      {/* 管理层审核弹窗 */}
      <Modal
        open={!!reviewRecord}
        title={`产品图片审核 - ${reviewRecord?.product_name_zh || reviewRecord?.title || ""}`}
        width={820}
        cancelText="关闭"
        footer={null}
        onCancel={() => setReviewRecord(null)}
      >
        {(reviewRecord?.designer_images || []).length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 16 }}>
            {reviewRecord!.designer_images!.map((url, i) => (
              <img key={i} src={url} alt={`产品图${i + 1}`} style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, background: "#f8fafc" }} />
            ))}
          </div>
        ) : (
          <Text type="secondary">该记录尚未上传产品图片</Text>
        )}
        {reviewRecord?.designer_complete_date && (
          <div style={{ marginBottom: 12, fontSize: 13, color: "#64748b" }}>完成图片日期：{reviewRecord.designer_complete_date}（美工：{reviewRecord.designer_images?.length || 0} 张）</div>
        )}
        <Space style={{ display: "flex", justifyContent: "flex-end" }}>
          <Popconfirm title="确认不通过？" okText="确认" cancelText="取消" onConfirm={() => handleReview(false)}>
            <Button danger disabled={reviewSaving || !(reviewRecord?.designer_images || []).length}>不通过</Button>
          </Popconfirm>
          <Button type="primary" loading={reviewSaving} disabled={!(reviewRecord?.designer_images || []).length} onClick={() => handleReview(true)}>审核通过</Button>
        </Space>
      </Modal>
    </div>
  );
};

export default ProductDevelopmentBot;
