# -*- coding: utf-8 -*-
"""比例卡片定案：去自适应、补 2:3/3:2（CRLF 感知 + 后端同步移除 auto）。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")

PF = r"C:\Users\Administrator\Desktop\AI\AIBXHS\frontend\src\pages\AIImageStudio.tsx"
PB = r"C:\Users\Administrator\Desktop\AI\AIBXHS\backend\services\ai_image_service.py"


def crlf_aware_replace(text: str, old: str, new: str) -> str:
    """按文件实际行尾匹配替换（先试原样，再试 CRLF/LF 转换）。"""
    for o, n in ((old, new), (old.replace("\n", "\r\n"), new.replace("\n", "\r\n"))):
        if o in text:
            return text.replace(o, n, 1)
    raise AssertionError(f"锚点缺失: {old[:60]!r}")


# ================= 前端 =================
sf = open(PF, encoding="utf-8", newline="").read()

old = """                        {[
                          { value: 'auto', label: '自适应', shape: 'auto' },
                          { value: '9:16', label: '9:16', shape: '9:16' },
                          { value: '16:9', label: '16:9', shape: '16:9' },
                          { value: '1:1', label: '1:1', shape: '1:1' },
                          { value: '4:3', label: '4:3', shape: '4:3' },
                          { value: '3:4', label: '3:4', shape: '3:4' },
                          { value: '21:9', label: '21:9', shape: '21:9' },
                        ].map((o) => {"""
new = """                        {[
                          { value: '1:1', label: '1:1', shape: '1:1' },
                          { value: '2:3', label: '2:3', shape: '2:3' },
                          { value: '3:2', label: '3:2', shape: '3:2' },
                          { value: '3:4', label: '3:4', shape: '3:4' },
                          { value: '4:3', label: '4:3', shape: '4:3' },
                          { value: '9:16', label: '9:16', shape: '9:16' },
                          { value: '16:9', label: '16:9', shape: '16:9' },
                          { value: '21:9', label: '21:9', shape: '21:9' },
                        ].map((o) => {"""
sf = crlf_aware_replace(sf, old, new)

old = """                            auto: [22, 22],
                            '9:16': [13, 24],"""
new = """                            '2:3': [16, 24],
                            '3:2': [26, 17],
                            '9:16': [13, 24],"""
sf = crlf_aware_replace(sf, old, new)

old = "  const [mainAspectRatio, setMainAspectRatio] = useState('auto')"
new = "  const [mainAspectRatio, setMainAspectRatio] = useState('1:1')"
sf = crlf_aware_replace(sf, old, new)

open(PF, "w", encoding="utf-8", newline="").write(sf)
sf2 = open(PF, encoding="utf-8", newline="").read()
print(
    "前端: 卡片含2:3/3:2 =",
    "value: '2:3'" in sf2 and "value: '3:2'" in sf2,
    "| auto 残留 =",
    "label: '自适应'" in sf2 or "useState('auto')" in sf2,
)

# ================= 后端：移除 auto =================
sb = open(PB, encoding="utf-8", newline="").read()

old = '    if main_counts and main_aspect_ratio not in ("auto",) and main_aspect_ratio not in ASPECT_RATIO_MAP:'
new = "    if main_counts and main_aspect_ratio not in ASPECT_RATIO_MAP:"
sb = crlf_aware_replace(sb, old, new)

old = """        # 「自适应」：按首张参考图宽高比选最接近的生成比例
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
new = """        for (t, gen_ratio, target_size, label, seq, no_text) in gen_plan:"""
sb = crlf_aware_replace(sb, old, new)

open(PB, "w", encoding="utf-8", newline="").write(sb)
import py_compile

py_compile.compile(PB, doraise=True)
sb2 = open(PB, encoding="utf-8", newline="").read()
print(
    "后端: auto 解析移除 =",
    "自适应比例" not in sb2,
    "| 校验严格 =",
    '("auto",)' not in sb2,
    "| COMPILE OK",
)
