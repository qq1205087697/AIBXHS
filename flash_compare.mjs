#!/usr/bin/env node
/**
 * flash_compare.mjs — 免费通道 vs 官方 DeepSeek V4.1 Flash 对比探针
 *
 * 用途：把同一批 prompt、同一份请求体分别打到两个端点，记录可量化差异。
 *
 *   免费通道  POST http://127.0.0.1:18923/v1/chat/completions
 *             model = deepseek-v4.1-flash-free
 *             鉴权  = Bearer <forwardKey>（从 .dsh/our-free-model/settings.json 读）
 *
 *   官方      POST https://api.deepseek.com/chat/completions
 *             model = deepseek-v4.1-flash
 *             鉴权  = Bearer <DEEPSEEK_API_KEY>（从 .dsh/.credentials.yaml 读）
 *
 * ⚠️ 重要限制：上游模型列表接口不暴露任何版本元数据（只有 id/created）。
 *    因此本脚本能回答的是「两侧行为是否一致」，**不能**证明两侧是不是同一个
 *    版本号。所谓 "1017" 若不存在于任一侧的 model id 中，就只是日期误读。
 *
 * 用法：
 *   node flash_compare.mjs               # 两侧都跑（官方 key 无效则自动降级）
 *   node flash_compare.mjs --free-only   # 只跑免费通道
 *   node flash_compare.mjs --official-only
 *   node flash_compare.mjs --repeats 3   # 每 prompt 重复次数，默认 1
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ── 配置读取 ────────────────────────────────────────────────────────────────

const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')

const argv = process.argv.slice(2)
const FREE_ONLY = argv.includes('--free-only')
const OFFICIAL_ONLY = argv.includes('--official-only')
const repeatsIdx = argv.indexOf('--repeats')
const REPEATS = repeatsIdx >= 0 ? Math.max(1, Number(argv[repeatsIdx + 1]) || 1) : 1

function readForwardKey() {
  const file = path.join(DSH_HOME, 'our-free-model', 'settings.json')
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof j.forwardKey === 'string' ? j.forwardKey : ''
  } catch {
    return ''
  }
}

function readOfficialKey() {
  // 环境变量优先，便于临时覆盖而不动凭据文件
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim()
  const file = path.join(DSH_HOME, '.credentials.yaml')
  try {
    const text = fs.readFileSync(file, 'utf8')
    const m = text.match(/^\s*DEEPSEEK_API_KEY\s*:\s*(\S+)\s*$/m)
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

const LANES = {
  free: {
    label: '免费通道 (opencode free lane)',
    url: process.env.FREE_LANE_URL ?? 'http://127.0.0.1:18923/v1/chat/completions',
    model: process.env.FREE_LANE_MODEL ?? 'deepseek-v4.1-flash-free',
    key: readForwardKey(),
  },
  official: {
    label: '官方 (api.deepseek.com)',
    url: process.env.OFFICIAL_URL ?? 'https://api.deepseek.com/chat/completions',
    modelsUrl: process.env.OFFICIAL_MODELS_URL ?? 'https://api.deepseek.com/models',
    model: process.env.OFFICIAL_MODEL ?? 'deepseek-v4.1-flash',
    key: readOfficialKey(),
  },
}

// ── 探针 prompt ─────────────────────────────────────────────────────────────
// 每个 prompt 探查一个可对比维度：自我认知 / 版本号 / 知识截止 / 确定性计算 /
// 指令遵循。全部短小，避免消耗通道配额。

const PROMPTS = [
  { id: 'identity', dim: '自我认知', text: '你是什么模型？请只回答模型名称和版本号，不要解释。' },
  { id: 'version1017', dim: '1017 存在性', text: '你的版本号是 1017 吗？请先只回答「是」或「否」，再用一句话说明你的实际版本。' },
  { id: 'cutoff', dim: '知识截止', text: '你的训练数据截止到什么时间？只回答一个日期。' },
  { id: 'math', dim: '确定性计算', text: '计算 17 * 23，只回答数字。' },
  { id: 'exact', dim: '指令遵循', text: 'Reply with exactly this string and nothing else: PROBE_OK' },
]

const MAX_TOKENS = 512

// ── 请求 ────────────────────────────────────────────────────────────────────

async function callLane(lane, prompt) {
  const body = {
    model: lane.model,
    messages: [{ role: 'user', content: prompt.text }],
    max_tokens: MAX_TOKENS,
    stream: false,
    temperature: 0,
  }
  const started = Date.now()
  try {
    const res = await fetch(lane.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${lane.key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    })
    const ms = Date.now() - started
    const raw = await res.text()
    let j = null
    try { j = JSON.parse(raw) } catch { /* 非 JSON（如 HTML 错误页）保留原文 */ }

    if (!res.ok) {
      return {
        ok: false, status: res.status, ms, prompt: prompt.id,
        error: j?.error?.message ?? raw.slice(0, 300),
        errorType: j?.error?.type ?? j?.error?.code ?? null,
      }
    }
    const msg = j?.choices?.[0]?.message ?? {}
    return {
      ok: true, status: res.status, ms, prompt: prompt.id,
      modelEcho: j?.model ?? null,
      content: (msg.content ?? '').trim(),
      reasoning: (msg.reasoning_content ?? msg.reasoning ?? '').trim() || null,
      finishReason: j?.choices?.[0]?.finish_reason ?? null,
      usage: j?.usage ?? null,
    }
  } catch (e) {
    return { ok: false, status: null, ms: Date.now() - started, prompt: prompt.id, error: e.message }
  }
}

/** 官方模型列表 —— 这是判定「1017 型号是否存在」的权威依据。 */
async function listOfficialModels(lane) {
  try {
    const res = await fetch(lane.modelsUrl, {
      headers: { authorization: `Bearer ${lane.key}` },
      signal: AbortSignal.timeout(30_000),
    })
    const raw = await res.text()
    if (!res.ok) {
      let detail = raw.slice(0, 300)
      try { detail = JSON.parse(raw)?.error?.message ?? detail } catch {}
      return { ok: false, status: res.status, error: detail }
    }
    const j = JSON.parse(raw)
    return { ok: true, status: res.status, ids: (j?.data ?? []).map(r => r.id).filter(Boolean) }
  } catch (e) {
    return { ok: false, status: null, error: e.message }
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const report = { at: new Date().toISOString(), repeats: REPEATS, officialModels: null, lanes: {} }

const activeLanes = []
if (!OFFICIAL_ONLY) activeLanes.push(['free', LANES.free])
if (!FREE_ONLY) activeLanes.push(['official', LANES.official])

console.log('═'.repeat(72))
console.log('DeepSeek V4.1 Flash 对比探针')
console.log('═'.repeat(72))

// 先查官方模型清单（如果官方侧在跑）
if (!FREE_ONLY && LANES.official.key) {
  process.stdout.write('\n[官方模型列表] 查询中… ')
  const m = await listOfficialModels(LANES.official)
  report.officialModels = m
  if (m.ok) {
    console.log(`200，共 ${m.ids.length} 个 id`)
    const hits = m.ids.filter(id => /v4\.1|flash|1017/i.test(id))
    console.log('  含 v4.1/flash 的 id：')
    for (const h of hits) console.log(`    - ${h}`)
    const has1017 = m.ids.some(id => id.includes('1017'))
    console.log(`  含 "1017" 的 id：${has1017 ? '有 ↑' : '无'}`)
  } else {
    console.log(`失败 (${m.status ?? 'no status'}) — ${m.error}`)
  }
} else if (!FREE_ONLY && !LANES.official.key) {
  console.log('\n[官方模型列表] 跳过：未找到 DEEPSEEK_API_KEY')
}

// 跑 prompt 电池
for (const [name, lane] of activeLanes) {
  if (!lane.key) {
    console.log(`\n── ${lane.label} ──\n  跳过：没有可用密钥`)
    report.lanes[name] = { skipped: 'no key' }
    continue
  }
  console.log(`\n── ${lane.label} ──`)
  console.log(`   ${lane.url}  model=${lane.model}`)
  const results = []
  for (const p of PROMPTS) {
    for (let i = 0; i < REPEATS; i++) {
      process.stdout.write(`   [${p.id}${REPEATS > 1 ? ` #${i + 1}` : ''}] `)
      const r = await callLane(lane, p)
      results.push(r)
      if (r.ok) {
        const u = r.usage ?? {}
        const oneLine = r.content.replace(/\s+/g, ' ').slice(0, 110)
        console.log(`200 ${r.ms}ms tok=${u.completion_tokens ?? '?'} (reason=${u.completion_tokens_details?.reasoning_tokens ?? '?'})`)
        console.log(`        → ${oneLine || '(空)'}`)
        if (r.modelEcho && r.modelEcho !== lane.model) {
          console.log(`        ⚠️ model 回显为 ${r.modelEcho}（请求的是 ${lane.model}）`)
        }
      } else {
        console.log(`FAIL ${r.status ?? '-'} ${r.ms}ms — ${r.error}`)
      }
    }
  }
  report.lanes[name] = { url: lane.url, model: lane.model, results }
}

// ── 汇总 ────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72))
console.log('汇总')
console.log('═'.repeat(72))

function stat(name) {
  const l = report.lanes[name]
  if (!l || l.skipped) return null
  const ok = l.results.filter(r => r.ok)
  const fail = l.results.filter(r => !r.ok)
  const u = ok.map(r => r.usage ?? {})
  const sum = k => u.reduce((a, x) => a + (x[k] ?? 0), 0)
  const reason = u.reduce((a, x) => a + (x.completion_tokens_details?.reasoning_tokens ?? 0), 0)
  return {
    ok: ok.length, fail: fail.length,
    modelEcho: [...new Set(ok.map(r => r.modelEcho).filter(Boolean))],
    completionTok: sum('completion_tokens'),
    reasoningTok: reason,
    avgMs: ok.length ? Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length) : null,
  }
}

for (const name of ['free', 'official']) {
  const s = stat(name)
  if (!s) { console.log(`\n${name}: 未运行或无密钥`); continue }
  console.log(`\n${name}:  成功 ${s.ok} / 失败 ${s.fail}`)
  console.log(`  model 回显 : ${s.modelEcho.join(', ') || '(无)'}`)
  console.log(`  输出 token : ${s.completionTok}（其中推理 ${s.reasoningTok}）`)
  console.log(`  平均耗时   : ${s.avgMs}ms`)
}

// 逐 prompt 文本对比
const f = report.lanes.free, o = report.lanes.official
if (f?.results && o?.results) {
  console.log('\n逐 prompt 输出对比：')
  for (const p of PROMPTS) {
    const fr = f.results.find(r => r.prompt === p.id)
    const or = o.results.find(r => r.prompt === p.id)
    const fc = fr?.ok ? fr.content.replace(/\s+/g, ' ') : `[失败: ${fr?.error ?? '?'}]`
    const oc = or?.ok ? or.content.replace(/\s+/g, ' ') : `[失败: ${or?.error ?? '?'}]`
    const same = fr?.ok && or?.ok && fc === oc
    console.log(`  ${p.id.padEnd(12)} ${same ? '一致' : '不一致'}`)
    console.log(`     free → ${fc.slice(0, 100)}`)
    console.log(`     offi → ${oc.slice(0, 100)}`)
  }
}

const outFile = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'flash_compare_report.json')
try {
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n完整报告已写入：${outFile}`)
} catch (e) {
  console.log(`\n报告写入失败：${e.message}`)
}

console.log('\n⚠️ 提醒：上游不暴露版本元数据，本对比只能证明「行为是否一致」，')
console.log('   无法证明两侧是同一个版本号。1017 是否真实存在，以上方官方 id 清单为准。')
