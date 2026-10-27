# -*- coding: utf-8 -*-
"""AIImageStudio 生成记录重做：行式紧凑卡片（对齐 AI 生视频历史）。

- 第一行：参考图缩略条（前3张 32x32 PreviewGroup + "+N"）+ 标题 + 状态/耗时 + 详情/编辑/更多
- 第二行：类型标签 + 比例张数 + 品牌摘要 + 时间/人 + 错误
- 结果图进「详情」弹窗（完整网格 + 下载），卡片上放完成结果小缩略条
- 编辑（restoreHistory/applyRestore）：参考图 URL 回填 + 参数 + 覆盖确认
- 主动高亮：hover 灰底；编辑中的记录主题色边框
"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
p = r"C:\Users\Administrator\Desktop\AI\AIBXHS\frontend\src\pages\AIImageStudio.tsx"
s = open(p, encoding="utf-8", newline="").read()
NL = "\r\n" if "\r\n" in s else "\n"


def rep(old: str, new: str) -> None:
    global s
    o = old.replace("\n", NL)
    assert o in s, f"锚点缺失: {old[:70]!r}"
    assert s.count(o) == 1, f"锚点不唯一: {old[:70]!r}"
    s = s.replace(o, new.replace("\n", NL), 1)


# ---------- 1) state：hoverId/activeHistoryId/previewTask ----------
rep(
    "  const [selectedProducts, setSelectedProducts] = useState<ProductOptionItem[]>([])",
    """  const [selectedProducts, setSelectedProducts] = useState<ProductOptionItem[]>([])
  const [hoverId, setHoverId] = useState<number | null>(null)
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null)
  const [previewTask, setPreviewTask] = useState<AIImageTask | null>(null)""",
)

# ---------- 2) handleReuse → applyRestore/restoreHistory ----------
old_reuse_start = "  /** 一键做同款：把历史任务的参数回填到左侧表单 */\n  const handleReuse = (task: AIImageTask) => {"
i = s.find(old_reuse_start.replace("\n", NL))
assert i > 0, "handleReuse 起始未找到"
# handleReuse 结束：其后的 "  const handleDownload"
end_anchor = "  const handleDownload"
j = s.find(end_anchor, i)
assert j > 0, "handleReuse 结束未找到"
new_fns = """  /** 编辑（恢复历史）：参考图（URL 形态）+ 参数全部回填左侧表单 */
  const applyRestore = (task: AIImageTask) => {
    // 替换上传区图片前先释放旧的 blob 地址
    fileList.forEach((f) => {
      if (f.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(f.thumbUrl)
    })
    setFileList(
      (task.images || []).map((url, i) => ({
        uid: `history-${task.id}-${i}`,
        name: `参考图${i + 1}.jpg`,
        status: 'done' as const,
        url,
        thumbUrl: url,
      })),
    )
    setAplusType(task.aplus_type || '')
    setAplusCount(task.image_count || 1)
    if (Array.isArray(task.main_types)) {
      setSelectedMainTypes(task.main_types)
      setMainCounts((m) => {
        const next = { ...m }
        for (const t of task.main_types!) if (next[t] == null) next[t] = 1
        return next
      })
    } else if (task.main_types && typeof task.main_types === 'object') {
      const entries = Object.entries(task.main_types as Record<string, number>)
      setSelectedMainTypes(entries.map(([t]) => t))
      setMainCounts((m) => {
        const next = { ...m }
        for (const [t, c] of entries) next[t] = c
        return next
      })
    } else if (!task.aplus_type) {
      const legacy = (task.generation_types || []).filter((t) => MAIN_TYPE_LABELS[t])
      setSelectedMainTypes(legacy.length ? legacy : ['white_background', 'scene'])
    }
    setMainAspectRatio(task.main_aspect_ratio || task.aspect_ratio || '1:1')
    if (task.brand_settings) {
      setBrand((b) => ({
        ...b,
        country: task.brand_settings?.country || b.country,
        language: task.brand_settings?.language || b.language,
        platform: task.brand_settings?.platform || b.platform,
      }))
    }
    setProductInfo(task.product_info || '')
    setExtraPrompt(task.prompt || '')
    setActiveHistoryId(task.id)
    message.success('已填入该历史的参考图、提示词与参数')
  }

  /** 编辑前覆盖确认：左侧已有内容时先确认，避免误覆盖 */
  const handleRestore = (task: AIImageTask) => {
    const hasExisting = fileList.length > 0 || productInfo.trim().length > 0
    if (!hasExisting) {
      applyRestore(task)
      return
    }
    Modal.confirm({
      title: '覆盖当前内容？',
      content: '左侧已上传的参考图和已填写的商品信息、参数将被该历史记录覆盖，确定继续吗？',
      okText: '覆盖',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => applyRestore(task),
    })
  }

"""
s = s[:i] + new_fns + s[j:]

# ---------- 3) handleReuse 残留断言移至渲染块替换后 ----------

# ---------- 4) 渲染块替换：Space 大卡片 → 行式列表 ----------
# 定位：从 "              <Space direction=\"vertical\" style={{ width: '100%' }} size={16}>" 到
#        "            )}\n            {total > pageSize &&" 之前
start_anchor = """            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>"""
end_anchor = """            {total > pageSize && ("""
si = s.find(start_anchor.replace("\n", NL))
assert si > 0, "渲染块起始未找到"
ei = s.find(end_anchor.replace("\n", NL), si)
assert ei > si, "渲染块结束未找到"
# 回退：end_anchor 前的分页 div 之前的换行——替换 [si, ei) 为新渲染
new_render = """            ) : (
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {tasks
                  .filter((t) => !statusFilter || t.status === statusFilter)
                  .map((task) => {
                    const doneCount = (task.result_images || []).filter(
                      (x) => x.status === '已完成' && x.url,
                    ).length
                    return (
                      <div
                        key={task.id}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: hoverId === task.id ? '#f5f5f5' : 'transparent',
                          border: `1px solid ${activeHistoryId === task.id ? '#722ed1' : '#f0f0f0'}`,
                          marginBottom: 6,
                        }}
                        onMouseEnter={() => setHoverId(task.id)}
                        onMouseLeave={() => setHoverId(null)}
                      >
                        {/* 第一行：参考图缩略条 + 标题 + 状态/耗时 + 操作 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {(task.images || []).length > 0 && (
                            <Image.PreviewGroup>
                              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                {task.images.slice(0, 3).map((url, i) => (
                                  <span
                                    key={`${task.id}-${i}`}
                                    style={{ display: 'inline-flex', lineHeight: 0, cursor: 'zoom-in' }}
                                    title="原始参考图"
                                  >
                                    <Image
                                      src={url}
                                      width={32}
                                      height={32}
                                      style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #f0f0f0' }}
                                      preview={{ mask: false }}
                                    />
                                  </span>
                                ))}
                                {task.images.length > 3 && (
                                  <span style={{ fontSize: 12, color: '#999', alignSelf: 'center' }}>
                                    +{task.images.length - 3}
                                  </span>
                                )}
                              </div>
                            </Image.PreviewGroup>
                          )}
                          <Text strong ellipsis style={{ fontSize: 13, flex: '0 1 auto', minWidth: 0 }}>
                            {task.title || `任务 #${task.id}`}
                          </Text>
                          {task.status === '排队中' || task.status === '生成中' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              <Spin size="small" />
                              <Text type="secondary" style={{ fontSize: 12 }}>{task.status}</Text>
                            </span>
                          ) : task.status === '失败' ? (
                            <Tag color="error" style={{ flexShrink: 0, marginRight: 0 }}>失败</Tag>
                          ) : task.cost_seconds != null ? (
                            <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                              耗时 {formatCost(task.cost_seconds)}
                            </Text>
                          ) : null}
                          <div style={{ flex: 1 }} />
                          <Button icon={<EyeOutlined />} size="small" onClick={() => setPreviewTask(task)}>
                            详情
                          </Button>
                          <Button icon={<FormOutlined />} size="small" onClick={() => handleRestore(task)}>
                            编辑
                          </Button>
                          <Popconfirm title="确定删除该记录？" onConfirm={() => handleDelete(task.id)}>
                            <Button size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </div>

                        {/* 第二行：类型 + 参数 + 品牌 + 时间/人 */}
                        <div style={{ marginTop: 2 }}>
                          <Space wrap size={4}>
                            {renderTypeTags(task)}
                            {(task.main_aspect_ratio || task.aspect_ratio) && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {task.main_aspect_ratio || task.aspect_ratio}
                              </Text>
                            )}
                            {Array.isArray(task.main_types) && task.main_types.length ? (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {task.main_types.length} 类 ·{' '}
                                {Object.values(task.main_types).reduce(
                                  (a: number, b: any) => a + Number(b || 1),
                                  0,
                                )}{' '}
                                张
                              </Text>
                            ) : task.main_types && typeof task.main_types === 'object' ? (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {Object.keys(task.main_types).length} 类 ·{' '}
                                {Object.values(task.main_types).reduce(
                                  (a: number, b: any) => a + Number(b || 1),
                                  0,
                                )}{' '}
                                张
                              </Text>
                            ) : null}
                            {task.aplus_type && (
                              <Text type="secondary" style={{ fontSize: 12 }}>A+×{task.image_count}</Text>
                            )}
                            {renderBrandSummary(task)}
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {task.created_at}
                              {task.creator_name ? ` · ${task.creator_name}` : ''}
                            </Text>
                          </Space>
                        </div>
                        {task.error_message && (
                          <Text type="danger" style={{ fontSize: 12, display: 'block' }}>
                            {task.error_message}
                          </Text>
                        )}

                        {/* 结果缩略条：已完成的前 3 张 48px，点击开详情看全部 */}
                        {doneCount > 0 && (
                          <div style={{ display: 'flex', gap: 4, marginTop: 6, alignItems: 'center' }}>
                            {(task.result_images || [])
                              .filter((x) => x.status === '已完成' && x.url)
                              .slice(0, 3)
                              .map((x, i) => (
                                <img
                                  key={`${x.type}-${x.seq}`}
                                  alt={x.label}
                                  src={x.url!}
                                  style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid #f0f0f0' }}
                                />
                              ))}
                            {doneCount > 3 && (
                              <span style={{ fontSize: 12, color: '#999' }}>+{doneCount - 3}</span>
                            )}
                            <Button size="small" type="link" onClick={() => setPreviewTask(task)}>
                              查看全部结果
                            </Button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                {total > pageSize && (
                  <div style={{ textAlign: 'center', marginTop: 16 }}>
                    <Pagination
                      current={page}
                      pageSize={pageSize}
                      total={total}
                      onChange={(p: number) => setPage(p)}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </div>
            )"""
# 定位旧渲染区（start_anchor 到 end_anchor 之间全部内容，含旧的 tasks.map Card 块与分页）
# start_anchor 起点到 end_anchor 起点（不含 end_anchor）替换
si_nl = s.find(start_anchor.replace("\n", NL))
ei_nl = s.find(end_anchor.replace("\n", NL), si_nl)
# si 前面是 "            ) : (\n" 已包含在 start_anchor 中（"            ) : (" 开头）✓
s = s[:si_nl] + new_render.replace("\n", NL) + s[ei_nl:]

# ---------- 5) 详情 Modal（结果图完整网格 + 下载）插到根 div 闭合前 ----------
old_tail = """      </Modal>
    </div>
    </>
  )
}"""
assert old_tail.replace("\n", NL) in s, "尾部锚缺失"
detail_modal = """      {/* ===== 任务详情：完整结果网格 + 下载 ===== */}
      <Modal
        title={previewTask ? `${previewTask.title || '任务'} · 生成结果` : ''}
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
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Space wrap size={4}>
              {renderTypeTags(previewTask)}
              {previewTask.status && (
                <Tag color={STATUS_COLORS[previewTask.status] || 'default'}>{previewTask.status}</Tag>
              )}
              {previewTask.cost_seconds != null && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  耗时 {formatCost(previewTask.cost_seconds)}
                </Text>
              )}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {previewTask.created_at}
                {previewTask.creator_name ? ` · ${previewTask.creator_name}` : ''}
              </Text>
            </Space>
            {renderBrandSummary(previewTask)}
            {previewTask.product_info && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', whiteSpace: 'pre-wrap' }}>
                商品信息：{previewTask.product_info}
              </Text>
            )}
            {previewTask.prompt && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', whiteSpace: 'pre-wrap' }}>
                附加要求：{previewTask.prompt}
              </Text>
            )}
            {(previewTask.images || []).length > 0 && (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>原始参考图</Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {previewTask.images.map((url, i) => (
                    <img
                      key={i}
                      alt={`参考图${i + 1}`}
                      src={url}
                      style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>生成结果</Text>
              <Row gutter={[12, 12]} style={{ marginTop: 4 }}>
                {(previewTask.result_images || []).map((item) => renderResultItem(item, previewTask))}
              </Row>
            </div>
          </Space>
        )}
      </Modal>
    </div>
    </>
  )
}"""
s = s.replace(old_tail.replace("\n", NL), detail_modal.replace("\n", NL), 1)

# ---------- 6) import：EyeOutlined/FormOutlined ----------
rep("  CopyOutlined,\n  MinusOutlined,\n  PlusOutlined,\n",
    "  MinusOutlined,\n  PlusOutlined,\n  EyeOutlined,\n  FormOutlined,\n")

open(p, "w", encoding="utf-8", newline="").write(s)
s2 = open(p, encoding="utf-8", newline="").read()
assert "handleReuse" not in s2, "handleReuse 残留"
print(
    "完成: applyRestore =",
    "applyRestore" in s2,
    "| CopyOutlined 残留 =",
    "CopyOutlined" in s2,
    "| handleReuse 残留 =",
    "handleReuse" in s2,
)
