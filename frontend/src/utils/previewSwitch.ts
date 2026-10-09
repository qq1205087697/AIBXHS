/**
 * 图片预览切换按钮贴图定位
 *
 * antd Image 预览层把左右切换按钮渲染在独立的全屏 fixed 覆盖层
 * （.ant-image-preview-operations-wrapper），与图片层分离，
 * 纯 CSS 无法感知图片实际宽度；这里实时测量预览图片的包围盒，
 * 把按钮位置写入 CSS 变量 --preview-switch-left/right（距视口左/右边缘的 px），
 * 由 index.css 消费，使按钮始终紧贴图片左右外侧、不遮挡图片。
 *
 * 预览打开期间用低频轮询（120ms）跟踪切图/缩放/拖拽引起的位置变化，
 * 关闭后停止；MutationObserver 仅用于感知预览层的出现与销毁。
 */
const GAP = 56 // 按钮 44px + 12px 间距，按钮外缘与图片边缘的间隙

let pollTimer: number | null = null

const updateSwitchPosition = () => {
  const img = document.querySelector<HTMLElement>('.ant-image-preview-img')
  if (!img) return
  const rect = img.getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return
  const viewportW = window.innerWidth
  const left = Math.max(8, Math.round(rect.left - GAP))
  const right = Math.max(8, Math.round(viewportW - rect.right - GAP))
  const rootStyle = document.documentElement.style
  rootStyle.setProperty('--preview-switch-left', `${left}px`)
  rootStyle.setProperty('--preview-switch-right', `${right}px`)
}

const startPolling = () => {
  if (pollTimer !== null) return
  updateSwitchPosition()
  pollTimer = window.setInterval(updateSwitchPosition, 120)
}

const stopPolling = () => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

export const setupImagePreviewSwitch = () => {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return
  const observer = new MutationObserver(() => {
    const previewOpen = document.querySelector(
      '.ant-image-preview-operations-wrapper',
    )
    if (previewOpen) {
      startPolling()
    } else {
      stopPolling()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}
