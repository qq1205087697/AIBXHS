"""G7 / G11 缺口补齐的端到端验证（可重复执行，跑完自清理）

覆盖：
- G7 词库编辑接口  routers.tags.update_lexicon_entry
      · 单字段更新（keyword）→ changed 精确
      · 多字段更新（remark + status）→ changed 精确
      · 空操作（值未变）→ changed == []，不产生冗余审计
      · K6 枚举校验（非法节日名）→ 400
      · 站点枚举校验 → 400
      · 日期窗口区间校验（start > end）→ 400
      · (节日, 关键词) 唯一性冲突 → 400
      · 变更入审计（old_value → new_value）
- G11 is_holiday 多值（Q-2 用户裁定）
      · merge_holiday_values 去重 + K6 序排序
      · uk_tag 唯一键已放宽到含 tag_value（同一 ASIN 可挂多个节日）
      · search_inventory 主行 is_holiday 逗号合并
      · get_summary_children 子行 is_holiday 逗号合并

安全：所有测试数据使用哨兵值（keyword LIKE '__g7_test%' / sku='__g11_test__'），
      finally 中按哨兵精确删除，不触碰既有业务数据。
"""
import asyncio
import os
import sys
import traceback
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import text  # noqa: E402

from database.database import SessionLocal  # noqa: E402
from services.tag_service import _ensure_models_loaded, merge_holiday_values  # noqa: E402

TENANT = 1
KW_SENTINEL = "__g7_test_%"
# 注意：不要用 '__g7_test_%' 直接做 LIKE —— SQL LIKE 里 '_' 是单字符通配符，
# 而审计值实际形如「万圣节:__g7_test_kw_1b__」（前缀是节日名），必须用 % 包裹的
# 无通配符 token 才可靠。'g7_test' 是脚本铸造的标记，不会出现在真实业务数据里。
SENT_PAT = "%g7_test%"
SKU_SENTINEL = "__g11_test__"
USER = SimpleNamespace(tenant_id=TENANT, username="__g7_test_user__", id=999999)

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def expect_http_400(coro, label):
    """断言调用抛出 HTTPException(400)"""
    try:
        asyncio.run(coro)
    except HTTPException as e:
        check(label, e.status_code == 400, f"status={e.status_code} detail={str(e.detail)[:60]}")
        return
    except Exception as e:  # noqa: BLE001
        check(label, False, f"抛出了非 HTTPException：{type(e).__name__}: {e}")
        return
    check(label, False, "未抛出异常（应当拒绝）")


def g7():
    from routers.tags import create_lexicon_entry, update_lexicon_entry

    db = SessionLocal()
    try:
        # 清哨兵（含历史残留：审计值前缀为节日名，须用 %g7_test% 匹配）
        db.execute(text("DELETE FROM holiday_lexicon WHERE keyword LIKE :k"), {"k": SENT_PAT})
        db.execute(text(
            "DELETE FROM tag_audit_logs WHERE new_value LIKE :k OR old_value LIKE :k"),
            {"k": SENT_PAT})
        db.commit()

        # ---- 1. 建两条哨兵条目（用于唯一性冲突测试） ----
        r1 = asyncio.run(create_lexicon_entry(
            {"holiday_name": "万圣节", "keyword": "__g7_test_kw_1__", "match_type": "contains",
             "site": "ALL", "remark": "G7 verify"}, db, USER))
        e1 = r1["data"]["id"]
        r2 = asyncio.run(create_lexicon_entry(
            {"holiday_name": "万圣节", "keyword": "__g7_test_kw_2__", "site": "US"}, db, USER))
        e2 = r2["data"]["id"]
        check("G7 前置：词库条目创建成功", bool(e1 and e2), f"ids={e1},{e2}")

        # ---- 2. 单字段更新 ----
        res = asyncio.run(update_lexicon_entry(e1, {"keyword": "__g7_test_kw_1b__"}, db, USER))
        check("G7 单字段更新 keyword → changed 精确",
              res["data"]["changed"] == ["keyword"] and res["data"]["item"]["keyword"] == "__g7_test_kw_1b__",
              f"changed={res['data']['changed']}")
        row = db.execute(text("SELECT keyword FROM holiday_lexicon WHERE id=:i"), {"i": e1}).scalar()
        db.expire_all()
        check("G7 更新已落库", row == "__g7_test_kw_1b__", f"db={row}")

        # ---- 3. 多字段更新 ----
        res = asyncio.run(update_lexicon_entry(
            e1, {"remark": "G7 verify v2", "status": 0, "site": "UK"}, db, USER))
        check("G7 多字段更新 remark/status/site → changed 精确",
              set(res["data"]["changed"]) == {"remark", "status", "site"},
              f"changed={res['data']['changed']}")
        check("G7 未提交字段保持原值（holiday_name/match_type 不变）",
              res["data"]["item"]["holiday_name"] == "万圣节" and res["data"]["item"]["match_type"] == "contains",
              f"item={res['data']['item']}")

        # ---- 4b. 长关键词回归护栏（防 1406 Data too long） ----
        # 审计值格式为「节日:关键词」，关键词上限 100 → 最长 107；旧列宽 VARCHAR(20)
        # 会让任何稍长关键词的词库增/改在 commit 阶段 500。本用例锁定该回归。
        long_kw = "__g7_test_" + "x" * 80  # ≈ 89 字符
        try:
            rl = asyncio.run(create_lexicon_entry(
                {"holiday_name": "万圣节", "keyword": long_kw}, db, USER))
            e3 = rl["data"]["id"]
            rlu = asyncio.run(update_lexicon_entry(e3, {"keyword": long_kw + "y"}, db, USER))
            db.expire_all()
            alen = db.execute(text(
                "SELECT CHAR_LENGTH(new_value) FROM tag_audit_logs "
                "WHERE new_value LIKE :p ORDER BY id DESC LIMIT 1"
            ), {"p": "万圣节:__g7_test_%"}).scalar()
            check("G7 长关键词（89 字符）词库新增/修改不抛 1406",
                  rlu["data"]["changed"] == ["keyword"], f"id={e3} changed={rlu['data']['changed']}")
            check("G7 长关键词审计值完整落库（>20 字符，证明列宽已放开）",
                  (alen or 0) > 20, f"audit new_value len={alen}")
        except Exception as e:  # noqa: BLE001
            db.rollback()
            check("G7 长关键词（89 字符）词库新增/修改不抛 1406", False, f"{type(e).__name__}: {e}")

        # ---- 4. 空操作 → changed == [] ----
        res = asyncio.run(update_lexicon_entry(e1, {"remark": "G7 verify v2", "status": 0}, db, USER))
        check("G7 空操作（值未变）→ changed == []",
              res["data"]["changed"] == [], f"changed={res['data']['changed']}")

        # ---- 5. K6 枚举校验 ----
        expect_http_400(update_lexicon_entry(e1, {"holiday_name": "中秋节"}, db, USER),
                        "G7 非法节日名（非 K6 枚举）→ 400")

        # ---- 6. 站点枚举校验 ----
        expect_http_400(update_lexicon_entry(e1, {"site": "DE"}, db, USER),
                        "G7 非法站点 → 400")

        # ---- 7. 日期窗口区间校验 ----
        expect_http_400(update_lexicon_entry(
            e1, {"window_start": "2026-12-31", "window_end": "2026-01-01"}, db, USER),
            "G7 窗口 start > end → 400")

        # ---- 8. (节日, 关键词) 唯一性冲突 ----
        expect_http_400(update_lexicon_entry(e2, {"keyword": "__g7_test_kw_1b__"}, db, USER),
                        "G7 唯一性冲突（同节日同关键词）→ 400")

        # ---- 9. 审计留痕 ----
        n = db.execute(text(
            "SELECT COUNT(*) FROM tag_audit_logs WHERE (new_value LIKE :k OR old_value LIKE :k)"
        ), {"k": SENT_PAT}).scalar()
        check("G7 词库变更入审计（V4）", (n or 0) >= 4, f"audit rows={n}")
    finally:
        db.close()


def g11():
    from services.inventory_service import search_inventory, get_summary_children

    # ---- 10/11. 合并函数单元验证（不依赖 DB） ----
    check("G11 merge_holiday_values 去重 + K6 序排序",
          merge_holiday_values("圣诞节", "万圣节") == "万圣节,圣诞节",
          f"got={merge_holiday_values('圣诞节', '万圣节')!r}")
    check("G11 merge_holiday_values 处理 None / set / 重复项",
          merge_holiday_values(None, "圣诞节", {"万圣节", "圣诞节"}) == "万圣节,圣诞节",
          f"got={merge_holiday_values(None, '圣诞节', {'万圣节', '圣诞节'})!r}")
    check("G11 merge_holiday_values 全空 → 空串",
          merge_holiday_values(None, "", []) == "", f"got={merge_holiday_values(None, '', [])!r}")

    db = SessionLocal()
    try:
        # ---- 12. uk_tag 唯一键已含 tag_value ----
        idx = db.execute(text("SHOW INDEX FROM product_tags WHERE Key_name='uk_tag'")).all()
        cols = [r[4] for r in sorted(idx, key=lambda r: r[3])]  # Seq_in_index=r[3], Column_name=r[4]
        check("G11 uk_tag 唯一键含 tag_value + account 行级作用域",
              cols == ["tenant_id", "asin", "account", "tag_type", "tag_value"], f"cols={cols}")

        baseline = search_inventory(db, tenant_id=TENANT, page=1, page_size=5)
        if not baseline["items"]:
            check("G11 主行 is_holiday 多值合并（基线为空，跳过）", False, "无可见库存")
            return
        from datetime import date as _d
        # 对照 ASIN 必须「完全没有标签行」：标签被人工取消后行会保留为抑制态（active=0），
        # 若对照 ASIN 已有同 (asin, account='', holiday, 圣诞节) 行，哨兵 INSERT 会撞 uk_tag。
        _tagged = {r[0] for r in db.execute(text(
            "SELECT DISTINCT asin FROM product_tags WHERE tenant_id=:t"), {"t": TENANT}).all()}
        _pick = next((it for it in baseline["items"] if it["asin"] not in _tagged), None)
        asin = (_pick or baseline["items"][0])["asin"]

        db.execute(text("DELETE FROM product_tags WHERE sku = :s"), {"s": SKU_SENTINEL})
        db.commit()

        # ---- 13. 同一 (tenant, asin, sku, tag_type='holiday') 挂两个节日值 ----
        try:
            for hv in ("圣诞节", "万圣节"):
                db.execute(text("""
                    INSERT INTO product_tags
                    (tenant_id, asin, sku, tag_type, tag_value, source, locked, active, reason,
                     created_at, updated_at)
                    VALUES (:tid, :asin, :sku, 'holiday', :hv, 'manual', 0, 1, 'G11 verify temp',
                            NOW(), NOW())
                """), {"tid": TENANT, "asin": asin, "sku": SKU_SENTINEL, "hv": hv})
            db.commit()
            check("G11 同一 ASIN 挂两个节日标签无 IntegrityError", True, f"asin={asin}")
        except Exception as e:  # noqa: BLE001
            db.rollback()
            check("G11 同一 ASIN 挂两个节日标签无 IntegrityError", False, f"{type(e).__name__}: {e}")
            return

        # ---- 14. 主行 is_holiday 逗号合并 ----
        view = search_inventory(db, tenant_id=TENANT, keyword=asin, page=1, page_size=20)
        hit = next((it for it in view["items"] if it["asin"] == asin), None)
        iv = (hit or {}).get("is_holiday") or ""
        got = [x for x in iv.split(",") if x]
        check("G11 主行 is_holiday 逗号合并两个节日",
              {"万圣节", "圣诞节"} <= set(got),
              f"is_holiday={iv!r}")
        check("G11 合并结果按 K6 枚举序（万圣节 在 圣诞节 之前）",
              ("万圣节" in got and "圣诞节" in got and got.index("万圣节") < got.index("圣诞节")),
              f"order={got}")
        check("G11 合并结果无空格分隔（前端 split(',') 可直接拆）",
              ", " not in iv, f"is_holiday={iv!r}")

        # ---- 15. 子行路径 ----
        # 挑「非节日且未停售」的汇总行：get_summary_children 按 K3 只返回 KEEP 子行，
        # 父行为节日商品时子行会被正确排除（children=0），断言会误判。
        parent = db.execute(text("""
            SELECT asin, account FROM inventory_snapshots
            WHERE tenant_id=:tid AND summary_flag='是' AND account IS NOT NULL
              AND (is_holiday = '' OR is_holiday IS NULL)
              AND (is_discontinued = 0 OR is_discontinued IS NULL)
              AND snapshot_date=(SELECT MAX(snapshot_date) FROM inventory_snapshots WHERE tenant_id=:tid)
            LIMIT 1
        """), {"tid": TENANT}).first()
        if parent:
            children = get_summary_children(db, TENANT, parent[0], parent[1])
            check("G11 子行返回体含 is_holiday 字段",
                  all("is_holiday" in c for c in children) if children else False,
                  f"children={len(children)}")
        else:
            print("[SKIP] G11 子行 is_holiday（无父汇总行）")
    finally:
        db.close()


def cleanup():
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM product_tags WHERE sku = :s"), {"s": SKU_SENTINEL})
        db.execute(text("DELETE FROM holiday_lexicon WHERE keyword LIKE :k"), {"k": SENT_PAT})
        db.execute(text(
            "DELETE FROM tag_audit_logs WHERE new_value LIKE :k OR old_value LIKE :k"
        ), {"k": SENT_PAT})
        db.commit()
        left = {
            "tags": db.execute(text("SELECT COUNT(*) FROM product_tags WHERE sku=:s"),
                               {"s": SKU_SENTINEL}).scalar(),
            "lex": db.execute(text("SELECT COUNT(*) FROM holiday_lexicon WHERE keyword LIKE :k"),
                              {"k": SENT_PAT}).scalar(),
            "audit": db.execute(text(
                "SELECT COUNT(*) FROM tag_audit_logs WHERE new_value LIKE :k OR old_value LIKE :k"),
                {"k": SENT_PAT}).scalar(),
        }
        print(f"[CLEANUP] 残留：{left}")
    finally:
        db.close()


if __name__ == "__main__":
    try:
        _ensure_models_loaded()
        g7()
        g11()
    except Exception:
        traceback.print_exc()
        results.append(("脚本异常", False, "见 traceback"))
    finally:
        cleanup()
        total = len(results)
        passed = sum(1 for _, ok, _ in results if ok)
        print(f"\n===== {passed}/{total} PASS =====")
        sys.exit(0 if passed == total else 1)
