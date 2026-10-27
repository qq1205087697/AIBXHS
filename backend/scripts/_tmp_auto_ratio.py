# -*- coding: utf-8 -*-
"""后端：RATIO_VALUES 表 + 「自适应」比例解析（按参考图宽高比选最近项）。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
p = r"C:\Users\Administrator\Desktop\AI\AIBXHS\backend\services\ai_image_service.py"
s = open(p, encoding="utf-8", newline="").read()
lines = s.splitlines(keepends=True)
nl = "\r\n" if any(l.endswith("\r\n") for l in lines[:50]) else "\n"

# 1) 在 "21:9" 行（ASPECT_RATIO_MAP 内）之后插入 RATIO_VALUES
idx = [j for j, l in enumerate(lines) if '"21:9": "21:9 (Ultrawide)"' in l]
assert idx, "21:9 行未找到"
# 找该 dict 的闭合 "}"（21:9 行后的第一个 "}" 行）
close_i = idx[0]
while not lines[close_i].strip().startswith("}"):
    close_i += 1
ins = [
    nl,
    f"# 各比例的数值（宽/高），用于「自适应」按参考图宽高比选最近项{nl}",
    f"RATIO_VALUES: Dict[str, float] = {{{nl}",
    f'    "1:1": 1.0,{nl}',
    f'    "2:3": 2 / 3,{nl}',
    f'    "3:2": 1.5,{nl}',
    f'    "3:4": 0.75,{nl}',
    f'    "4:3": 4 / 3,{nl}',
    f'    "9:16": 9 / 16,{nl}',
    f'    "16:9": 16 / 9,{nl}',
    f'    "21:9": 21 / 9,{nl}',
    f"}}{nl}",
]
lines[close_i + 1: close_i + 1] = ins
s = "".join(lines)

# 2) submit 校验放宽：main_aspect_ratio 允许 'auto'
old = '    if main_counts and main_aspect_ratio not in ASPECT_RATIO_MAP:'
assert old in s, "校验锚点缺失"
new = '    if main_counts and main_aspect_ratio not in ("auto",) and main_aspect_ratio not in ASPECT_RATIO_MAP:'
s = s.replace(old, new, 1)

# 3) _prepare_and_run：auto → 按首张参考图宽高比选最近比例
old2 = """        for (t, gen_ratio, target_size, label, seq, no_text) in gen_plan:"""
assert old2 in s, "循环锚点缺失"
new2 = """        # 「自适应」：按首张参考图宽高比选最接近的生成比例
        resolved_plan: list = []
        for (t, gen_ratio, target_size, label, seq, no_text) in gen_plan:
            if gen_ratio == "auto":
                from io import BytesIO
                from PIL import Image as PILImage
                ref = PILImage.open(BytesIO(images[0][1]))
                r = ref.width / max(1, ref.height)
                gen_ratio = min(
                    RATIO_VALUES.items(), key=lambda kv: abs(kv[1] - r)
                )[0]
                logger.info(f"[AI生图] 自适应比例: 参考图 {ref.width}x{ref.height} -> {gen_ratio}")
            resolved_plan.append((t, gen_ratio, target_size, label, seq, no_text))
        for (t, gen_ratio, target_size, label, seq, no_text) in resolved_plan:"""
s = s.replace(old2, new2, 1)

open(p, "w", encoding="utf-8", newline="").write(s)
import py_compile

py_compile.compile(p, doraise=True)
s2 = open(p, encoding="utf-8", newline="").read()
print(
    "完成: RATIO_VALUES =",
    "RATIO_VALUES" in s2,
    "| auto 校验放宽 =",
    '("auto",)' in s2,
    "| 自适应解析 =",
    "自适应比例" in s2,
)
