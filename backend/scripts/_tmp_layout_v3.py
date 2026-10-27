# -*- coding: utf-8 -*-
"""AIImageStudio 布局对齐 AI 生视频：左栏 400px + 按钮固定栏底（三处替换 + 尾部闭合）。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
p = "frontend/src/pages/AIImageStudio.tsx"
s = open(p, encoding="utf-8").read()

# ---- 1) 开头壳 ----
old1 = """    <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
      <Row gutter={16} style={{ height: '100%', alignItems: 'stretch' }}>
        {/* 左栏：生成表单（栏内独立滚动，AICreationCenter 同模式） */}
        <Col xs={24} lg={9} style={{ height: '100%', width: 400, maxWidth: '100%', flexShrink: 0 }}>
          <Card
            title={
              <Space>
                <PictureOutlined />
                <span>商品套图生成</span>
              </Space>
            }
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            styles={{ body: { flex: 1, minHeight: 0, overflowY: 'auto' } }}
          >"""
assert old1 in s, "old1"
new1 = """    <div
      style={{
        display: 'flex',
        gap: 16,
        height: '100%',
        alignItems: 'stretch',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      {/* 左栏：生成表单（400px 固定宽，与 AI 生视频一致；生成按钮固定在栏底部） */}
      <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 4 }}>
          <Card
            title={
              <Space>
                <PictureOutlined />
                <span>商品套图生成</span>
              </Space>
            }
          >"""
s = s.replace(old1, new1, 1)

# ---- 2) 尾部：按钮移出 Card 到栏容器底部 + 右栏壳 ----
old2 = """              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={submitting}
                onClick={handleSubmit}
                block
                size="large"
                style={{
                  position: 'sticky',
                  bottom: 0,
                  zIndex: 2,
                  boxShadow: '0 -4px 12px rgba(0,0,0,0.08)',
                }}
              >
                立即生成（
                {[
                  aplusType && `A+×${aplusCount}`,
                  mainEnabled &&
                    selectedMainTypes.length &&
                    `主副图×${selectedMainTypes.reduce((a, t) => a + (mainCounts[t] || 1), 0)}`,
                ]
                  .filter(Boolean)
                  .join(' + ') || '未选择类型'}
                ）
              </Button>
            </Space>
          </Card>
        </Col>

        {/* 右栏：生成记录 */}
        <Col xs={24} lg={15} style={{ height: '100%', flex: 1, minWidth: 0 }}>
          <Card"""
assert old2 in s, "old2"
new2 = """          </Card>
        </div>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={submitting}
          onClick={handleSubmit}
          block
          size="large"
          style={{ marginTop: 8, flexShrink: 0 }}
        >
          立即生成（
          {[
            aplusType && `A+×${aplusCount}`,
            mainEnabled &&
              selectedMainTypes.length &&
              `主副图×${selectedMainTypes.reduce((a, t) => a + (mainCounts[t] || 1), 0)}`,
          ]
            .filter(Boolean)
            .join(' + ') || '未选择类型'}
          ）
        </Button>
      </div>

      {/* 右栏：生成记录 */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Card"""
s = s.replace(old2, new2, 1)

# ---- 3) 尾部右栏闭合（6 空格缩进的 </Col> 唯一出现在文件尾）----
old3 = """
        </Col>
      </Row>

      {/* ===== 品牌与自定义设置弹窗 ===== */}"""
assert old3 in s, "old3"
new3 = """
        </div>
      </div>

      {/* ===== 品牌与自定义设置弹窗 ===== */}"""
s = s.replace(old3, new3, 1)

open(p, "w", encoding="utf-8").write(s)
s2 = open(p, encoding="utf-8").read()
print(
    "完成: flex壳 =", "display: 'flex',\n        gap: 16" in s2,
    "| 400px =", "width: 400, flexShrink: 0" in s2,
    "| Row/Col 壳残留 =", ("<Row gutter" in s2 or 'lg={9}"' in s2 or 'lg={15}"' in s2 or "lg={15} style" in s2),
    "| 尾部闭合 =", "\n      </div>\n    </div>\n  )\n}" in s2,
)
