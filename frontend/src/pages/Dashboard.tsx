import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Row, Col, Statistic, Table, Tag, Pagination, Modal, DatePicker, message } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import {
  TrendingUp,
  Package,
  MessageSquare,
  DollarSign,
  AlertTriangle,
  ClipboardList,
  Ship,
  Mail,
  ChevronRight,
  ShoppingCart,
  PackageX,
  Search,
  X,
  User,
  Users,
  Bot,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { dashboardApi, inventoryApi, reviewsApi } from '../api'
import apiClient from '../api'
import RobotBriefing from '../components/RobotBriefing'
import lunarJs from 'lunar-javascript'

interface DashboardData {
  inventoryAlerts: {
    low_stock?: number
    overstock?: number
    [key: string]: number | undefined
  }
  negativeReviews: number
  productCount: number
  storeCount: number
  salesTrend: Array<{date: string, sales: number}>
  inventoryDistribution: Array<{range: string, count: number}>
}

interface InventoryAlert {
  id: string
  asin: string
  name: string
  currentStock: number
  safetyStock: number
  daysRemaining: number
  status: string
  category: string
  suggestion: string
}

interface ReviewItem {
  id: string
  asin: string
  productName: string
  rating: number
  originalText: string
  translatedText: string
  keyPoints: string[]
  date: string
  status: string
  author: string
}

const TIMEZONES = [
  { label: '中国·北京', zone: 'Asia/Shanghai' },
  { label: '美国·后台', sub: '洛杉矶 PT', zone: 'America/Los_Angeles' },
  { label: '美国·买家', sub: '纽约 ET · 多伦多 ET', zone: 'America/New_York' },
  { label: '英国', sub: '伦敦 GMT/BST', zone: 'Europe/London' },
  { label: '欧区·中欧', sub: '柏林 CET/CEST', zone: 'Europe/Berlin' },
]

// 模拟时钟表盘（SVG）
const AnalogClock: React.FC<{ hour: number; minute: number; second: number; color: string; size?: number }> = ({ hour, minute, second, color, size = 52 }) => {
  const hourDeg = (hour % 12) * 30 + minute * 0.5
  const minDeg = minute * 6 + second * 0.1
  const secDeg = second * 6
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="47" fill="#ffffff" stroke={color} strokeWidth="4" />
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 30 * Math.PI) / 180
        const x1 = 50 + 38 * Math.sin(angle)
        const y1 = 50 - 38 * Math.cos(angle)
        const x2 = 50 + 43 * Math.sin(angle)
        const y2 = 50 - 43 * Math.cos(angle)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={i % 3 === 0 ? 4 : 2} />
      })}
      <line x1="50" y1="50" x2="50" y2="28" stroke="#333" strokeWidth="5" strokeLinecap="round" transform={`rotate(${hourDeg} 50 50)`} />
      <line x1="50" y1="50" x2="50" y2="18" stroke="#333" strokeWidth="3.5" strokeLinecap="round" transform={`rotate(${minDeg} 50 50)`} />
      <line x1="50" y1="50" x2="50" y2="15" stroke="#ff4d4f" strokeWidth="2" strokeLinecap="round" transform={`rotate(${secDeg} 50 50)`} />
      <circle cx="50" cy="50" r="4" fill={color} />
    </svg>
  )
}

// ===== 世界时钟（内部每秒自刷新，避免整页每秒重渲染导致滚动卡顿） =====
const WorldClocks: React.FC<{ color: string; primaryDark: string }> = ({ color, primaryDark }) => {
  const [tick, setTick] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setTick(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const formatZoneTime = (zone: string) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(tick)
  const formatZoneDate = (zone: string) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone,
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).format(tick)
  const getZoneParts = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(tick)
    const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0', 10)
    return { hour: get('hour') % 24, minute: get('minute'), second: get('second') }
  }
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'nowrap' }}>
      {TIMEZONES.map(tz => (
        <div key={tz.zone} style={{
          flex: 1,
          minWidth: 0,
          background: '#ffffff',
          borderRadius: 10,
          padding: '12px 16px',
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
          border: '1px solid #f0f0f0'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>
              {tz.label}{tz.sub ? `：${tz.sub}` : ''}
            </span>
            <span style={{ fontSize: 12, color: '#bbb', marginLeft: 6, flexShrink: 0 }}>
              {formatZoneDate(tz.zone)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 4px' }}>
            <AnalogClock {...getZoneParts(tz.zone)} color={color} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: primaryDark, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3, textAlign: 'center' }}>
            {formatZoneTime(tz.zone)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ===== 日历节日（公历固定 / 农历固定 / 浮动规则 三类，跨年自动计算） =====

interface HolidayDef {
  name: string
  icon: string
  type: 'solar' | 'lunar' | 'rule'
  md?: string                                   // 公历固定 MM-DD
  lm?: string                                   // 农历固定 MM-DD（正月初一 = 01-01）
  rule?: (y: number) => Dayjs                   // 浮动节日：按年份计算公历日期
}

// 第 n 个星期 w（weekday: 0=周日）的公历日期
const nthWeekday = (y: number, m: number, n: number, weekday: number): Dayjs => {
  const first = dayjs(`${y}-${String(m).padStart(2, '0')}-01`)
  const offset = (weekday - first.day() + 7) % 7
  return first.add(offset + (n - 1) * 7, 'day')
}
// 复活节（匿名高斯算法，1583 年后公历适用）
const easterDate = (y: number): Dayjs => {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100
  const d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m2 = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m2 + 114) / 31)
  const day = ((h + l - 7 * m2 + 114) % 31) + 1
  return dayjs(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
}
// 清明（21 世纪近似公式：int(y*0.2422+4.81)，2000-2099 适用）
const qingmingDate = (y: number): Dayjs =>
  dayjs(`${y}-04-${String(Math.floor(y % 100 * 0.2422 + 4.81)).padStart(2, '0')}`)

const HOLIDAY_DEFS: HolidayDef[] = [
  // 农历节日
  { name: '春节', icon: '🧨', type: 'lunar', lm: '01-01' },
  { name: '元宵节', icon: '🏮', type: 'lunar', lm: '01-15' },
  { name: '清明节', icon: '🌿', type: 'rule', rule: qingmingDate },
  { name: '端午节', icon: '🥟', type: 'lunar', lm: '05-05' },
  { name: '七夕', icon: '🎋', type: 'lunar', lm: '07-07' },
  { name: '中秋节', icon: '🥮', type: 'lunar', lm: '08-15' },
  { name: '重阳节', icon: '⛰️', type: 'lunar', lm: '09-09' },
  { name: '除夕', icon: '🎆', type: 'rule', rule: y => findSpringFestival(y + 1).subtract(1, 'day') },
  // 公历固定节日
  { name: '元旦', icon: '🎊', type: 'solar', md: '01-01' },
  { name: '情人节', icon: '💝', type: 'solar', md: '02-14' },
  { name: '妇女节', icon: '🌷', type: 'solar', md: '03-08' },
  { name: '劳动节', icon: '🛠️', type: 'solar', md: '05-01' },
  { name: '美国独立日', icon: '🗽', type: 'solar', md: '07-04' },
  { name: '返校季开启', icon: '🎒', type: 'solar', md: '08-15' },
  { name: '德国统一日', icon: '🎡', type: 'solar', md: '10-03' },
  { name: '万圣节', icon: '🎃', type: 'solar', md: '10-31' },
  { name: '平安夜', icon: '🎄', type: 'solar', md: '12-24' },
  { name: '圣诞节', icon: '🎅', type: 'solar', md: '12-25' },
  { name: '节礼日', icon: '🎁', type: 'solar', md: '12-26' },
  { name: '跨年夜', icon: '🥂', type: 'solar', md: '12-31' },
  // 浮动节日（每年自动计算）
  { name: '复活节', icon: '🐣', type: 'rule', rule: easterDate },
  { name: '母亲节', icon: '💐', type: 'rule', rule: y => nthWeekday(y, 5, 2, 0) },
  { name: '父亲节', icon: '👔', type: 'rule', rule: y => nthWeekday(y, 6, 3, 0) },
  { name: '感恩节', icon: '🦃', type: 'rule', rule: y => nthWeekday(y, 11, 4, 4) },
  { name: '黑色星期五', icon: '🖤', type: 'rule', rule: y => nthWeekday(y, 11, 4, 4).add(1, 'day') },
  { name: '网络星期一', icon: '🛒', type: 'rule', rule: y => nthWeekday(y, 11, 4, 4).add(4, 'day') },
]

// 找某年农历正月初一（春节）的公历日期：lunar-javascript 直接支持农历→公历
const LUNAR = lunarJs.Lunar
function findSpringFestival(y: number): Dayjs {
  return dayjs(LUNAR.fromYmd(y, 1, 1).getSolar().toYmd())
}
// 农历固定节日（农历 MM-DD）→ 当年对应公历 dayjs（闰月节日暂不涉及）
function lunarToDate(y: number, lm: string): Dayjs {
  const [tm, td] = lm.split('-').map(Number)
  return dayjs(LUNAR.fromYmd(y, tm, td).getSolar().toYmd())
}
// 生成某年全部节日实例（升序）
const getHolidayDates = (y: number): Array<{ name: string; icon: string; date: Dayjs; lunar: boolean }> =>
  HOLIDAY_DEFS
    .map(h => {
      let date: Dayjs | null = null
      if (h.type === 'solar' && h.md) date = dayjs(`${y}-${h.md}`)
      else if (h.type === 'lunar' && h.lm) date = lunarToDate(y, h.lm)
      else if (h.type === 'rule' && h.rule) date = h.rule(y)
      return date ? { name: h.name, icon: h.icon, date, lunar: h.type === 'lunar' } : null
    })
    .filter((x): x is { name: string; icon: string; date: Dayjs; lunar: boolean } => !!x)
    .sort((a, b) => a.date.valueOf() - b.date.valueOf())

// 农历换算含逐日循环，按年缓存结果（module 级，跨组件/月份切换复用）
const holidayCache = new Map<number, Array<{ name: string; icon: string; date: Dayjs; lunar: boolean }>>()
const getHolidayDatesCached = (y: number) => {
  if (!holidayCache.has(y)) holidayCache.set(y, getHolidayDates(y))
  return holidayCache.get(y)!
}

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']

// ===== 今日待处理配置（点击跳转对应页面板块，数量从各业务API实时获取） =====
const TASK_CONFIG = [
  { id: 'buybox', icon: <ShoppingCart size={16} />, label: '购物车预警', color: '#fa8c16', to: '/data-alert', section: 'section-buybox' },
  { id: 'shipment', icon: <Ship size={16} />, label: '货件到达提醒', color: '#1890ff', to: '/data-alert', section: 'section-shipment' },
  { id: 'email', icon: <Mail size={16} />, label: '待跟进邮件', color: '#722ed1', to: '/email' },
  { id: 'review', icon: <MessageSquare size={16} />, label: '新增差评', color: '#cf1322', to: '/review' },
  { id: 'stockout', icon: <PackageX size={16} />, label: '断货风险', color: '#faad14', to: '/inventory' },
]

// ===== 消息通知数据结构（来自 group_messages 表） =====
interface NoticeItem {
  id: number
  group: string
  sender: string
  text: string
  time: string
}

// demo 账号消息通知测试数据（时间相对今天动态生成，覆盖近30天，供演示分页/过滤）
const buildDemoNotices = (): NoticeItem[] => {
  const mk = (id: number, daysAgo: number, hh: number, mm: number, group: string, sender: string, text: string): NoticeItem => ({
    id, group, sender, text,
    time: dayjs().subtract(daysAgo, 'day').hour(hh).minute(mm).format('YYYY-MM-DD HH:mm'),
  })
  return [
    mk(1, 0, 10, 23, '运营-美区群', '张倩', 'US站 A10 竞品昨晚降价8%，建议今天跟调广告竞价，别丢购物车。'),
    mk(2, 0, 9, 41, '物流跟踪群', '王磊', 'FBA货件 FBA15ABCD123 已到洛杉矶仓，预计明天上架，注意核对数量。'),
    mk(3, 1, 18, 5, '客服售后群', '李敏', '昨天新增2条差评，都是物流时效问题，已整理到表格，麻烦看下要不要回评。'),
    mk(4, 1, 15, 12, '运营-欧区群', '陈晨', 'DE站 B07 断货风险预警，按当前销量只够撑4天，建议尽快补货。'),
    mk(5, 2, 11, 37, '广告优化群', '刘洋', 'Q4旺季广告预算建议提前拉高20%，ACOS目前28%在可控范围内。'),
    mk(6, 3, 16, 48, '采购协同群', '赵静', '10月采购单已发工厂，交期25天，国庆后第一批能出。'),
    mk(7, 4, 9, 15, '运营-美区群', '张倩', '黑五选品清单初稿已同步到共享盘，重点推厨房类目。'),
    mk(8, 5, 14, 22, '物流跟踪群', '王磊', '海运费本周上涨12%，美西线舱位紧张，建议提前订舱。'),
    mk(9, 6, 17, 30, '客服售后群', '李敏', '买家邮件回复率98%，剩余3封待跟进邮件已标黄。'),
    mk(10, 6, 10, 8, '运营-日区群', '佐藤', 'JP站listing日文文案已优化，点击率提升明显。'),
    mk(11, 8, 15, 44, '广告优化群', '刘洋', '上周ACOS汇总：美区24%、欧区31%，欧区偏高已调整否定词。'),
    mk(12, 10, 9, 52, '运营-欧区群', '陈晨', '英国站VAT申报截止提醒，财务已收到通知。'),
    mk(13, 12, 13, 19, '采购协同群', '赵静', '新品样品已到，明天上午评审，会议室A。'),
    mk(14, 14, 11, 2, '物流跟踪群', '王磊', '海运整柜 GESC1234567 已到港，清关中。'),
    mk(15, 16, 16, 35, '客服售后群', '李敏', '退货率周报：整体1.8%，服装类目偏高2.6%。'),
    mk(16, 18, 10, 26, '运营-美区群', '张倩', 'Prime Day复盘会纪要已发群文件，注意查收。'),
    mk(17, 20, 14, 58, '广告优化群', '刘洋', '新品A+页面已上线，观察一周数据再调整。'),
    mk(18, 22, 9, 33, '运营-日区群', '佐藤', 'JP站Q4库存计划已确认，海运10月初出发。'),
    mk(19, 24, 17, 11, '采购协同群', '赵静', '工厂报价单已更新，包装成本下降0.3元。'),
    mk(20, 26, 12, 47, '物流跟踪群', '王磊', '空运补货通道已恢复，急件可以走空运。'),
    mk(21, 28, 15, 20, '运营-欧区群', '陈晨', '欧区秋季大促报名即将截止，3个ASIN已提报。'),
    mk(22, 29, 10, 55, '客服售后群', '李敏', '差评问题SKU已换包装，观察后续买家反馈。'),
  ]
}

// WMO 天气码 → 简报场景（图标 / 文案 / 建议文案）
const mapWmoWeather = (code: number, temp: number): { icon: string; text: string; tip: string | null } => {
  const t = `${temp}℃`
  if (temp >= 35) return { icon: '🔥', text: `高温 ${t}`, tip: '注意防暑降温' }
  if (temp <= 0) return { icon: '🥶', text: `寒潮 ${t}`, tip: '注意保暖防冻' }
  if (code === 0) return { icon: '☀️', text: `晴 ${t}`, tip: null }
  if (code === 1) return { icon: '🌤', text: `晴 ${t}`, tip: null }
  if (code === 2) return { icon: '⛅', text: `多云 ${t}`, tip: null }
  if (code === 3) return { icon: '☁️', text: `阴天 ${t}`, tip: null }
  if (code === 45 || code === 48) return { icon: '🌫', text: `雾霾 ${t}`, tip: '空气较差，外出戴口罩' }
  if (code >= 51 && code <= 57) return { icon: '🌦', text: `毛毛雨 ${t}`, tip: '随身备伞' }
  if (code === 61) return { icon: '🌦', text: `小雨 ${t}`, tip: '随身备伞' }
  if (code === 63) return { icon: '🌧', text: `中雨 ${t}`, tip: '出门记得带伞' }
  if (code === 65) return { icon: '🌧', text: `大雨 ${t}`, tip: '雨大路滑，减少外出' }
  if ((code >= 66 && code <= 67) || (code >= 56 && code <= 57)) return { icon: '🌧', text: `冻雨 ${t}`, tip: '路面结冰，出行小心' }
  if (code >= 71 && code <= 77) return { icon: '🌨', text: `降雪 ${t}`, tip: '路面湿滑，注意安全' }
  if (code >= 80 && code <= 82) return { icon: '🌦', text: `阵雨 ${t}`, tip: '随身备伞' }
  if (code === 85 || code === 86) return { icon: '🌨', text: `阵雪 ${t}`, tip: '路面湿滑，注意安全' }
  if (code === 95) return { icon: '⛈', text: `雷阵雨 ${t}`, tip: '有雷电，减少外出' }
  if (code === 96 || code === 99) return { icon: '⛈', text: `雷暴冰雹 ${t}`, tip: '冰雹预警，护好车辆' }
  return { icon: '🌤', text: `多云 ${t}`, tip: null }
}

const Dashboard: React.FC = () => {
  const { currentTheme } = useTheme()
  const { user } = useAuth()
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [inventoryAlerts, setInventoryAlerts] = useState<InventoryAlert[]>([])
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  // 消息通知搜索过滤
  const [noticeSearchOpen, setNoticeSearchOpen] = useState(false)
  const [noticeSearch, setNoticeSearch] = useState('')
  const [senderSearch, setSenderSearch] = useState('')
  // 群名筛选（'' = 全部群；选项来自当前已加载消息的群名去重）
  const [noticeGroupFilter, setNoticeGroupFilter] = useState('')
  // 消息行 hover 高亮改用纯 CSS（.notice-row:hover），避免 setState 导致整页重渲染卡顿
  const [activeNotice, setActiveNotice] = useState<NoticeItem | null>(null)
  // 消息通知分页（每页10条）
  const [noticePage, setNoticePage] = useState(1)
  // 节日日历（月视图，可切换月份）
  const [calMonth, setCalMonth] = useState(() => dayjs().startOf('month'))
  // 备忘录（真实用户接入 memos 表按 user_id 隔离；demo 账号保留本地测试数据）
  const memoDemoMode = user?.tenant_id === 6 || (user?.username || '').toLowerCase() === 'demo'
  const [memos, setMemos] = useState<Array<{ id: number; text: string; level: string; date: string; done: boolean }>>(memoDemoMode ? [
    { id: 1, text: '跟进 US 站 B07 广告花费异常（ACOS 超阈值）', level: '重要', date: dayjs().format('YYYY-MM-DD'), done: false },
    { id: 2, text: '黑五前完成 DE 仓库 A10 SKU 补货计划', level: '重要', date: dayjs().add(1, 'day').format('YYYY-MM-DD'), done: false },
    { id: 3, text: '回复英国客户售后邮件（换货申请）', level: '普通', date: dayjs().add(2, 'day').format('YYYY-MM-DD'), done: false },
    { id: 4, text: '整理 Q4 大促选品清单给采购', level: '普通', date: dayjs().add(3, 'day').format('YYYY-MM-DD'), done: false },
    { id: 5, text: '更新新品 A12 主图与 A+ 页面', level: '普通', date: dayjs().subtract(2, 'day').format('YYYY-MM-DD'), done: true },
  ] : [])
  const mapMemoRow = (r: any) => ({ id: r.id, text: r.content, level: r.level, date: r.record_date, done: !!r.done })
  const loadMemos = async () => {
    try {
      const res = await apiClient.get('/memos')
      if (res.data?.success) setMemos((res.data.data || []).map(mapMemoRow))
    } catch { /* 接口失败时保持当前列表 */ }
  }
  useEffect(() => { if (!memoDemoMode) loadMemos() }, [])
  const [memoInput, setMemoInput] = useState('')
  // 快速添加的紧急程度（默认普通，选中后连续添加保持所选级别）
  const [memoQuickLevel, setMemoQuickLevel] = useState<'紧急' | '重要' | '普通'>('普通')
  // 备忘录筛选（右上角：全部/紧急/重要/普通）与排序（按日期/按紧急程度）
  const [memoLevelFilter, setMemoLevelFilter] = useState<'全部' | '紧急' | '重要' | '普通'>('全部')
  const [memoSortKey, setMemoSortKey] = useState<'date' | 'level'>('date')
  const addMemo = async () => {
    const t = memoInput.trim()
    if (!t) return
    const today = dayjs().format('YYYY-MM-DD')
    if (memoDemoMode) {
      setMemos([{ id: Date.now(), text: t, level: memoQuickLevel, date: today, done: false }, ...memos])
      setMemoInput('')
      return
    }
    try {
      const res = await apiClient.post('/memos', { items: [{ content: t, level: memoQuickLevel, record_time: today }] })
      if (res.data?.success) setMemos([...(res.data.data || []).map(mapMemoRow), ...memos])
      else message.error(res.data?.message || '备忘录保存失败，请刷新重试')
    } catch (e: any) {
      console.error('添加备忘录失败:', e)
      message.error(e?.response?.data?.detail || e?.message || '备忘录保存失败，请检查网络后重试')
    }
    setMemoInput('')
  }
  // 点击日历日期 → 弹窗添加该日期的备忘录事项（弹窗内多行草稿，可一次加入多条）
  const MEMO_LEVELS = ['紧急', '重要', '普通'] as const
  const MEMO_LEVEL_COLOR: Record<string, string> = { 紧急: 'red', 重要: 'orange', 普通: 'blue' }
  const [memoModalDate, setMemoModalDate] = useState<Dayjs | null>(null)
  const [memoDrafts, setMemoDrafts] = useState<Array<{ text: string; level: string }>>([{ text: '', level: '普通' }])
  const openMemoModal = (d: Dayjs) => {
    setMemoModalDate(d)
    setMemoDrafts([{ text: '', level: '普通' }])
  }
  // 单击查看该日期备忘录 / 双击打开添加弹窗（用延时区分单击与双击）
  const [memoViewDate, setMemoViewDate] = useState<Dayjs | null>(null)
  const cellClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleCellClick = (c: Dayjs) => {
    if (cellClickTimer.current) { window.clearTimeout(cellClickTimer.current); cellClickTimer.current = null; return }
    cellClickTimer.current = window.setTimeout(() => { cellClickTimer.current = null; setMemoViewDate(c) }, 260)
  }
  const handleCellDoubleClick = (c: Dayjs) => {
    if (cellClickTimer.current) { window.clearTimeout(cellClickTimer.current); cellClickTimer.current = null }
    openMemoModal(c)
  }
  const updateDraft = (idx: number, patch: Partial<{ text: string; level: string }>) =>
    setMemoDrafts(memoDrafts.map((d, i) => i === idx ? { ...d, ...patch } : d))
  // 加入备忘录：全部非空草稿行一次性写入（真实用户批量入库，demo 本地追加）
  const submitMemoDrafts = async () => {
    if (!memoModalDate) return
    const rows = memoDrafts.filter(d => d.text.trim())
    if (rows.length === 0) return
    const dateStr = memoModalDate.format('YYYY-MM-DD')
    if (memoDemoMode) {
      setMemos([
        ...rows.map((r, i) => ({ id: Date.now() + i, text: r.text.trim(), level: r.level, date: dateStr, done: false })),
        ...memos,
      ])
    } else {
      try {
        const res = await apiClient.post('/memos', { items: rows.map(r => ({ content: r.text.trim(), level: r.level, record_time: dateStr })) })
        if (res.data?.success) setMemos([...(res.data.data || []).map(mapMemoRow), ...memos])
        else message.error(res.data?.message || '备忘录保存失败，请刷新重试')
      } catch (e: any) {
        console.error('添加备忘录失败:', e)
        message.error(e?.response?.data?.detail || e?.message || '备忘录保存失败，请检查网络后重试')
      }
    }
    setMemoModalDate(null)
  }
  // 倒计日清单：本年+次年全部节日实例，仅保留未来60天内（含今天）的，按倒计天升序（农历/浮动节日自动换算）
  const todayD = dayjs().startOf('day')
  const todayStr = todayD.format('YYYY-MM-DD')
  const upcomingHolidays = useMemo(() => (
    [...getHolidayDatesCached(todayD.year()), ...getHolidayDatesCached(todayD.year() + 1)]
      .filter(h => { const d = h.date.diff(todayD, 'day'); return d >= 0 && d <= 59 })
      .sort((a, b) => a.date.diff(todayD) - b.date.diff(todayD))
  ), [])
  // 点击倒计日 → 切到对应月份并短暂高亮该日期格
  const [calHighlight, setCalHighlight] = useState<string | null>(null)
  const jumpToHoliday = (date: Dayjs) => {
    setCalMonth(date.startOf('month'))
    const key = date.format('YYYY-MM-DD')
    setCalHighlight(key)
    window.setTimeout(() => setCalHighlight(cur => (cur === key ? null : cur)), 2200)
  }
  // 月历 42 格（周一为一周起点）+ 当月涉及的节日映射（YYYY-MM-DD → 节日，含前后月与跨年）
  const calCells = useMemo(() => {
    const monthStart = calMonth.startOf('month')
    const firstCell = monthStart.subtract((monthStart.day() + 6) % 7, 'day')
    return Array.from({ length: 42 }, (_, i) => firstCell.add(i, 'day'))
  }, [calMonth])
  const calHolidayMap = useMemo(() => {
    const m = new Map<string, { name: string; icon: string; lunar: boolean }>()
    const years = new Set(calCells.map(c => c.year()))
    years.forEach(y => getHolidayDatesCached(y).forEach(h => {
      if (!m.has(h.date.format('YYYY-MM-DD'))) m.set(h.date.format('YYYY-MM-DD'), { name: h.name, icon: h.icon, lunar: h.lunar })
    }))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calCells])
  // 群消息数据（group_messages 表）
  const [notices, setNotices] = useState<NoticeItem[]>([])
  // 今日待处理各业务数量
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({})
  // 机器人简报弹窗统计：差评三等级未处理 / 页面优化低分数（备忘录部分由 memos 实时计算）
  const [briefingStats, setBriefingStats] = useState({ reviewHigh: 0, reviewMedium: 0, reviewLow: 0, lowScore: 0 })
  // 每日简报弹窗（机器人引导 + 今日运营清单）
  const [briefingOpen, setBriefingOpen] = useState(false)
  // 「开启今日工作」过渡：机器人眨眼微笑反馈后淡出关闭
  const [briefingClosing, setBriefingClosing] = useState(false)
  // 当天简报已读（弹窗第一次出现即标记）：入口图标不再显示红点，刷新后当天内也不恢复
  const [briefingRead, setBriefingRead] = useState(false)

  // 「开启今日工作」：机器人眨眼微笑反馈后淡出关闭（RobotBriefing 内部先播放反馈）
  const startBriefingWork = () => {
    setBriefingClosing(true)
    setTimeout(() => { setBriefingOpen(false); setBriefingClosing(false) }, 550)
  }

  // 当天首次进入首页自动弹出机器人清单（按 用户+日期 在 localStorage 标记，同时取消入口红点，当天内只弹一次）
  const briefingSeenKey = `briefing_seen_${user?.username || 'user'}_${dayjs().format('YYYY-MM-DD')}`
  const markBriefingOpened = () => {
    try { localStorage.setItem(briefingSeenKey, '1') } catch { /* 隐私模式等存储异常时忽略 */ }
    setBriefingRead(true)
  }
  // 刷新页面后从 localStorage 恢复当天已读状态
  useEffect(() => {
    let read = false
    try { read = localStorage.getItem(briefingSeenKey) === '1' } catch { read = false }
    setBriefingRead(read)
  }, [briefingSeenKey])
  useEffect(() => {
    if (loading || briefingOpen || briefingClosing) return
    let opened = false
    try { opened = localStorage.getItem(briefingSeenKey) === '1' } catch { opened = false }
    if (opened) return
    markBriefingOpened()
    // 等首页缓冲内容渲染完再播放信封拆开动画
    const t = setTimeout(() => setBriefingOpen(true), 800)
    return () => clearTimeout(t)
  }, [loading, briefingOpen, briefingClosing, briefingSeenKey])
  // 实时天气（深圳龙岗，Open-Meteo 免费接口，30分钟缓存，失败回退测试值）
  const [briefingWeather, setBriefingWeather] = useState<{ icon: string; text: string; tip: string | null } | null>(null)
  // 简报天气兜底测试数据
  const BRIEFING = {
    weather: { icon: '🌤', text: '晴 26℃', tip: null as string | null }
  }
  const navigate = useNavigate()
  // 简报问候语（按当前时间动态生成）
  const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']
  const hour = new Date().getHours()
  const greeting = hour < 6 ? '凌晨好' : hour < 9 ? '早上好' : hour < 12 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  const briefingDate = `${new Date().getFullYear()}年${new Date().getMonth() + 1}月${new Date().getDate()}日`
  const weekday = WEEKDAY_CN[new Date().getDay()]
  const weatherInfo = briefingWeather || BRIEFING.weather
  const noticeKeywords = noticeSearch.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const senderKeyword = senderSearch.trim().toLowerCase()
  // 当前已加载消息中的群名去重（按出现顺序）
  const noticeGroups = Array.from(new Set(notices.map(n => n.group)))
  const filteredNotices = notices.filter(n => {
    const hay = `${n.text} ${n.group}`.toLowerCase()
    const kwOk = noticeKeywords.length === 0 || noticeKeywords.some(k => hay.includes(k))
    const senderOk = !senderKeyword || (n.sender || '').toLowerCase().includes(senderKeyword)
    const groupOk = !noticeGroupFilter || n.group === noticeGroupFilter
    return kwOk && senderOk && groupOk
  })

  useEffect(() => {
    fetchData()
  }, [])

  // 拉取深圳龙岗实时天气（Open-Meteo，免密钥；sessionStorage 缓存 30 分钟）
  useEffect(() => {
    const CACHE_KEY = 'briefing_weather_longgang'
    try {
      const cached = sessionStorage.getItem(CACHE_KEY)
      if (cached) {
        const { data, ts } = JSON.parse(cached)
        // 校验缓存结构完整（防止旧版本缓存缺少文案字段）
        if (data && data.icon && typeof data.text === 'string' && data.text && Date.now() - ts < 30 * 60 * 1000) {
          setBriefingWeather(data)
          return
        }
      }
    } catch { /* 缓存解析失败则重新拉取 */ }
    let cancelled = false
    fetch('https://api.open-meteo.com/v1/forecast?latitude=22.610498&longitude=114.068945&current=temperature_2m,weather_code&timezone=Asia%2FShanghai')
      .then(res => {
        if (!res.ok) throw new Error('weather api error')
        return res.json()
      })
      .then(data => {
        if (cancelled || !data?.current) return
        const info = mapWmoWeather(Number(data.current.weather_code), Math.round(Number(data.current.temperature_2m)))
        setBriefingWeather(info)
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: info, ts: Date.now() }))
        } catch { /* 忽略缓存写入失败 */ }
      })
      .catch(() => { /* 接口失败保持测试值兜底 */ })
    return () => { cancelled = true }
  }, [])

  // 简报弹窗 ESC 关闭（过渡动画期间忽略）
  useEffect(() => {
    if (!briefingOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !briefingClosing) setBriefingOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [briefingOpen, briefingClosing])

  // 消息通知数据加载：默认近7天；搜索面板按快捷范围/所选日期加载（自定义不选日期=全部）
  // demo 账号（tenant_id=6 或用户名 demo）使用测试数据，前端模拟日期过滤
  const isDemoUser = user?.tenant_id === 6 || (user?.username || '').toLowerCase() === 'demo'
  const [noticeRange, setNoticeRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [noticeRangeLabel, setNoticeRangeLabel] = useState('近7天')
  const loadNotices = async (opts?: { startDate?: string; endDate?: string; allTime?: boolean; label?: string }) => {
    try {
      if (isDemoUser) {
        const all = buildDemoNotices()
        let list = all
        let label = '近7天'
        if (opts?.startDate && opts?.endDate) {
          list = all.filter(n => {
            const d = n.time.slice(0, 10)
            return d >= opts.startDate! && d <= opts.endDate!
          })
          label = opts.label || `${opts.startDate.slice(5)} ~ ${opts.endDate.slice(5)}`
        } else if (opts?.allTime) {
          label = '全部'
        } else {
          const minDate = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
          list = all.filter(n => n.time.slice(0, 10) >= minDate)
        }
        setNotices(list)
        setNoticeRangeLabel(label)
        return
      }
      const params: Record<string, any> = { limit: 200 }
      let label = '近7天'
      if (opts?.startDate && opts?.endDate) {
        params.start_date = opts.startDate
        params.end_date = opts.endDate
        label = opts.label || `${opts.startDate.slice(5)} ~ ${opts.endDate.slice(5)}`
      } else if (opts?.allTime) {
        label = '全部'
      } else {
        params.days = 7
      }
      const res = await apiClient.get('/group-messages/recent', { params })
      if (res.data?.success) {
        setNotices((res.data.data || []).map((r: any) => ({
          id: r.id,
          group: r.group_name,
          sender: r.sender_name,
          text: r.message_body,
          time: r.received_at,
        })))
        setNoticeRangeLabel(label)
      }
    } catch { /* 接口失败时保持原列表 */ }
  }
  useEffect(() => { loadNotices() }, [user?.username])

  // 搜索面板快捷日期：今日/昨日/近七天/近30天/自定义（默认近七天，点击即加载）
  const QUICK_RANGES = [
    { key: 'today', label: '今日' },
    { key: 'yesterday', label: '昨日' },
    { key: '7d', label: '近七天' },
    { key: '30d', label: '近30天' },
    { key: 'custom', label: '自定义' },
  ] as const
  type NoticeQuickKey = typeof QUICK_RANGES[number]['key']
  const [noticeQuickKey, setNoticeQuickKey] = useState<NoticeQuickKey>('7d')

  const handleNoticeQuick = (key: NoticeQuickKey) => {
    setNoticeQuickKey(key)
    if (key === 'custom') { setNoticePage(1); return }
    const today = dayjs()
    if (key === 'today') {
      const d = today.format('YYYY-MM-DD')
      setNoticePage(1); loadNotices({ startDate: d, endDate: d, label: '今日' })
    } else if (key === 'yesterday') {
      const d = today.subtract(1, 'day').format('YYYY-MM-DD')
      setNoticePage(1); loadNotices({ startDate: d, endDate: d, label: '昨日' })
    } else if (key === '7d') {
      setNoticePage(1); loadNotices({ startDate: today.subtract(6, 'day').format('YYYY-MM-DD'), endDate: today.format('YYYY-MM-DD'), label: '近7天' })
    } else {
      setNoticePage(1); loadNotices({ startDate: today.subtract(29, 'day').format('YYYY-MM-DD'), endDate: today.format('YYYY-MM-DD'), label: '近30天' })
    }
  }

  // 搜索按钮：自定义模式按所选日期查（不选=全部时间），其他模式按当前快捷范围查
  const applyNoticeSearch = () => {
    if (noticeQuickKey === 'custom') {
      setNoticePage(1)
      if (noticeRange && noticeRange[0] && noticeRange[1]) {
        loadNotices({
          startDate: noticeRange[0].format('YYYY-MM-DD'),
          endDate: noticeRange[1].format('YYYY-MM-DD'),
        })
      } else {
        loadNotices({ allTime: true })
      }
    } else {
      handleNoticeQuick(noticeQuickKey)
    }
  }

  // 今日待处理：获取各业务待办数量（购物车/货件按用户可见店铺过滤）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let storeNames: string[] = []
      try {
        const res = await apiClient.get('/stores/my-stores')
        // 预警表 store 字段存的是 shop_abbr（与数据驾驶舱一致）
        if (res.data.success) storeNames = (res.data.data.stores || []).map((s: any) => s.shop_abbr).filter(Boolean)
      } catch { /* 获取店铺失败时不带店铺过滤 */ }
      const params: Record<string, any> = storeNames.length > 0 ? { stores: storeNames.join(',') } : {}
      const [buybox, shipment, email, review, restock, reviewStats, pageLow] = await Promise.allSettled([
        apiClient.get('/product-buybox', { params }),
        apiClient.get('/product-shipment-notice', { params }),
        apiClient.get('/emails/unfollowed-count'),
        apiClient.get('/reviews/new/count'),
        apiClient.get('/restock/overview'),
        // 弹窗用：差评机器人三等级未处理数 / 页面优化低分数量
        apiClient.get('/reviews/stats'),
        apiClient.get('/product-page-info', { params: { low_score: true, page: 1, page_size: 1 } }),
      ])
      if (cancelled) return
      const val = (r: PromiseSettledResult<any>, fn: (d: any) => number) =>
        r.status === 'fulfilled' ? fn(r.value.data) : 0
      setTaskCounts({
        buybox: val(buybox, d => (d?.data || []).length),
        shipment: val(shipment, d => (d?.data || []).length),
        email: val(email, d => d?.data?.total ?? 0),
        review: val(review, d => d?.data?.count ?? 0),
        stockout: val(restock, d => d?.data?.red_count ?? 0),
      })
      setBriefingStats({
        reviewHigh: val(reviewStats, d => d?.data?.high?.unviewed ?? 0),
        reviewMedium: val(reviewStats, d => d?.data?.medium?.unviewed ?? 0),
        reviewLow: val(reviewStats, d => d?.data?.low?.unviewed ?? 0),
        lowScore: val(pageLow, d => d?.total ?? 0),
      })
    })()
    return () => { cancelled = true }
  }, [])

  // 每秒刷新世界时钟（已移入 WorldClocks 组件内部，避免整页重渲染卡顿）

  const fetchData = async () => {
    try {
      setLoading(true)
      const [dashboardRes, alertsRes, reviewsRes] = await Promise.all([
        dashboardApi.getStats(),
        inventoryApi.getAlerts(),
        reviewsApi.getList()
      ])

      if (dashboardRes.data.success) {
        setDashboardData(dashboardRes.data.data)
      }
      if (alertsRes.data.success) {
        setInventoryAlerts(alertsRes.data.data)
      }
      if (reviewsRes.data.success) {
        setReviews(reviewsRes.data.data)
      }
    } catch (error) {
      console.error('获取数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const inventoryColumns = [
    { title: 'ASIN', dataIndex: 'asin', key: 'asin' },
    { title: '商品名称', dataIndex: 'name', key: 'name' },
    { title: '库存数量', dataIndex: 'currentStock', key: 'currentStock' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (_status: string, record: InventoryAlert) => {
        let color = 'green'
        let text = '正常'
        if (record.category === 'low_stock') {
          color = 'red'
          text = '断货风险'
        } else if (record.category === 'overstock') {
          color = 'orange'
          text = '库存冗余'
        }
        return <Tag color={color}>{text}</Tag>
      },
    },
  ]

  const reviewColumns = [
    { title: 'ASIN', dataIndex: 'asin', key: 'asin' },
    { title: '商品名称', dataIndex: 'productName', key: 'productName' },
    {
      title: '评分',
      dataIndex: 'rating',
      key: 'rating',
      render: (rating: number) => '⭐'.repeat(rating)
    },
    { title: '日期', dataIndex: 'date', key: 'date' },
  ]

  const totalAlerts = dashboardData ? 
    (dashboardData.inventoryAlerts.low_stock || 0) + (dashboardData.inventoryAlerts.overstock || 0) : 0

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      {/* 欢迎横幅 */}
      <div style={{
        background: currentTheme.primaryBg,
        borderRadius: 12,
        padding: '16px 24px',
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <span style={{ fontSize: 20, fontWeight: 600, color: currentTheme.primaryDark, letterSpacing: 1 }}>
          {user?.username || '用户'} · 数据看板已就绪 · 欢迎回来
        </span>
        {/* 今日运营清单入口 */}
        <div
          onClick={() => { markBriefingOpened(); setBriefingOpen(true) }}
          title="今日运营清单"
          style={{
            position: 'relative',
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.10)',
            flexShrink: 0,
            transition: 'transform 0.2s'
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.08)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
        >
          <Bot size={19} color={currentTheme.primaryDark} />
          {!briefingRead && (
            <span style={{
              position: 'absolute',
              top: -2,
              right: -2,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#ff4d4f',
              border: '2px solid #ffffff'
            }} />
          )}
        </div>
      </div>

      {/* 世界时钟 */}
      <WorldClocks color={currentTheme.primary} primaryDark={currentTheme.primaryDark} />

      {/* 节日日历 & 备忘录 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={13}>
          <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #f0f0f0', boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)', padding: '14px 16px', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>📅 日历</span>
              <span style={{ marginLeft: 10, fontSize: 11, color: '#bbb' }}>含农历 · 公历节日 · 倒计日</span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span onClick={() => setCalMonth(calMonth.subtract(1, 'month'))}
                  style={{ width: 22, height: 22, borderRadius: 6, background: '#f5f5f5', color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, userSelect: 'none' }}>‹</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#555', minWidth: 88, textAlign: 'center' }}>{calMonth.format('YYYY年MM月')}</span>
                <span onClick={() => setCalMonth(calMonth.add(1, 'month'))}
                  style={{ width: 22, height: 22, borderRadius: 6, background: '#f5f5f5', color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, userSelect: 'none' }}>›</span>
              </span>
            </div>
            {/* 月历网格（周一为一周起点；公历日 + 农历日小字；节日橙底标记，今天主题色高亮） */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginTop: 10 }}>
              {['一', '二', '三', '四', '五', '六', '日'].map(w => (
                <div key={w} style={{ textAlign: 'center', fontSize: 11, color: '#999', padding: '2px 0' }}>{w}</div>
              ))}
              {calCells.map(c => {
                const key = c.format('YYYY-MM-DD')
                const hol = calHolidayMap.get(key)
                let lunarDay = ''
                try {
                  const ln = LUNAR.fromSolar(lunarJs.Solar.fromYmd(c.year(), c.month() + 1, c.date()))
                  lunarDay = ln.getDay() === 1 ? `${ln.getMonthInChinese()}月` : ln.getDayInChinese()
                } catch { /* 农历解析失败则不显示 */ }
                const isToday = c.isSame(todayD, 'day')
                const inMonth = c.month() === calMonth.month()
                const isHighlight = calHighlight === key
                return (
                  <div key={key} className="cal-cell" title={hol ? `${hol.icon} ${hol.name}${hol.lunar ? '（农历节日）' : ''} · 农历${lunarDay} · 单击查看备忘，双击添加` : `农历${lunarDay} · 单击查看备忘，双击添加`}
                    onClick={() => handleCellClick(c)}
                    onDoubleClick={() => handleCellDoubleClick(c)}
                    style={{ position: 'relative', textAlign: 'center', padding: '3px 0 5px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                      background: isToday ? currentTheme.primary : (hol && inMonth ? 'rgba(250, 140, 22, 0.14)' : (inMonth ? '#f2f2f2' : 'transparent')),
                      boxShadow: isHighlight ? `inset 0 0 0 2px ${currentTheme.primary}, inset 0 0 0 999px rgba(255, 178, 82, 0.30)` : undefined,
                      transition: isHighlight ? 'none' : 'box-shadow .3s ease',
                      color: isToday ? '#ffffff' : (inMonth ? (hol ? '#ad3708' : '#2b2b2b') : '#cccccc'),
                      fontWeight: isToday || hol ? 600 : 500 }}>
                    {c.date()}
                    <div style={{ fontSize: 9, lineHeight: '11px', color: isToday ? 'rgba(255,255,255,0.85)' : (hol && inMonth ? '#d46b08' : '#8c8c8c'), whiteSpace: 'normal', wordBreak: 'break-all' }}>
                      {hol && inMonth ? hol.name : lunarDay}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* 倒计日列表（未来60天内的节日，按倒计天升序；点击跳到对应月份日期格） */}
            <div style={{ marginTop: 10, borderTop: '1px dashed #f0f0f0', paddingTop: 8 }}>
              {upcomingHolidays.length === 0 && (
                <div style={{ textAlign: 'center', fontSize: 12, color: '#bbb', padding: '6px 0' }}>未来60天内暂无节日</div>
              )}
              {upcomingHolidays.map(h => {
                const days = h.date.diff(todayD, 'day')
                return (
                  <div key={`${h.name}-${h.date.format('YYYY-MM-DD')}`} className="countdown-row" title="点击定位到日历对应日期"
                    onClick={() => jumpToHoliday(h.date)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px', fontSize: 12.5, cursor: 'pointer', borderRadius: 6 }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{h.icon}</span>
                    <span style={{ color: days === 0 ? currentTheme.primary : '#444', fontWeight: days === 0 ? 600 : 400 }}>{h.name}</span>
                    {h.lunar && <span style={{ fontSize: 10, color: '#fa8c16', border: '1px solid rgba(250,140,22,0.4)', borderRadius: 4, padding: '0 4px', lineHeight: '14px', flexShrink: 0 }}>农历</span>}
                    <span style={{ color: '#bbb', fontSize: 11.5 }}>{h.date.format('MM-DD')} 周{WEEK_CN[h.date.day()]}</span>
                    <span style={{
                      marginLeft: 'auto', flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10,
                      background: days === 0 ? currentTheme.primary : (days <= 7 ? 'rgba(250, 84, 28, 0.10)' : (days <= 30 ? 'rgba(22, 119, 255, 0.08)' : '#f5f5f5')),
                      color: days === 0 ? '#ffffff' : (days <= 7 ? '#d4380d' : (days <= 30 ? '#1677ff' : '#999')),
                    }}>
                      {days === 0 ? '🎉 今天' : `D-${days}`}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </Col>
        <Col span={11}>
          <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #f0f0f0', boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)', padding: '14px 16px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>📝 备忘录</span>
              <span style={{ marginLeft: 10, fontSize: 12, color: currentTheme.primary, background: currentTheme.primaryBg, borderRadius: 10, padding: '2px 10px' }}>
                未完成 {memos.filter(m => !m.done).length}
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {(['全部', '紧急', '重要', '普通'] as const).map(k => {
                  const active = memoLevelFilter === k
                  return (
                    <span key={k} onClick={() => { setMemoLevelFilter(k); setMemoSortKey('date') }}
                      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, cursor: 'pointer', lineHeight: '16px',
                        border: `1px solid ${active ? 'transparent' : '#e5e5e5'}`,
                        background: active ? currentTheme.primary : '#fafafa',
                        color: active ? '#ffffff' : '#888' }}>
                      {k}
                    </span>
                  )
                })}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <span style={{ fontSize: 11, color: '#bbb' }}>排序</span>
              {([['date', '按日期'], ['level', '按紧急程度']] as const).map(([k, label]) => (
                <span key={k} onClick={() => setMemoSortKey(k)}
                  style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, cursor: 'pointer', lineHeight: '16px',
                    border: `1px solid ${memoSortKey === k ? 'transparent' : '#e5e5e5'}`,
                    background: memoSortKey === k ? currentTheme.primaryBg || '#f0f5ff' : '#fafafa',
                    color: memoSortKey === k ? currentTheme.primary : '#888' }}>
                  {label}
                </span>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#ccc' }}>
                未完成 {memos.filter(m => !m.done).length} / 共 {memos.length} 条
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <div style={{ flex: 1, height: 30, display: 'flex', alignItems: 'center', gap: 4, borderRadius: 6, border: '1px solid #e0e0e0', padding: '0 6px', background: '#ffffff' }}>
                {(['紧急', '重要', '普通'] as const).map(lv => {
                  const active = memoQuickLevel === lv
                  return (
                    <span key={lv} onClick={() => setMemoQuickLevel(lv)}
                      style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 9, cursor: 'pointer', lineHeight: '15px', flexShrink: 0,
                        border: `1px solid ${active ? 'transparent' : '#ececec'}`,
                        background: active ? MEMO_LEVEL_COLOR[lv] : '#fafafa',
                        color: active ? '#ffffff' : '#999' }}>
                      {lv}
                    </span>
                  )
                })}
                <input value={memoInput} onChange={e => setMemoInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addMemo() }}
                  placeholder="记录一条备忘，回车快速添加…"
                  style={{ flex: 1, minWidth: 0, height: 26, border: 'none', outline: 'none', fontSize: 12.5, color: '#444', background: 'transparent' }} />
              </div>
              <button onClick={addMemo}
                style={{ height: 30, padding: '0 16px', borderRadius: 6, border: 'none', background: currentTheme.primary, color: '#ffffff', fontSize: 12.5, cursor: 'pointer' }}>
                添加
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', marginTop: 8, minHeight: 0 }}>
              {(() => {
                const LEVEL_RANK: Record<string, number> = { '紧急': 0, '重要': 1, '普通': 2 }
                let list = [...memos]
                if (memoLevelFilter !== '全部') list = list.filter(m => m.level === memoLevelFilter)
                list.sort((a, b) => {
                  if (Number(a.done) !== Number(b.done)) return Number(a.done) - Number(b.done)  // 未完成始终在前
                  if (memoSortKey === 'level') {
                    const d = (LEVEL_RANK[a.level] ?? 2) - (LEVEL_RANK[b.level] ?? 2)
                    if (d !== 0) return d
                    return b.date.localeCompare(a.date)  // 同级按日期倒序
                  }
                  return b.date.localeCompare(a.date)  // 按日期：新→旧
                })
                if (list.length === 0) {
                  return <div style={{ textAlign: 'center', color: '#ccc', fontSize: 12.5, padding: '20px 0' }}>该分类下暂无备忘事项</div>
                }
                return list.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderBottom: '1px dashed #f5f5f5', background: m.done ? '#fafafa' : 'transparent', borderRadius: 6 }}>
                  <span onClick={() => {
                    if (memoDemoMode) { setMemos(memos.map(x => x.id === m.id ? { ...x, done: !x.done } : x)); return }
                    apiClient.put(`/memos/${m.id}/toggle`)
                      .then(res => { if (res.data?.success) setMemos(memos.map(x => x.id === m.id ? { ...x, done: !!res.data.data.done } : x)) })
                      .catch(() => { /* 失败保持原状态 */ })
                  }}
                    title={m.done ? '标记为未完成' : '标记为已完成'}
                    style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: m.done ? 'none' : '2px solid #ccc', background: m.done ? currentTheme.primary : 'transparent', color: '#ffffff' }}>
                    {m.done ? '✓' : ''}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: m.done ? '#bbb' : '#444', textDecoration: m.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.text}
                  </span>
                  <Tag color={MEMO_LEVEL_COLOR[m.level] || 'blue'} style={{ marginRight: 0, fontSize: 11, lineHeight: '16px', flexShrink: 0 }}>{m.level}</Tag>
                  <span style={{ fontSize: 11, color: '#bbb', flexShrink: 0 }}>{m.date.slice(5)}</span>
                  <span onClick={() => {
                    if (memoDemoMode) { setMemos(memos.filter(x => x.id !== m.id)); return }
                    apiClient.delete(`/memos/${m.id}`)
                      .then(res => { if (res.data?.success) setMemos(memos.filter(x => x.id !== m.id)) })
                      .catch(() => { /* 失败保持原列表 */ })
                  }} title="删除"
                    style={{ cursor: 'pointer', color: '#ddd', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>✕</span>
                </div>
                ))
              })()}
            </div>
          </div>
        </Col>
      </Row>

      {/* 日历日期 → 添加备忘录弹窗 */}
      {memoModalDate && (
        <div onClick={() => setMemoModalDate(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(0, 0, 0, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 380, background: '#ffffff', borderRadius: 12, boxShadow: '0 12px 40px rgba(0, 0, 0, 0.2)', padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>📝 添加备忘录</span>
              <span onClick={() => setMemoModalDate(null)}
                style={{ marginLeft: 'auto', cursor: 'pointer', color: '#999', fontSize: 16, lineHeight: 1 }}>✕</span>
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: currentTheme.primaryBg || '#f0f5ff', borderRadius: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: currentTheme.primary }}>
                {memoModalDate.format('YYYY-MM-DD')} 周{WEEK_CN[memoModalDate.day()]}
              </div>
              {(() => {
                const hol = calHolidayMap.get(memoModalDate.format('YYYY-MM-DD'))
                let lunarDay = ''
                try {
                  const ln = LUNAR.fromSolar(lunarJs.Solar.fromYmd(memoModalDate.year(), memoModalDate.month() + 1, memoModalDate.date()))
                  lunarDay = `农历${ln.getMonthInChinese()}月${ln.getDayInChinese()}`
                } catch { /* 忽略 */ }
                return (
                  <div style={{ fontSize: 11.5, color: '#999', marginTop: 2 }}>
                    {lunarDay}{hol ? ` · ${hol.icon} ${hol.name}` : ''}
                  </div>
                )
              })()}
            </div>
            <div style={{ marginTop: 12, maxHeight: 260, overflowY: 'auto' }}>
              {memoDrafts.map((d, idx) => (
                <div key={idx} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flexShrink: 0, fontSize: 11, color: '#bbb', width: 14, textAlign: 'center' }}>{idx + 1}</span>
                    <input value={d.text} onChange={e => updateDraft(idx, { text: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter' && idx === memoDrafts.length - 1) setMemoDrafts([...memoDrafts, { text: '', level: '普通' }]); if (e.key === 'Escape') setMemoModalDate(null) }}
                      placeholder="输入该日期需要办理的事项…"
                      autoFocus={idx === memoDrafts.length - 1}
                      style={{ flex: 1, minWidth: 0, height: 32, borderRadius: 6, border: '1px solid #e0e0e0', padding: '0 10px', fontSize: 13, outline: 'none', color: '#444' }} />
                    {memoDrafts.length > 1 && (
                      <span title="移除此行" onClick={() => setMemoDrafts(memoDrafts.filter((_, i) => i !== idx))}
                        style={{ flexShrink: 0, cursor: 'pointer', color: '#ccc', fontSize: 14, lineHeight: 1 }}>✕</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, paddingLeft: 22 }}>
                    <span style={{ fontSize: 11.5, color: '#999', flexShrink: 0 }}>紧急程度</span>
                    {MEMO_LEVELS.map(lv => (
                      <span key={lv} onClick={() => updateDraft(idx, { level: lv })}
                        style={{ fontSize: 11.5, padding: '1px 10px', borderRadius: 10, cursor: 'pointer', userSelect: 'none',
                          border: d.level === lv ? 'none' : '1px solid #e0e0e0',
                          background: d.level === lv ? (MEMO_LEVEL_COLOR[lv] === 'red' ? '#fff1f0' : MEMO_LEVEL_COLOR[lv] === 'orange' ? '#fff7e6' : '#e6f4ff') : '#ffffff',
                          color: d.level === lv ? (MEMO_LEVEL_COLOR[lv] === 'red' ? '#cf1322' : MEMO_LEVEL_COLOR[lv] === 'orange' ? '#d46b08' : '#1677ff') : '#888',
                          fontWeight: d.level === lv ? 600 : 400 }}>
                        {lv}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div title="新增一行（可同时录入多条事项）" onClick={() => setMemoDrafts([...memoDrafts, { text: '', level: '普通' }])}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, cursor: 'pointer', color: currentTheme.primary, fontSize: 13, fontWeight: 600, userSelect: 'none' }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, border: `1px dashed ${currentTheme.primary}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1 }}>+</span>
              新增一行事项
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setMemoModalDate(null)}
                style={{ height: 30, padding: '0 14px', borderRadius: 6, border: '1px solid #e0e0e0', background: '#ffffff', color: '#666', fontSize: 12.5, cursor: 'pointer' }}>
                关闭
              </button>
              <button onClick={submitMemoDrafts}
                style={{ height: 30, padding: '0 16px', borderRadius: 6, border: 'none', background: currentTheme.primary, color: '#ffffff', fontSize: 12.5, cursor: 'pointer' }}>
                加入备忘录
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 单击日期格 → 查看该日期备忘录弹窗 */}
      {memoViewDate && (() => {
        const dayMemos = memos.filter(m => m.date === memoViewDate.format('YYYY-MM-DD'))
        const ordered = [...dayMemos].sort((a, b) => Number(a.done) - Number(b.done))
        let lunarDesc = ''
        try {
          const ln = LUNAR.fromSolar(lunarJs.Solar.fromYmd(memoViewDate.year(), memoViewDate.month() + 1, memoViewDate.date()))
          lunarDesc = `农历${ln.getMonthInChinese()}月${ln.getDayInChinese()}`
        } catch { /* 忽略 */ }
        const hol = calHolidayMap.get(memoViewDate.format('YYYY-MM-DD'))
        return (
          <div onClick={() => setMemoViewDate(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(0, 0, 0, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ width: 380, background: '#ffffff', borderRadius: 12, boxShadow: '0 12px 40px rgba(0, 0, 0, 0.2)', padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>📋 {memoViewDate.format('MM月DD日')} 备忘录</span>
                <span onClick={() => setMemoViewDate(null)}
                  style={{ marginLeft: 'auto', cursor: 'pointer', color: '#999', fontSize: 16, lineHeight: 1 }}>✕</span>
              </div>
              <div style={{ marginTop: 10, padding: '8px 12px', background: currentTheme.primaryBg || '#f0f5ff', borderRadius: 8, fontSize: 12, color: '#666' }}>
                周{WEEK_CN[memoViewDate.day()]} · {lunarDesc}{hol ? ` · ${hol.icon} ${hol.name}` : ''}
                <span style={{ marginLeft: 8, color: '#999' }}>({ordered.filter(m => !m.done).length} 条未完成)</span>
              </div>
              <div style={{ marginTop: 12, maxHeight: 240, overflowY: 'auto' }}>
                {ordered.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#bbb', fontSize: 13, padding: '18px 0' }}>
                    当天暂无备忘录
                    <div style={{ fontSize: 11.5, marginTop: 4, color: '#ccc' }}>双击日期格或点下方按钮添加</div>
                  </div>
                )}
                {ordered.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 4px', borderBottom: '1px dashed #f5f5f5' }}>
                    <Tag color={MEMO_LEVEL_COLOR[m.level] || 'blue'} style={{ marginRight: 0, fontSize: 11, lineHeight: '16px', flexShrink: 0, marginTop: 1 }}>{m.level}</Tag>
                    <span style={{ flex: 1, fontSize: 13, color: m.done ? '#bbbbbb' : '#444', textDecoration: m.done ? 'line-through' : 'none', wordBreak: 'break-all' }}>{m.text}</span>
                    {m.done && <span style={{ flexShrink: 0, fontSize: 11, color: '#52c41a' }}>✓ 已完成</span>}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button onClick={() => setMemoViewDate(null)}
                  style={{ height: 30, padding: '0 14px', borderRadius: 6, border: '1px solid #e0e0e0', background: '#ffffff', color: '#666', fontSize: 12.5, cursor: 'pointer' }}>
                  关闭
                </button>
                <button onClick={() => { openMemoModal(memoViewDate); setMemoViewDate(null) }}
                  style={{ height: 30, padding: '0 16px', borderRadius: 6, border: 'none', background: currentTheme.primary, color: '#ffffff', fontSize: 12.5, cursor: 'pointer' }}>
                  ＋ 添加事项
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 今日待处理 & 消息通知 */}
      <Row gutter={16}>
        <Col span={10}>
          <div style={{
            background: '#ffffff',
            borderRadius: 12,
            border: '1px solid #f0f0f0',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
            height: '100%',
            minHeight: 480,
            marginBottom: 24
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '14px 20px',
              borderBottom: '1px solid #f0f0f0',
              fontWeight: 600,
              fontSize: 15,
              color: '#333'
            }}>
              <span style={{ width: 4, height: 16, borderRadius: 2, background: currentTheme.primary, display: 'inline-block' }} />
              今日待处理
              <span style={{
                marginLeft: 'auto',
                fontSize: 12,
                color: '#cf1322',
                background: '#fff2f0',
                borderRadius: 10,
                padding: '2px 10px'
              }}>
                共 {TASK_CONFIG.filter(t => (taskCounts[t.id] ?? 0) > 0).length} 项
              </span>
            </div>
            <div style={{ padding: '8px 12px' }}>
              {TASK_CONFIG.map(task => {
                const count = taskCounts[task.id] ?? 0
                return (
                  <div
                    key={task.id}
                    onClick={() => navigate(task.section ? `${task.to}?section=${task.section}` : task.to)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 8px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#fafafa' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                  >
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: `${task.color}15`,
                      color: task.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      {task.icon}
                    </div>
                    <span style={{ fontSize: 14, color: '#333' }}>{task.label}</span>
                    <span style={{
                      marginLeft: 'auto',
                      fontSize: 16,
                      fontWeight: 700,
                      color: count > 0 ? '#cf1322' : '#999',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {count}
                    </span>
                    <ChevronRight size={16} color="#bbb" />
                  </div>
                )
              })}
            </div>
          </div>
        </Col>
        <Col span={14}>
          <div style={{
            background: '#ffffff',
            borderRadius: 12,
            border: '1px solid #f0f0f0',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
            height: '100%',
            minHeight: 480,
            marginBottom: 24,
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '14px 20px',
              borderBottom: '1px solid #f0f0f0',
              fontWeight: 600,
              fontSize: 15,
              color: '#333'
            }}>
              <span style={{ width: 4, height: 16, borderRadius: 2, background: currentTheme.primary, display: 'inline-block' }} />
              消息通知
              <span style={{
                marginLeft: 'auto',
                fontSize: 12,
                color: '#999',
                background: '#f5f5f5',
                borderRadius: 10,
                padding: '2px 10px'
              }}>
                {noticeKeywords.length > 0 || senderKeyword || noticeGroupFilter
                  ? `${filteredNotices.length} / ${notices.length} 条（${noticeRangeLabel}）`
                  : `共 ${notices.length} 条（${noticeRangeLabel}）`}
              </span>
              <div
                onClick={() => {
                  if (noticeSearchOpen) {
                    setNoticeSearchOpen(false); setNoticeSearch(''); setSenderSearch(''); setNoticeGroupFilter(''); setNoticeRange(null); setNoticeQuickKey('7d'); setNoticePage(1)
                    loadNotices()
                  } else { setNoticeSearchOpen(true) }
                }}
                title={noticeSearchOpen ? '关闭搜索' : '搜索过滤消息'}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: noticeSearchOpen ? '#ffffff' : '#666',
                  background: noticeSearchOpen ? currentTheme.primary : '#f5f5f5',
                  transition: 'background 0.2s',
                  flexShrink: 0
                }}
              >
                <Search size={14} />
              </div>
            </div>
            {noticeSearchOpen && (
              <div style={{ padding: '10px 12px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {QUICK_RANGES.map(q => (
                    <span
                      key={q.key}
                      onClick={() => handleNoticeQuick(q.key)}
                      title={q.key === 'custom' ? '选日期后点搜索，不选日期则查全部时间' : `查看${q.label}消息`}
                      style={{
                        fontSize: 12,
                        padding: '3px 10px',
                        borderRadius: 12,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        transition: 'all 0.2s',
                        background: noticeQuickKey === q.key ? currentTheme.primary : '#f5f5f5',
                        color: noticeQuickKey === q.key ? '#ffffff' : '#666'
                      }}
                    >
                      {q.label}
                    </span>
                  ))}
                  {noticeQuickKey === 'custom' && (
                    <DatePicker.RangePicker
                      value={noticeRange}
                      onChange={(v) => setNoticeRange(v as [Dayjs, Dayjs] | null)}
                      allowClear
                      size="small"
                      style={{ flex: 1, minWidth: 0 }}
                      placeholder={['开始日期', '结束日期']}
                    />
                  )}
                  {noticeQuickKey === 'custom' && (
                    <div
                      onClick={applyNoticeSearch}
                      title="不选日期则查询全部时间"
                      style={{
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: currentTheme.primary,
                        color: '#fff',
                        borderRadius: 8,
                        padding: '5px 14px',
                        fontSize: 13,
                        cursor: 'pointer',
                        transition: 'opacity 0.2s'
                      }}
                    >
                      <Search size={14} />
                      搜索
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: '#f5f5f5', borderRadius: 8, padding: '6px 12px' }}>
                    <Search size={14} color="#999" style={{ flexShrink: 0 }} />
                    <input
                      value={noticeSearch}
                      onChange={e => { setNoticeSearch(e.target.value); setNoticePage(1) }}
                      placeholder="输入关键词过滤，多词用空格分隔"
                      style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: '#333' }}
                    />
                    {noticeSearch && (
                      <span onClick={() => setNoticeSearch('')} style={{ cursor: 'pointer', display: 'flex', color: '#999', flexShrink: 0 }}>
                        <X size={14} />
                      </span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: '#f5f5f5', borderRadius: 8, padding: '6px 12px' }}>
                    <User size={14} color="#999" style={{ flexShrink: 0 }} />
                    <input
                      value={senderSearch}
                      onChange={e => { setSenderSearch(e.target.value); setNoticePage(1) }}
                      placeholder="搜索发送人"
                      style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: '#333' }}
                    />
                    {senderSearch && (
                      <span onClick={() => setSenderSearch('')} style={{ cursor: 'pointer', display: 'flex', color: '#999', flexShrink: 0 }}>
                        <X size={14} />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* 群名筛选（消息列表上方，始终显示，与关键词/发送人/日期交集过滤） */}
            {noticeGroups.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 0', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#999', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Users size={13} />
                  群名
                </span>
                <span
                  onClick={() => { setNoticeGroupFilter(''); setNoticePage(1) }}
                  title="显示全部群消息"
                  style={{
                    fontSize: 12,
                    padding: '3px 10px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    transition: 'all 0.2s',
                    background: noticeGroupFilter === '' ? currentTheme.primary : '#f5f5f5',
                    color: noticeGroupFilter === '' ? '#ffffff' : '#666'
                  }}
                >
                  全部群
                </span>
                {noticeGroups.map(g => (
                  <span
                    key={g}
                    onClick={() => { setNoticeGroupFilter(g); setNoticePage(1) }}
                    title={`只看「${g}」的消息`}
                    style={{
                      fontSize: 12,
                      padding: '3px 10px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      maxWidth: 160,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      flexShrink: 0,
                      transition: 'all 0.2s',
                      background: noticeGroupFilter === g ? currentTheme.primary : '#f5f5f5',
                      color: noticeGroupFilter === g ? '#ffffff' : '#666'
                    }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
            <div style={{ padding: '8px 12px', flex: 1 }}>
              {[...filteredNotices]
                .sort((a, b) => b.time.localeCompare(a.time))
                .slice((noticePage - 1) * 10, noticePage * 10)
                .map(notice => {
                  return (
                    <div
                      key={notice.id}
                      className="notice-row"
                      onClick={() => setActiveNotice(notice)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 8px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        transition: 'background 0.2s'
                      }}
                    >
                      <span style={{
                        fontSize: 13,
                        color: '#333',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {notice.text.length > 60 ? `${notice.text.slice(0, 60)}…` : notice.text}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 500, color: currentTheme.primaryDark, flexShrink: 0 }}>
                        {notice.group}
                      </span>
                      <span style={{ fontSize: 12, color: '#bbb', flexShrink: 0 }}>{notice.time}</span>
                    </div>
                  )
                })}
              {filteredNotices.length === 0 && (
                <div style={{ textAlign: 'center', color: '#bbb', fontSize: 13, padding: '24px 0' }}>
                  {notices.length === 0 ? '暂无消息通知' : '无匹配消息'}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 16px 14px', marginTop: 'auto' }}>
              <Pagination
                size="small"
                current={noticePage}
                pageSize={10}
                total={filteredNotices.length}
                onChange={p => setNoticePage(p)}
                showSizeChanger={false}
              />
            </div>
          </div>
        </Col>
      </Row>

      {/* 消息详情独立弹窗 */}
      <Modal
        open={!!activeNotice}
        onCancel={() => setActiveNotice(null)}
        footer={null}
        width={560}
        centered
        title={activeNotice ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span>{activeNotice.group}</span>
            <span style={{ fontSize: 12, fontWeight: 400, color: '#999' }}>{activeNotice.time}</span>
          </div>
        ) : null}
      >
        {activeNotice && (
          <>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 12, paddingBottom: 10, borderBottom: '1px dashed #eee' }}>
              发送人：<b style={{ color: currentTheme.primaryDark }}>{activeNotice.sender || '—'}</b>
            </div>
            <div style={{
              fontSize: 14,
              lineHeight: 1.9,
              color: '#333',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '60vh',
              overflowY: 'auto'
            }}>
              {activeNotice.text}
            </div>
          </>
        )}
      </Modal>

      {/* 今日运营清单（机器人动漫引导 + 清单卡片，登录当天首次自动弹出） */}
      {briefingOpen && (
        <RobotBriefing
          closing={briefingClosing}
          userName={user?.username || '用户'}
          greeting={greeting}
          dateText={briefingDate}
          weekday={weekday}
          weather={weatherInfo}
          tasks={TASK_CONFIG.map(t => ({ id: t.id, label: t.label, count: taskCounts[t.id] ?? 0, color: t.color }))}
          stats={{
            ...briefingStats,
            emailPending: taskCounts.email ?? 0,
            memoTodayPending: memos.filter(m => !m.done && m.date === todayStr).length,
            memoTotalPending: memos.filter(m => !m.done).length,
          }}
          primary={currentTheme.primary}
          primaryDark={currentTheme.primaryDark}
          onTaskClick={(id) => {
            setBriefingOpen(false)
            const t = TASK_CONFIG.find(x => x.id === id)
            if (t) navigate(t.to)
          }}
          onStartWork={startBriefingWork}
          onOverlayClose={() => setBriefingOpen(false)}
        />
      )}
    </div>
  )
}

export default Dashboard
