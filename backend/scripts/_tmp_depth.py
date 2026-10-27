# -*- coding: utf-8 -*-
"""粗略 JSX 深度计数：定位 return 后标签层错位点。"""
import sys
import re

sys.stdout.reconfigure(encoding="utf-8")
s = open(
    r"C:\Users\Administrator\Desktop\AI\AIBXHS\frontend\src\pages\AIImageStudio.tsx",
    encoding="utf-8",
    newline="",
).read()
start = s.find("return (")
seg = s[start:]
lines = seg.splitlines()
depth = 0
tag_re = re.compile(r"</?([A-Za-z][A-Za-z0-9.]*)")
for li, l in enumerate(lines):
    # 跳过注释与字符串粗糙处理：只数 <> 开头或 </ 开头的标签
    for m in tag_re.finditer(l):
        t = m.group(1)
        if t in ("style",):
            pass
        if l[m.start():].startswith("</"):
            depth -= 1
        else:
            # 自闭合标签 <div .../> 不计
            rest = l[m.start():]
            if "/>" in rest.split(">")[1] if ">" in rest else False:
                pass
            depth += 1
        print(f"行{li+1:4d} 深度{depth:3d} {'CLOSE' if l[m.start():].startswith('</') else 'OPEN '} {t:12s} | {l.strip()[:60]}")
        break
