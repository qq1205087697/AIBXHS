# -*- coding: utf-8 -*-
"""端到端验证：v2 分组提交（A+ 高级 x1 + 主副图白底图 x1）→ 轮询 → 断言 A+ 尺寸 1464x600。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, ".")

import io
import json
import time
import urllib.parse
import urllib.request
import urllib.error

from PIL import Image as PILImage

from services.auth_service import create_access_token
from database.database import SessionLocal
from sqlalchemy import text

BASE = "http://127.0.0.1:8002/api/ai-image"

db = SessionLocal()
try:
    row = db.execute(
        text("SELECT id, username, tenant_id FROM users WHERE username='test' LIMIT 1")
    ).fetchone()
finally:
    db.close()
token = create_access_token(data={"sub": row[1], "uid": row[0], "tid": row[2]})
H = {"Authorization": f"Bearer {token}"}

# 0. 探测 router 版本（空 files，看 400 文案）
form = {"title": "probe", "main_types": json.dumps({"white_background": 1}), "generation_types": "[]"}
req = urllib.request.Request(
    f"{BASE}/tasks", data=urllib.parse.urlencode(form).encode(), headers=H
)
try:
    urllib.request.urlopen(req, timeout=15)
    print("探测异常成功")
except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8", "replace")[:150]
    if "必须是 JSON 数组" in body:
        print("[STOP] 服务仍是旧 router（main_types dict 被拒）——请重启后端后重跑本脚本")
        sys.exit(2)
    print("探测: router 已接受 dict main_types ✓（", e.code, body[:80], "）")

# 1. 提交 v2 任务：高级A+×1 + 主副图白底图×1
buf = io.BytesIO()
PILImage.new("RGB", (900, 1200), (140, 90, 200)).save(buf, format="PNG")
buf.seek(0)

# multipart 需要 boundary——用 requests 更省事
import requests

files = [("files", ("e2e_ref.png", buf.getvalue(), "image/png"))]
data = {
    "title": "v2端到端验证",
    "aplus_type": "aplus_advanced",
    "main_types": json.dumps({"white_background": 1}),
    "main_aspect_ratio": "1:1",
    "image_count": "1",
    "product_info": "紫色陶瓷马克杯（端到端验证）",
    "brand_settings": json.dumps({"country": "US 美国", "language": "英语", "platform": "亚马逊"}),
}
r = requests.post(f"{BASE}/tasks", headers=H, files=files, data=data, timeout=120)
print("提交:", r.status_code)
task = r.json()
task = task.get("data") or task
task_id = task.get("id")
assert task_id, r.text[:300]
print("任务 ID:", task_id, "| 落库字段:",
      {k: task.get(k) for k in ("aplus_type", "main_types", "main_aspect_ratio")})

# 2. 轮询到终态（最长 10 分钟）
deadline = time.time() + 600
final = None
while time.time() < deadline:
    lst = requests.get(f"{BASE}/tasks?page=1&page_size=5", headers=H, timeout=15).json()
    items = (lst.get("data") or {}).get("items") or []
    cur = next((t for t in items if t.get("id") == task_id), None)
    if cur:
        subs = [(s.get("label"), s.get("status")) for s in (cur.get("result_images") or [])]
        print(f"  [{int(time.time() % 1000)}] {cur.get('status')} {subs}")
        if cur.get("status") in ("已完成", "部分完成", "失败"):
            final = cur
            break
    time.sleep(10)

assert final, "轮询超时"
print("终态:", final.get("status"), "| 耗时:", final.get("cost_seconds"), "秒")

# 3. 断言：A+ 图尺寸 1464x600
ok_all = True
for s in final.get("result_images") or []:
    label, st, url = s.get("label"), s.get("status"), s.get("url")
    if st == "已完成" and url:
        img = PILImage.open(io.BytesIO(requests.get(url, timeout=60).content))
        expect = (1464, 600) if label == "高级A+图" else None
        match = "" if not expect else ("✓" if img.size == expect else f"✗ 期望 {expect}")
        print(f"  {label}: {img.size[0]}x{img.size[1]} {match}")
        if expect and img.size != expect:
            ok_all = False
    else:
        print(f"  {label}: {st}", (s.get("error") or "")[:80])
        ok_all = False
print("端到端判定:", "PASS" if ok_all and final.get("status") == "已完成" else "FAIL")
