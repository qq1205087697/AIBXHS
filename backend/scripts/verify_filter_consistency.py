"""过滤口径一致性（§9.6-U1 / §十）端到端验证：过滤口径 必须与 展示口径（is_holiday = 快照 ∪ 标签）同源

覆盖：
- A. 物化路径（有决策行）：打标签 → apply_tags_to_decisions → 默认视图排除 / only_holiday 命中
- B. 兜底路径（无决策行）：不刷新决策行，直接验证
      · 默认视图的 keep_cond 兜底分支已含标签维度（修复点 1）
      · only_non_holiday / only_holiday / holiday_<类型> 已含标签维度（修复点 1）
      · 无决策行的展示兜底 _display_verdict 返回 HOLIDAY_EXCLUDED（修复点 2/3）

安全：哨兵标签 sku='__fc_test__'，finally 必删；
      决策行仅临时改 snapshot_id（单列 UPDATE，逐字恢复），不删除、不重建任何行。
"""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from database.database import SessionLocal  # noqa: E402
from services.tag_service import _ensure_models_loaded  # noqa: E402

TENANT = 1
SKU_SENTINEL = "__fc_test__"
HOLIDAY = "万圣节"

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def _view(db, asin, holiday_filter=None):
    """按 asin 精确查询某一视图，返回 (命中与否, 命中行)"""
    from services.inventory_service import search_inventory
    r = search_inventory(db, tenant_id=TENANT, keyword=asin,
                         holiday_filter=holiday_filter, page=1, page_size=50)
    hit = next((it for it in r["items"] if it["asin"] == asin), None)
    return hit is not None, hit


def _seed(db, asin):
    db.execute(text("DELETE FROM product_tags WHERE sku = :s"), {"s": SKU_SENTINEL})
    db.execute(text("""
        INSERT INTO product_tags
        (tenant_id, asin, sku, tag_type, tag_value, source, locked, active, reason,
         created_at, updated_at)
        VALUES (:tid, :asin, :sku, 'holiday', :hv, 'manual', 0, 1, 'filter-consistency verify',
                NOW(), NOW())
    """), {"tid": TENANT, "asin": asin, "sku": SKU_SENTINEL, "hv": HOLIDAY})
    db.commit()


def _unseed(db):
    db.execute(text("DELETE FROM product_tags WHERE sku = :s"), {"s": SKU_SENTINEL})
    db.commit()


def main():
    _ensure_models_loaded()
    db = SessionLocal()
    dec_id = None
    orig_snapshot_id = None
    try:
        from services.inventory_service import search_inventory  # noqa: F401
        from services.tag_service import apply_tags_to_decisions

        latest = db.execute(text(
            "SELECT MAX(snapshot_date) FROM inventory_snapshots WHERE tenant_id=:t"
        ), {"t": TENANT}).scalar()

        # 对照组：正常产品（快照无节日、未停售、有决策行且 filter_status=KEEP）
        row = db.execute(text("""
            SELECT s.id, s.asin, d.id AS dec_id, d.snapshot_id AS dec_sid
            FROM inventory_snapshots s
            JOIN replenishment_decisions d
              ON d.snapshot_id = s.id AND d.tenant_id = s.tenant_id AND d.deleted_at IS NULL
            WHERE s.tenant_id = :t AND s.snapshot_date = :d AND s.deleted_at IS NULL
              AND s.summary_flag NOT IN ('共享库存')
              AND (s.is_holiday = '' OR s.is_holiday IS NULL)
              AND (s.is_discontinued = 0 OR s.is_discontinued IS NULL)
              AND d.filter_status = 'KEEP'
            ORDER BY (SELECT COUNT(*) FROM inventory_snapshots s2
                      WHERE s2.asin = s.asin AND s2.snapshot_date = :d
                        AND s2.deleted_at IS NULL
                        AND COALESCE(s2.summary_flag,'') <> '共享库存') ASC, s.id
            LIMIT 1
        """), {"t": TENANT, "d": latest}).first()
        if not row:
            print("ERR 未找到符合条件的对照产品")
            return 1
        sid, asin, dec_id, orig_snapshot_id = row[0], row[1], row[2], row[3]
        print(f"[CONTROL] snapshot_id={sid} asin={asin} dec_id={dec_id}")

        # ---------- A. 物化路径（有决策行） ----------
        ok, _ = _view(db, asin)
        check("A1 基线：默认视图可见", ok, f"asin={asin}")

        _seed(db, asin)
        # 通配标签（account=''）作用于该 ASIN 全部店铺行 → 重算该 ASIN 的全部快照行
        # （与 set_holiday_tag 内部 _recompute_decisions(accounts=['']) 的真实行为一致）
        _all_sids = [r[0] for r in db.execute(text("""
            SELECT id FROM inventory_snapshots
            WHERE tenant_id = :t AND asin = :a AND snapshot_date = :d AND deleted_at IS NULL
        """), {"t": TENANT, "a": asin, "d": latest}).all()]
        apply_tags_to_decisions(db, TENANT, snapshot_ids=_all_sids)

        ok, _ = _view(db, asin)
        check("A2 打标签+刷新决策行后：默认视图排除（快照∪标签 合并口径）", not ok)
        ok, _ = _view(db, asin, "only_holiday")
        check("A3 only_holiday 命中（标签维度被识别）", ok)
        ok, _ = _view(db, asin, f"holiday_{HOLIDAY}")
        check(f"A4 holiday_{HOLIDAY} 命中（按节日类型覆盖标签值）", ok)
        ok, _ = _view(db, asin, "only_non_holiday")
        check("A5 only_non_holiday 排除（正常产品口径同源）", not ok)

        ok, item = _view(db, asin, "only_holiday")
        check("A6 展示口径一致：is_holiday 含标签值 且 filter_status=HOLIDAY_EXCLUDED",
              ok and item and HOLIDAY in (item.get("is_holiday") or "")
              and item.get("filter_status") == "HOLIDAY_EXCLUDED",
              f"is_holiday={item.get('is_holiday') if item else None} "
              f"filter_status={item.get('filter_status') if item else None}")

        _unseed(db)
        apply_tags_to_decisions(db, TENANT, snapshot_ids=_all_sids)
        ok, _ = _view(db, asin)
        check("A7 撤销标签后：默认视图恢复可见", ok)
        ok, _ = _view(db, asin, "only_holiday")
        check("A8 撤销标签后：only_holiday 不再命中", not ok)

        # ---------- B. 兜底路径（无决策行） ----------
        # 演示库所有快照都有决策行；为真实触发 keep_cond 兜底分支与 _display_verdict，
        # 临时把决策行的 snapshot_date 偏移一天使其脱离 OUTER JOIN 的匹配条件
        # （单列 UPDATE，无 FK 依赖，finally 逐字恢复。注：snapshot_id 有 FK RESTRICT，不能改）。
        db.execute(text(
            "UPDATE replenishment_decisions SET snapshot_date = DATE_SUB(:d, INTERVAL 1 DAY) "
            "WHERE id = :i"
        ), {"d": latest, "i": dec_id})
        db.commit()
        print("[B] 决策行已临时脱离 JOIN（snapshot_date 偏移），进入无决策行路径")

        ok, _ = _view(db, asin)
        check("B1 无决策行兜底：未打标签时默认视图仍可见", ok)

        _seed(db, asin)   # 故意不调 apply_tags_to_decisions：模拟「标签已打、决策行缺失/未刷新」

        ok, _ = _view(db, asin)
        check("B2 无决策行兜底：打标签后默认视图排除（修复点 1：keep_cond 兜底含标签维度）", not ok)
        ok, _ = _view(db, asin, "only_non_holiday")
        check("B3 无决策行兜底：only_non_holiday 排除", not ok)
        ok, item = _view(db, asin, "only_holiday")
        check("B4 无决策行兜底：only_holiday 命中", ok)
        check("B5 无决策行展示兜底：filter_status=HOLIDAY_EXCLUDED（修复点 2/3：_display_verdict）",
              ok and item and item.get("filter_status") == "HOLIDAY_EXCLUDED",
              f"filter_status={item.get('filter_status') if item else None} "
              f"force_replenish={item.get('force_replenish') if item else None}")
        ok, _ = _view(db, asin, f"holiday_{HOLIDAY}")
        check(f"B6 无决策行兜底：holiday_{HOLIDAY} 命中", ok)

        _unseed(db)
        ok, _ = _view(db, asin)
        check("B7 撤销标签后：默认视图恢复可见", ok)
        return 0
    except Exception:
        traceback.print_exc()
        results.append(("脚本异常", False, "见 traceback"))
        return 1
    finally:
        try:
            _unseed(db)
            if dec_id is not None and orig_snapshot_id is not None:
                # 恢复决策行（snapshot_date 由 JOIN 条件反推：等于快照最新日期）
                latest2 = db.execute(text(
                    "SELECT MAX(snapshot_date) FROM inventory_snapshots WHERE tenant_id = :t"
                ), {"t": TENANT}).scalar()
                db.execute(text(
                    "UPDATE replenishment_decisions SET snapshot_date = :d WHERE id = :i"
                ), {"d": latest2, "i": dec_id})
            db.commit()
            left_tags = db.execute(text(
                "SELECT COUNT(*) FROM product_tags WHERE sku = :s"), {"s": SKU_SENTINEL}).scalar()
            restored = db.execute(text(
                "SELECT snapshot_id, snapshot_date FROM replenishment_decisions WHERE id = :i"
            ), {"i": dec_id}).first()
            latest3 = db.execute(text(
                "SELECT MAX(snapshot_date) FROM inventory_snapshots WHERE tenant_id = :t"
            ), {"t": TENANT}).scalar()
            print(f"[CLEANUP] 残留标签={left_tags} 决策行已恢复="
                  f"{restored and restored[0] == orig_snapshot_id and restored[1] == latest3} "
                  f"(snapshot_id={restored[0] if restored else None}, "
                  f"snapshot_date={restored[1] if restored else None}, latest={latest3})")
        except Exception:  # noqa: BLE001
            traceback.print_exc()


if __name__ == "__main__":
    code = main()
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n===== {passed}/{total} PASS =====")
    sys.exit(0 if passed == total and code == 0 else 1)
