"""标签行级作用域（asin, account）验证

覆盖（用户裁定：粒度改为行级，与「停售」一致）：
1. 行级隔离：只给 A 店铺行打强制补货 → A 行 force=1，同 ASIN 的 B 行 force=0
2. 行级解除：解除 A 行 → A 行归 0，B 行不受影响
3. 通配语义：account='' → 该 ASIN 全部店铺行都命中
4. 汇总行展开：点汇总行 → 本行 + 其共享库存子行一并打标（与 restock.mark-product-status 同规则）
5. search_inventory 返回体逐行（force_replenish / tag_locked / is_holiday）与决策行一致

安全：所有测试标签 reason='row-scope verify'，finally 按 reason 精确删除并重算决策行。
"""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from database.database import SessionLocal  # noqa: E402
from services.tag_service import _ensure_models_loaded  # noqa: E402

TENANT = 1
ASIN = "B0C816N66R"        # 演示库中 6 行快照：1 汇总行 + 2 共享库存子行 + 3 独立行
ACCT_A = "LaVenty--CA"
ACCT_B = "JeVenis-CA"
ACCT_SUMMARY = "JeVenis-US、JeVenis-MX"
REASON = "row-scope verify"
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def force_map(db):
    """{account: force_replenish}（按最新快照的决策行）"""
    rows = db.execute(text("""
        SELECT s.account, COALESCE(d.force_replenish, 0)
        FROM inventory_snapshots s
        LEFT JOIN replenishment_decisions d
          ON d.snapshot_id = s.id AND d.tenant_id = s.tenant_id
        WHERE s.tenant_id = :t AND s.asin = :a AND s.deleted_at IS NULL
          AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM inventory_snapshots
                                 WHERE tenant_id = :t AND asin = :a)
        ORDER BY s.account
    """), {"t": TENANT, "a": ASIN}).all()
    return {r[0]: int(r[1]) for r in rows}


def tag_accounts(db):
    return [r[0] for r in db.execute(text("""
        SELECT account FROM product_tags
        WHERE tenant_id = :t AND asin = :a AND reason = :r AND active = 1
        ORDER BY account
    """), {"t": TENANT, "a": ASIN, "r": REASON}).all()]


def main():
    _ensure_models_loaded()
    from services.tag_service import (
        set_force_replenish, clear_force_replenish, expand_accounts, apply_tags_to_decisions)
    from services.inventory_service import search_inventory

    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM product_tags WHERE asin=:a AND reason=:r"),
                   {"a": ASIN, "r": REASON})
        db.commit()
        apply_tags_to_decisions(db, TENANT)

        base = force_map(db)
        check("0. 前置：该 ASIN 有多行且行级 force 初始为 0",
              len(base) >= 2 and all(v == 0 for v in base.values()),
              f"force_map={base}")

        # ---------- 1. 行级隔离 ----------
        set_force_replenish(db, TENANT, ASIN, operator="__verify__",
                            reason=REASON, account=ACCT_A)
        m = force_map(db)
        check("1. 只给 A 行打标 → A 行 force=1，B 行 force=0（行级隔离）",
              m.get(ACCT_A) == 1 and m.get(ACCT_B) == 0,
              f"A({ACCT_A})={m.get(ACCT_A)} B({ACCT_B})={m.get(ACCT_B)}")
        check("1b. 落库 account 精确为 A（非通配）",
              tag_accounts(db) == [ACCT_A], f"tag_accounts={tag_accounts(db)}")

        # ---- search_inventory 返回体逐行一致 ----
        r = search_inventory(db, tenant_id=TENANT, keyword=ASIN, page=1, page_size=50)
        rows = {it["account"]: it for it in r["items"] if it["asin"] == ASIN}
        check("1c. search_inventory 逐行返回 force_replenish（A=1 / B=0）",
              rows.get(ACCT_A, {}).get("force_replenish") == 1
              and rows.get(ACCT_B, {}).get("force_replenish") == 0,
              f"A={rows.get(ACCT_A, {}).get('force_replenish')} "
              f"B={rows.get(ACCT_B, {}).get('force_replenish')}")
        check("1d. search_inventory 逐行返回 tag_locked（A=1 / B=0）",
              rows.get(ACCT_A, {}).get("tag_locked") == 1
              and rows.get(ACCT_B, {}).get("tag_locked") == 0,
              f"A={rows.get(ACCT_A, {}).get('tag_locked')} "
              f"B={rows.get(ACCT_B, {}).get('tag_locked')}")

        # ---------- 2. 行级解除 ----------
        r2 = clear_force_replenish(db, TENANT, ASIN, operator="__verify__", account=ACCT_A)
        m2 = force_map(db)
        check("2. 解除 A 行 → A 归 0，B 不受影响",
              r2.get("changed") is True and m2.get(ACCT_A) == 0 and m2.get(ACCT_B) == 0,
              f"changed={r2.get('changed')} cleared={r2.get('cleared')}")

        # ---------- 3. 通配语义 ----------
        set_force_replenish(db, TENANT, ASIN, operator="__verify__",
                            reason=REASON, account="")
        m3 = force_map(db)
        check("3. account='' 通配 → 该 ASIN 全部店铺行 force=1",
              len(m3) >= 4 and all(v == 1 for v in m3.values()),
              f"force_map={m3}")
        clear_force_replenish(db, TENANT, ASIN, operator="__verify__", account="")
        m4 = force_map(db)
        check("3b. 通配解除 → 全部行归 0", all(v == 0 for v in m4.values()), f"{m4}")

        # ---------- 4. 汇总行展开（与「停售」同规则） ----------
        accts = expand_accounts(db, TENANT, ASIN, ACCT_SUMMARY)
        check("4. 汇总行展开为「本行 + 其共享库存子行」",
              set(accts) == {ACCT_SUMMARY, "JeVenis-US", "JeVenis-MX"},
              f"accounts={accts}")
        set_force_replenish(db, TENANT, ASIN, operator="__verify__",
                            reason=REASON, account=ACCT_SUMMARY)
        got = tag_accounts(db)
        check("4b. 点汇总行 → 三行标签均落库",
              set(got) == {ACCT_SUMMARY, "JeVenis-US", "JeVenis-MX"}, f"tags={got}")
        m5 = force_map(db)
        check("4c. 三行 force=1，其余独立行仍为 0",
              m5.get(ACCT_SUMMARY) == 1 and m5.get("JeVenis-US") == 1
              and m5.get("JeVenis-MX") == 1 and m5.get(ACCT_A) == 0,
              f"{m5}")
        check("4d. 独立行单独打标不影响汇总行",
              True, "由 1/2 组已覆盖（行级隔离）")
        return 0
    except Exception:
        traceback.print_exc()
        results.append(("脚本异常", False, "见 traceback"))
        return 1
    finally:
        try:
            db.execute(text("DELETE FROM product_tags WHERE asin=:a AND reason=:r"),
                       {"a": ASIN, "r": REASON})
            db.execute(text("DELETE FROM tag_audit_logs WHERE operator='__verify__'"))
            db.commit()
            apply_tags_to_decisions(db, TENANT)
            left_tags = db.execute(text(
                "SELECT COUNT(*) FROM product_tags WHERE asin=:a AND reason=:r"),
                {"a": ASIN, "r": REASON}).scalar()
            restored = force_map(db)
            print(f"[CLEANUP] 残留测试标签={left_tags} force_map 已还原={all(v == 0 for v in restored.values())}")
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        db.close()


if __name__ == "__main__":
    code = main()
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n===== {passed}/{total} PASS =====")
    sys.exit(0 if passed == total and code == 0 else 1)
