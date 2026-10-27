# -*- coding: utf-8 -*-
"""详情弹窗（字段清单式）+ 收尾清理。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
p = r"C:\Users\Administrator\Desktop\AI\AIBXHS\frontend\src\pages\AIImageStudio.tsx"
s = open(p, encoding="utf-8", newline="").read()
NL = "\r\n" if "\r\n" in s else "\n"


def rep(old: str, new: str, cnt: int = 1) -> None:
    global s
    o = old.replace("\n", NL)
    assert o in s, f"锚点缺失: {old[:70]!r}"
    s = s.replace(o, new.replace("\n", NL), cnt)


# ---------- 1) state：previewTask ----------
rep(
    "  const [hoverId, setHoverId] = useState<number | null>(null)",
    "  const [previewTask, setPreviewTask] = useState<AIImageTask | null>(null)\n  const [hoverId, setHoverId] = useState<number | null>(null)",
)

# ---------- 2) 参考图 map 的未使用 i ----------
rep(
    "                              {task.images.slice(0, 3).map((url, i) => (",
    "                              {task.images.slice(0, 3).map((url) => (",
)

# ---------- 3) 详情弹窗：字段清单式（对齐视频详情）+ 结果网格 ----------
# 插到根 div 闭合前（产品弹窗 Modal 之后）。锚：Fragment 闭合序列
old_tail = """    </div>
    </>
  )
}"""
assert old_tail.replace("\n", NL) in s, "尾部锚缺失"
detail = """      {/* ===== 任务详情：字段清单 + 结果网格 ===== */}
      <Modal
        title={previewTask ? previewTask.title || `任务 #${previewTask.id}` : ''}
        open={!!previewTask}
        onCancel={() => setPreviewTask(null)}
        footer={[
          <Button key="close" onClick={() => setPreviewTask(null)}>
            关闭
          </Button>,
        ]}
        width={860}
      >
        {previewTask && (
          <div>
            <Text strong style={{ fontSize: 15 }}>
              {previewTask.title || `任务 #${previewTask.id}`}
            </Text>
            <div style={{ marginTop: 10 }}>
              {[
                ['任务ID', String(previewTask.id)],
                ['生成状态', previewTask.status],
                ['生成者', previewTask.creator_name || '-'],
                [
                  '生成类型',
                  [
                    previewTask.aplus_type
                      ? { aplus_advanced: '高级A+', aplus_normal: '普通A+', aplus_mobile: '手机A+' }[
                          previewTask.aplus_type
                        ] || previewTask.aplus_type
                      : '',
                    ...(Array.isArray(previewTask.main_types)
                      ? previewTask.main_types.map((t) => MAIN_TYPE_LABELS[t] || t)
                      : previewTask.main_types && typeof previewTask.main_types === 'object'
                        ? Object.keys(previewTask.main_types).map((t) => MAIN_TYPE_LABELS[t] || t)
                        : (previewTask.generation_types || []).map((t) => LEGACY_TYPE_LABELS[t] || t)),
                  ]
                    .filter(Boolean)
                    .join(' + '),
                ],
                ['生成比例', previewTask.main_aspect_ratio || previewTask.aspect_ratio || '-'],
                ['销售国家/地区', previewTask.brand_settings?.country || '-'],
                ['生成图片语言', previewTask.brand_settings?.language || '-'],
                ['发布平台', previewTask.brand_settings?.platform || '-'],
                ['商品信息', previewTask.product_info || '-'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 13, width: 120, flexShrink: 0 }}>
                    {k}：
                  </Text>
                  <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{v}</Text>
                </div>
              ))}
              {previewTask.prompt && (
                <div style={{ display: 'flex', marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 13, width: 120, flexShrink: 0 }}>
                    提示词描述：
                  </Text>
                  <Text style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {previewTask.prompt}
                  </Text>
                </div>
              )}
              {previewTask.error_message && (
                <div style={{ display: 'flex', marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 13, width: 120, flexShrink: 0 }}>
                    失败原因：
                  </Text>
                  <Text type="danger" style={{ fontSize: 13 }}>
                    {previewTask.error_message}
                  </Text>
                </div>
              )}
            </div>

            {(previewTask.images || []).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <Text type="secondary" style={{ fontSize: 13 }}>原始参考图：</Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {previewTask.images.map((url, i) => (
                    <img
                      key={`ref-${i}`}
                      alt={`参考图${i + 1}`}
                      src={url}
                      style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ fontSize: 13 }}>生成结果：</Text>
              <Row gutter={[12, 12]} style={{ marginTop: 6 }}>
                {(previewTask.result_images || []).map((item) => renderResultItem(item, previewTask))}
              </Row>
            </div>
          </div>
        )}
      </Modal>
    </div>
    </>
  )
}"""
rep(old_tail, detail)

open(p, "w", encoding="utf-8", newline="").write(s)
print("详情弹窗与收尾完成")
