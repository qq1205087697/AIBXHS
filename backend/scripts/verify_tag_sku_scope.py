"""标签 sku 维度已彻底退出语义键 —— 回归护栏

## 历史背景（本脚本的来由）
2026-09-29 曾出现真实缺陷：`set_force_replenish` 按前端传入 sku 落库（如 'USA-A-524'），
而 `clear_force_replenish` 查 `sku=''` → 查不到 → 返回 changed:False 但 HTTP 200 + success，
前端弹「已解除」而实际未解除（静默失效）。

## 现状（行级改造后）
唯一键为 `(tenant_id, asin, account, tag_type, tag_value)`，**sku 已完全退出唯一键与查询条件**，
只作审计留痕 → 该缺陷类在结构上不可能复现。本脚本保留为**护栏**，断言：
1. 任意 sku 值都不影响标签的落库与解除（sku='X' 的标签，不带 sku 也能解除）
2. sku 不再是唯一键的一部分：同 (asin, account, tag_type, tag_value) 换 sku 再插 → 撞唯一键
3. sku 仅留痕：落库保留传入值，但不参与匹配

安全：使用不存在的哨兵 ASIN `__SKUSCOPE_TEST__`（product_tags 无外键指向快照），
      finally 按 asin 精确删除，零业务影响。
"""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from database.database import SessionLocal  # noqa: E402
from services.tag_service import _ensure_models_loaded  # noqa: E402

TENANT = 1
ASIN = "__SKUSCOPE_TEST__"
HOLIDAY = "万圣节"
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def rows(db, extra_where="", params=None):
    q = ("SELECT id, sku, account, tag_type, tag_value, source, locked, active "
         "FROM product_tags WHERE tenant_id=:t AND asin=:a " + extra_where +
         " ORDER BY id")
    return db.execute(text(q), {"t": TENANT, "a": ASIN, **(params or {})}).all()


def raw_insert(db, tag_type, tag_value, sku, locked, active=1, source="manual", account=""):
    db.execute(text("""
        INSERT INTO product_tags
        (tenant_id, asin, account, sku, tag_type, tag_value, source, locked, active, reason,
         created_at, updated_at)
        VALUES (:t, :a, :acct, :sku, :tt, :tv, :src, :lk, :ac, 'sku-scope verify', NOW(), NOW())
    """), {"t": TENANT, "a": ASIN, "acct": account, "sku": sku, "tt": tag_type, "tv": tag_value,
           "src": source, "lk": locked, "ac": active})
    db.commit()


def main():
    _ensure_models_loaded()
    from services.tag_service import (
        set_force_replenish, clear_force_replenish,
        set_holiday_tag, unlock_holiday_tag,
    )
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM product_tags WHERE asin=:a"), {"a": ASIN})
        db.commit()

        # ---------- 1. 带任意 sku 落库的标签，不带 sku 也能解除（原缺陷点） ----------
        raw_insert(db, "force_replenish", "1", "USA-A-524", locked=1)
        r = clear_force_replenish(db, TENANT, ASIN, operator="__verify__")
        check("1. 带 sku 的强制标签可被解除（sku 不影响匹配，原缺陷点）",
              r.get("changed") is True, f"changed={r.get('changed')} cleared={r.get('cleared')}")
        after = rows(db, "AND tag_type='force_replenish'")
        check("1b. 该行已软删（active=0）",
              bool(after) and all(x[7] == 0 for x in after),
              f"rows={[tuple(x) for x in after]}")

        # ---------- 2. sku 已不在唯一键内：换 sku 再插应撞唯一键 ----------
        db.execute(text("DELETE FROM product_tags WHERE asin=:a"), {"a": ASIN})
        db.commit()
        raw_insert(db, "force_replenish", "1", "SKU-A", locked=1)
        collided = False
        try:
            raw_insert(db, "force_replenish", "1", "SKU-B", locked=1)
        except Exception as e:  # noqa: BLE001
            collided = "Duplicate" in str(e) or "uk_tag" in str(e)
            db.rollback()
        check("2. sku 不再参与唯一键（同 asin+account+类型+值 换 sku 仍撞键）",
              collided, f"collided={collided}")
        # 用同一 sku 重复设置则幂等（不新增行）
        set_force_replenish(db, TENANT, ASIN, operator="__verify__",
                            reason="sku-scope verify", sku="SKU-A")
        n = db.execute(text("SELECT COUNT(*) FROM product_tags WHERE asin=:a"), {"a": ASIN}).scalar()
        check("2b. 重复设置幂等（同一 asin 下不新增行）", n == 1, f"count={n}")

        # ---------- 3. 节日标签同样与 sku 无关 ----------
        db.execute(text("DELETE FROM product_tags WHERE asin=:a"), {"a": ASIN})
        db.commit()
        raw_insert(db, "holiday", HOLIDAY, "EU-B-548", locked=1)
        r = unlock_holiday_tag(db, TENANT, ASIN, HOLIDAY, operator="__verify__", clear=False)
        check("3. 带 sku 的节日标签可解除锁定（K5 → 自动管辖）",
              r.get("changed") is True, f"changed={r.get('changed')}")
        after = rows(db, "AND tag_type='holiday'")
        check("3b. locked 归 0 且 source 变为 auto",
              bool(after) and after[0][5] == "auto" and after[0][6] == 0,
              f"row={tuple(after[0]) if after else None}")

        r = unlock_holiday_tag(db, TENANT, ASIN, HOLIDAY, operator="__verify__", clear=True)
        after = rows(db, "AND tag_type='holiday'")
        check("4. 解除并清除生效（active=0）",
              r.get("changed") is True and bool(after) and all(x[7] == 0 for x in after),
              f"changed={r.get('changed')}")

        # ---------- 5. sku 仅留痕 ----------
        db.execute(text("DELETE FROM product_tags WHERE asin=:a"), {"a": ASIN})
        db.commit()
        set_force_replenish(db, TENANT, ASIN, operator="__verify__",
                            reason="sku-scope verify", sku="KEEP-AS-PROVENANCE")
        created = rows(db)
        check("5. sku 仅作审计留痕（落库保留传入值，不参与匹配）",
              len(created) == 1 and created[0][1] == "KEEP-AS-PROVENANCE",
              f"rows={[tuple(x) for x in created]}")
        return 0
    except Exception:
        traceback.print_exc()
        results.append(("脚本异常", False, "见 traceback"))
        return 1
    finally:
        try:
            db.execute(text("DELETE FROM product_tags WHERE asin=:a"), {"a": ASIN})
            db.execute(text("DELETE FROM tag_audit_logs WHERE operator='__verify__'"))
            db.commit()
            left = db.execute(text("SELECT COUNT(*) FROM product_tags WHERE asin=:a"),
                              {"a": ASIN}).scalar()
            left_audit = db.execute(text(
                "SELECT COUNT(*) FROM tag_audit_logs WHERE operator='__verify__'")).scalar()
            print(f"[CLEANUP] 残留 product_tags={left} audit={left_audit}")
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        db.close()


if __name__ == "__main__":
    code = main()
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n===== {passed}/{total} PASS =====")
    sys.exit(0 if passed == total and code == 0 else 1)
