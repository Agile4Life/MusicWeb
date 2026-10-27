/**
 * Canonical Minimal Editorial (Vinyl Studio) PWA color tokens & iOS Standalone helpers.
 */
export const MINIMAL_EDITORIAL_PWA_COLORS = {
  background: '#141017',
  surface: '#1D1720',
  surface2: '#251E29',
  paper: '#F4ECE1',
  paperDim: '#B9AC9C',
  muted: '#8B8090',
  accent: '#E8A94F',
  accentInk: '#2A1704',
  hair: 'rgba(244, 236, 230, 0.08)',
  hairStrong: 'rgba(244, 236, 230, 0.14)',
} as const

export const IOS_PWA_PROMPT_STORAGE_KEY = 'musicweb-ios-pwa-prompt-dismissed'

/**
 * Resolves the `<meta name="theme-color">` hex value for iOS Safari / Standalone status bar.
 */
export function resolvePwaThemeColor(themeStyle: string, fallbackBgSpace?: string): string {
  if (themeStyle === 'minimal-flat') {
    return MINIMAL_EDITORIAL_PWA_COLORS.background
  }
  return fallbackBgSpace || MINIMAL_EDITORIAL_PWA_COLORS.background
}

/**
 * Synchronizes the document's `<meta name="theme-color">` tag in the DOM.
 */
export function syncDocumentThemeColor(themeStyle: string, fallbackBgSpace?: string): void {
  if (typeof document === 'undefined') return
  const color = resolvePwaThemeColor(themeStyle, fallbackBgSpace)
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = color
}

/**
 * Detects iPhone, iPod, iPad (including iPadOS 13+ desktop-class UA with touch points).
 */
export function isIOSUserAgent(ua: string, maxTouchPoints = 0): boolean {
  if (!ua) return false
  if (/iPad|iPhone|iPod/i.test(ua)) return true
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return true
  return false
}

export interface StandaloneWindowLike {
  navigator?: { standalone?: boolean } | Navigator
  matchMedia?: (query: string) => { matches: boolean }
}

/**
 * Checks whether the web app is currently running in installed standalone / fullscreen PWA mode.
 */
export function isStandaloneDisplayMode(win?: StandaloneWindowLike): boolean {
  const target: StandaloneWindowLike | undefined =
    win ?? (typeof window !== 'undefined' ? window : undefined)
  if (!target) return false

  const nav = target.navigator as { standalone?: boolean } | undefined
  if (nav?.standalone === true) {
    return true
  }

  if (typeof target.matchMedia === 'function') {
    if (
      target.matchMedia('(display-mode: standalone)').matches ||
      target.matchMedia('(display-mode: fullscreen)').matches ||
      target.matchMedia('(display-mode: minimal-ui)').matches
    ) {
      return true
    }
  }

  return false
}

/**
 * Determines whether the iOS "Add to Home Screen" editorial banner should be shown.
 */
export function shouldShowIOSInstallPrompt(params: {
  ua: string
  maxTouchPoints?: number
  isStandalone: boolean
  isDismissed: boolean
}): boolean {
  if (params.isStandalone || params.isDismissed) return false
  return isIOSUserAgent(params.ua, params.maxTouchPoints ?? 0)
}
