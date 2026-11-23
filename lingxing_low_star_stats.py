# -*- coding: utf-8 -*-
"""
统计全部店铺 Listing 中 last_star <= 3 的产品
数据源: POST /erp/sc/data/mws/listing（销售 > Listing，last_star 为 Listing 评分字段）

用法:
  python lingxing_low_star_stats.py count   # 探针：只统计总量并估算耗时，不拉全量
  python lingxing_low_star_stats.py run     # 全量分页拉取并统计，输出明细 CSV + 汇总
"""

import csv
import json
import math
import os
import sys
import time

from lingxing_api import BASE_URL, APP_ID, make_sign, get_access_token
from lingxing_api import get_amazon_sellers
import requests

PAGE = 1000          # 接口单页上限 1000
THRESHOLD = 3.0      # last_star 阈值
PAGE_DELAY = 0.3     # 页间隔，规避限流（令牌桶容量 1）
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(OUT_DIR, "low_star_page_cache.jsonl")

# 断点续传只需保留统计用字段
KEEP_FIELDS = ["sid", "seller_sku", "asin", "parent_asin", "local_sku", "last_star",
               "price", "currency_code", "status", "item_name", "marketplace",
               "fulfillment_channel_type"]

LISTING_PATH = "/erp/sc/data/mws/listing"


def call_with_retry(payload: dict, tries: int = 6) -> dict:
    """带重试的调用：覆盖限流(3001008)与网络异常（瞬断/超时/响应不完整）"""
    token = get_access_token()
    for i in range(tries):
        try:
            timestamp = str(int(time.time()))
            sign = make_sign({**payload, "access_token": token, "app_key": APP_ID, "timestamp": timestamp})
            resp = requests.post(
                f"{BASE_URL}{LISTING_PATH}",
                params={"app_key": APP_ID, "timestamp": timestamp, "sign": sign},
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                timeout=120,
            ).json()
        except requests.RequestException as e:
            if i < tries - 1:
                print(f"    网络异常重试 {i + 1}/{tries - 1}: {type(e).__name__}")
                time.sleep(2 + 2 * i)
                continue
            raise
        if str(resp.get("code")) == "0":
            return resp
        if "3001008" in str(resp.get("code")) and i < tries - 1:
            time.sleep(2 + 2 * i)
            continue
        raise RuntimeError(f"调用失败: {json.dumps(resp, ensure_ascii=False)[:300]}")
    raise RuntimeError("多次重试后仍失败")


def load_page_cache() -> dict:
    """读取已成功拉取的页（按 offset），容忍最后一条未写完整的 JSON"""
    pages = {}
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    obj = json.loads(line)
                    pages[obj["offset"]] = obj["data"]
                except json.JSONDecodeError:
                    continue
    return pages


def get_all_sids() -> str:
    sellers = get_amazon_sellers()
    return ",".join(str(s["sid"]) for s in sellers), {str(s["sid"]): s.get("name", "") for s in sellers}


def parse_star(v) -> float | None:
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def probe():
    """探针：总条数 + 实测单页耗时 → 估算总耗时"""
    sids, _ = get_all_sids()
    print(f"店铺数: {len(sids.split(','))}")

    t0 = time.time()
    total = call_with_retry({"sid": sids, "offset": 0, "length": 1})["total"]
    print(f"全部店铺 Listing 总条数: {total}（探针请求耗时 {time.time() - t0:.1f}s）")

    t0 = time.time()
    page = call_with_retry({"sid": sids, "offset": 0, "length": PAGE})["data"]
    page_dt = time.time() - t0
    print(f"实测单页({len(page)}条)耗时: {page_dt:.2f}s")

    pages = math.ceil(total / PAGE)
    best = pages * page_dt
    est = pages * (page_dt + PAGE_DELAY)
    print(f"\n全量拉取需要 {pages} 页请求:")
    print(f"  估算总耗时: 约 {est / 60:.1f} 分钟（纯请求 {best / 60:.1f} 分钟 + 页间隔/重试余量）")


def run():
    """全量拉取并统计 last_star <= 3"""
    sids, sid_names = get_all_sids()
    total = call_with_retry({"sid": sids, "offset": 0, "length": 1})["total"]
    pages = math.ceil(total / PAGE)
    print(f"总条数 {total}，{pages} 页，开始拉取...")

    all_listings, t_start = [], time.time()
    cached = load_page_cache()
    cache_f = open(CACHE_FILE, "a", encoding="utf-8")
    if cached:
        print(f"发现断点缓存 {len(cached)} 页，自动续传")

    for offset in range(0, total, PAGE):
        if offset in cached:
            data = cached[offset]
        else:
            for attempt in range(3):
                try:
                    resp = call_with_retry({"sid": sids, "offset": offset, "length": PAGE})
                    break
                except RuntimeError as e:
                    if attempt == 2:
                        raise
                    print(f"  offset={offset} 失败重试: {str(e)[:120]}")
                    time.sleep(3)
            data = resp.get("data") or []
            # 每页成功后落盘，中断后可续传
            cache_f.write(json.dumps({"offset": offset,
                                      "data": [{k: it.get(k) for k in KEEP_FIELDS} for it in data]},
                                     ensure_ascii=False) + "\n")
            cache_f.flush()
        all_listings.extend(data)
        done = len(all_listings)
        print(f"  进度 {done}/{total} ({done / total * 100:.0f}%)，累计 {time.time() - t_start:.0f}s")
        time.sleep(PAGE_DELAY)
    cache_f.close()
    if os.path.exists(CACHE_FILE):
        os.remove(CACHE_FILE)  # 全部完成后清理缓存

    # 过滤 last_star <= 3（仅统计有评分的）
    matched = []
    no_star = 0
    dist = {"无评分": 0, "<=1": 0, "1-2": 0, "2-3": 0, ">3": 0}
    for it in all_listings:
        star = parse_star(it.get("last_star"))
        if star is None:
            dist["无评分"] += 1
            no_star += 1
        elif star <= 1:
            dist["<=1"] += 1
        elif star <= 2:
            dist["1-2"] += 1
        elif star <= THRESHOLD:
            dist["2-3"] += 1
        else:
            dist[">3"] += 1
        if star is not None and star <= THRESHOLD:
            matched.append(it)

    # 按店铺汇总
    by_store = {}
    for it in matched:
        sid = str(it.get("sid"))
        by_store.setdefault(sid, {"店铺": sid_names.get(sid, ""), "低分listing数": 0, "低分ASIN数": set()})
        by_store[sid]["低分listing数"] += 1
        by_store[sid]["低分ASIN数"].add(it.get("asin"))

    # 明细 CSV（Excel 友好）
    csv_path = os.path.join(OUT_DIR, "low_star_listings.csv")
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["sid", "店铺名", "seller_sku", "asin", "last_star", "price",
                    "currency_code", "status", "item_name"])
        for it in matched:
            w.writerow([it.get("sid"), sid_names.get(str(it.get("sid")), ""), it.get("seller_sku"),
                        it.get("asin"), it.get("last_star"), it.get("price"),
                        it.get("currency_code"), it.get("status"),
                        (it.get("item_name") or "")[:100]])

    # 汇总
    summary = {
        "统计时间": time.strftime("%Y-%m-%d %H:%M:%S"),
        "阈值": f"last_star <= {THRESHOLD}",
        "扫描listing总数": len(all_listings),
        "低分listing数": len(matched),
        "低分唯一ASIN数": len({it.get("asin") for it in matched}),
        "低分唯一本地SKU数": len({it.get("local_sku") for it in matched if it.get("local_sku")}),
        "评分分布": dist,
        "耗时秒": round(time.time() - t_start, 1),
        "按店铺分布": {
            sid: {"店铺": v["店铺"], "低分listing数": v["低分listing数"], "低分ASIN数": len(v["低分ASIN数"])}
            for sid, v in sorted(by_store.items(), key=lambda kv: -kv[1]["低分listing数"])
        },
    }
    json_path = os.path.join(OUT_DIR, "low_star_summary.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print(f"扫描 Listing 总数: {len(all_listings)}（其中无评分 {no_star} 条）")
    print(f"last_star <= {THRESHOLD}: {len(matched)} 条 listing，"
          f"唯一 ASIN {summary['低分唯一ASIN数']} 个，唯一本地SKU {summary['低分唯一本地SKU数']} 个")
    print(f"评分分布: {dist}")
    top = list(summary["按店铺分布"].items())[:10]
    print("\n低分最多的前 10 个店铺:")
    for sid, v in top:
        print(f"  sid={sid}  {v['店铺']}  低分listing {v['低分listing数']} / ASIN {v['低分ASIN数']}")
    print(f"\n明细: {csv_path}\n汇总: {json_path}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "count"
    if mode == "count":
        probe()
    elif mode == "run":
        run()
    else:
        print("用法: python lingxing_low_star_stats.py [count|run]")
