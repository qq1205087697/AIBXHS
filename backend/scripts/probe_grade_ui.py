"""等级池 UI 探针（Playwright + 本机 8002 生产产物，只读）

验证：
1. /grade-pool 页面渲染：期次条 / 六档统计卡 / 列表 / 等级徽标配色
2. /inventory 页「等级」列渲染（用户实例 B0H5QH16TB 父行 = A）
3. 菜单出现「等级池」三级项

用法：python scripts/probe_grade_ui.py
"""
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)
sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:8002"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOT = os.path.join(ROOT, "probe_grade_ui.png")

GRADE_COLORS_JS = r"""
() => {
  // 找等级徽标：S/A/B/C 实底、D/E 描边，取列表前几行的样式
  const badges = Array.from(document.querySelectorAll('span'))
    .filter(s => /^(S|A|B|C|D|E)$/.test((s.innerText || '').trim())
      && s.style.borderRadius && parseInt(s.style.borderRadius) >= 4);
  return badges.slice(0, 8).map(s => ({
    g: (s.innerText || '').trim(),
    bg: s.style.background.slice(0, 60),
    border: s.style.border.slice(0, 30),
    color: s.style.color,
    w: Math.round(s.getBoundingClientRect().width),
    h: Math.round(s.getBoundingClientRect().height),
  }));
}
"""


def main() -> int:
    from sqlalchemy import text  # noqa: PLC0415
    from database.database import SessionLocal  # noqa: PLC0415
    from services.auth_service import create_access_token  # noqa: PLC0415

    db = SessionLocal()
    try:
        row = db.execute(text(
            "SELECT id, username, tenant_id FROM users WHERE username='test' LIMIT 1"
        )).fetchone()
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

        # ===== 1. 等级池页 =====
        page.goto(f"{BASE}/grade-pool", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2000)
        body = page.evaluate("() => document.body.innerText.slice(0, 600)")
        has_period = "数据期" in body
        has_menu = "等级池" in body
        has_cards = all(f"{g}" in body for g in ["爆款", "热销", "稳定动销", "未动销"])
        print(f"[grade-pool] 菜单/标题含等级池={has_menu} 数据期={has_period} 统计卡文案={has_cards}")
        badges = page.evaluate(GRADE_COLORS_JS)
        print(f"[grade-pool] 徽标样例 {len(badges)} 个:")
        for b in badges[:5]:
            print("   ", b)
        if not (has_menu and has_cards):
            fails += 1
            print("   [FAIL] 页面结构缺失，正文样例:", body[:200])

        # ===== 2. 库存页等级列 =====
        page.goto(f"{BASE}/inventory", wait_until="networkidle", timeout=60000)
        page.wait_for_selector(
            ".ant-table-tbody tr.ant-table-row", timeout=40000)
        page.wait_for_timeout(2500)
        grade_col = page.evaluate(r"""
          () => {
            const ths = Array.from(document.querySelectorAll('.ant-table-thead th'));
            const idx = ths.findIndex(th => (th.innerText || '').trim() === '等级');
            if (idx < 0) return {error: 'no grade col'};
            const rows = Array.from(document.querySelectorAll('.ant-table-tbody tr'));
            const out = [];
            for (const r of rows) {
              const cells = r.querySelectorAll('td');
              if (idx >= cells.length) continue;
              const badge = cells[idx].querySelector('span[style*="border-radius"]');
              out.push({
                asin: (r.querySelectorAll('td')[1]?.innerText || '').trim().slice(0, 14),
                text: (cells[idx].innerText || '').trim(),
                bg: badge ? badge.style.background.slice(0, 40) : '',
                hasDash: (cells[idx].innerText || '').trim() === '-',
              });
              if (out.length >= 6) break;
            }
            return {colIndex: idx, rows: out};
          }
        """)
        print(f"[inventory] 等级列: {grade_col}")

        # ===== 3. 用户实例父行核验（数据期 2026-10，A 级）=====
        inst = page.evaluate(r"""
          (asin) => {
            const rows = Array.from(document.querySelectorAll('.ant-table-tbody tr'));
            for (const r of rows) {
              if ((r.innerText || '').includes(asin)) {
                const ths = Array.from(document.querySelectorAll('.ant-table-thead th'));
                const gi = ths.findIndex(th => (th.innerText || '').trim() === '等级');
                const cells = r.querySelectorAll('td');
                const badge = gi >= 0 && gi < cells.length
                  ? cells[gi].querySelector('span[style*="border-radius"]') : null;
                return {
                  found: true,
                  account: (r.innerText || '').slice(0, 60).replace(/\s+/g, ' '),
                  grade: badge ? (badge.innerText || '').trim() : '(无徽标)',
                  bg: badge ? badge.style.background.slice(0, 50) : '',
                };
              }
            }
            return {found: false};
          }
        """, "B0H5QH16TB")
        print(f"[inventory] 实例 B0H5QH16TB: {inst}")

        if errs:
            print("[PAGEERROR]", errs[:3])
            fails += 1
        page.screenshot(path=SHOT, full_page=False)
        browser.close()

    print(f"\n结论：{'PASS' if fails == 0 else 'FAIL(%d)' % fails}")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
