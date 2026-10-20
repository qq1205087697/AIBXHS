import React, { useMemo } from "react";
import {
  Alert,
  Button,
  Card,
  Cascader,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { ArrowLeft, CopyPlus, Download, FileSpreadsheet, ImagePlus, MinusCircle, Plus, PlusCircle, Save } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs, { Dayjs } from "dayjs";
import { developmentBotApi, departmentsApi, storeGroupsApi, type DevelopmentProject, type ProductDevelopmentPayload } from "../api";
import { useAuth } from "../contexts/AuthContext";
import ImagesUpload from "../components/ImagesUpload";

const { Title, Text } = Typography;

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

// 采购链接 + 采购图片 + 采购信息按组对应（一组 = 链接框 + 图片框 + 信息框）
interface PurchaseItem {
  link?: string;
  images?: string[];
  info?: string;
}

// 关联店铺：[{path: [分组名, 店铺名], quantity: 采购数量}]
interface StoreRow {
  path?: string[];
  quantity?: number;
}

interface ProductFormRow {
  title: string;
  product_title: string;
  product_name_zh: string;
  category: string;
  store_rows?: StoreRow[];
  purchase_items?: PurchaseItem[];
  purchase_info?: string;
  urgency: string;
  seasonality?: string;
  competitors?: string;
  purchase_price?: number;
  selling_price?: number; // 仅表单展示，数据库无对应列
  de_keywords?: string;
  en_keywords?: string;
  au_keywords?: string;
  development_date?: Dayjs | null;
  reference_images?: string[];
  warehouse_note?: string;
  site_owners?: string | string[];
}

interface FormValues {
  products: ProductFormRow[];
}

const toPayload = (row: ProductFormRow, developer?: string): ProductDevelopmentPayload => ({
  title: row.title?.trim() || "",
  product_title: row.product_title?.trim() || "",
  product_name_zh: row.product_name_zh?.trim() || "",
  category: row.category || "",
  developer: developer || "",
  urgency: row.urgency || "一般",
  seasonality: row.seasonality || "",
  competitors: row.competitors?.trim() || "",
  purchase_price: row.purchase_price,
  // 店铺分组一级选择：数量对应分组下所有店铺
  related_store: (row.store_rows || [])
    .map((r) => (r.path?.[0] || "").trim())
    .filter(Boolean)
    .join("，") || undefined,
  store_quantities: (row.store_rows || [])
    .map((r) => ({ store: (r.path?.[0] || "").trim(), quantity: r.quantity ?? 0 }))
    .filter((s) => s.store),
  purchase_links: (row.purchase_items || [])
    .map((it) => (it.link || "").trim())
    .filter(Boolean),
  purchase_info: row.purchase_info?.trim() || undefined,
  purchase_items: (row.purchase_items || []).map((it) => ({
    link: (it.link || "").trim() || undefined,
    images: it.images || [],
    info: (it.info || "").trim() || undefined,
  })),
  de_keywords: row.de_keywords?.trim() || "",
  en_keywords: row.en_keywords?.trim() || "",
  au_keywords: row.au_keywords?.trim() || "",
  development_date: row.development_date ? dayjs(row.development_date).format("YYYY-MM-DD") : "",
  reference_images: (row.purchase_items || []).flatMap((it) => it.images || []),
  warehouse_note: row.warehouse_note?.trim() || undefined,
  site_owners: Array.isArray(row.site_owners)
    ? row.site_owners.join(",").trim() || undefined
    : row.site_owners?.trim() || undefined,
});

const requiredRule = (label: string) => [{ required: true, message: `请输入${label}` }];

const ProductDevelopmentCreate: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const warehouseRecordId = searchParams.get("record"); // KPI 通知跳转：仓库针对已有新品上传六面图
  const { user } = useAuth();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = React.useState(false);
  const [employees, setEmployees] = React.useState<EmployeeItem[]>([]);
  const [warehouseRecord, setWarehouseRecord] = React.useState<DevelopmentProject | null>(null);
  const [warehouseLoading, setWarehouseLoading] = React.useState(false);
  const [warehouseNotFound, setWarehouseNotFound] = React.useState(false);
  const [sixFaceImages, setSixFaceImages] = React.useState<string[]>([]);
  const [warehouseNote, setWarehouseNote] = React.useState("");
  // 模板导入
  const [importOpen, setImportOpen] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState<{ created: number; failed?: number; errors: { row: number; msg: string }[] } | null>(null);

  const handleDownloadTemplate = async () => {
    try {
      const res = await developmentBotApi.downloadImportTemplate();
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "新品导入模板.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "模板下载失败，请稍后重试");
    }
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const res = await developmentBotApi.importProjects(file);
      const data = res.data?.data || { created: 0, errors: [] };
      setImportResult(data);
      if (data.created > 0) message.success(`成功导入 ${data.created} 条新品`);
      else message.warning("没有导入任何记录，请检查模板内容");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "导入失败，请检查文件格式");
    } finally {
      setImporting(false);
    }
    return false; // 阻止 antd Upload 自动上传
  };
  interface StoreNode { id: number; name: string; stores: { id: number; name: string; site?: string | null }[] }
  interface StoreTreeData { groups: StoreNode[]; owner_sites: Record<string, string[]> }
  // 店铺分组树（系统设置-店铺管理）+ 站点负责人站点映射
  const [storeTree, setStoreTree] = React.useState<StoreTreeData>({ groups: [], owner_sites: {} });
  const productsWatch = Form.useWatch("products", form) as ProductFormRow[] | undefined;

  React.useEffect(() => {
    storeGroupsApi
      .getTree()
      .then((res) => {
        const d = res.data?.data;
        if (d) setStoreTree({ groups: d.groups || [], owner_sites: d.owner_sites || {} });
      })
      .catch(() => {});
  }, []);

  // 按站点负责人员过滤店铺级联选项：取所选负责人名下站点集合，无映射或未选则展示全部
  // 添加新品只需选择店铺分组一级；数量对应分组下所有店铺，保存时存分组名
  const storeCascaderOptions = (index: number) => {
    const owners = (productsWatch?.[index]?.site_owners as string[] | undefined) || [];
    let allowed: Set<string> | null = null;
    if (owners.length) {
      allowed = new Set<string>();
      owners.forEach((o) => (storeTree.owner_sites[o] || []).forEach((s) => allowed!.add(s)));
      if (allowed.size === 0) allowed = null;
    }
    return storeTree.groups
      .filter((g) => !allowed || g.stores.some((s) => s.site && allowed.has(s.site)))
      .map((g) => ({ label: g.name, value: g.name }));
  };

  // 仓库回填模式：加载已有新品记录
  React.useEffect(() => {
    if (!warehouseRecordId) return;
    setWarehouseLoading(true);
    developmentBotApi
      .getDetail(warehouseRecordId)
      .then((res) => {
        if (res.data?.success && res.data.data) {
          const item = res.data.data;
          setWarehouseRecord(item);
          setSixFaceImages(item.six_face_images || []);
          setWarehouseNote(item.warehouse_note || "");
        } else {
          setWarehouseNotFound(true);
        }
      })
      .catch(() => setWarehouseNotFound(true))
      .finally(() => setWarehouseLoading(false));
  }, [warehouseRecordId]);

  // 拉取后台全部员工（按部门分组）；非管理员 403 时降级为当前登录用户
  React.useEffect(() => {
    let cancelled = false;
    departmentsApi
      .getAllUsers()
      .then((res) => {
        if (!cancelled) setEmployees(res.data?.data || []);
      })
      .catch(() => {
        if (!cancelled && user?.nickname) setEmployees([{ nickname: user.nickname }]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.nickname]);

  // 站点负责人员选项：全部员工昵称去重（支持搜索）
  const siteOwnerOptions = useMemo(() => {
    const names = new Set<string>();
    employees.forEach((emp) => {
      const name = (emp.nickname || emp.username || "").trim();
      if (name) names.add(name);
    });
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b, "zh"))
      .map((name) => ({ label: name, value: name }));
  }, [employees]);

  const emptyRow = (): ProductFormRow => ({
    title: "",
    product_title: "",
    product_name_zh: "",
    category: undefined as unknown as string,
    store_rows: [{ path: undefined, quantity: undefined }],
    purchase_items: [{ link: "", images: [], info: "" }],
    purchase_info: "",
    urgency: "一般",
    seasonality: "日常",
    competitors: "",
    purchase_price: undefined,
    selling_price: undefined,
    de_keywords: "",
    en_keywords: "",
    au_keywords: "",
    development_date: dayjs(),
    reference_images: [],
    warehouse_note: "",
    site_owners: [],
  });

  const handleWarehouseSave = async () => {
    if (!warehouseRecord) return;
    setSaving(true);
    try {
      await developmentBotApi.updateWarehouse(warehouseRecord.record_id, {
        six_face_images: sixFaceImages,
        warehouse_note: warehouseNote.trim() || undefined,
      });
      message.success("六面图与仓库备注已保存");
      navigate("/development");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (values: FormValues) => {
    const payloads = (values.products || []).map((row) => toPayload(row, user?.nickname || undefined));
    setSaving(true);
    try {
      if (payloads.length > 1) await developmentBotApi.createBatch(payloads);
      else await developmentBotApi.create(payloads[0]);
      message.success(`已提交 ${payloads.length} 条新品到数据库，已按部门推送采购/仓库/美工提醒`);
      navigate("/development");
    } catch (e: any) {
      message.error(e?.response?.data?.detail || "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  // ============ 仓库回填模式（KPI 通知跳转） ============
  if (warehouseRecordId) {
    return (
      <div style={{ height: "100%", overflowY: "auto", background: "#f5f7fb" }}>
        <div style={{ padding: "24px 28px 40px", maxWidth: 900, margin: "0 auto" }}>
          <Space direction="vertical" size={4} style={{ marginBottom: 20 }}>
            <Button type="link" icon={<ArrowLeft size={16} />} onClick={() => navigate("/development")} style={{ padding: 0 }}>返回新品记录</Button>
            <Title level={2} style={{ margin: 0 }}>上传六面图与仓库备注</Title>
            <Text type="secondary">保存后写入产品开发数据库对应记录的六面图与仓库备注字段。</Text>
          </Space>
          {warehouseLoading ? (
            <Card bordered={false}><div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spin /></div></Card>
          ) : warehouseNotFound || !warehouseRecord ? (
            <Card bordered={false}><Result status="warning" title="未找到对应新品记录" subTitle="记录可能已删除或无权查看" extra={<Button type="primary" onClick={() => navigate("/development")}>返回列表</Button>} /></Card>
          ) : (
            <Card bordered={false}>
              <Descriptions column={2} size="small" style={{ marginBottom: 20 }}>
                <Descriptions.Item label="产品编码">{warehouseRecord.product_code || "-"}</Descriptions.Item>
                <Descriptions.Item label="产品中文名称">{warehouseRecord.product_name_zh || "-"}</Descriptions.Item>
                <Descriptions.Item label="英文标题" span={2}>{warehouseRecord.title || "-"}</Descriptions.Item>
                <Descriptions.Item label="类目">{warehouseRecord.category || "-"}</Descriptions.Item>
                <Descriptions.Item label="开发人员">{warehouseRecord.developer || "-"}</Descriptions.Item>
              </Descriptions>
              <Form.Item label="六面图" style={{ marginBottom: 20 }}>
                <ImagesUpload maxCount={9} placeholder="上传六面图" value={sixFaceImages} onChange={setSixFaceImages} />
              </Form.Item>
              <Form.Item label="仓库备注" style={{ marginBottom: 24 }}>
                <Input.TextArea rows={3} value={warehouseNote} onChange={(e) => setWarehouseNote(e.target.value)} placeholder="填写仓库备注" />
              </Form.Item>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Button onClick={() => navigate("/development")}>取消</Button>
                <Button type="primary" icon={<Save size={16} />} loading={saving} onClick={handleWarehouseSave}>保存</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    );
  }

  // ============ 批量添加新品模式 ============
  return (
    <div style={{ height: "100%", overflowY: "auto", background: "#f5f7fb" }}>
      <div style={{ padding: "24px 28px 40px", maxWidth: 1440, margin: "0 auto" }}>
        <Space direction="vertical" size={4} style={{ marginBottom: 20 }}>
          <Button type="link" icon={<ArrowLeft size={16} />} onClick={() => navigate("/development")} style={{ padding: 0 }}>返回新品记录</Button>
          <Title level={2} style={{ margin: 0 }}>批量添加新品</Title>
          <Text type="secondary">每个分组代表一条完整新品，保存后写入产品开发数据库（ad_product_info），并按部门推送采购/仓库/美工提醒。</Text>
        </Space>

        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ products: [emptyRow()] }}>
          <Form.List name="products">
            {(fields, { add, remove }) => (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <Space><Tag color="blue">批量录入</Tag><Text type="secondary">共 {fields.length} 条新品</Text></Space>
                  <Space>
                    <Button icon={<FileSpreadsheet size={16} />} onClick={() => { setImportResult(null); setImportOpen(true); }}>导入模板</Button>
                    <Button type="primary" icon={<Plus size={16} />} onClick={() => add(emptyRow())}>新增一行</Button>
                  </Space>
                </div>
                {fields.map((field, index) => (
                  <Card
                    key={field.key}
                    size="small"
                    bordered={false}
                    title={<Space><span style={{ color: "#1677ff" }}>新品 {index + 1}</span><Text type="secondary">基础资料与上新信息</Text></Space>}
                    extra={
                      <Space>
                        <Button
                          type="text"
                          icon={<CopyPlus size={16} />}
                          onClick={() => {
                            const row: any = form.getFieldValue(["products", field.name]);
                            if (!row) return;
                            const copy: any = { ...row };
                            if (Array.isArray(copy.site_owners)) copy.site_owners = [...copy.site_owners];
                            if (Array.isArray(copy.store_rows)) copy.store_rows = copy.store_rows.map((r: any) => ({ path: r.path ? [...r.path] : undefined, quantity: r.quantity }));
                            if (Array.isArray(copy.purchase_items)) {
                              copy.purchase_items = copy.purchase_items.map((it: any) => ({
                                link: it.link,
                                images: Array.isArray(it.images) ? [...it.images] : [],
                                info: it.info,
                              }));
                            }
                            if (Array.isArray(copy.reference_images)) copy.reference_images = [...copy.reference_images];
                            add(copy, field.name + 1);
                            message.success("已复制当前新品内容到新行");
                          }}
                        >
                          复制内容
                        </Button>
                        <Button type="text" danger icon={<MinusCircle size={17} />} onClick={() => fields.length > 1 ? remove(field.name) : message.warning("至少保留一条新品记录")}>删除</Button>
                      </Space>
                    }
                    style={{ marginBottom: 16 }}
                  >
                    <Row gutter={[16, 0]}>
                      <Col xs={24} md={8}>
                        <Form.Item name={[field.name, "title"]} label="英文标题" rules={[...requiredRule("英文标题"), { max: 75, message: "英文标题不能超过 75 个字符" }]}>
                          <Input placeholder="只填英文" showCount maxLength={75} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={[field.name, "product_title"]} label="英文标题关键词" rules={requiredRule("英文标题关键词")}>
                          <Input.TextArea rows={1} placeholder="只填英文，多个关键词用逗号分隔" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={[field.name, "product_name_zh"]} label="产品中文名称" rules={requiredRule("产品中文名称")}>
                          <Input placeholder="产品中文名称" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={[field.name, "category"]} label="类目" rules={[{ required: true, message: "请选择类目" }]}>
                          <Select showSearch optionFilterProp="label" placeholder="选择商品类目" options={CATEGORY_OPTIONS} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={[field.name, "seasonality"]} label="产品季节性">
                          <Select showSearch optionFilterProp="label" placeholder="选择季节性" options={SEASONALITY_OPTIONS} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={[field.name, "urgency"]} label="产品紧急度" rules={[{ required: true, message: "请选择紧急度" }]}>
                          <Select options={URGENCY_OPTIONS} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={[field.name, "development_date"]} label="日期" rules={[{ required: true, message: "请选择日期" }]}>
                          <DatePicker style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={[field.name, "site_owners"]} label="相关站点负责人员">
                          <Select
                            mode="multiple"
                            showSearch
                            allowClear
                            maxTagCount="responsive"
                            placeholder="选择站点负责人员（可多选，用于数据可见性拆分）"
                            options={siteOwnerOptions}
                            optionFilterProp="label"
                          />
                        </Form.Item>
                      </Col>
                    </Row>

                    <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16, marginTop: 2 }}>
                      <Text strong style={{ display: "block", marginBottom: 12 }}>价格与市场</Text>
                      <Row gutter={[16, 0]}>
                        <Col xs={24} sm={8}><Form.Item name={[field.name, "purchase_price"]} label="进货价"><InputNumber min={0} precision={2} addonBefore="¥" style={{ width: "100%" }} /></Form.Item></Col>
                        <Col xs={24} sm={8}><Form.Item name={[field.name, "selling_price"]} label="售价"><InputNumber min={0} precision={2} addonBefore="¥" style={{ width: "100%" }} /></Form.Item></Col>
                        <Col xs={24} sm={8}><Form.Item name={[field.name, "competitors"]} label="竞品ASIN"><Input placeholder="多个 ASIN 用逗号分隔" /></Form.Item></Col>
                      </Row>
                    </div>

                    <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16, marginTop: 2 }}>
                      <Text strong style={{ display: "block", marginBottom: 12 }}>采购信息与关联店铺</Text>
                      <Row gutter={[20, 0]}>
                        <Col xs={24} md={14}>
                          <Form.List name={[field.name, "purchase_items"]}>
                            {(itemFields, { add: addItem, remove: removeItem }) => (
                              <>
                                {itemFields.map((pf) => (
                                  <div
                                    key={pf.key}
                                    style={{
                                      border: "1px solid #f1f5f9",
                                      borderRadius: 8,
                                      padding: "12px 14px 4px",
                                      marginBottom: 10,
                                      background: "#fafbfc",
                                    }}
                                  >
                                    <Form.Item
                                      name={[pf.name, "link"]}
                                      label={<Text type="secondary" style={{ fontSize: 12 }}>采购链接 {pf.name + 1}</Text>}
                                      style={{ marginBottom: 10 }}
                                    >
                                      <Input placeholder="粘贴采购链接（1688/淘宝等）" allowClear />
                                    </Form.Item>
                                    <Form.Item
                                      name={[pf.name, "images"]}
                                      label={<Space size={4}><ImagePlus size={14} /><Text type="secondary" style={{ fontSize: 12 }}>对应采购图片（支持拖拽上传）</Text></Space>}
                                      style={{ marginBottom: 10 }}
                                    >
                                      <ImagesUpload maxCount={9} placeholder="上传/拖入该链接的采购图片" />
                                    </Form.Item>
                                    <Form.Item
                                      name={[pf.name, "info"]}
                                      label={<Text type="secondary" style={{ fontSize: 12 }}>对应采购信息</Text>}
                                      style={{ marginBottom: 10 }}
                                    >
                                      <Input.TextArea rows={2} maxLength={2000} placeholder="该链接对应的供应商、交期、质量要求等信息" />
                                    </Form.Item>
                                    {itemFields.length > 1 && (
                                      <div style={{ textAlign: "right", paddingBottom: 6 }}>
                                        <Button type="text" danger size="small" icon={<MinusCircle size={15} />} onClick={() => removeItem(pf.name)}>
                                          删除该组
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                                <Button
                                  type="dashed"
                                  size="small"
                                  icon={<PlusCircle size={15} />}
                                  onClick={() => addItem({ link: "", images: [], info: "" })}
                                >
                                  添加链接和图片
                                </Button>
                              </>
                            )}
                          </Form.List>
                          <Form.Item name={[field.name, "purchase_info"]} label="采购信息" style={{ marginTop: 14 }}>
                            <Input.TextArea rows={3} maxLength={2000} showCount placeholder="供应商、交期、质量要求等采购信息" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={10}>
                          <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                            关联店铺分组与采购数量（选择分组一级，数量对应分组下所有店铺；可按站点负责人筛选）
                          </Text>
                          <Form.List name={[field.name, "store_rows"]}>
                            {(storeFields, { add: addStore, remove: removeStore }) => (
                              <>
                                {storeFields.map((sf) => (
                                  <div key={sf.key} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                                    <Form.Item
                                      name={[sf.name, "path"]}
                                      style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
                                    >
                                      <Cascader
                                        options={storeCascaderOptions(field.name)}
                                        showSearch
                                        placeholder="店铺分组"
                                        changeOnSelect={false}
                                      />
                                    </Form.Item>
                                    <Form.Item
                                      name={[sf.name, "quantity"]}
                                      style={{ width: 110, marginBottom: 0 }}
                                    >
                                      <InputNumber min={0} precision={0} placeholder="采购数量" style={{ width: "100%" }} />
                                    </Form.Item>
                                    {storeFields.length > 1 && (
                                      <Button type="text" danger icon={<MinusCircle size={15} />} onClick={() => removeStore(sf.name)} />
                                    )}
                                  </div>
                                ))}
                                <Button
                                  type="dashed"
                                  size="small"
                                  icon={<PlusCircle size={15} />}
                                  onClick={() => addStore({ path: undefined, quantity: undefined })}
                                >
                                  添加店铺
                                </Button>
                              </>
                            )}
                          </Form.List>
                        </Col>
                      </Row>
                    </div>

                    <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16, marginTop: 2 }}>
                      <Text strong style={{ display: "block", marginBottom: 12 }}>多语言资料</Text>
                      <Row gutter={[16, 0]}>
                        <Col xs={24} md={8}><Form.Item name={[field.name, "de_keywords"]} label="德语关键词"><Input.TextArea rows={2} placeholder="德语关键词，用逗号分隔" /></Form.Item></Col>
                        <Col xs={24} md={8}><Form.Item name={[field.name, "en_keywords"]} label="英语关键词"><Input.TextArea rows={2} placeholder="英语关键词，用逗号分隔" /></Form.Item></Col>
                        <Col xs={24} md={8}><Form.Item name={[field.name, "au_keywords"]} label="澳洲关键词"><Input.TextArea rows={2} placeholder="澳洲关键词，用逗号分隔" /></Form.Item></Col>
                      </Row>
                    </div>

                    <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 16 }}>
                      <Form.Item name={[field.name, "warehouse_note"]} label="仓库备注" style={{ marginBottom: 0 }}>
                        <Input.TextArea rows={2} placeholder="填写仓库备注（保存后仓库人员可在 KPI 提醒中跳转上传六面图）" />
                      </Form.Item>
                    </div>
                  </Card>
                ))}
              </>
            )}
          </Form.List>
          <Modal
            open={importOpen}
            title="导入新品模板"
            footer={null}
            width={560}
            onCancel={() => setImportOpen(false)}
          >
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Button type="primary" icon={<Download size={16} />} onClick={handleDownloadTemplate}>
                下载导入新品模板
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>
                模板中类目、季节性、紧急度、关联店铺列已带下拉选项；一行一条新品，上传后自动批量创建并推送部门提醒。
              </Text>
              <Upload.Dragger
                accept=".xlsx"
                maxCount={1}
                showUploadList={false}
                disabled={importing}
                beforeUpload={(file) => { handleImportFile(file); return false; }}
              >
                <div style={{ padding: "18px 0" }}>
                  {importing ? <Spin /> : <FileSpreadsheet size={34} color="#1677ff" />}
                  <div style={{ marginTop: 8, fontWeight: 600 }}>点击或拖入填写好的模板文件</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>仅支持 .xlsx 格式</Text>
                </div>
              </Upload.Dragger>
              {importResult && (
                <div>
                  {importResult.created > 0 && (
                    <Alert
                      type="success"
                      showIcon
                      message={`成功导入 ${importResult.created} 条新品`}
                      style={{ marginBottom: 8 }}
                    />
                  )}
                  {importResult.errors.length > 0 && (
                    <Alert
                      type="error"
                      showIcon
                      message={`检测到 ${importResult.errors.length} 行数据异常，未导入`}
                      description={
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>异常汇总（请修正模板中对应行后重新上传）：</div>
                          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #fecaca", borderRadius: 6, background: "#fef2f2", padding: "6px 12px" }}>
                            {importResult.errors.map((e, i) => (
                              <div key={i} style={{ fontSize: 12, color: "#b91c1c", lineHeight: 2, borderBottom: i < importResult.errors.length - 1 ? "1px dashed #fecaca" : "none" }}>
                                <Tag color="red" style={{ marginRight: 8 }}>第 {e.row} 行</Tag>
                                {e.msg}
                              </div>
                            ))}
                          </div>
                        </div>
                      }
                    />
                  )}
                  {importResult.created === 0 && importResult.errors.length === 0 && (
                    <Alert type="warning" showIcon message="没有导入任何记录，请检查模板内容（空行不会导入）" />
                  )}
                </div>
              )}
            </Space>
          </Modal>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button onClick={() => navigate("/development")}>取消</Button>
            <Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={saving}>保存批量新品</Button>
          </div>
        </Form>
      </div>
    </div>
  );
};

export default ProductDevelopmentCreate;
