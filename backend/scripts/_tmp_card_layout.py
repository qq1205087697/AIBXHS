# -*- coding: utf-8 -*-
"""历史卡片排版对齐视频页（两列：参考图|标题/耗时/信息行）+ 详情改字段清单式。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
p = r"C:\Users\Administrator\Desktop\AI\AIBXHS\frontend\src\pages\AIImageStudio.tsx"
s = open(p, encoding="utf-8", newline="").read()
NL = "\r\n" if "\r\n" in s else "\n"


def rep(old: str, new: str) -> None:
    global s
    o = old.replace("\n", NL)
    assert o in s, f"锚点缺失: {old[:70]!r}"
    s = s.replace(o, new.replace("\n", NL), 1)


# ---------- 1) 卡片 children 重写为两列布局 ----------
old_children = """                      <Space direction="vertical" style={{ width: '100%' }} size={8}>
                        {(task.images || []).length > 0 && (
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>原始参考图</Text>
                            <Image.PreviewGroup>
                              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                {task.images.slice(0, 5).map((url, i) => (
                                  <img
                                    key={`${task.id}-ref-${i}`}
                                    alt={`参考图${i + 1}`}
                                    src={url}
                                    style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                                  />
                                ))}
                              </div>
                            </Image.PreviewGroup>
                          </div>
                        )}
                        <Space wrap size={4}>
                          {renderTypeTags(task)}
                          {(task.aplus_type || task.main_types?.length) && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {task.main_aspect_ratio || task.aspect_ratio} ·{' '}
                              {Array.isArray(task.main_types)
                                ? `${task.main_types.length} 类`
                                : task.main_types && typeof task.main_types === 'object'
                                  ? `${Object.keys(task.main_types).length} 类 · ${Object.values(task.main_types).reduce((a: number, b: any) => a + Number(b || 1), 0)} 张`
                                  : `${task.image_count}/类`}{' '}
                              · {task.created_at}
                            </Text>
                          )}
                          {task.cost_seconds != null && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              耗时 {formatCost(task.cost_seconds)}
                            </Text>
                          )}
                        </Space>
                        {renderBrandSummary(task)}
                        {task.error_message && (
                          <Text type="danger" style={{ fontSize: 12 }}>
                            {task.error_message}
                          </Text>
                        )}
                        {task.product_info && (
                          <Tooltip title={task.product_info}>
                            <Text
                              type="secondary"
                              style={{ fontSize: 12, display: 'block' }}
                              ellipsis={{ tooltip: task.product_info }}
                            >
                              商品信息：{task.product_info}
                            </Text>
                          </Tooltip>
                        )}
                        <Image.PreviewGroup>
                          <Row gutter={[12, 12]}>
                            {(task.result_images || []).map((item) =>
                              renderResultItem(item, task),
                            )}
                          </Row>
                        </Image.PreviewGroup>
                      </Space>"""
new_children = """                      <div style={{ display: 'flex', gap: 10 }}>
                        {/* 左：原始参考图缩略条（前 3 张，点击预览） */}
                        {(task.images || []).length > 0 && (
                          <Image.PreviewGroup>
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                              {task.images.slice(0, 3).map((url, i) => (
                                <img
                                  key={`${task.id}-ref-${i}`}
                                  alt={`参考图${i + 1}`}
                                  src={url}
                                  style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid #f0f0f0', cursor: 'zoom-in' }}
                                />
                              ))}
                            </div>
                          </Image.PreviewGroup>
                        )}
                        {/* 右：标题下三行信息（类型 / 状态或耗时 / 参数与摘要） */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Space wrap size={4}>
                            {renderTypeTags(task)}
                          </Space>
                          {task.status === '排队中' || task.status === '生成中' ? (
                            <div style={{ marginTop: 2 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>{task.status}…</Text>
                            </div>
                          ) : task.status === '失败' ? (
                            <div style={{ marginTop: 2 }}>
                              <Tag color="error" style={{ marginRight: 0 }}>失败</Tag>
                              {task.error_message && (
                                <Text type="danger" style={{ fontSize: 12 }}>{task.error_message}</Text>
                              )}
                            </div>
                          ) : task.cost_seconds != null ? (
                            <div style={{ marginTop: 2 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                耗时 {formatCost(task.cost_seconds)}
                              </Text>
                            </div>
                          ) : null}
                          <Tooltip
                            title={
                              (task.product_info || task.prompt)
                                ? `${task.product_info ? `商品信息：${task.product_info}` : ''}${task.prompt ? `${task.product_info ? '\\n' : ''}附加要求：${task.prompt}` : ''}`
                                : undefined
                            }
                            overlayStyle={{ maxWidth: 560 }}
                            overlayInnerStyle={{
                              maxWidth: 560,
                              width: 560,
                              maxHeight: 380,
                              overflowY: 'auto',
                              whiteSpace: 'pre-wrap',
                              fontSize: 12,
                              lineHeight: 1.7,
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{
                                fontSize: 12,
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {task.created_at}
                              {task.creator_name ? ` · ${task.creator_name}` : ''}
                              {task.brand_settings?.country ? ` · ${task.brand_settings.country}` : ''}
                              {task.brand_settings?.language ? ` · ${task.brand_settings.language}` : ''}
                              {task.brand_settings?.platform ? ` · ${task.brand_settings.platform}` : ''}
                              {` · ${task.main_aspect_ratio || task.aspect_ratio || ''}`}
                              {Array.isArray(task.main_types) && task.main_types.length
                                ? ` · ${task.main_types.length} 类 ${Object.values(task.main_types).reduce((a: number, b: any) => a + Number(b || 1), 0)} 张`
                                : task.main_types && typeof task.main_types === 'object'
                                  ? ` · ${Object.keys(task.main_types).length} 类 ${Object.values(task.main_types).reduce((a: number, b: any) => a + Number(b || 1), 0)} 张`
                                  : ''}
                              {task.aplus_type ? ` · A+×${task.image_count}` : ''}
                              {task.product_info ? ` · ${task.product_info}` : ''}
                            </Text>
                          </Tooltip>
                        </div>
                      </div>
                      {/* 结果缩略条：已完成的前 3 张，点击「查看全部结果」进详情 */}
                      {(task.result_images || []).some((x) => x.status === '已完成' && x.url) && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
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
                          {(task.result_images || []).filter((x) => x.status === '已完成' && x.url).length > 3 && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              +{(task.result_images || []).filter((x) => x.status === '已完成' && x.url).length - 3}
                            </Text>
                          )}
                          <Button size="small" type="link" onClick={() => setPreviewTask(task)}>
                            查看全部结果
                          </Button>
                        </div>
                      )}"""
rep(old_children, new_children)

open(p, "w", encoding="utf-8", newline="").write(s)
print("卡片排版重写完成")
