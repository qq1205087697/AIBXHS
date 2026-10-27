# -*- coding: utf-8 -*-
"""AIImageStudio 上传重做：本地上传 + 产品库选择 + 缩略图展示（对齐 AI 生视频）。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
p = r"C:\Users\Administrator\Desktop\AI\AIBXHS\frontend\src\pages\AIImageStudio.tsx"
s = open(p, encoding="utf-8", newline="").read()
NL = "\r\n" if "\r\n" in s else "\n"
applied = 0


def rep(old, new):
    global s, applied
    o = old.replace("\n", NL)
    assert o in s, f"锚点缺失: {old[:70]!r}"
    s = s.replace(o, new.replace("\n", NL), 1)
    applied += 1


# ---------- 1) 模块级：ProductOptionItem 接口 + PRODUCT_PAGE_SIZE ----------
rep(
    "const MAX_IMAGES = 5",
    """const MAX_IMAGES = 5
const PRODUCT_PAGE_SIZE = 8

interface ProductOptionItem {
  id: number
  product_code: string
  name: string
  images: string[]
}""",
)

# ---------- 2) import 增补：AppstoreOutlined / Modal / productsApi ----------
rep("  ThunderboltOutlined,\n  DownloadOutlined,\n  BulbOutlined,\n",
    "  ThunderboltOutlined,\n  DownloadOutlined,\n  BulbOutlined,\n  AppstoreOutlined,\n")
rep("  Popconfirm,\n  Spin,\n  Badge,\n  Upload,\n",
    "  Popconfirm,\n  Spin,\n  Badge,\n  Upload,\n  Modal,\n")
rep("import {\n  aiImageApi,\n  aiCreationApi,",
    "import {\n  aiImageApi,\n  aiCreationApi,\n  productsApi,")

# ---------- 3) state 组（submitting 之后插入） ----------
rep(
    "  const [extraPrompt, setExtraPrompt] = useState('')\n  const [submitting, setSubmitting] = useState(false)",
    """  const [extraPrompt, setExtraPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // ===== 上传区（本地上传 + 产品库选择，对齐 AI 生视频） =====
  const localInputRef = useRef<HTMLInputElement>(null)
  const [uploadAreaHover, setUploadAreaHover] = useState(false)
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [productSearchText, setProductSearchText] = useState('')
  const [productKeyword, setProductKeyword] = useState('')
  const [productOptions, setProductOptions] = useState<ProductOptionItem[]>([])
  const [productTotal, setProductTotal] = useState(0)
  const [productPage, setProductPage] = useState(1)
  const [productLoading, setProductLoading] = useState(false)
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([])
  // 从产品库选图时记录来源产品（编码/品名随任务落库）
  const [selectedProducts, setSelectedProducts] = useState<ProductOptionItem[]>([])""",
)

# ---------- 4) 辅助函数（handleAnalyze 之前插入） ----------
rep(
    "  // ===== AI 分析商品信息 =====",
    """  // ===== 上传辅助（对齐 AI 生视频） =====
  const appendFiles = (files: File[]) => {
    const images = files.filter((f) => f.type?.startsWith('image/'))
    if (images.length < files.length) {
      message.error('存在非图片文件，已自动忽略')
    }
    setFileList((prev) => {
      const remain = MAX_IMAGES - prev.length
      if (images.length > remain) {
        message.warning(`最多上传 ${MAX_IMAGES} 张图片`)
      }
      const accepted = images.slice(0, Math.max(0, remain))
      const items: UploadFile[] = accepted.map((f, i) => ({
        uid: `local-${Date.now()}-${i}-${f.name}`,
        name: f.name,
        status: 'done',
        thumbUrl: URL.createObjectURL(f),
        originFileObj: f,
      }))
      return [...prev, ...items]
    })
  }

  const handleLocalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) appendFiles(files)
    e.target.value = ''
  }

  const handleRemoveImage = (uid: string) => {
    setFileList((prev) => {
      const target = prev.find((f) => f.uid === uid)
      if (target?.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(target.thumbUrl)
      return prev.filter((f) => f.uid !== uid)
    })
  }

  const fetchProductOptions = async (page: number, keyword: string) => {
    setProductLoading(true)
    try {
      const res = await productsApi.getList({
        search: keyword || undefined,
        page,
        page_size: PRODUCT_PAGE_SIZE,
        product_type: 'finished',
      })
      if (res.data?.success && res.data?.data) {
        const payload: any = res.data.data
        const items: any[] = Array.isArray(payload) ? payload : payload?.items || []
        const total = Array.isArray(payload) ? (res.data.total ?? items.length) : (payload?.total ?? items.length)
        const curPage = Array.isArray(payload) ? (res.data.page ?? page) : (payload?.page ?? page)
        setProductOptions(
          items.map((prod) => ({
            id: prod.id,
            product_code: prod.product_code || '',
            name: prod.name || '',
            images: Array.from(
              new Set([...(prod.images || []), ...(prod.main_image ? [prod.main_image] : [])]),
            ).filter(Boolean) as string[],
          })),
        )
        setProductTotal(total)
        setProductPage(curPage)
      } else {
        message.error('获取产品列表失败')
      }
    } catch (err: any) {
      message.error(err.response?.data?.detail || '获取产品列表失败')
    } finally {
      setProductLoading(false)
    }
  }

  const openProductModal = () => {
    setSelectedImageUrls([])
    setProductSearchText('')
    setProductKeyword('')
    setProductModalOpen(true)
    fetchProductOptions(1, '')
  }

  const toggleProductImage = (url: string) => {
    setSelectedImageUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    )
  }

  const handleConfirmProductImages = () => {
    if (selectedImageUrls.length === 0) {
      message.warning('请先勾选产品图片')
      return
    }
    setFileList((prev) => {
      const existUrls = new Set(prev.map((f) => f.url || f.thumbUrl).filter(Boolean))
      const freshUrls = selectedImageUrls.filter((url) => !existUrls.has(url))
      const remain = MAX_IMAGES - prev.length
      if (freshUrls.length > remain) {
        message.warning(`最多上传 ${MAX_IMAGES} 张图片`)
      }
      const urls = freshUrls.slice(0, Math.max(0, remain))
      const items: UploadFile[] = urls.map((url, i) => ({
        uid: `pm-${Date.now()}-${i}`,
        name: url.split('/').pop() || 'product-image',
        status: 'done',
        url,
        thumbUrl: url,
      }))
      return [...prev, ...items]
    })
    // 记录选图来源产品（编码/品名随任务落库）
    const matched = productOptions.filter((prod) =>
      selectedImageUrls.some((u) => prod.images?.includes(u)),
    )
    setSelectedProducts((prev) => {
      const ids = new Set(prev.map((prod) => prod.id))
      return [...prev, ...matched.filter((prod) => !ids.has(prod.id))]
    })
    setSelectedImageUrls([])
    setProductModalOpen(false)
    message.success('已添加所选产品图片')
  }

  const fetchImageBlob = async (url: string): Promise<Blob | null> => {
    try {
      const resp = await fetch(url)
      if (resp.ok) return await resp.blob()
    } catch {
      // 直连失败（跨域等），尝试后端代理
    }
    try {
      const resp = await aiCreationApi.proxyImage(url)
      return resp.data
    } catch {
      return null
    }
  }

  // 收集所有图片为 File：本地文件直接用，产品图片 URL 需下载转 File
  const collectFiles = async (): Promise<File[]> => {
    const files: File[] = []
    for (const f of fileList) {
      if (f.originFileObj instanceof File) {
        files.push(f.originFileObj)
      } else if (f.url || f.thumbUrl) {
        const blob = await fetchImageBlob(f.url || f.thumbUrl!)
        if (blob) {
          files.push(new File([blob], f.name || `image-${f.uid}.jpg`, { type: blob.type || 'image/jpeg' }))
        }
      }
    }
    return files
  }

  // ===== AI 分析商品信息 =====""",
)

# ---------- 5) handleAnalyze / handleSubmit 取图改造 ----------
rep(
    "  const handleAnalyze = async () => {\n    const files = fileList.map((f) => f.originFileObj).filter(Boolean) as File[]",
    "  const handleAnalyze = async () => {\n    const files = await collectFiles()",
)
rep(
    "  const handleSubmit = async () => {\n    const files = fileList.map((f) => f.originFileObj).filter(Boolean) as File[]",
    "  const handleSubmit = async () => {\n    const files = await collectFiles()",
)
rep(
    """      await aiImageApi.createTask(files, {
        title: baseName,
        aplus_type: aplusType || undefined,""",
    """      await aiImageApi.createTask(files, {
        title: baseName,
        aplus_type: aplusType || undefined,
        product_code: selectedProducts[0]?.product_code || '',
        product_name: selectedProducts[0]?.name || '',""",
)

# ---------- 6) 上传区 JSX 替换（Dragger + 缩略图网格 → 自绘结构） ----------
old_jsx = """              <div>
                <Text strong>参考图（1~{MAX_IMAGES} 张，首张为主参考）</Text>
                <Upload.Dragger
                  multiple
                  accept="image/*"
                  maxCount={MAX_IMAGES}
                  fileList={fileList}
                  showUploadList={false}
                  beforeUpload={() => false}
                  onChange={({ fileList: fl }) => setFileList(fl.slice(-MAX_IMAGES))}
                  style={{ marginTop: 8 }}
                >
                  <p className="ant-upload-drag-icon">
                    <UploadOutlined />
                  </p>
                  <p className="ant-upload-text">点击或拖拽上传商品参考图</p>
                  <p className="ant-upload-hint">JPEG/PNG/WebP，单张 ≤ 10M</p>
                </Upload.Dragger>
                {fileList.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {fileList.map((f) => (
                      <div key={f.uid} style={{ position: 'relative', width: 80, height: 80 }}>
                        <img
                          alt={f.name}
                          src={f.thumbUrl || f.url}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                        />
                        <Button
                          danger
                          size="small"
                          shape="circle"
                          icon={<DeleteOutlined style={{ fontSize: 10 }} />}
                          style={{ position: 'absolute', top: -8, right: -8, width: 20, height: 20, minWidth: 20 }}
                          onClick={() =>
                            setFileList((prev) => prev.filter((x) => x.uid !== f.uid))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>"""
assert old_jsx.replace("\n", NL) in s, "上传区 JSX 锚点缺失"
new_jsx = """              <div>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text strong>参考图（1~{MAX_IMAGES} 张，首张为主参考）</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    已上传 {fileList.length}/{MAX_IMAGES}
                  </Text>
                </Space>
                <div
                  onMouseEnter={() => setUploadAreaHover(true)}
                  onMouseLeave={() => setUploadAreaHover(false)}
                  style={{
                    marginTop: 8,
                    border: `1px dashed ${uploadAreaHover ? '#722ed1' : '#d9d9d9'}`,
                    borderRadius: 8,
                    padding: 16,
                    textAlign: 'center',
                    cursor: 'pointer',
                    minHeight: 120,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                  onClick={() => {
                    if (fileList.length < MAX_IMAGES) localInputRef.current?.click()
                  }}
                >
                  {fileList.length === 0 ? (
                    <>
                      <UploadOutlined style={{ fontSize: 40, color: '#bfbfbf' }} />
                      <Text type="secondary" style={{ marginTop: 8 }}>
                        上传商品图片（点击或拖拽）
                      </Text>
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                      {fileList.map((f) => (
                        <div key={f.uid} style={{ position: 'relative', width: 80, height: 80 }}>
                          <img
                            alt={f.name}
                            src={f.thumbUrl || f.url}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
                          />
                          <Button
                            danger
                            size="small"
                            shape="circle"
                            icon={<DeleteOutlined style={{ fontSize: 10 }} />}
                            style={{ position: 'absolute', top: -8, right: -8, width: 20, height: 20, minWidth: 20 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemoveImage(f.uid)
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ height: 32, marginTop: 6, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    {uploadAreaHover && fileList.length < MAX_IMAGES && (
                      <Space size={12}>
                        <Button
                          type="primary"
                          size="small"
                          icon={<UploadOutlined />}
                          onClick={(e) => {
                            e.stopPropagation()
                            localInputRef.current?.click()
                          }}
                        >
                          本地上传
                        </Button>
                        <Button
                          size="small"
                          icon={<AppstoreOutlined />}
                          onClick={(e) => {
                            e.stopPropagation()
                            openProductModal()
                          }}
                        >
                          从产品管理选择
                        </Button>
                      </Space>
                    )}
                  </div>
                </div>
                <input
                  ref={localInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleLocalFileSelect}
                />
              </div>"""
rep(old_jsx, new_jsx)

# ---------- 7) 产品弹窗 JSX（Fragment 闭合前插入） ----------
old_tail = """      </Modal>
    </div>
    </>
  )
}"""
# 注意：本页已无 Modal（刚删）——锚改为根 div 闭合
old_tail = """    </div>
    </>
  )
}"""
assert old_tail.replace("\n", NL) in s, "尾部锚缺失"
modal_jsx = """      {/* ===== 从产品管理选择图片 ===== */}
      <Modal
        title="从产品管理选择图片"
        open={productModalOpen}
        onCancel={() => setProductModalOpen(false)}
        width={860}
        footer={[
          <Button key="cancel" onClick={() => setProductModalOpen(false)}>
            取消
          </Button>,
          <Button
            key="ok"
            type="primary"
            disabled={selectedImageUrls.length === 0}
            onClick={handleConfirmProductImages}
          >
            确认{selectedImageUrls.length > 0 ? `（已选 ${selectedImageUrls.length} 张）` : ''}
          </Button>,
        ]}
      >
        <Input.Search
          placeholder="搜索产品编码 / 品名"
          allowClear
          enterButton
          value={productSearchText}
          onChange={(e) => setProductSearchText(e.target.value)}
          onSearch={(v) => {
            setProductKeyword(v)
            fetchProductOptions(1, v)
          }}
          style={{ marginBottom: 12 }}
        />
        {productLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin />
          </div>
        ) : productOptions.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到相关产品" />
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '52vh', overflowY: 'auto' }}>
              {productOptions.map((prod) => (
                <div key={prod.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13, flexShrink: 0 }}>{prod.product_code}</Text>
                    <Text style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {prod.name}
                    </Text>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {prod.images.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>该产品暂无图片</Text>
                    ) : (
                      prod.images.map((url) => {
                        const checked = selectedImageUrls.includes(url)
                        return (
                          <div
                            key={url}
                            onClick={() => toggleProductImage(url)}
                            style={{
                              position: 'relative',
                              width: 64,
                              height: 64,
                              cursor: 'pointer',
                              border: `2px solid ${checked ? '#722ed1' : '#f0f0f0'}`,
                              borderRadius: 6,
                              overflow: 'hidden',
                            }}
                          >
                            <img alt="" src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            {checked && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  right: 0,
                                  width: 18,
                                  height: 18,
                                  background: '#722ed1',
                                  color: '#fff',
                                  fontSize: 11,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderBottomLeftRadius: 6,
                                }}
                              >
                                ✓
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <Pagination
                size="small"
                current={productPage}
                total={productTotal}
                pageSize={PRODUCT_PAGE_SIZE}
                onChange={(pg: number) => fetchProductOptions(pg, productKeyword)}
              />
            </div>
          </>
        )}
      </Modal>
    </div>
    </>
  )
}"""
rep(old_tail, modal_jsx)

# ---------- 8) Upload 组件不再使用（Dragger 移除）→ 清 import ----------
if s.count("Upload") == 2 and "Upload.Dragger" not in s:
    s = s.replace("  Upload,\n", "", 1)
    applied += 1

open(p, "w", encoding="utf-8", newline="").write(s)
print(f"全部 {applied} 处注入完成")
