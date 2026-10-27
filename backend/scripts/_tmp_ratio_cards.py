# -*- coding: utf-8 -*-
"""比例卡片：去自适应、补 2:3/3:2（后端同步移除 auto 逻辑，保证参数全部固定映射）。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")

# ================= 前端 =================
pf = r"C:\Users\Administrator\Desktop\AI\AIBXHS\frontend\src\pages\AIImageStudio.tsx"
s = open(pf, encoding="utf-8", newline="").read()

# 1) 卡片列表替换（8 项，对齐 ComfyUI 下拉顺序）
old = """                        {[
                          { value: 'auto', label: '自适应', shape: 'auto' },
                          { value: '9:16', label: '9:16', shape: '9:16' },
                          { value: '16:9', label: '16:9', shape: '16:9' },
                          { value: '1:1', label: '1:1', shape: '1:1' },
                          { value: '4:3', label: '4:3', shape: '4:3' },
                          { value: '3:4', label: '3:4', shape: '3:4' },
                          { value: '21:9', label: '21:9', shape: '21:9' },
                        ].map((o) => {"""
assert old in s, "卡片列表锚点缺失"
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
s = s.replace(old, new, 1)

# 2) shapeMap 补 2:3/3:2、删 auto
old2 = """                          const shapeMap: Record<string, [number, number]> = {
                            auto: [22, 22],
                            '9:16': [13, 24],
                            '16:9': [30, 17],
                            '1:1': [20, 20],
                            '4:3': [26, 20],
                            '3:4': [20, 26],
                            '21:9': [32, 14],
                          }"""
assert old2 in s, "shapeMap 锚点缺失"
new2 = """                          const shapeMap: Record<string, [number, number]> = {
                            '1:1': [20, 20],
                            '2:3': [16, 24],
                            '3:2': [26, 17],
                            '3:4': [20, 26],
                            '4:3': [26, 20],
                            '9:16': [13, 24],
                            '16:9': [30, 17],
                            '21:9': [32, 14],
                          }"""
s = s.replace(old2, new2, 1)

# 3) 默认值 auto → 1:1
old3 = "  const [mainAspectRatio, setMainAspectRatio] = useState('auto')"
assert old3 in s, "默认值锚点缺失"
s = s.replace(old3, "  const [mainAspectRatio, setMainAspectRatio] = useState('1:1')", 1)

# 4) 自适应图标分支删除
old4 = """                                {o.shape === 'auto' ? (
                                  <div
                                    style={{
                                      width: 22,
                                      height: 22,
                                      border: '1.5px dashed #bfbfbf',
                                      borderRadius: 4,
                                    }}
                                  />
                                ) : ("""
assert old4 in s, "图标分支锚点缺失"
s = s.replace(old4, "                                (", 1)
# 原 "): (" 的三目闭合——删掉 auto 分支后残留 "): (" 需要清理：把 "(  原内容  )" 包裹去掉
old5 = """                                )
                                )}
                              </div>"""
# 直接把三目表达式残留修复：现在是 "( <div .../> )" 形式
old6 = """                                (
                                  <div
                                    style={{
                                      width: w,
                                      height: h,"""
assert old6 in s, "三目残留定位失败"
# 把 "(\n<div" 到 "\n)\n" 的三目残留改为直接 JSX
s = s.replace(old4 and old4, "", 1) if False else s
open(pf, "w", encoding="utf-8", newline="").write(s)
print("前端 stage1 完成（三目残留需 stage2 修）")
