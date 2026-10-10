import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Row, Col, Statistic, Table, Tag, Pagination, Modal, DatePicker } from 'antd'
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
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import { dashboardApi, inventoryApi, reviewsApi } from '../api'
import apiClient from '../api'

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

// 信纸横线背景（跟随每个文字块绘制，保证文字始终落在横线上）
const RULE_BG = 'repeating-linear-gradient(180deg, transparent 0, transparent 33px, rgba(164, 138, 88, 0.22) 33px, rgba(164, 138, 88, 0.22) 34px)'

// 每日简报信封拆开动画样式
const benvStyles = `
.benv-overlay { position: fixed; inset: 0; z-index: 3000; background: rgba(15, 15, 20, 0.55); display: flex; align-items: center; justify-content: center; animation: benvFade .3s ease both; overflow-y: auto; padding: 4vh 0; }
.benv-stage { position: relative; width: min(460px, 92vw); display: flex; justify-content: center; }
.benv-box { position: absolute; top: 50%; left: 0; right: 0; width: 360px; height: 230px; margin: -115px auto 0; perspective: 900px; animation: benvPop .45s cubic-bezier(.34,1.56,.64,1) both, benvBoxGone .4s ease 1.5s both; }
.benv-back { position: absolute; inset: 0; border-radius: 10px; background: linear-gradient(160deg, #f7ead7, #eed9bd); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35); }
.benv-letter-peek { position: absolute; left: 22px; right: 22px; top: 10px; height: 214px; border-radius: 8px 8px 0 0; background: linear-gradient(180deg, #fffdf6, #fff7e8); box-shadow: 0 -4px 14px rgba(0, 0, 0, 0.08); animation: benvRise .6s ease .95s both; }
.benv-front { position: absolute; inset: 0; border-radius: 10px; background: linear-gradient(200deg, #fbeedd, #f0dcc2); clip-path: polygon(0 0, 50% 54%, 100% 0, 100% 100%, 0 100%); animation: benvDrop .55s ease 1.25s both; }
.benv-flap { position: absolute; left: 0; right: 0; top: 0; height: 54%; transform-origin: top center; background: linear-gradient(180deg, #f3e2c8, #e9d2b0); clip-path: polygon(0 0, 100% 0, 50% 100%); animation: benvFlap .6s ease-in .65s both; z-index: 5; }
.benv-seal { position: absolute; left: 50%; top: 46%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #d96b4f, #b3432e); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25); z-index: 6; animation: benvSeal .4s ease .7s both; }
.benv-letter-full { position: relative; width: min(960px, 92vw); border-radius: 14px; overflow: hidden; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35); animation: benvLetterIn .55s cubic-bezier(.22, 1, .36, 1) 1.45s both; flex-shrink: 0; margin: auto; }
.benv-letter-body { width: 100%; height: min(460px, 52vh); overflow-y: auto; }
.benv-letter-body::-webkit-scrollbar { width: 6px; }
.benv-letter-body::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 3px; }
@keyframes benvFade { from { opacity: 0; } }
@keyframes benvPop { from { opacity: 0; transform: translateY(26px) scale(0.7); } to { opacity: 1; transform: none; } }
@keyframes benvBoxGone { to { opacity: 0; } }
@keyframes benvFlap { 0% { transform: rotateX(0deg); z-index: 5; } 50% { z-index: 1; } 100% { transform: rotateX(178deg); z-index: 1; } }
@keyframes benvSeal { to { opacity: 0; transform: scale(0.6); } }
@keyframes benvRise { to { transform: translateY(-48px); } }
@keyframes benvDrop { to { opacity: 0; transform: translateY(80px); } }
@keyframes benvLetterIn { from { opacity: 0; transform: translateY(34px) scale(0.92); } to { opacity: 1; transform: none; } }
/* 开启今日工作：信件飞向信封图标的过渡动画 */
.benv-overlay.benv-closing { animation: benvFadeOut .72s ease both !important; pointer-events: none; }
.benv-overlay.benv-closing .benv-letter-full { animation: benvFlyAway .72s cubic-bezier(.45, 0, .7, .5) both !important; }
@keyframes benvFadeOut { to { opacity: 0; } }
@keyframes benvFlyAway { 0% { transform: none; opacity: 1; } 100% { transform: translate(var(--fly-x, 30vw), var(--fly-y, -25vh)) scale(0.05) rotate(10deg); opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .benv-overlay * { animation-duration: 0.01s !important; animation-delay: 0s !important; } }
`

const Dashboard: React.FC = () => {
  const { currentTheme } = useTheme()
  const { user } = useAuth()
  const [now, setNow] = useState(() => new Date())
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [inventoryAlerts, setInventoryAlerts] = useState<InventoryAlert[]>([])
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  // 消息通知搜索过滤
  const [noticeSearchOpen, setNoticeSearchOpen] = useState(false)
  const [noticeSearch, setNoticeSearch] = useState('')
  const [senderSearch, setSenderSearch] = useState('')
  // 消息悬浮高亮 / 点击打开详情弹窗
  const [hoveredNotice, setHoveredNotice] = useState<number | null>(null)
  const [activeNotice, setActiveNotice] = useState<NoticeItem | null>(null)
  // 消息通知分页（每页10条）
  const [noticePage, setNoticePage] = useState(1)
  // 群消息数据（group_messages 表）
  const [notices, setNotices] = useState<NoticeItem[]>([])
  // 今日待处理各业务数量
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({})
  // 每日简报弹窗
  const [briefingOpen, setBriefingOpen] = useState(false)
  // 「开启今日工作」过渡：信件飞向信封图标后关闭
  const [briefingClosing, setBriefingClosing] = useState(false)
  // 当天简报已读（弹窗第一次出现即标记）：信封图标不再显示红点，刷新后当天内也不恢复
  const [briefingRead, setBriefingRead] = useState(false)
  const briefingIconRef = useRef<HTMLDivElement>(null)
  const briefingLetterRef = useRef<HTMLDivElement>(null)

  const closeBriefingWithFly = () => {
    if (briefingClosing) return
    const iconEl = briefingIconRef.current
    const letterEl = briefingLetterRef.current
    if (iconEl && letterEl) {
      const ir = iconEl.getBoundingClientRect()
      const lr = letterEl.getBoundingClientRect()
      // 信件中心 → 信封图标中心的位移（信封图标在欢迎横幅右侧）
      letterEl.style.setProperty('--fly-x', `${(ir.left + ir.width / 2) - (lr.left + lr.width / 2)}px`)
      letterEl.style.setProperty('--fly-y', `${(ir.top + ir.height / 2) - (lr.top + lr.height / 2)}px`)
    }
    setBriefingClosing(true)
    setTimeout(() => { setBriefingOpen(false); setBriefingClosing(false) }, 750)
  }

  // 当天首次进入首页自动展开简报（按 用户+日期 在 localStorage 标记，同时取消信封红点，当天内只弹一次）
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
  const hour = now.getHours()
  const greeting = hour < 6 ? '凌晨好' : hour < 9 ? '早上好' : hour < 12 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  const briefingDate = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
  const weekday = WEEKDAY_CN[now.getDay()]
  const weatherInfo = briefingWeather || BRIEFING.weather
  // 简报任务列表（复用今日待处理实时数量，仅列出不为 0 的项）
  const briefingTasks = TASK_CONFIG
    .map(t => ({ label: t.label, count: taskCounts[t.id] ?? 0, color: t.color }))
    .filter(t => t.count > 0)
  const briefingTaskTotal = briefingTasks.length
  const noticeKeywords = noticeSearch.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const senderKeyword = senderSearch.trim().toLowerCase()
  const filteredNotices = notices.filter(n => {
    const hay = `${n.text} ${n.group}`.toLowerCase()
    const kwOk = noticeKeywords.length === 0 || noticeKeywords.some(k => hay.includes(k))
    const senderOk = !senderKeyword || (n.sender || '').toLowerCase().includes(senderKeyword)
    return kwOk && senderOk
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
      const [buybox, shipment, email, review, restock] = await Promise.allSettled([
        apiClient.get('/product-buybox', { params }),
        apiClient.get('/product-shipment-notice', { params }),
        apiClient.get('/emails/unfollowed-count'),
        apiClient.get('/reviews/new/count'),
        apiClient.get('/restock/overview'),
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
    })()
    return () => { cancelled = true }
  }, [])

  // 每秒刷新世界时钟
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatZoneTime = (zone: string) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now)

  const formatZoneDate = (zone: string) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone,
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).format(now)

  const getZoneParts = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(now)
    const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0', 10)
    return { hour: get('hour') % 24, minute: get('minute'), second: get('second') }
  }

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
    <div>
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
        {/* 每日简报入口 */}
        <div
          ref={briefingIconRef}
          onClick={() => { markBriefingOpened(); setBriefingOpen(true) }}
          title="每日简报"
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
          <Mail size={18} color={currentTheme.primaryDark} />
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
      <div style={{
        display: 'flex',
        gap: 12,
        marginBottom: 24,
        flexWrap: 'nowrap'
      }}>
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
              <AnalogClock {...getZoneParts(tz.zone)} color={currentTheme.primary} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: currentTheme.primaryDark, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3, textAlign: 'center' }}>
              {formatZoneTime(tz.zone)}
            </div>
          </div>
        ))}
      </div>

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
                {noticeKeywords.length > 0 || senderKeyword
                  ? `${filteredNotices.length} / ${notices.length} 条（${noticeRangeLabel}）`
                  : `共 ${notices.length} 条（${noticeRangeLabel}）`}
              </span>
              <div
                onClick={() => {
                  if (noticeSearchOpen) {
                    setNoticeSearchOpen(false); setNoticeSearch(''); setSenderSearch(''); setNoticeRange(null); setNoticeQuickKey('7d'); setNoticePage(1)
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
            <div style={{ padding: '8px 12px', flex: 1 }}>
              {[...filteredNotices]
                .sort((a, b) => b.time.localeCompare(a.time))
                .slice((noticePage - 1) * 10, noticePage * 10)
                .map(notice => {
                  return (
                    <div
                      key={notice.id}
                      onMouseEnter={() => setHoveredNotice(notice.id)}
                      onMouseLeave={() => setHoveredNotice(null)}
                      onClick={() => setActiveNotice(notice)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 8px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        background: hoveredNotice === notice.id ? '#fafafa' : 'transparent'
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

      {/* 每日简报（信封拆开动画 → 展开信件，测试数据） */}
      {briefingOpen && (
        <div className={`benv-overlay${briefingClosing ? ' benv-closing' : ''}`} onClick={() => { if (!briefingClosing) setBriefingOpen(false) }}>
          <style>{benvStyles}</style>
          <div className="benv-stage" onClick={e => e.stopPropagation()}>
            {/* 信封（动画完成后隐藏） */}
            <div className="benv-box">
              <div className="benv-back" />
              <div className="benv-letter-peek" />
              <div className="benv-front" />
              <div className="benv-flap" />
              <div className="benv-seal">✦</div>
            </div>
            {/* 展开后的完整信件 */}
            <div ref={briefingLetterRef} className="benv-letter-full">
        {/* 信头 */}
        <div style={{
          background: `linear-gradient(135deg, ${currentTheme.primary}, ${currentTheme.primaryDark})`,
          padding: '26px 28px 22px',
          textAlign: 'center',
          color: '#ffffff',
          position: 'relative',
          flexShrink: 0
        }}>
          <div style={{ fontSize: 20, opacity: 0.85, marginBottom: 4 }}>✦</div>
          <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: 3 }}>
            {greeting}，{user?.username || '用户'}
          </div>
          <div style={{ fontSize: 13, opacity: 0.92, marginTop: 8, letterSpacing: 1 }}>
            今天是 {briefingDate} · 星期{weekday}
          </div>
          <div style={{
            display: 'inline-block',
            marginTop: 10,
            padding: '3px 14px',
            borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.22)',
            fontSize: 13
          }}>
            {weatherInfo.icon} 深圳 · {weatherInfo.text}
          </div>
          {weatherInfo.tip && (
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 6 }}>
              小贴士：{weatherInfo.tip}
            </div>
          )}
        </div>

        {/* 信纸正文（红色装订线贯通；横线跟随文字块；落款贴底） */}
        <div
          className="benv-letter-body"
          style={{
            backgroundColor: '#fffdf6',
            backgroundImage: `linear-gradient(90deg, transparent 26px, rgba(214, 96, 74, 0.4) 26px, rgba(214, 96, 74, 0.4) 27.5px, transparent 27.5px)`,
            padding: '34px 34px 34px 54px'
          }}
        >
          <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', color: currentTheme.primary, fontSize: 12, lineHeight: '34px', letterSpacing: 6, margin: 0, backgroundImage: RULE_BG }}>
              ✦ ─────── ✦ ─────── ✦
            </div>
            <p style={{ fontSize: 15, lineHeight: '34px', color: '#3d3d3d', textIndent: '2em', margin: 0, backgroundImage: RULE_BG }}>
              今日待完成<b style={{ color: currentTheme.primaryDark }}>{briefingTaskTotal}</b>个任务：
            </p>
            {briefingTasks.length === 0 ? (
              <p style={{ fontSize: 15, lineHeight: '34px', color: '#3d3d3d', textIndent: '2em', margin: 0, backgroundImage: RULE_BG }}>
                暂无待办事项，好好休息～
              </p>
            ) : (
              briefingTasks.map(t => (
                <p key={t.label} style={{ fontSize: 15, lineHeight: '34px', color: '#3d3d3d', textIndent: '2em', margin: 0, backgroundImage: RULE_BG }}>
                  · {t.label}：<b style={{ color: t.color }}>{t.count}</b> 项
                </p>
              ))
            )}
            <p style={{ fontSize: 15, lineHeight: '34px', color: '#3d3d3d', textIndent: '2em', margin: 0, backgroundImage: RULE_BG }}>
              祝您今天工作愉快。
            </p>
            <div style={{ textAlign: 'right', margin: 0, marginTop: 'auto', backgroundImage: RULE_BG }}>
              <div style={{ fontSize: 15, lineHeight: '34px', color: '#3d3d3d' }}>—— 宝鑫华盛AI助手</div>
              <div style={{ fontSize: 13, lineHeight: '34px', color: '#8c8c8c' }}>{briefingDate}</div>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div style={{ padding: '14px 30px 20px', background: '#fffefb', textAlign: 'center', flexShrink: 0 }}>
          <div
            onClick={closeBriefingWithFly}
            style={{
              display: 'inline-block',
              padding: '9px 42px',
              borderRadius: 999,
              background: `linear-gradient(135deg, ${currentTheme.primary}, ${currentTheme.primaryDark})`,
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: 2,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              transition: 'transform 0.2s'
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)' }}
          >
            开启今日工作
          </div>
        </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
