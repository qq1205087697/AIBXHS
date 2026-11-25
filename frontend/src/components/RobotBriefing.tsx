import React, { useState } from 'react'

// ===== 今日运营清单弹窗（机器人动漫引导 + 清单卡片，登录后首屏弹出） =====
export interface BriefingTask {
  id: string
  label: string
  count: number
  color: string
}
export interface BriefingWeather {
  icon: string
  text: string
  tip: string | null
}
// 差评机器人三个等级未处理数 + 页面优化低分数量 + 备忘录待完成统计
export interface BriefingStats {
  reviewHigh: number
  reviewMedium: number
  reviewLow: number
  lowScore: number
  emailPending: number
  memoTodayPending: number
  memoTotalPending: number
}

interface RobotBriefingProps {
  closing: boolean
  userName: string
  greeting: string
  dateText: string
  weekday: string
  weather: BriefingWeather
  tasks: BriefingTask[]
  stats: BriefingStats
  primary: string
  primaryDark: string
  onTaskClick: (id: string) => void
  onStartWork: () => void
  onOverlayClose: () => void
}

const rbStyles = `
.rb-overlay { position: fixed; inset: 0; z-index: 3000; background: rgba(24, 20, 40, 0.55); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; overflow-y: auto; padding: 3vh 0; animation: rbFade .35s ease both; }
.rb-overlay.rb-closing { animation: rbFadeOut .5s ease both !important; pointer-events: none; }
.rb-panel { width: min(1080px, 94vw); max-height: 88vh; margin: auto; border-radius: 20px; overflow: hidden; display: flex; background: linear-gradient(160deg, #fff8f0 0%, #ffeeda 55%, #f6efff 100%); box-shadow: 0 24px 70px rgba(30, 20, 60, 0.45); animation: rbPanelIn .55s cubic-bezier(.22, 1, .36, 1) both; }
.rb-stage { position: relative; width: 380px; flex-shrink: 0; background: radial-gradient(120px 90px at 50% 44%, rgba(255, 178, 102, 0.35), transparent 70%), radial-gradient(180px 130px at 30% 20%, rgba(150, 120, 255, 0.22), transparent 70%), radial-gradient(170px 130px at 76% 78%, rgba(120, 150, 255, 0.20), transparent 70%); }
.rb-robot-wrap { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); animation: rbBob 3s ease-in-out infinite; }
.rb-holo { position: absolute; border-radius: 12px; background: linear-gradient(150deg, rgba(255, 255, 255, 0.94), rgba(233, 224, 255, 0.78)); border: 1px solid rgba(140, 110, 255, 0.35); box-shadow: 0 8px 24px rgba(120, 90, 255, 0.28); animation: rbHoloIn .55s cubic-bezier(.22, 1, .36, 1) both; }
.rb-holo-in { animation: rbBob2 2.8s ease-in-out infinite alternate; }
.rb-bar { width: 9px; border-radius: 3px 3px 0 0; background: linear-gradient(180deg, #9a7bff, #6c4cff); }
.rb-line { width: 100%; height: 4px; border-radius: 2px; background: rgba(140, 110, 255, 0.35); }
.rb-mini-row { display: flex; align-items: center; gap: 4px; }
.rb-mini-dot { width: 6px; height: 6px; border-radius: 50%; background: #6c4cff; flex-shrink: 0; }
.rb-right { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 11px; padding: 20px 22px 16px; overflow-y: auto; }
.rb-right::-webkit-scrollbar { width: 6px; }
.rb-right::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 3px; }
.rb-card { background: #ffffff; border-radius: 14px; padding: 12px 16px; box-shadow: 0 3px 14px rgba(90, 60, 160, 0.10); animation: rbCardIn .5s cubic-bezier(.22, 1, .36, 1) both; }
.rb-card-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; color: #4a3f66; letter-spacing: 1px; }
.rb-todo-row { display: flex; align-items: center; gap: 9px; padding: 5px 8px; margin: 0 -8px; border-radius: 8px; cursor: pointer; transition: background 0.15s; }
.rb-todo-row:hover { background: #f4efff; }
.rb-todo-row.rb-zero { opacity: 0.45; cursor: default; }
.rb-count { animation: rbPulse 1s ease 1.45s both; }
.rb-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600; }
.rb-progress-track { height: 8px; border-radius: 4px; background: #efe9fa; overflow: hidden; }
.rb-progress-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #9a7bff, #6c4cff); animation: rbFill 1.1s ease 1.5s both; }
.rb-start-btn { display: inline-block; padding: 10px 44px; border-radius: 999px; background: linear-gradient(135deg, var(--rb-primary), var(--rb-primary-dark)); color: #ffffff; font-size: 14px; font-weight: 600; letter-spacing: 2px; cursor: pointer; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18); transition: transform 0.2s; user-select: none; }
.rb-start-btn:hover { transform: translateY(-1px); }
.rb-bubble { position: absolute; left: 62%; top: 8%; background: #ffffff; color: #4a3f66; font-size: 12.5px; font-weight: 600; padding: 7px 13px; border-radius: 12px 12px 12px 3px; box-shadow: 0 6px 18px rgba(90, 60, 160, 0.25); white-space: nowrap; animation: rbHoloIn .35s ease both; }
.rb-eye { transform-box: fill-box; transform-origin: center; animation: rbBlink 3.4s infinite; }
.rb-wave { animation: rbWaveArm 2.2s ease-in-out infinite; }
.rb-ring { animation: rbDash 6s linear infinite; }
.rb-ant-glow { animation: rbAnt 1.8s ease-in-out infinite; }
@keyframes rbFade { from { opacity: 0; } }
@keyframes rbFadeOut { to { opacity: 0; } }
@keyframes rbPanelIn { from { opacity: 0; transform: translateY(30px) scale(0.94); } to { opacity: 1; transform: none; } }
@keyframes rbBob { 0%, 100% { transform: translate(-50%, -50%); } 50% { transform: translate(-50%, calc(-50% - 9px)); } }
@keyframes rbBob2 { from { transform: translateY(0); } to { transform: translateY(-7px); } }
@keyframes rbHoloIn { from { opacity: 0; transform: translateY(16px) scale(0.8); } to { opacity: 1; transform: none; } }
@keyframes rbCardIn { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes rbPulse { 0% { transform: none; } 35% { transform: scale(1.45); filter: drop-shadow(0 0 6px currentColor); } 100% { transform: none; } }
@keyframes rbFill { from { width: 0; } }
@keyframes rbBlink { 0%, 91%, 100% { transform: scaleY(1); } 94% { transform: scaleY(0.08); } }
@keyframes rbWaveArm { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(18deg); } }
@keyframes rbDash { to { stroke-dashoffset: -120; } }
@keyframes rbAnt { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@media (max-width: 920px) { .rb-stage { display: none; } }
@media (prefers-reduced-motion: reduce) { .rb-overlay * { animation-duration: 0.01s !important; animation-delay: 0s !important; } }
`

// 橙色可爱动漫机器人（SVG：悬浮 + 挥手 + 眨眼；happy 时眯眼大笑）
const RobotGuide: React.FC<{ happy: boolean }> = ({ happy }) => (
  <svg width="250" height="250" viewBox="0 0 240 240">
    <defs>
      <linearGradient id="rbBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffbe62" />
        <stop offset="1" stopColor="#ff8a2a" />
      </linearGradient>
      <radialGradient id="rbGlow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#9a7bff" stopOpacity="0.55" />
        <stop offset="1" stopColor="#9a7bff" stopOpacity="0" />
      </radialGradient>
    </defs>
    {/* 全息底座光环 */}
    <ellipse cx="120" cy="210" rx="72" ry="13" fill="url(#rbGlow)" />
    <ellipse cx="120" cy="176" rx="88" ry="25" fill="none" stroke="#9a7bff" strokeWidth="1.6" strokeDasharray="6 8" opacity="0.55" className="rb-ring" />
    <g>
      <g className="rb-wave" style={{ transformOrigin: '88px 142px' }}>
        {/* 左臂（挥手） */}
        <line x1="88" y1="142" x2="62" y2="112" stroke="url(#rbBody)" strokeWidth="13" strokeLinecap="round" />
        <circle cx="60" cy="108" r="9" fill="#ffbe62" />
      </g>
      {/* 右臂 */}
      <line x1="152" y1="142" x2="176" y2="162" stroke="url(#rbBody)" strokeWidth="13" strokeLinecap="round" />
      <circle cx="178" cy="164" r="9" fill="#ffbe62" />
      {/* 天线 */}
      <line x1="120" y1="52" x2="120" y2="36" stroke="#e0731c" strokeWidth="4" strokeLinecap="round" />
      <circle cx="120" cy="28" r="8" fill="#54d9ff" className="rb-ant-glow" />
      {/* 耳朵 */}
      <rect x="48" y="82" width="13" height="32" rx="6.5" fill="#f29326" />
      <rect x="179" y="82" width="13" height="32" rx="6.5" fill="#f29326" />
      {/* 头 */}
      <rect x="60" y="52" width="120" height="88" rx="42" fill="url(#rbBody)" />
      {/* 面部屏幕 */}
      <rect x="74" y="66" width="92" height="60" rx="28" fill="#262b3a" />
      {happy ? (
        <>
          {/* 眯眼大笑 ^ ^ */}
          <path d="M94 100 Q100 91 106 100" fill="none" stroke="#54d9ff" strokeWidth="5" strokeLinecap="round" />
          <path d="M134 100 Q140 91 146 100" fill="none" stroke="#54d9ff" strokeWidth="5" strokeLinecap="round" />
          <path d="M104 110 Q120 124 136 110" fill="none" stroke="#54d9ff" strokeWidth="5" strokeLinecap="round" />
          <ellipse cx="88" cy="112" rx="7" ry="4" fill="#ff9d5c" opacity="0.75" />
          <ellipse cx="152" cy="112" rx="7" ry="4" fill="#ff9d5c" opacity="0.75" />
        </>
      ) : (
        <>
          {/* 眼睛（周期性眨眼）+ 微笑 */}
          <rect x="93" y="84" width="13" height="20" rx="6.5" fill="#54d9ff" className="rb-eye" />
          <rect x="134" y="84" width="13" height="20" rx="6.5" fill="#54d9ff" className="rb-eye" />
          <path d="M110 112 Q120 119 130 112" fill="none" stroke="#54d9ff" strokeWidth="4.5" strokeLinecap="round" />
        </>
      )}
      {/* 身体 */}
      <rect x="84" y="126" width="72" height="58" rx="28" fill="url(#rbBody)" />
      <circle cx="120" cy="156" r="16" fill="#262b3a" />
      <path d="M113 156 l5 5 l9 -10" fill="none" stroke="#54d9ff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  </svg>
)

// 机器人周围的全息信息卡片（依次浮入 + 持续悬浮）
const HoloCards: React.FC = () => (
  <>
    {/* 迷你柱状图 */}
    <div className="rb-holo" style={{ top: 20, left: 24, animationDelay: '0.85s' }}>
      <div className="rb-holo-in" style={{ animationDelay: '0.4s', padding: '9px 11px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 34 }}>
          {[14, 22, 10, 28, 18].map((h, i) => (
            <div key={i} className="rb-bar" style={{ height: h }} />
          ))}
        </div>
        <div className="rb-line" style={{ marginTop: 8, width: 56 }} />
      </div>
    </div>
    {/* 迷你趋势卡 */}
    <div className="rb-holo" style={{ top: 8, right: 18, animationDelay: '1s' }}>
      <div className="rb-holo-in" style={{ animationDelay: '0.7s', padding: '9px 11px', width: 116 }}>
        <div className="rb-line" style={{ width: 64, marginBottom: 7 }} />
        <svg width="94" height="26" viewBox="0 0 94 26">
          <polyline points="2,22 18,14 34,18 50,8 66,12 82,4 92,8" fill="none" stroke="#6c4cff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
    {/* AI 徽章卡 */}
    <div className="rb-holo" style={{ bottom: 86, left: 6, animationDelay: '1.15s' }}>
      <div className="rb-holo-in" style={{ animationDelay: '1s', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #9a7bff, #6c4cff)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>AI</div>
        <div>
          <div className="rb-line" style={{ width: 52, marginBottom: 5 }} />
          <div className="rb-line" style={{ width: 36 }} />
        </div>
      </div>
    </div>
    {/* 迷你清单卡 */}
    <div className="rb-holo" style={{ bottom: 34, right: 8, animationDelay: '1.3s' }}>
      <div className="rb-holo-in" style={{ animationDelay: '1.3s', padding: '9px 11px', width: 108 }}>
        {[0, 1, 2].map(i => (
          <div key={i} className="rb-mini-row" style={{ marginBottom: i < 2 ? 6 : 0 }}>
            <span className="rb-mini-dot" style={{ opacity: i === 2 ? 0.35 : 1 }} />
            <span className="rb-line" style={{ width: i === 0 ? 66 : i === 1 ? 48 : 56 }} />
          </div>
        ))}
      </div>
    </div>
  </>
)

const RobotBriefing: React.FC<RobotBriefingProps> = ({
  closing, userName, greeting, dateText, weekday, weather, tasks, stats,
  primary, primaryDark, onTaskClick, onStartWork, onOverlayClose,
}) => {
  const [happy, setHappy] = useState(false)
  const activeTasks = tasks.filter(t => t.count > 0)
  const cardDelay = (i: number) => ({ animationDelay: `${0.2 + i * 0.13}s` })

  const handleStart = () => {
    if (closing || happy) return
    setHappy(true)
    setTimeout(onStartWork, 1000)
  }

  return (
    <div className={`rb-overlay${closing ? ' rb-closing' : ''}`} onClick={() => { if (!closing) onOverlayClose() }}>
      <style>{rbStyles}</style>
      <div className="rb-panel" onClick={e => e.stopPropagation()} style={{ ['--rb-primary' as any]: primary, ['--rb-primary-dark' as any]: primaryDark }}>
        {/* 左侧：机器人动漫引导区 */}
        <div className="rb-stage">
          {happy && <div className="rb-bubble">收到！今日一起加油 🚀</div>}
          <HoloCards />
          <div className="rb-robot-wrap">
            <RobotGuide happy={happy} />
          </div>
        </div>

        {/* 右侧：今日运营清单 */}
        <div className="rb-right">
          {/* 问候信息卡 */}
          <div className="rb-card" style={cardDelay(0)}>
            <div className="rb-card-title">👋 问候信息</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#2f2a45', marginTop: 6 }}>
              {greeting}，{userName}
            </div>
            <div style={{ fontSize: 12.5, color: '#8a82a3', marginTop: 3 }}>
              今天是 {dateText} · 星期{weekday}
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="rb-chip" style={{ background: 'rgba(108, 76, 255, 0.10)', color: '#6c4cff' }}>
                {weather.icon} 深圳 · {weather.text}
              </span>
              {weather.tip && <span style={{ fontSize: 12, color: '#8a82a3' }}>小贴士：{weather.tip}</span>}
            </div>
          </div>

          {/* 今日待处理事项卡 */}
          <div className="rb-card" style={cardDelay(1)}>
            <div className="rb-card-title">
              📋 今日待处理
              <span className="rb-chip" style={{ background: 'rgba(255, 138, 42, 0.12)', color: '#e0731c', marginLeft: 'auto', fontSize: 11.5, padding: '2px 10px' }}>
                共 {activeTasks.length} 项
              </span>
            </div>
            <div style={{ marginTop: 6 }}>
              {tasks.map(t => (
                <div
                  key={t.id}
                  className={`rb-todo-row${t.count === 0 ? ' rb-zero' : ''}`}
                  onClick={() => { if (t.count > 0 && !closing) onTaskClick(t.id) }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, color: '#3d3654' }}>{t.label}</span>
                  <span style={{ marginLeft: 'auto' }} />
                  <span
                    className={t.count > 0 ? 'rb-count' : ''}
                    style={{ fontSize: 14, fontWeight: 700, color: t.count > 0 ? t.color : '#b8b2c7', display: 'inline-block' }}
                  >
                    {t.count}
                  </span>
                  <span style={{ fontSize: 11.5, color: '#8a82a3', width: 22 }}>项</span>
                </div>
              ))}
            </div>
          </div>

          {/* 商品优化建议卡（差评机器人三等级未处理 / 页面优化低分 / 邮件机器人待跟进） */}
          <div className="rb-card" style={cardDelay(2)}>
            <div className="rb-card-title">
              💡 商品优化建议
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#a49dbb' }}>实时数据</span>
            </div>
            <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <span className="rb-chip" style={{ background: 'rgba(255, 77, 79, 0.10)', color: '#ff4d4f', fontSize: 11, padding: '1px 8px', flexShrink: 0 }}>差评机器人</span>
                <span style={{ fontSize: 12.5, color: '#3d3654', lineHeight: 1.5 }}>
                  差评待处理共 <b style={{ color: '#ff4d4f' }}>{stats.reviewHigh + stats.reviewMedium + stats.reviewLow}</b> 条：严重 <b style={{ color: '#ff4d4f' }}>{stats.reviewHigh}</b> · 中等 <b style={{ color: '#fa8c16' }}>{stats.reviewMedium}</b> · 轻微 <b style={{ color: '#3a86ff' }}>{stats.reviewLow}</b>，建议优先处理严重等级
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <span className="rb-chip" style={{ background: 'rgba(108, 76, 255, 0.10)', color: '#6c4cff', fontSize: 11, padding: '1px 8px', flexShrink: 0 }}>页面优化</span>
                <span style={{ fontSize: 12.5, color: '#3d3654', lineHeight: 1.5 }}>
                  <b style={{ color: '#6c4cff' }}>{stats.lowScore}</b> 个 Listing 评分低于 60 分，建议优先优化标题、图片与 A+ 页面
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <span className="rb-chip" style={{ background: 'rgba(114, 46, 209, 0.10)', color: '#722ed1', fontSize: 11, padding: '1px 8px', flexShrink: 0 }}>邮件机器人</span>
                <span style={{ fontSize: 12.5, color: '#3d3654', lineHeight: 1.5 }}>
                  待跟进邮件 <b style={{ color: '#722ed1' }}>{stats.emailPending}</b> 封，建议今日完成回复与跟进
                </span>
              </div>
            </div>
          </div>

          {/* 今日提醒卡（备忘录今日待完成 / 全部待完成） */}
          <div className="rb-card" style={cardDelay(3)}>
            <div className="rb-card-title">
              ⏰ 今日提醒
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#a49dbb' }}>备忘录 · 实时数据</span>
            </div>
            <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className="rb-chip" style={{ background: 'rgba(250, 140, 22, 0.12)', color: '#e0731c', fontSize: 10.5, padding: '1px 8px', flexShrink: 0 }}>今日</span>
                <span style={{ fontSize: 12.5, color: '#3d3654' }}>
                  备忘录中日期为今天的待完成事项有 <b style={{ color: stats.memoTodayPending > 0 ? '#e0731c' : '#3a86ff' }}>{stats.memoTodayPending}</b> 项{stats.memoTodayPending > 0 ? '，记得今天完成打卡' : '，安排得很从容'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className="rb-chip" style={{ background: 'rgba(58, 134, 255, 0.10)', color: '#3a86ff', fontSize: 10.5, padding: '1px 8px', flexShrink: 0 }}>全部</span>
                <span style={{ fontSize: 12.5, color: '#3d3654' }}>
                  备忘录累计待完成 <b style={{ color: '#3a86ff' }}>{stats.memoTotalPending}</b> 项，合理规划节奏逐项清零
                </span>
              </div>
            </div>
          </div>

          {/* 开启今日工作 */}
          <div style={{ textAlign: 'center', paddingTop: 2, paddingBottom: 2, animation: 'rbCardIn .5s cubic-bezier(.22,1,.36,1) 1.25s both' }}>
            <div className="rb-start-btn" onClick={handleStart}>开启今日工作</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default RobotBriefing
