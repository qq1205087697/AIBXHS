# -*- coding: utf-8 -*-
"""端到端冒烟：v2 分组参数提交 → 轮询 → 验证 A+ 图输出尺寸（会真实生成 3 张图）。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, ".")

import io
import json
import time

import requests
from PIL import Image as PILImage

from services.auth_service import create_access_token
from database.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    row = db.execute(text(
        "SELECT id, username, tenant_id FROM users WHERE username='test' LIMIT 1"
    )).fetchone()
finally:
    db.close()
token = create_access_token(data={"sub": row[1], "uid": row[0], "tid": row[2]})
H = {"Authorization": f"Bearer {token}"}
BASE = "http://127.0.0.1:8011/api/ai-image"

# 1. options 检查
r = requests.get(f"{BASE}/options", headers=H, timeout=15).json()
print("options 原始响应键:", list(r.keys()))
d = r.get("data") or r
print("options: aplus_types =", list((d.get("aplus_types") or {}).keys()))
print("options: main_types =", list((d.get("main_types") or {}).keys()))
print("options: brand_options.countries =", (d.get("brand_options") or {}).get("countries", [])[:3], "…")

# 2. 造一张测试参考图
buf = io.BytesIO()
PILImage.new("RGB", (800, 800), (150, 90, 200)).save(buf, format="PNG")
buf.seek(0)

# 3. 提交 v2 任务：高级A+×1 + 主副图（白底图、特写白底图）×1
brand = {
    "main_color": "#E85D3A",
    "font_style": "现代无衬线",
    "custom_text": "测试任务：明亮简洁风格",
    "country": "US 美国",
    "language": "英语",
    "platform": "亚马逊",
}
files = [("files", ("test_ref.png", buf.getvalue(), "image/png"))]
form = {
    "title": "v2分组冒烟",
    "aplus_type": "aplus_advanced",
    "main_types": json.dumps(["white_background", "closeup_white"]),
    "main_aspect_ratio": "1:1",
    "image_count": "1",
    "product_info": "紫色陶瓷马克杯，圣诞限定",
    "brand_settings": json.dumps(brand, ensure_ascii=False),
}
r = requests.post(f"{BASE}/tasks", headers=H, files=files, data=form, timeout=120)
print("提交:", r.status_code)
task = r.json()
task = task.get("data") or task
task_id = task.get("id")
assert task_id, r.text[:300]

# 4. 轮询到终态（最长 8 分钟）
deadline = time.time() + 480
final = None
while time.time() < deadline:
    lst = requests.get(f"{BASE}/tasks?page=1&page_size=5", headers=H, timeout=15).json()
    items = (lst.get("data") or {}).get("items") or []
    cur = next((t for t in items if t.get("id") == task_id), None)
    if cur:
        subs = [(s.get("label"), s.get("status")) for s in (cur.get("result_images") or [])]
        print(f"  [{int(time.time()-0)}s] {cur.get('status')} {subs}")
        if cur.get("status") in ("已完成", "部分完成", "失败"):
            final = cur
            break
    time.sleep(10)

assert final, "轮询超时"
print("状态:", final.get("status"), "| 耗时:", final.get("cost_seconds"), "秒")

# 5. 验证 A+ 图尺寸 = 1464×600
for s in final.get("result_images") or []:
    label, st, url = s.get("label"), s.get("status"), s.get("url")
    if st == "已完成" and url:
        img = PILImage.open(io.BytesIO(requests.get(url, timeout=60).content))
        print(f"  {label}: {img.size[0]}×{img.size[1]}")
    else:
        print(f"  {label}: {st}", (s.get('error') or '')[:80])
