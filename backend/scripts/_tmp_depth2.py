# -*- coding: utf-8 -*-
"""容器级标签深度轨迹：定位 1325 前的提前闭合。"""
import sys
import re

sys.stdout.reconfigure(encoding="utf-8")
s = open(
    r"C:\Users\Administrator\Desktop\AI\AIBXHS\frontend\src\pages\AIImageStudio.tsx",
    encoding="utf-8",
    newline="",
).read()
start = s.find("  return (\n    <style>") or s.find("  return (\r\n    <style>")
if start < 0:
    start = s.find("  return (")
seg = s[start:]
lines = seg.splitlines()
depth = 0
WATCH = {"div", "Row", "Col", "Card", "Space", "Modal", "style"}
tag_re = re.compile(r"(</?)([A-Za-z][A-Za-z0-9]*)")
prev = None
for li, l in enumerate(lines):
    for m in tag_re.finditer(l):
        t = m.group(2)
        if t not in WATCH:
            continue
        closing = m.group(1) == "</"
        # 粗略自闭合判断：该标签片段以 /> 结束（同行内找）
        seg_after = l[m.start():]
        close_bracket = seg_after.find(">")
        self_close = "/>" in seg_after[: close_bracket + 1] if close_bracket >= 0 else False
        if closing:
            depth -= 1
        elif not self_close:
            depth += 1
        if prev is not None and abs(depth - prev) > 1:
            print(f"突变>> 行{li+1} 深度 {prev}->{depth} | {l.strip()[:70]}")
        prev = depth
        break
    if li > 900:
        break
print("--- 轨迹（每 10 行采样，从 1100 起）---")
# 重跑一遍记录轨迹并输出 1100 行后的采样
depth = 0
track = []
for li, l in enumerate(lines):
    for m in tag_re.finditer(l):
        t = m.group(2)
        if t not in WATCH:
            continue
        closing = m.group(1) == "</"
        seg_after = l[m.start():]
        close_bracket = seg_after.find(">")
        self_close = "/>" in seg_after[: close_bracket + 1] if close_bracket >= 0 else False
        if closing:
            depth -= 1
        elif not self_close:
            depth += 1
        break
    track.append((li + 1, depth, l.strip()[:60]))
for row in track:
    if row[0] >= 1100:
        print(f"行{row[0]:4d} 深度{row[1]:3d} | {row[2]}")
