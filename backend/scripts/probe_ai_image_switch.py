"""A+ / 主副图 切换顺滑度探针（Playwright + 本机 8002 生产产物，只读）

背景：两个页面是同一条路由位置上的同一个组件实例，切页时 state 不重建；
      修复前「生成记录」会先停留上一页的列表，等新请求回来才替换。
      修复策略：layoutEffect 在绘制前同步换上目标页缓存快照 + 请求序号防串页。

本探针逐帧采样「左栏标题（当前页）」与「右栏第一条记录标题」，
输出两者的变化时间差：
  · 左栏已切页、右栏仍是上一页记录 的帧数 = 停留时长
  · 目标：0 帧（同一帧内一起变）

用法：python scripts/probe_ai_image_switch.py
"""
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)
sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:8002"

SAMPLER_JS = r"""
() => {
  const readState = () => {
    const cards = Array.from(document.querySelectorAll('.ant-card'));
    let left = null;
    for (const c of cards) {
      const h = c.querySelector(':scope > .ant-card-head .ant-card-head-title');
      const t = h ? (h.innerText || '') : '';
      if (t.includes('A+ 套图生成')) { left = 'aplus'; break; }
      if (t.includes('主副图生成')) { left = 'main'; break; }
    }
    let first = null, count = null;
    const listCard = cards.find(c => {
      const h = c.querySelector(':scope > .ant-card-head .ant-card-head-title');
      return h && (h.innerText || '').includes('生成记录');
    });
    if (listCard) {
      const body = listCard.querySelector(':scope > .ant-card-body');
      if (body) {
        const inner = body.querySelectorAll('.ant-card-head-title');
        count = inner.length;
        if (inner.length) first = (inner[0].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!inner.length) {
          const sp = body.querySelector('.ant-spin');
          if (sp) first = '[骨架]';
          const em = body.querySelector('.ant-empty-description');
          if (em) first = '[空] ' + (em.innerText || '').trim().slice(0, 12);
        }
      }
    }
    return { left, first, count };
  };

  window.__samples = [];
  const t0 = performance.now();
  window.__sampling = true;
  const tick = () => {
    if (!window.__sampling) return;
    const s = readState();
    const last = window.__samples[window.__samples.length - 1];
    if (!last || last.left !== s.left || last.first !== s.first) {
      window.__samples.push({ t: Math.round(performance.now() - t0), ...s });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return readState();
}
"""


def main() -> int:
    from sqlalchemy import text  # noqa: PLC0415
    from database.database import SessionLocal  # noqa: PLC0415
    from services.auth_service import create_access_token  # noqa: PLC0415

    db = SessionLocal()
    try:
        row = db.execute(
            text("SELECT id, username, tenant_id FROM users WHERE username='test' LIMIT 1")
        ).fetchone()
        if not row:
            print("ERR 未找到 test 用户")
            return 1
        uid, uname, tid = row[0], row[1], row[2]
    finally:
        db.close()
    token = create_access_token(data={"sub": uname, "uid": uid, "tid": tid})

    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    fails = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1600, "height": 900})
        ctx.add_init_script(f"window.localStorage.setItem('token', {token!r});")
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))

        page.goto(f"{BASE}/ai-image-main", wait_until="networkidle", timeout=60000)
        page.wait_for_selector(".ant-card .ant-card-head-title", timeout=30000)
        page.wait_for_timeout(1500)  # 等首屏列表 + 另一页预热
        init = page.evaluate(SAMPLER_JS)
        print(f"[INIT] 当前页={init['left']} 记录数={init['count']} 首条={init['first']!r}")

        def switch_and_report(label: str, menu_text: str, expect_mode: str):
            nonlocal fails
            before = page.evaluate(SAMPLER_JS)  # 重置采样并重新开始逐帧记录
            prev_first = before["first"]
            item = page.locator(".ant-menu-item", has_text=menu_text).first
            item.click()
            page.wait_for_timeout(1600)
            samples = page.evaluate("() => window.__samples")
            page.evaluate("() => { window.__sampling = false; }")
            print(f"\n[{label}] 上一页首条={prev_first!r}，采样（仅变化帧）：")
            for s in samples[:12]:
                print(f"   t={s['t']:>4}ms  页={s['left']}  记录数={s['count']}  首条={s['first']!r}")

            left_idx = next((i for i, s in enumerate(samples) if s["left"] == expect_mode), None)
            if left_idx is None:
                print(f"   [FAIL] 左栏未切到 {expect_mode}")
                fails += 1
                return
            # 关键判据：左栏已切到目标页，右栏是否仍渲染上一页的那条记录
            stale = [
                s for s in samples[left_idx:]
                if s["first"] == prev_first and s["first"] is not None
            ]
            first_new = next(
                (s for s in samples[left_idx:] if s["first"] != prev_first), None
            )
            if stale:
                print(f"   [FAIL] 切页后仍有 {len(stale)} 个变化帧停留在上一页记录"
                      f"（t={stale[0]['t']}ms）")
                fails += 1
            else:
                lag = (first_new["t"] - samples[left_idx]["t"]) if first_new else 0
                print(f"   [OK] 左栏切页同帧起右栏即为目标页内容（滞后 {lag}ms）")
            print(f"   [DONE] 最终 页={samples[-1]['left']} 记录数={samples[-1]['count']}")

        switch_and_report("主副图 → A+套图", "A+套图", "aplus")
        switch_and_report("A+套图 → 主副图", "主副图", "main")
        switch_and_report("再次 主副图 → A+套图（缓存命中）", "A+套图", "aplus")

        if errs:
            print("\n[PAGEERROR]", errs[:3])
            fails += 1
        page.screenshot(path=os.path.join(BACKEND, "..", "probe_ai_image_switch.png"))
        browser.close()

    print(f"\n结论：{'PASS' if fails == 0 else 'FAIL(%d)' % fails}")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
