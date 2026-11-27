import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Row, Col, Tabs, Table, Statistic, DatePicker, Button, Tag, Space, Typography, Tooltip, Modal, Form, Input, InputNumber, Select, Popconfirm, message, Empty, Divider } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  Wallet, TrendingUp, TrendingDown, RefreshCw, Scale, Landmark, Users, ShoppingBag,
  Briefcase, Truck, Banknote, SearchCheck, Megaphone, Building2, Store,
  FolderTree, ChevronRight, Pencil, Trash2, ArrowLeft, Plus, ListChecks, Calculator, ArrowUp, ArrowDown,
} from 'lucide-react';
import dayjs, { Dayjs } from 'dayjs';
import { financeApi, financeCategoryApi, financeTemplateApi, FinanceRecordItem, FinanceCategoryItem, FinanceTemplateItem } from '../api';

const { Text } = Typography;
const { RangePicker } = DatePicker;

// ============================================================
// 财务机器人：顶部收支可视化 + 各费用板块明细（日期/金额/收支类型）
// 分类（一级/二级）存储于 finance_categories 表，首次访问自动初始化种子数据
// ============================================================

// 一级分类图标映射（icon 字段存的是 lucide 组件名）
const ICON_MAP: Record<string, React.ReactNode> = {
  Landmark: <Landmark size={15} />,
  Users: <Users size={15} />,
  ShoppingBag: <ShoppingBag size={15} />,
  Briefcase: <Briefcase size={15} />,
  Truck: <Truck size={15} />,
  Banknote: <Banknote size={15} />,
  SearchCheck: <SearchCheck size={15} />,
  Megaphone: <Megaphone size={15} />,
  Building2: <Building2 size={15} />,
  Store: <Store size={15} />,
  Wallet: <Wallet size={15} />,
};

const PIE_COLORS = ['#1890ff', '#eb2f96', '#fa541c', '#fa8c16', '#722ed1', '#8c8c8c', '#13c2c2', '#cf1322', '#faad14', '#389e0d', '#d9d9d9'];

// 自定义公式类型（页面演示数据，未接后端）
interface FinanceFormulaDemo {
  id: number;
  name: string;
  categoryId: number | null; // 归属板块，null=通用
  fields: string[];          // 自定义字段名
  expression: string;        // 表达式：字段名 + 数字 + + - * / ( )
}

// 公式求值：字段名替换为所填值后按四则运算计算；不合法返回 null
const evalFormula = (f: FinanceFormulaDemo | undefined, values: Record<string, number | undefined>): number | null => {
  if (!f) return null;
  let expr = f.expression;
  for (const field of [...f.fields].sort((a, b) => b.length - a.length)) {
    const v = values[field];
    expr = expr.split(field).join(v === undefined || v === null || !isFinite(Number(v)) ? 'NaN' : String(Number(v)));
  }
  if (!/^[0-9+\-*/().\s]*$/.test(expr)) return null; // 含未定义字段或非法字符
  try {
    const r = Function(`"use strict";return (${expr})`)();
    return typeof r === 'number' && isFinite(r) ? r : null;
  } catch {
    return null;
  }
};

// 演示用初始公式
const DEFAULT_FORMULAS: FinanceFormulaDemo[] = [
  { id: 1, name: '应发工资', categoryId: null, fields: ['基本工资', '绩效奖金', '社保扣款'], expression: '基本工资 + 绩效奖金 - 社保扣款' },
];

const FinanceBot: React.FC = () => {
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [records, setRecords] = useState<FinanceRecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<number | null>(null);

  // 分类（数据库）
  const [cats, setCats] = useState<FinanceCategoryItem[]>([]);

  // 模板（数据库）
  const [tpls, setTpls] = useState<FinanceTemplateItem[]>([]);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplFormOpen, setTplFormOpen] = useState(false); // false=列表视图，true=新建/编辑表单
  const [tplEditing, setTplEditing] = useState<FinanceTemplateItem | null>(null); // null=新建
  const [tplName, setTplName] = useState('');
  const [tplCatId, setTplCatId] = useState<number | null>(null);
  const [tplSubIds, setTplSubIds] = useState<number[]>([]);
  const [tplSaving, setTplSaving] = useState(false);
  // 登记弹窗-模板批量金额（key=二级分类ID）
  const [tplAmounts, setTplAmounts] = useState<Record<number, number | undefined>>({});

  // 自定义公式（页面演示数据，未接后端）
  const [formulas, setFormulas] = useState<FinanceFormulaDemo[]>(DEFAULT_FORMULAS);
  const [fmlOpen, setFmlOpen] = useState(false);
  const [fmlFormOpen, setFmlFormOpen] = useState(false); // false=列表，true=新建/编辑
  const [fmlEditing, setFmlEditing] = useState<FinanceFormulaDemo | null>(null);
  const [fmlName, setFmlName] = useState('');
  const [fmlCatId, setFmlCatId] = useState<number | null>(null);
  const [fmlFields, setFmlFields] = useState<string[]>([]);
  const [fmlNewField, setFmlNewField] = useState('');
  const [fmlExpr, setFmlExpr] = useState('');
  // 登记弹窗-公式字段值（key=字段名）
  const [fmlAmounts, setFmlAmounts] = useState<Record<string, number | undefined>>({});

  // 登记弹窗
  const [registerOpen, setRegisterOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  // 分类管理弹窗
  const [catOpen, setCatOpen] = useState(false);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [editingCat, setEditingCat] = useState<{ id: number; text: string } | null>(null); // 二级编辑
  const [editingL1, setEditingL1] = useState<{ id: number; text: string } | null>(null);   // 一级编辑
  const [newCatName, setNewCatName] = useState('');

  // ----- 派生数据：一级/二级分类视图 -----
  const l1Cats = useMemo(
    () => cats.filter(c => c.parentId === null).sort((a, b) => a.sort - b.sort),
    [cats],
  );
  const l2ByParent = useMemo(() => {
    const map = new Map<number, FinanceCategoryItem[]>();
    cats.filter(c => c.parentId !== null).forEach(c => {
      const list = map.get(c.parentId!) || [];
      list.push(c);
      map.set(c.parentId!, list);
    });
    map.forEach(list => list.sort((a, b) => a.sort - b.sort));
    return map;
  }, [cats]);

  // ----- 加载流水 -----
  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await financeApi.list({
        start_date: dateRange[0].format('YYYY-MM-DD'),
        end_date: dateRange[1].format('YYYY-MM-DD'),
      });
      setRecords(res.data.data || []);
    } catch {
      message.error('查询财务流水失败');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  // ----- 加载分类（数据库，首访自动种子） -----
  const loadCategories = useCallback(async () => {
    try {
      const res = await financeCategoryApi.list();
      const list = res.data.data || [];
      setCats(list);
      setActiveSection(prev => prev ?? (list.find(c => c.parentId === null)?.id ?? null));
    } catch {
      message.error('查询财务分类失败');
    }
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // ----- 加载模板 -----
  const loadTemplates = useCallback(async () => {
    try {
      const res = await financeTemplateApi.list();
      setTpls(res.data.data || []);
    } catch {
      message.error('查询模板失败');
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // ----- 汇总指标（所选日期范围） -----
  const summary = useMemo(() => {
    const income = records.filter(r => r.flowType === '收入').reduce((s, r) => s + Number(r.amount), 0);
    const expense = records.filter(r => r.flowType === '支出').reduce((s, r) => s + Number(r.amount), 0);
    return { income, expense, profit: income - expense, margin: income > 0 ? ((income - expense) / income * 100).toFixed(1) : '0.0' };
  }, [records]);

  // ----- 按月聚合收支趋势 -----
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    records.forEach((r) => {
      const month = (r.recordDate || '').slice(0, 7);
      if (!month) return;
      const cur = map.get(month) || { income: 0, expense: 0 };
      if (r.flowType === '收入') cur.income += Number(r.amount);
      else cur.expense += Number(r.amount);
      map.set(month, cur);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, v]) => ({ month, income: v.income, expense: v.expense, profit: v.income - v.expense }));
  }, [records]);

  // ----- 支出构成（按板块聚合） -----
  const expenseBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    records.filter(r => r.flowType === '支出').forEach((r) => {
      map.set(r.category, (map.get(r.category) || 0) + Number(r.amount));
    });
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value }));
  }, [records]);

  // ----- 流水归属过滤：新数据按 categoryId，旧数据回退 category 文本 -----
  const belongsTo = useCallback((r: FinanceRecordItem, cat: FinanceCategoryItem) => {
    if (r.categoryId) return r.categoryId === cat.id;
    return r.category === cat.name;
  }, []);

  // ----- 登记入口 -----
  const selectedCategoryId = Form.useWatch('category', form);
  const selectedTplId = Form.useWatch('template', form);
  const selectedTpl = tpls.find(t => t.id === selectedTplId);
  const selectedFormulaId = Form.useWatch('formula', form);
  const selectedFormula = formulas.find(f => f.id === selectedFormulaId);
  const fmlResult = useMemo(() => evalFormula(selectedFormula, fmlAmounts), [selectedFormula, fmlAmounts]);
  const tplTotal = useMemo(() => {
    let total = 0;
    for (const v of Object.values(tplAmounts)) total += Number(v) || 0;
    return total;
  }, [tplAmounts]);

  const openRegister = (categoryId?: number) => {
    form.setFieldsValue({
      category: categoryId ?? l1Cats[0]?.id,
      sub_category: undefined,
      template: undefined,
      formula: undefined,
      record_date: dayjs(),
      flow_type: '支出',
      amount: undefined,
      description: '',
    });
    setTplAmounts({});
    setFmlAmounts({});
    setRegisterOpen(true);
  };

  const submitRegister = async () => {
    try {
      const values = await form.validateFields();
      const recordDate = values.record_date.format('YYYY-MM-DD');
      const desc = values.description?.trim() || '';
      setSubmitting(true);
      if (values.formula && selectedFormula) {
        // 公式登记：字段值代入公式计算金额，登记为一条流水
        if (fmlResult === null) {
          message.warning('请填写所有公式字段，且填写值需合法');
          return;
        }
        await financeApi.create({
          category_id: values.category,
          sub_category_id: values.sub_category || undefined,
          flow_type: values.flow_type,
          record_date: recordDate,
          amount: Math.round(fmlResult * 100) / 100,
          description: desc || `公式「${selectedFormula.name}」`,
        });
        message.success(`已按公式「${selectedFormula.name}」登记，计算结果 ${fmlResult.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`);
        setRegisterOpen(false);
        setFmlAmounts({});
        loadRecords();
        return;
      }
      if (values.template && selectedTpl) {
        // 模板批量登记：逐项填了金额的生成一条流水
        const entries = selectedTpl.items
          .map(it => ({ ...it, amount: tplAmounts[it.subCategoryId] }))
          .filter(e => e.amount !== undefined && e.amount !== null && Number(e.amount) > 0);
        if (entries.length === 0) {
          message.warning('请至少填写一项金额');
          return;
        }
        for (const e of entries) {
          await financeApi.create({
            category_id: values.category,
            sub_category_id: e.subCategoryId,
            flow_type: values.flow_type,
            record_date: recordDate,
            amount: Number(e.amount),
            description: desc,
          });
        }
        message.success(`已按模板「${selectedTpl.name}」登记 ${entries.length} 条流水，合计 ${tplTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`);
        setRegisterOpen(false);
        setTplAmounts({});
        loadRecords();
        return;
      }
      await financeApi.create({
        category_id: values.category,
        sub_category_id: values.sub_category || undefined,
        flow_type: values.flow_type,
        record_date: recordDate,
        amount: values.amount,
        description: desc,
      });
      message.success('登记成功');
      setRegisterOpen(false);
      loadRecords();
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验错误
      message.error(e?.response?.data?.detail || '登记失败');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteRecord = async (id: number) => {
    try {
      await financeApi.remove(id);
      message.success('已删除');
      loadRecords();
    } catch {
      message.error('删除失败');
    }
  };

  // ----- 分类管理操作（走数据库接口） -----
  const reloadCats = () => loadCategories();

  const renameCategory = async (id: number, newName: string) => {
    const name = newName.trim();
    if (!name) {
      setEditingCat(null);
      setEditingL1(null);
      return;
    }
    try {
      await financeCategoryApi.update(id, { name });
      message.success('已重命名');
      reloadCats();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '重命名失败');
    } finally {
      setEditingCat(null);
      setEditingL1(null);
    }
  };

  const addSubCat = async () => {
    const name = newCatName.trim();
    if (activeCat === null || !name) return;
    try {
      const res = await financeCategoryApi.create({ name, parent_id: activeCat });
      message.success(`已添加「${name}」`);
      setNewCatName('');
      reloadCats();
      // 若是从登记弹窗的下拉进入的，直接把新增的二级分类填入登记表单
      if (registerOpen && res.data.data?.id) {
        form.setFieldsValue({ sub_category: res.data.data.id });
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '添加失败');
    }
  };

  const deleteSubCat = async (id: number) => {
    try {
      await financeCategoryApi.remove(id);
      message.success('已删除');
      reloadCats();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除失败');
    }
  };

  const activeCatItem = l1Cats.find(c => c.id === activeCat);

  // ----- 模板管理操作 -----
  const openTplModal = () => {
    setTplEditing(null);
    setTplName('');
    setTplCatId(null);
    setTplSubIds([]);
    setTplFormOpen(false);
    setTplOpen(true);
  };

  const openTplEdit = (t: FinanceTemplateItem) => {
    setTplEditing(t);
    setTplName(t.name);
    setTplCatId(t.categoryId);
    setTplSubIds(t.items.map(i => i.subCategoryId));
    setTplFormOpen(true);
  };

  const saveTpl = async () => {
    if (!tplName.trim()) {
      message.warning('请输入模板名称');
      return;
    }
    if (!tplCatId) {
      message.warning('请选择所属板块');
      return;
    }
    if (tplSubIds.length === 0) {
      message.warning('请至少选择一个二级分类');
      return;
    }
    setTplSaving(true);
    try {
      if (tplEditing) {
        await financeTemplateApi.update(tplEditing.id, { name: tplName.trim(), sub_category_ids: tplSubIds });
        message.success('模板已更新');
      } else {
        await financeTemplateApi.create({ name: tplName.trim(), category_id: tplCatId, sub_category_ids: tplSubIds });
        message.success('模板已创建');
      }
      setTplOpen(false);
      loadTemplates();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '保存失败');
    } finally {
      setTplSaving(false);
    }
  };

  const deleteTpl = async (id: number) => {
    try {
      await financeTemplateApi.remove(id);
      message.success('模板已删除');
      loadTemplates();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除失败');
    }
  };

  // ----- 自定义公式管理（演示数据，未接后端） -----
  const openFmlModal = () => {
    setFmlEditing(null);
    setFmlName('');
    setFmlCatId(null);
    setFmlFields([]);
    setFmlExpr('');
    setFmlFormOpen(false);
    setFmlOpen(true);
  };

  const openFmlEdit = (f: FinanceFormulaDemo) => {
    setFmlEditing(f);
    setFmlName(f.name);
    setFmlCatId(f.categoryId);
    setFmlFields([...f.fields]);
    setFmlExpr(f.expression);
    setFmlFormOpen(true);
  };

  const addFmlField = () => {
    const name = fmlNewField.trim();
    if (!name) return;
    if (fmlFields.includes(name)) {
      message.warning('该字段已存在');
      return;
    }
    setFmlFields(prev => [...prev, name]);
    setFmlNewField('');
  };

  const saveFml = () => {
    const name = fmlName.trim();
    if (!name) {
      message.warning('请输入公式名称');
      return;
    }
    const fields = fmlFields.map(f => f.trim()).filter(Boolean);
    if (fields.length === 0) {
      message.warning('请至少添加一个自定义字段');
      return;
    }
    const expr = fmlExpr.trim();
    if (!expr) {
      message.warning('请输入计算表达式');
      return;
    }
    // 校验表达式：只能包含字段名与数字/运算符
    let rest = expr;
    for (const f of [...fields].sort((a, b) => b.length - a.length)) {
      rest = rest.split(f).join('');
    }
    if (/[^0-9+\-*/().\s]/.test(rest.replace(/\s/g, ''))) {
      message.warning('表达式包含未定义的字段或非法字符（支持 + - * / ( ) 和数字）');
      return;
    }
    // 用全 1 试算，确保表达式可计算
    const trial: Record<string, number | undefined> = {};
    fields.forEach(f => { trial[f] = 1; });
    const trialResult = evalFormula({ id: 0, name, categoryId: null, fields, expression: expr }, trial);
    if (trialResult === null) {
      message.warning('表达式无法计算，请检查书写');
      return;
    }
    if (fmlEditing) {
      setFormulas(prev => prev.map(f => (f.id === fmlEditing.id ? { ...f, name, categoryId: fmlCatId, fields, expression: expr } : f)));
      message.success('公式已更新');
    } else {
      const newId = Math.max(0, ...formulas.map(f => f.id)) + 1;
      setFormulas(prev => [...prev, { id: newId, name, categoryId: fmlCatId, fields, expression: expr }]);
      message.success('公式已创建');
    }
    setFmlOpen(false);
    setFmlFormOpen(false);
  };

  const deleteFml = (id: number) => {
    setFormulas(prev => prev.filter(f => f.id !== id));
    message.success('公式已删除');
  };

  // ----- 二级分类排序（上移/下移） -----
  const moveSubCat = (cat: FinanceCategoryItem, dir: -1 | 1) => {
    if (cat.parentId === null) return;
    const siblings = (l2ByParent.get(cat.parentId) || []).slice();
    const idx = siblings.findIndex(c => c.id === cat.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= siblings.length) return;
    siblings.splice(target, 0, siblings.splice(idx, 1)[0]);
    const newIds = siblings.map(c => c.id);
    // 乐观更新：本地先重排 sort 再同步后端
    const sortMap = new Map(newIds.map((id, i) => [id, i]));
    setCats(prev => prev.map(c => (sortMap.has(c.id) ? { ...c, sort: sortMap.get(c.id)! } : c)));
    financeCategoryApi.reorder(newIds).catch(() => {
      message.error('保存排序失败，已恢复');
      loadCategories();
    });
  };

  const renderDetailTable = (list: FinanceRecordItem[]) => (
    <Table
      size="small"
      loading={loading}
      columns={[
        { title: '日期', dataIndex: 'recordDate', key: 'recordDate', width: 110 },
        { title: '摘要', dataIndex: 'description', key: 'description', ellipsis: true },
        { title: '二级分类', dataIndex: 'subCategoryName', key: 'subCategoryName', width: 110, render: (v: string) => v || '-' },
        { title: '收支类型', dataIndex: 'flowType', key: 'flowType', width: 100 },
        { title: '金额', dataIndex: 'amount', key: 'amount', width: 130, align: 'right' as const, render: (v: number, row: FinanceRecordItem) => `${row.flowType === '收入' ? '+' : '-'}${Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
        { title: '登记人', dataIndex: 'createdBy', key: 'createdBy', width: 100 },
        { title: '登记时间', dataIndex: 'createdAt', key: 'createdAt', width: 140 },
        {
          title: '操作',
          key: 'action',
          width: 70,
          render: (_: any, row: FinanceRecordItem) => (
            <Popconfirm title="确认删除这条流水？" onConfirm={() => deleteRecord(row.id)}>
              <Button type="link" size="small" danger style={{ padding: 0 }}>删除</Button>
            </Popconfirm>
          ),
        },
      ]}
      dataSource={list}
      rowKey="id"
      pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 条` }}
      locale={{ emptyText: <Empty description="暂无流水，点击右上角「登记流水」录入" /> }}
    />
  );

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      {/* 页头 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <Space size={10}>
          <Wallet size={22} color="#1890ff" />
          <Text type="secondary">收支总览与各板块明细，数据来自「登记流水」录入</Text>
        </Space>
        <Space>
          <RangePicker
            value={dateRange}
            onChange={(v) => v && v[0] && v[1] && setDateRange([v[0], v[1]])}
            allowClear={false}
          />
          <Button icon={<RefreshCw size={14} />} onClick={() => { loadRecords(); reloadCats(); }}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openRegister()}>登记流水</Button>
        </Space>
      </div>

      {/* 顶部汇总指标卡 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={<Space size={6}><TrendingUp size={14} color="#389e0d" />收入合计</Space>}
              value={summary.income}
              precision={2}
              valueStyle={{ color: '#389e0d' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={<Space size={6}><TrendingDown size={14} color="#cf1322" />支出合计</Space>}
              value={summary.expense}
              precision={2}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={<Space size={6}><Scale size={14} color="#1890ff" />净额（收入-支出）</Space>}
              value={summary.profit}
              precision={2}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="净利率" value={summary.margin} suffix="%" valueStyle={{ color: '#722ed1' }} />
          </Card>
        </Col>
      </Row>

      {/* 收支可视化图表 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title="收入 / 支出 / 净额趋势（按月聚合，近12个月）" extra={<Text type="secondary">所选日期范围内的登记流水</Text>}>
            {monthlyTrend.length === 0 ? (
              <Empty description="暂无数据，请先在各板块登记流水" style={{ padding: '60px 0' }} />
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} />
                  <RechartsTooltip formatter={(v: any) => Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2 })} />
                  <Legend />
                  <Bar dataKey="income" name="收入" fill="#389e0d" radius={[4, 4, 0, 0]} barSize={18} />
                  <Bar dataKey="expense" name="支出" fill="#cf1322" radius={[4, 4, 0, 0]} barSize={18} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="支出构成（按板块）">
            {expenseBreakdown.length === 0 ? (
              <Empty description="暂无支出数据" style={{ padding: '60px 0' }} />
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={expenseBreakdown}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {expenseBreakdown.map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(v: any) => Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2 })} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
      </Row>

      {/* 各费用板块明细 */}
      <Card style={{ marginTop: 16 }}>
        <Tabs
          activeKey={activeSection === null ? undefined : String(activeSection)}
          onChange={(k) => setActiveSection(Number(k))}
          tabBarExtraContent={{
            right: (
              <Space size={8} style={{ marginLeft: 8 }}>
                <Button
                  icon={<FolderTree size={14} />}
                  onClick={() => {
                    setActiveCat(null);
                    setEditingCat(null);
                    setEditingL1(null);
                    setNewCatName('');
                    setCatOpen(true);
                  }}
                >
                  分类管理
                </Button>
                <Button icon={<ListChecks size={14} />} onClick={openTplModal}>
                  模板管理
                </Button>
                <Button icon={<Calculator size={14} />} onClick={openFmlModal}>
                  公式管理
                </Button>
              </Space>
            ),
          }}
          items={l1Cats.map((section) => {
            const list = records.filter(r => belongsTo(r, section));
            const income = list.filter(r => r.flowType === '收入').reduce((s, r) => s + Number(r.amount), 0);
            const expense = list.filter(r => r.flowType === '支出').reduce((s, r) => s + Number(r.amount), 0);
            return {
              key: String(section.id),
              label: (
                <Space size={6}>
                  {ICON_MAP[section.icon] ?? <Wallet size={15} />}
                  {section.name}
                </Space>
              ),
              children: (
                <>
                  <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <Space size={8}>
                      {section.remark && (
                        <Tooltip title={section.remark}>
                          <Text type="secondary">{section.remark}</Text>
                        </Tooltip>
                      )}
                      <Tag color="green">收入 {income.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Tag>
                      <Tag color="red">支出 {expense.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Tag>
                    </Space>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openRegister(section.id)}>
                      登记流水
                    </Button>
                  </div>
                  {renderDetailTable(list)}
                </>
              ),
            };
          })}
        />
      </Card>

      {/* 登记弹窗：板块 / 二级分类 / 日期 / 金额 / 收支类型 / 摘要 */}
      <Modal
        title="登记流水"
        open={registerOpen}
        onOk={submitRegister}
        onCancel={() => {
          setRegisterOpen(false);
          setTplAmounts({});
          setFmlAmounts({});
        }}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="板块（操作类型）" name="category" rules={[{ required: true, message: '请选择板块' }]}>
            <Select
              placeholder="请选择流水归属板块"
              onChange={() => form.setFieldValue('sub_category', undefined)}
            >
              {l1Cats.map(s => (
                <Select.Option key={s.id} value={s.id}>
                  <Space size={6}>{ICON_MAP[s.icon] ?? <Wallet size={15} />}{s.name}</Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="登记模板（选填，选后逐项填金额）" name="template">
            <Select
              placeholder="选择模板批量登记该板块的多项二级分类"
              allowClear
              options={(tpls.filter(t => t.categoryId === selectedCategoryId) || []).map(t => ({ label: `${t.name}（${t.items.length} 项）`, value: t.id }))}
              onChange={() => {
                setTplAmounts({});
                form.setFieldsValue({ sub_category: undefined, amount: undefined, formula: undefined });
                setFmlAmounts({});
              }}
            />
          </Form.Item>
          <Form.Item label="自定义公式（选填，选后填字段值自动算金额）" name="formula">
            <Select
              placeholder="选择公式，按公式计算登记金额"
              allowClear
              options={formulas
                .filter(f => f.categoryId === null || f.categoryId === selectedCategoryId)
                .map(f => ({ label: f.name, value: f.id }))}
              onChange={() => {
                setFmlAmounts({});
                form.setFieldsValue({ sub_category: undefined, amount: undefined, template: undefined });
                setTplAmounts({});
              }}
            />
          </Form.Item>
          {!selectedTplId && !selectedFormulaId && (l2ByParent.get(selectedCategoryId) || []).length > 0 && (
            <Form.Item label="二级分类" name="sub_category">
              <Select
                placeholder="选择该板块的二级分类（选填）"
                allowClear
                options={(l2ByParent.get(selectedCategoryId) || []).map(c => ({ label: c.name, value: c.id }))}
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <Divider style={{ margin: '8px 0' }} />
                    <Button
                      type="link"
                      block
                      icon={<Plus size={13} />}
                      onClick={() => {
                        setActiveCat(selectedCategoryId ?? null);
                        setEditingCat(null);
                        setEditingL1(null);
                        setNewCatName('');
                        setCatOpen(true);
                      }}
                    >
                      没有合适的选项？新增二级分类
                    </Button>
                  </>
                )}
              />
            </Form.Item>
          )}
          <Form.Item label="日期" name="record_date" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="收支类型" name="flow_type" rules={[{ required: true, message: '请选择收支类型' }]}>
            <Select>
              <Select.Option value="支出">支出</Select.Option>
              <Select.Option value="收入">收入</Select.Option>
            </Select>
          </Form.Item>
          {selectedTplId && selectedTpl ? (
            <>
              <div style={{ marginBottom: 8 }}>
                <Text strong>模板明细金额</Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>不填的项将跳过</Text>
              </div>
              {selectedTpl.items.map(it => (
                <div key={it.subCategoryId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text style={{ width: 110, flexShrink: 0 }}>{it.subName}</Text>
                  <InputNumber
                    style={{ flex: 1 }}
                    min={0.01}
                    precision={2}
                    placeholder="金额"
                    value={tplAmounts[it.subCategoryId]}
                    onChange={(v) => setTplAmounts(prev => ({ ...prev, [it.subCategoryId]: v ?? undefined }))}
                  />
                </div>
              ))}
              <div style={{ textAlign: 'right', margin: '4px 0 12px' }}>
                <Text strong>合计：</Text>
                <Text strong style={{ color: '#cf1322' }}>
                  {tplTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </div>
            </>
          ) : selectedFormulaId && selectedFormula ? (
            <>
              <div style={{ marginBottom: 8 }}>
                <Text strong>公式字段</Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  表达式：{selectedFormula.expression}
                </Text>
              </div>
              {selectedFormula.fields.map(field => (
                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text style={{ width: 110, flexShrink: 0 }}>{field}</Text>
                  <InputNumber
                    style={{ flex: 1 }}
                    precision={2}
                    placeholder={`请输入${field}`}
                    value={fmlAmounts[field]}
                    onChange={(v) => setFmlAmounts(prev => ({ ...prev, [field]: v ?? undefined }))}
                  />
                </div>
              ))}
              <div style={{ textAlign: 'right', margin: '4px 0 12px' }}>
                <Text strong>计算结果：</Text>
                <Text strong style={{ color: fmlResult === null ? '#999' : '#cf1322' }}>
                  {fmlResult === null ? '请填写所有字段' : fmlResult.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </div>
            </>
          ) : (
            <Form.Item label="金额" name="amount" rules={[{ required: true, message: '请输入金额' }]}>
              <InputNumber style={{ width: '100%' }} min={0.01} precision={2} placeholder="请输入金额" />
            </Form.Item>
          )}
          <Form.Item label="摘要说明" name="description">
            <Input.TextArea rows={2} maxLength={200} placeholder="选填，如：11月VAT申报 / 华昌电子采购尾款" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 分类管理弹窗：一级分类 → 二级分类增删改（数据库存储） */}
      <Modal
        title={
          activeCat ? (
            <Space size={8}>
              <Button
                type="text"
                size="small"
                icon={<ArrowLeft size={14} />}
                onClick={() => {
                  setActiveCat(null);
                  setEditingCat(null);
                }}
              />
              {activeCatItem?.name || ''} · 二级分类
            </Space>
          ) : (
            '分类管理'
          )
        }
        open={catOpen}
        onCancel={() => {
          setCatOpen(false);
          setActiveCat(null);
          setEditingCat(null);
          setEditingL1(null);
        }}
        footer={null}
        width={480}
        zIndex={1100}
      >
        {activeCat === null ? (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              一级分类（与页面板块一致），点击查看二级分类，✏️ 重命名（数据库存储）
            </Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {l1Cats.map((s) => (
                editingL1?.id === s.id ? (
                  <Input
                    key={s.id}
                    value={editingL1.text}
                    autoFocus
                    onChange={(e) => setEditingL1({ id: s.id, text: e.target.value })}
                    onPressEnter={() => renameCategory(s.id, editingL1.text)}
                    onBlur={() => renameCategory(s.id, editingL1.text)}
                    suffix={
                      <Button type="link" size="small" style={{ padding: 0 }} onMouseDown={(e) => e.preventDefault()} onClick={() => renameCategory(s.id, editingL1.text)}>
                        保存
                      </Button>
                    }
                  />
                ) : (
                  <div
                    key={s.id}
                    onClick={() => {
                      setActiveCat(s.id);
                      setEditingCat(null);
                      setNewCatName('');
                    }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '14px 16px',
                      borderRadius: 8,
                      background: '#fafafa',
                      cursor: 'pointer',
                      fontSize: 15,
                    }}
                  >
                    <Space size={8}>
                      {ICON_MAP[s.icon] ?? <Wallet size={15} />}
                      <span>{s.name}</span>
                    </Space>
                    <Space size={4}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {(l2ByParent.get(s.id) || []).length} 项
                      </Text>
                      <Button
                        type="text"
                        size="small"
                        icon={<Pencil size={13} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingL1({ id: s.id, text: s.name });
                        }}
                      />
                      <ChevronRight size={16} color="#bfbfbf" />
                    </Space>
                  </div>
                )
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {(l2ByParent.get(activeCat) || []).map((c, idx) =>
                editingCat?.id === c.id ? (
                  <Input
                    key={c.id}
                    value={editingCat.text}
                    autoFocus
                    onChange={(e) => setEditingCat({ id: c.id, text: e.target.value })}
                    onPressEnter={() => renameCategory(c.id, editingCat.text)}
                    onBlur={() => renameCategory(c.id, editingCat.text)}
                    suffix={
                      <Button type="link" size="small" style={{ padding: 0 }} onMouseDown={(e) => e.preventDefault()} onClick={() => renameCategory(c.id, editingCat.text)}>
                        保存
                      </Button>
                    }
                  />
                ) : (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '11px 16px',
                      borderRadius: 8,
                      background: '#fafafa',
                      fontSize: 14,
                    }}
                  >
                    <span>{c.name}</span>
                    <Space size={2}>
                      <Button
                        type="text"
                        size="small"
                        icon={<ArrowUp size={13} />}
                        disabled={idx === 0}
                        onClick={() => moveSubCat(c, -1)}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<ArrowDown size={13} />}
                        disabled={idx === (l2ByParent.get(activeCat) || []).length - 1}
                        onClick={() => moveSubCat(c, 1)}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<Pencil size={13} />}
                        onClick={() => setEditingCat({ id: c.id, text: c.name })}
                      />
                      <Popconfirm title="确认删除该二级分类？" onConfirm={() => deleteSubCat(c.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 size={13} />} />
                      </Popconfirm>
                    </Space>
                  </div>
                ),
              )}
            </div>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="新增二级分类名称"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onPressEnter={addSubCat}
                maxLength={50}
              />
              <Button type="primary" icon={<Plus size={14} />} onClick={addSubCat}>
                添加
              </Button>
            </Space.Compact>
          </>
        )}
      </Modal>
      {/* 模板管理弹窗：新建/编辑 = 名称 + 板块 + 勾选若干二级分类 */}
      <Modal
        title="模板管理"
        open={tplOpen}
        onCancel={() => setTplOpen(false)}
        footer={null}
        width={520}
        zIndex={1100}
      >
        {!tplFormOpen ? (
          // 模板列表
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              模板 = 某板块下常用的几个二级分类，登记时选模板逐项填金额、自动汇总
            </Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {tpls.length === 0 && (
                <Empty description="还没有模板，点击下方「新建模板」创建" />
              )}
              {tpls.map(t => {
                const catName = l1Cats.find(c => c.id === t.categoryId)?.name || '';
                return (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 16px',
                      borderRadius: 8,
                      background: '#fafafa',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {catName} · {t.items.map(i => i.subName).join(' / ')}
                      </Text>
                    </div>
                    <Space size={2}>
                      <Button type="text" size="small" icon={<Pencil size={13} />} onClick={() => openTplEdit(t)} />
                      <Popconfirm title="确认删除该模板？" onConfirm={() => deleteTpl(t.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 size={13} />} />
                      </Popconfirm>
                    </Space>
                  </div>
                );
              })}
            </div>
            <Button type="primary" block icon={<Plus size={14} />} onClick={() => { setTplEditing(null); setTplName(''); setTplCatId(null); setTplSubIds([]); setTplFormOpen(true); }}>
              新建模板
            </Button>
          </>
        ) : (
          // 新建/编辑表单
          <>
            <Form layout="vertical" style={{ marginTop: 8 }}>
              <Form.Item label="模板名称" required>
                <Input
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="如：月度固定开销 / 工资发放"
                  maxLength={50}
                />
              </Form.Item>
              <Form.Item label="所属板块" required>
                <Select
                  placeholder="选择一级分类"
                  value={tplCatId ?? undefined}
                  disabled={tplEditing !== null} // 编辑时不允许换板块（子项跨板块无意义）
                  getPopupContainer={(node) => node.parentNode as HTMLElement}
                  onChange={(v) => {
                    setTplCatId(v);
                    setTplSubIds([]);
                  }}
                >
                  {l1Cats.map(s => (
                    <Select.Option key={s.id} value={s.id}>
                      <Space size={6}>{ICON_MAP[s.icon] ?? <Wallet size={15} />}{s.name}</Space>
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="包含的二级分类" required>
                <Select
                  mode="multiple"
                  placeholder={tplCatId ? '勾选该板块下的二级分类（按勾选顺序）' : '请先选择所属板块'}
                  value={tplSubIds}
                  disabled={!tplCatId}
                  getPopupContainer={(node) => node.parentNode as HTMLElement}
                  onChange={setTplSubIds}
                  options={(l2ByParent.get(tplCatId || 0) || []).map(c => ({ label: c.name, value: c.id }))}
                />
              </Form.Item>
            </Form>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => { setTplFormOpen(false); setTplEditing(null); setTplName(''); setTplCatId(null); setTplSubIds([]); }}>
                {tplEditing ? '返回列表' : '取消'}
              </Button>
              <Button type="primary" loading={tplSaving} onClick={saveTpl}>保存</Button>
            </Space>
          </>
        )}
      </Modal>

      {/* 公式管理弹窗：自定义字段 + 计算表达式（演示数据，未接后端） */}
      <Modal
        title="自定义公式管理"
        open={fmlOpen}
        onCancel={() => setFmlOpen(false)}
        footer={null}
        width={520}
        zIndex={1100}
      >
        {!fmlFormOpen ? (
          // 公式列表
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              公式 = 自定义字段 + 计算表达式；登记时填字段值，自动算出金额（当前为演示数据，未接后端）
            </Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {formulas.length === 0 && (
                <Empty description="还没有公式，点击下方「新建公式」创建" />
              )}
              {formulas.map(f => {
                const catName = f.categoryId ? (l1Cats.find(c => c.id === f.categoryId)?.name || '') : '通用';
                return (
                  <div
                    key={f.id}
                    style={{
                      padding: '12px 16px',
                      borderRadius: 8,
                      background: '#fafafa',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{f.name}</div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {catName} · {f.expression}
                      </Text>
                    </div>
                    <Space size={2} style={{ flexShrink: 0 }}>
                      <Button type="text" size="small" icon={<Pencil size={13} />} onClick={() => openFmlEdit(f)} />
                      <Popconfirm title="确认删除该公式？" onConfirm={() => deleteFml(f.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 size={13} />} />
                      </Popconfirm>
                    </Space>
                  </div>
                );
              })}
            </div>
            <Button type="primary" block icon={<Plus size={14} />} onClick={() => { setFmlEditing(null); setFmlName(''); setFmlCatId(null); setFmlFields([]); setFmlExpr(''); setFmlFormOpen(true); }}>
              新建公式
            </Button>
          </>
        ) : (
          // 新建/编辑表单
          <>
            <Form layout="vertical" style={{ marginTop: 8 }}>
              <Form.Item label="公式名称" required>
                <Input
                  value={fmlName}
                  onChange={(e) => setFmlName(e.target.value)}
                  placeholder="如：应发工资 / 运费结算"
                  maxLength={50}
                />
              </Form.Item>
              <Form.Item label="归属板块（选填，不选则所有板块可用）">
                <Select
                  placeholder="选择一级分类"
                  allowClear
                  value={fmlCatId ?? undefined}
                  disabled={fmlEditing !== null}
                  getPopupContainer={(node) => node.parentNode as HTMLElement}
                  onChange={(v) => setFmlCatId(v ?? null)}
                >
                  {l1Cats.map(s => (
                    <Select.Option key={s.id} value={s.id}>
                      <Space size={6}>{ICON_MAP[s.icon] ?? <Wallet size={15} />}{s.name}</Space>
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="自定义字段" required>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                  {fmlFields.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Input
                        value={f}
                        onChange={(e) => setFmlFields(prev => prev.map((x, j) => (j === i ? e.target.value : x)))}
                        placeholder="字段名，如：基本工资"
                        maxLength={20}
                      />
                      <Popconfirm title="删除该字段？" onConfirm={() => setFmlFields(prev => prev.filter((_, j) => j !== i))}>
                        <Button type="text" size="small" danger icon={<Trash2 size={13} />} />
                      </Popconfirm>
                    </div>
                  ))}
                </div>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={fmlNewField}
                    onChange={(e) => setFmlNewField(e.target.value)}
                    onPressEnter={addFmlField}
                    placeholder="新增字段名"
                    maxLength={20}
                  />
                  <Button icon={<Plus size={13} />} onClick={addFmlField}>添加字段</Button>
                </Space.Compact>
              </Form.Item>
              <Form.Item
                label="计算表达式"
                required
                extra={fmlFields.filter(Boolean).length > 0 ? `可用字段：${fmlFields.filter(Boolean).join('、')}（支持 + - * / ( ) 和数字）` : '请先添加字段'}
              >
                <Input
                  value={fmlExpr}
                  onChange={(e) => setFmlExpr(e.target.value)}
                  placeholder="如：基本工资 + 绩效奖金 * 1.5 - 社保扣款"
                  maxLength={200}
                />
              </Form.Item>
            </Form>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => { setFmlFormOpen(false); setFmlEditing(null); }}>
                {fmlEditing ? '返回列表' : '取消'}
              </Button>
              <Button type="primary" onClick={saveFml}>保存</Button>
            </Space>
          </>
        )}
      </Modal>
    </div>
  );
};

export default FinanceBot;
