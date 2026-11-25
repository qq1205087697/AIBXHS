import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Row, Col, Tabs, Table, Statistic, DatePicker, Button, Tag, Space, Typography, Tooltip, Modal, Form, Input, InputNumber, Select, Popconfirm, message, Empty } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  Wallet, TrendingUp, TrendingDown, RefreshCw, Scale, Landmark, Users, ShoppingBag,
  Briefcase, Truck, Banknote, SearchCheck, Megaphone, Building2, Store,
} from 'lucide-react';
import dayjs, { Dayjs } from 'dayjs';
import { financeApi, FinanceRecordItem } from '../api';

const { Text } = Typography;
const { RangePicker } = DatePicker;

// ============================================================
// 财务机器人：顶部收支可视化 + 各费用板块明细（日期/金额/收支类型）
// 数据来源：/api/finance/records（板块"登记"入口录入）
// ============================================================

// ----- 支出板块配置（category 与后端白名单一致） -----
interface ExpenseSection {
  id: string;       // 后端 category 值
  label: string;
  icon: React.ReactNode;
  color: string;
  note: string;
}

const EXPENSE_SECTIONS: ExpenseSection[] = [
  { id: '税务', label: '税务', icon: <Landmark size={15} />, color: '#cf1322', note: 'VAT / 关税 / 申报缴费流水' },
  { id: '工资', label: '工资', icon: <Users size={15} />, color: '#722ed1', note: '薪资发放 / 社保公积金流水' },
  { id: '采购', label: '采购', icon: <ShoppingBag size={15} />, color: '#1890ff', note: '采购付款 / 应付账款流水' },
  { id: '服务商', label: '服务商', icon: <Briefcase size={15} />, color: '#13c2c2', note: '服务商合同费用 / 月结账单流水' },
  { id: '物流商', label: '物流商', icon: <Truck size={15} />, color: '#fa8c16', note: '头程/尾程运费 / 对账付款流水' },
  { id: '收款', label: '收款', icon: <Banknote size={15} />, color: '#389e0d', note: '平台回款 / 到账流水' },
  { id: '核查', label: '核查', icon: <SearchCheck size={15} />, color: '#faad14', note: '差异调整 / 异常流水冲正' },
  { id: '广告费', label: '广告费', icon: <Megaphone size={15} />, color: '#eb2f96', note: '各店铺广告花费流水' },
  { id: '房租物业', label: '房租物业', icon: <Building2 size={15} />, color: '#8c8c8c', note: '办公室/仓库租金 / 物业水电流水' },
  { id: '平台费用', label: '平台费用', icon: <Store size={15} />, color: '#fa541c', note: '平台佣金 / FBA配送仓储费扣款流水' },
];

const PIE_COLORS = ['#1890ff', '#eb2f96', '#fa541c', '#fa8c16', '#722ed1', '#8c8c8c', '#13c2c2', '#cf1322', '#faad14', '#389e0d', '#d9d9d9'];

// 明细表列：日期 / 摘要 / 收支类型 / 金额 / 登记人 / 登记时间 / 操作
const DETAIL_COLUMNS = [
  { title: '日期', dataIndex: 'recordDate', key: 'recordDate', width: 110 },
  { title: '摘要', dataIndex: 'description', key: 'description', ellipsis: true },
  { title: '收支类型', dataIndex: 'flowType', key: 'flowType', width: 100 },
  { title: '金额', dataIndex: 'amount', key: 'amount', width: 130, align: 'right' as const, render: (v: number, row: FinanceRecordItem) => `${row.flowType === '收入' ? '+' : '-'}${Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
  { title: '登记人', dataIndex: 'createdBy', key: 'createdBy', width: 100 },
  { title: '登记时间', dataIndex: 'createdAt', key: 'createdAt', width: 140 },
  { title: '操作', key: 'action', width: 70 },
];

const FinanceBot: React.FC = () => {
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [records, setRecords] = useState<FinanceRecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(EXPENSE_SECTIONS[0].id);

  // 登记弹窗
  const [registerOpen, setRegisterOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

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

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // ----- 汇总指标（所选日期范围） -----
  const summary = useMemo(() => {
    const income = records.filter(r => r.flowType === '收入').reduce((s, r) => s + Number(r.amount), 0);
    const expense = records.filter(r => r.flowType === '支出').reduce((s, r) => s + Number(r.amount), 0);
    return { income, expense, profit: income - expense, margin: income > 0 ? ((income - expense) / income * 100).toFixed(1) : '0.0' };
  }, [records]);

  // ----- 近12个月收支趋势（按月聚合，不含未来月份，最多展示所选范围所在年份的数据） -----
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

  // ----- 登记入口 -----
  const openRegister = (category?: string) => {
    form.setFieldsValue({
      category: category || EXPENSE_SECTIONS[0].id,
      record_date: dayjs(),
      flow_type: '支出',
      amount: undefined,
      description: '',
    });
    setRegisterOpen(true);
  };

  const submitRegister = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await financeApi.create({
        category: values.category,
        flow_type: values.flow_type,
        record_date: values.record_date.format('YYYY-MM-DD'),
        amount: values.amount,
        description: values.description || '',
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

  const renderDetailTable = (list: FinanceRecordItem[]) => (
    <Table
      size="small"
      loading={loading}
      columns={[
        ...DETAIL_COLUMNS.slice(0, 6),
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
      locale={{ emptyText: <Empty description="暂无流水，点击右上角「登记」录入" /> }}
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
          <Button icon={<RefreshCw size={14} />} onClick={loadRecords}>刷新</Button>
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

      {/* 各费用板块明细（统一字段：日期/金额/收支类型 + 登记入口） */}
      <Card style={{ marginTop: 16 }}>
        <Tabs
          activeKey={activeSection}
          onChange={setActiveSection}
          items={EXPENSE_SECTIONS.map((section) => {
            const list = records.filter(r => r.category === section.id);
            const income = list.filter(r => r.flowType === '收入').reduce((s, r) => s + Number(r.amount), 0);
            const expense = list.filter(r => r.flowType === '支出').reduce((s, r) => s + Number(r.amount), 0);
            return {
              key: section.id,
              label: (
                <Space size={6}>
                  {section.icon}
                  {section.label}
                </Space>
              ),
              children: (
                <>
                  <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <Space size={8}>
                      <Tooltip title={section.note}>
                        <Text type="secondary">{section.note}</Text>
                      </Tooltip>
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

      {/* 登记弹窗：板块（操作类型）/ 日期 / 金额 / 收支类型 / 摘要 */}
      <Modal
        title="登记流水"
        open={registerOpen}
        onOk={submitRegister}
        onCancel={() => setRegisterOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="板块（操作类型）" name="category" rules={[{ required: true, message: '请选择板块' }]}>
            <Select placeholder="请选择流水归属板块">
              {EXPENSE_SECTIONS.map(s => (
                <Select.Option key={s.id} value={s.id}>
                  <Space size={6}>{s.icon}{s.label}</Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="日期" name="record_date" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="收支类型" name="flow_type" rules={[{ required: true, message: '请选择收支类型' }]}>
            <Select>
              <Select.Option value="支出">支出</Select.Option>
              <Select.Option value="收入">收入</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="金额" name="amount" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber style={{ width: '100%' }} min={0.01} precision={2} placeholder="请输入金额" />
          </Form.Item>
          <Form.Item label="摘要说明" name="description">
            <Input.TextArea rows={2} maxLength={200} placeholder="选填，如：11月VAT申报 / 华昌电子采购尾款" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default FinanceBot;
