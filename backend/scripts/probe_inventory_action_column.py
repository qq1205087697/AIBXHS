"""库存页「操作」列固定可见性真机测量（Playwright + 本机 8002 生产产物）

用途：为 UI 缺陷「标记按钮没有同在途详情/强制补货一样固定显示」提供 FACT 级证据，
     并回归验证修复后的两条溢出路径（默认态 / 多节日态）。

做法：本地铸造 JWT（不改动任何数据）→ 注入 localStorage['token'] → 打开 /inventory
     → 测量「操作」列单元格的 scrollWidth/clientWidth
     → 测量单元格内各控件相对所有滚动裁剪祖先的实际可见宽度。

用法：
  python scripts/probe_inventory_action_column.py                 # 测默认态（未标记行）
  python scripts/probe_inventory_action_column.py --seed-holiday  # 测多节日态
      （--seed-holiday 会在目标 ASIN 上临时插入 3 条 holiday 标签，跑完必删，零残留）
  python scripts/probe_inventory_action_column.py --asin B0XXXX   # 指定 ASIN
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = "http://127.0.0.1:8002"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOT = os.path.join(ROOT, "probe_action_column.png")

TENANT = 1
SKU_SENTINEL = "__ui_probe__"
SEED_HOLIDAYS = ["万圣节", "圣诞节", "感恩节黑五"]

ALIGN_JS = r"""
() => {
  const ths = Array.from(document.querySelectorAll('.ant-table-thead th'));
  const idx = ths.findIndex(th => (th.innerText || '').trim() === '操作');
  if (idx < 0) return {error: 'no action col'};
  const rows = Array.from(document.querySelectorAll('.ant-table-tbody tr'));
  const out = [];
  for (const r of rows) {
    const cells = r.querySelectorAll('td');
    if (idx >= cells.length) continue;
    const c = cells[idx];
    const btns = Array.from(c.querySelectorAll('button, .ant-tag'));
    if (!btns.length) continue;
    out.push({
      asin: (r.querySelectorAll('td')[1]?.innerText || '').trim().slice(0, 14),
      text: (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 42),
      controls: btns.map(b => ({
        t: (b.innerText || '').trim().slice(0, 8),
        left: +b.getBoundingClientRect().left.toFixed(1),
        top: +b.getBoundingClientRect().top.toFixed(1),
        w: +b.getBoundingClientRect().width.toFixed(1),
      })),
      cellOverflow: c.scrollWidth - c.clientWidth,
    });
    if (out.length >= 8) break;
  }
  return out;
}
"""

MEASURE_JS = r"""
(targetAsin) => {
  const clipRect = (el) => {
    let box = {left: -1e9, top: -1e9, right: 1e9, bottom: 1e9};
    let n = el.parentElement;
    while (n) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) ||
          /(auto|scroll|hidden|clip)/.test(cs.overflowY)) {
        const r = n.getBoundingClientRect();
        box.left = Math.max(box.left, r.left);
        box.right = Math.min(box.right, r.right);
        box.top = Math.max(box.top, r.top);
        box.bottom = Math.min(box.bottom, r.bottom);
      }
      n = n.parentElement;
    }
    return box;
  };
  const probe = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const c = clipRect(el);
    const visibleW = Math.max(0, Math.min(r.right, c.right) - Math.max(r.left, c.left));
    const midX = (Math.max(r.left, c.left) + Math.min(r.right, c.right)) / 2;
    const midY = (Math.max(r.top, c.top) + Math.min(r.bottom, c.bottom)) / 2;
    const hit = (midX > 0 && midY > 0) ? document.elementFromPoint(midX, midY) : null;
    return {
      text: (el.innerText || '').trim().slice(0, 16),
      w: +r.width.toFixed(1),
      left: +r.left.toFixed(1),
      right: +r.right.toFixed(1),
      visibleW: +visibleW.toFixed(1),
      fullyVisible: visibleW >= r.width - 0.6,
      fullyClipped: visibleW <= 0.6,
      topmost: !!hit && (hit === el || el.contains(hit) || hit.contains(el)),
      scrollW: el.scrollWidth, clientW: el.clientWidth,
    };
  };

  const ths = Array.from(document.querySelectorAll('.ant-table-thead th'));
  const idx = ths.findIndex(th => (th.innerText || '').trim() === '操作');
  const out = {headerIndex: idx, headerCount: ths.length};
  if (idx < 0) return out;

  const rect = ths[idx].getBoundingClientRect();
  out.colWidth = +rect.width.toFixed(1);

  const rows = Array.from(document.querySelectorAll('.ant-table-tbody tr'));
  const pick = (pred) => {
    for (const r of rows) {
      const cells = r.querySelectorAll('td');
      if (idx >= cells.length) continue;
      if (pred(cells[idx], r)) return cells[idx];
    }
    return null;
  };

  let target = null;
  if (targetAsin) {
    target = pick((c, r) => (r.innerText || '').includes(targetAsin));
    out.matchedBy = target ? 'asin' : null;
  }
  if (!target) {
    target = pick((c) => {
      const t = c.innerText || '';
      return t.includes('在途详情') && t.includes('标记');
    });
    out.matchedBy = target ? (out.matchedBy || 'unmarked-row') : null;
  }
  if (!target) {
    target = pick((c) => (c.innerText || '').includes('在途详情'));
    out.matchedBy = target ? 'any-action-row' : null;
  }
  if (!target) { out.note = '未找到目标行'; return out; }

  const cs = getComputedStyle(target);
  out.cell = {
    clientWidth: target.clientWidth,
    scrollWidth: target.scrollWidth,
    overflowX: target.scrollWidth - target.clientWidth,
    cssPosition: cs.position,
    cssRight: cs.right,
    text: (target.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50),
  };
  out.controls = Array.from(target.querySelectorAll('button, .ant-tag')).map(probe).filter(Boolean);
  return out;
}
"""


def seed(asin, force=False):
    from sqlalchemy import text  # noqa: PLC0415
    from database.database import SessionLocal  # noqa: PLC0415

    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM product_tags WHERE sku = :s"), {"s": SKU_SENTINEL})
        if force:
            db.execute(text("""
                INSERT INTO product_tags
                (tenant_id, asin, sku, tag_type, tag_value, source, locked, active, reason,
                 created_at, updated_at)
                VALUES (:tid, :asin, :sku, 'force_replenish', '1', 'manual', 1, 1,
                        'UI probe temp', NOW(), NOW())
            """), {"tid": TENANT, "asin": asin, "sku": SKU_SENTINEL})
            # 决策行同步（真实链路：打标签必触发），否则列表仍显示未强制态
            from services.tag_service import apply_tags_to_decisions  # noqa: PLC0415
            apply_tags_to_decisions(db, TENANT)
            print(f"[SEED] asin={asin} force_replenish 标签 + 决策行刷新")
        else:
            for hv in SEED_HOLIDAYS:
                db.execute(text("""
                    INSERT INTO product_tags
                    (tenant_id, asin, sku, tag_type, tag_value, source, locked, active, reason,
                     created_at, updated_at)
                    VALUES (:tid, :asin, :sku, 'holiday', :hv, 'manual', 0, 1, 'UI probe temp',
                            NOW(), NOW())
                """), {"tid": TENANT, "asin": asin, "sku": SKU_SENTINEL, "hv": hv})
            print(f"[SEED] asin={asin} holiday tags={len(SEED_HOLIDAYS)}")
    finally:
        db.close()


def cleanup():
    from sqlalchemy import text  # noqa: PLC0415
    from database.database import SessionLocal  # noqa: PLC0415

    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM product_tags WHERE sku = :s"), {"s": SKU_SENTINEL})
        db.commit()
        left = db.execute(text("SELECT COUNT(*) FROM product_tags WHERE sku=:s"),
                          {"s": SKU_SENTINEL}).scalar()
        print(f"[CLEANUP] 残留 product_tags(sku={SKU_SENTINEL}) = {left}")
    finally:
        db.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asin", default=None)
    ap.add_argument("--seed-holiday", action="store_true")
    ap.add_argument("--seed-force", action="store_true",
                    help="临时插 force_replenish 标签（测「解除强制」态的对齐/溢出）")
    ap.add_argument("--align-scan", action="store_true",
                    help="扫描前 8 行各控件的 X/Y 坐标，输出「标记」列是否横向对齐")
    args = ap.parse_args()

    if (args.seed_holiday or args.seed_force) and not args.asin:
        print("ERR --seed-holiday / --seed-force 需要配合 --asin 指定目标产品")
        return 1

    from sqlalchemy import text  # noqa: PLC0415
    from database.database import SessionLocal  # noqa: PLC0415
    from services.auth_service import create_access_token  # noqa: PLC0415

    db = SessionLocal()
    try:
        row = db.execute(text(
            "SELECT id, username, tenant_id FROM users WHERE username='test' LIMIT 1"
        )).fetchone()
        if not row:
            print("ERR 未找到 test 用户")
            return 1
        uid, uname, tid = row[0], row[1], row[2]
    finally:
        db.close()
    token = create_access_token(data={"sub": uname, "uid": uid, "tid": tid})

    if (args.seed_holiday or args.seed_force) and not args.asin:
        print("ERR --seed-holiday / --seed-force 需要配合 --asin 指定目标产品")
        return 1

    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    try:
        if args.seed_holiday or args.seed_force:
            seed(args.asin, force=args.seed_force)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1600, "height": 900})
            ctx.add_init_script(f"window.localStorage.setItem('token', {token!r});")
            page = ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.goto(f"{BASE}/inventory", wait_until="networkidle", timeout=60000)
            try:
                page.wait_for_selector(".ant-table-tbody tr", timeout=40000)
            except Exception as e:  # noqa: BLE001
                print(f"[WARN] 未等到数据行：{type(e).__name__}")
            page.wait_for_timeout(2500)

            info = page.evaluate(MEASURE_JS, args.asin)
            print("[MEASURE]", info)
            align = None
            if args.align_scan:
                align = page.evaluate(ALIGN_JS)
                print("[ALIGN]", align)
            page.screenshot(path=SHOT)
            print(f"[SHOT] {SHOT}")
            if errs:
                print(f"[PAGEERROR] {errs[:3]}")
            browser.close()

        cell = info.get("cell") or {}
        ok = True
        print(f"\n[VERDICT] 操作列 内容溢出 = {cell.get('overflowX')}px "
              f"(scrollWidth={cell.get('scrollWidth')} clientWidth={cell.get('clientWidth')}) "
              f"matchedBy={info.get('matchedBy')}")
        if cell.get("overflowX", 1) > 0:
            ok = False
        ctrls = info.get("controls", [])
        if not ctrls:
            print("  [WARN] 未测得控件")
        for c in ctrls:
            flag = "OK " if c["fullyVisible"] else "CLIP"
            if not c["fullyVisible"]:
                ok = False
            print(f"  [{flag}] {c['text']:<10} w={c['w']:>6} visibleW={c['visibleW']:>6} "
                  f"fullyVisible={c['fullyVisible']} topmost={c['topmost']}")

        # 对齐判定：各行「标记」按钮的 left 坐标必须一致（容差 1px）
        if align:
            marks = []
            for r in align:
                m = next((c for c in r["controls"] if c["t"] == "标记"), None)
                if m:
                    marks.append((r["asin"], m["left"], r["cellOverflow"]))
            if marks:
                xs = {x for _, x, _ in marks}
                aligned = len(xs) <= 1 or (max(xs) - min(xs)) <= 1
                any_overflow = any(ov > 0 for _, _, ov in marks)
                print(f"\n[ALIGN] 标记按钮 left 坐标 = {sorted(xs)} → "
                      f"{'横向对齐' if aligned else '❌ 横向不对齐'}；"
                      f"各行溢出={[ov for _, _, ov in marks]}")
                if not aligned or any_overflow:
                    ok = False
                for a, x, ov in marks:
                    print(f"    asin={a:<14} 标记.left={x:>7} 溢出={ov}")
        print(f"\n===== {'PASS' if ok else 'FAIL'} =====")
        return 0 if ok else 1
    finally:
        cleanup()


if __name__ == "__main__":
    sys.exit(main())
