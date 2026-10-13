const CUSTOM_PLATFORM_KEY = 'custom_platforms'

/** 读取用户自定义添加的平台列表 */
export function loadCustomPlatforms(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_PLATFORM_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []
  } catch {
    return []
  }
}

/** 保存新的自定义平台（去重），返回最新列表 */
export function saveCustomPlatform(name: string): string[] {
  const list = Array.from(new Set([name, ...loadCustomPlatforms()]))
  localStorage.setItem(CUSTOM_PLATFORM_KEY, JSON.stringify(list))
  return list
}
