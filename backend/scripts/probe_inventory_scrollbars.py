# -*- coding: utf-8 -*-
"""真机探针：定位库存页底部横向滚动条的渲染元素与 computed 样式（零数据改动）。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, ".")

from sqlalchemy import text  # noqa: PLC0415
from database.database import SessionLocal  # noqa: PLC0415
from services.auth_service import create_access_token  # noqa: PLC0415
from services.tag_service import _ensure_models_loaded  # noqa: PLC0415

_ensure_models_loaded()

db = SessionLocal()
try:
    row = db.execute(text(
        "SELECT id, username, tenant_id FROM users WHERE username='test' LIMIT 1"
    )).fetchone()
finally:
    db.close()
token = create_access_token(data={"sub": row[1], "uid": row[0], "tid": row[2]})

JS = r"""
() => {
  const out = { ua: navigator.userAgent, bars: [] };
  const sel = {
    custom: '.table-h-scroll',
    wrap: '.inv-detail-hscroll',
    body: '.inv-detail-hscroll .ant-table-body',
    sticky: '.inv-detail-hscroll .ant-table-sticky-scroll',
    page: '.inv-page-scroll',
  };
  out.elems = {};
  for (const [k, s] of Object.entries(sel)) {
    const el = document.querySelector(s);
    if (!el) { out.elems[k] = null; continue; }
    const cs = getComputedStyle(el);
    out.elems[k] = {
      selector: s,
      rect: (r => ({top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width)}))(el.getBoundingClientRect()),
      scrollbarWidth: cs.scrollbarWidth,
      inlineStyle: (el.getAttribute("style") || "").slice(0, 200),
      overflowX: cs.overflowX,
      hScrollbarVisible: el.scrollWidth > el.clientWidth + 1,
      thickness: el.offsetHeight - el.clientHeight,   // 横向条实际占用的厚度
      vThickness: el.offsetWidth - el.clientWidth,    // 纵向条实际占用的厚度
      display: cs.display,
    };
  }
  // 全页扫描：当前实际渲染出横向滚动条（厚度>0 且可横滚）的元素
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight === 0) continue;
    const t = el.offsetHeight - el.clientHeight;
    if (t > 4 && el.scrollWidth > el.clientWidth + 1) {
      const cs = getComputedStyle(el);
      out.bars.push({
        cls: (el.className || '').toString().slice(0, 60),
        tag: el.tagName,
        thickness: t,
        top: Math.round(el.getBoundingClientRect().top),
        scrollbarWidth: cs.scrollbarWidth,
      });
    }
  }
  out.bars.sort((a, b) => a.top - b.top);
  out.bars = out.bars.slice(0, 8);
  // 页面实际生效的 scrollbar-width 规则（style 标签文本）
  out.styleRules = [];
  for (const st of document.querySelectorAll("style")) {
    const t = st.textContent || "";
    if (t.includes("scrollbar-width")) {
      out.styleRules.push(t.slice(t.indexOf("scrollbar-width") - 200, t.indexOf("scrollbar-width") + 400));
      break;
    }
  }
  // 一锤定音：遍历全部样式表，找出命中 .ant-table-body 且带 scrollbar-width 的规则
  out.matchedRules = [];
  const bodyEl = document.querySelector(".inv-detail-hscroll .ant-table-body");
  if (bodyEl) {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      const walk = (ruleList) => {
        for (const r of ruleList) {
          if (r.cssRules) { walk(r.cssRules); continue; }
          if (!r.selectorText || !r.style) continue;
          const sw = r.style.getPropertyValue("scrollbar-width");
          if (!sw) continue;
          try {
            if (bodyEl.matches(r.selectorText)) {
              out.matchedRules.push({
                selector: r.selectorText.slice(0, 90),
                scrollbarWidth: sw,
                href: (sheet.href || "inline").slice(-40),
              });
            }
          } catch (e) {}
        }
      };
      walk(rules);
    }
  }
  // 定位解析断点：每个含滚动规则的 inline style 标签，看 cssRules 里最后一条是什么
  out.styleParse = [];
  for (const st of document.querySelectorAll("style")) {
    const t = st.textContent || "";
    if (!t.includes("inv-detail-hscroll")) continue;
    let rules = [];
    try { rules = Array.from(st.sheet.cssRules); } catch (e) { out.styleParse.push({err: String(e)}); continue; }
    out.styleParse.push({
      ruleCount: rules.length,
      last3: rules.slice(-3).map(r => (r.selectorText || r.cssText).slice(0, 80)),
      hasInvDetail: rules.filter(r => (r.selectorText || "").includes("inv-detail-hscroll")).length,
      hasPageScroll: rules.filter(r => (r.selectorText || "").includes("inv-page-scroll")).length,
      hasTableHScroll: rules.filter(r => (r.selectorText || "").includes("table-h-scroll")).length,
      textLen: t.length,
    });
  }
  // 明细：解析到的滚动相关规则全列出
  out.scrollRuleDetail = [];
  for (const st of document.querySelectorAll("style")) {
    const t = st.textContent || "";
    if (!t.includes("inv-detail-hscroll")) continue;
    try {
      for (const r of st.sheet.cssRules) {
        const sel = r.selectorText || "";
        if (sel.includes("inv-detail-hscroll") || sel.includes("table-h-scroll") || sel.includes("inv-page-scroll")) {
          out.scrollRuleDetail.push({
            sel: sel.slice(0, 100),
            sw: (r.style && r.style.getPropertyValue("scrollbar-width")) || "",
          });
        }
      }
    } catch (e) {}
  }
  // 沉底条驱动横向同步：只负责设值（scroll 事件异步派发，读取在 Python 侧等待后进行）
  const th = document.querySelector(".table-h-scroll");
  const body = document.querySelector(".inv-detail-hscroll .ant-table-body");
  if (th && body) { th.scrollLeft = 300; }
  out.hScrollSet = th ? th.scrollLeft : null;
  // 列对齐断言：表头第 N 个 th 与表体第一行第 N 个 td 的左缘差（>2px 即错位）
  const ths = document.querySelectorAll('.inv-detail-hscroll .ant-table-thead th');
  const tds = document.querySelectorAll('.inv-detail-hscroll .ant-table-tbody tr.ant-table-row td');
  out.align = [];
  for (let i = 0; i < Math.min(6, ths.length, tds.length); i++) {
    const a = ths[i].getBoundingClientRect(), b = tds[i].getBoundingClientRect();
    out.align.push({ i, dx: Math.round((b.left - a.left) * 10) / 10 });
  }
  return out;
}
"""

from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=False, args=["--window-size=1620,950"])
    pg = browser.new_page(viewport={"width": 1600, "height": 900})
    pg.add_init_script(f"localStorage.setItem('token', '{token}');")
    pg.goto("http://127.0.0.1:8002/inventory", wait_until="networkidle")
    pg.wait_for_selector(".ant-table-tbody tr.ant-table-row", timeout=30000, state="attached")
    pg.wait_for_timeout(1500)
    data = pg.evaluate(JS)
    pg.wait_for_timeout(300)   # 等 scroll 事件异步派发、同步监听器执行
    data["bodyScrollLeftAfter"] = pg.evaluate(
        "() => document.querySelector('.inv-detail-hscroll .ant-table-body').scrollLeft")
    data["thScrollLeftAfter"] = pg.evaluate(
        "() => document.querySelector('.table-h-scroll').scrollLeft")
    browser.close()

import json
print(json.dumps(data, ensure_ascii=False, indent=1))
