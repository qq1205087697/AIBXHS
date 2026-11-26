import { Modal } from 'antd'

export interface SiteLanguageMismatch {
  site: string
  site_language: string
}

export interface LanguageMismatchInfo {
  video_language?: string
  mismatches: SiteLanguageMismatch[]
}

/**
 * 从接口 409 错误中提取「视频语言与站点语言不匹配」信息。
 * 后端 detail 结构：{ code: 'language_mismatch', video_language, mismatches: [{ site, site_language }] }
 */
export const getLanguageMismatch = (error: unknown): LanguageMismatchInfo | null => {
  const detail = (error as any)?.response?.data?.detail
  if (!detail || detail.code !== 'language_mismatch') return null
  return {
    video_language: detail.video_language,
    mismatches: Array.isArray(detail.mismatches) ? detail.mismatches : [],
  }
}

/** 弹出语言不匹配警告弹窗，用户确认后继续执行 onConfirm */
export const confirmLanguageMismatch = (
  info: LanguageMismatchInfo,
  onConfirm: () => void | Promise<void>,
  actionLabel = '上传',
) => {
  const siteText = info.mismatches
    .map((m) => `${m.site}${m.site_language ? `（${m.site_language}）` : ''}`)
    .join('、')
  Modal.confirm({
    title: '视频语言与目标站点语言不匹配',
    width: 480,
    centered: true,
    okText: `确认${actionLabel}`,
    okButtonProps: { danger: true },
    cancelText: '取消',
    content: (
      <div style={{ lineHeight: 1.9 }}>
        <div>
          视频语言：<strong>{info.video_language || '未知'}</strong>
        </div>
        <div>
          不匹配站点：<strong style={{ color: '#cf1322' }}>{siteText || '-'}</strong>
        </div>
        <div style={{ color: '#cf1322', marginTop: 8 }}>
          该站点语言与视频语言不一致，继续{actionLabel}可能导致平台审核不通过或用户体验不佳，是否确认{actionLabel}？
        </div>
      </div>
    ),
    onOk: onConfirm,
  })
}

export interface LanguageUnknownInfo {
  sites: string[]
}

/** 从接口 409 错误中提取「无法识别视频语言」信息（detail.code = language_unknown） */
export const getLanguageUnknown = (error: unknown): LanguageUnknownInfo | null => {
  const detail = (error as any)?.response?.data?.detail
  if (!detail || detail.code !== 'language_unknown') return null
  return { sites: Array.isArray(detail.sites) ? detail.sites : [] }
}

/** 无法识别视频语言时提醒人工核对，确认后继续执行 onConfirm */
export const confirmLanguageUnknown = (
  info: LanguageUnknownInfo | null,
  onConfirm: () => void | Promise<void>,
  actionLabel = '上传',
) => {
  const siteText = (info?.sites || []).filter(Boolean).join('、')
  Modal.confirm({
    title: '无法识别视频语言',
    width: 480,
    centered: true,
    okText: `确认${actionLabel}`,
    cancelText: '取消',
    content: (
      <div style={{ lineHeight: 1.9 }}>
        <div>系统无法识别视频语言，请检查视频和上传站点的语言是否匹配。</div>
        {siteText && (
          <div style={{ marginTop: 8 }}>
            目标站点：<strong>{siteText}</strong>
          </div>
        )}
      </div>
    ),
    onOk: onConfirm,
  })
}
