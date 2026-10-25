import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  MINIMAL_EDITORIAL_PWA_COLORS,
  resolvePwaThemeColor,
  isIOSUserAgent,
  isStandaloneDisplayMode,
  shouldShowIOSInstallPrompt,
} from '@/lib/pwaManifestConfig'

describe('iOS PWA Minimal Editorial Configuration & Helpers', () => {
  it('defines canonical Minimal Editorial PWA palette tokens', () => {
    expect(MINIMAL_EDITORIAL_PWA_COLORS).toEqual({
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
    })
  })

  it('resolves theme-color to #141017 for minimal-flat and fallback bgSpace for other styles', () => {
    expect(resolvePwaThemeColor('minimal-flat', '#0A0E1A')).toBe('#141017')
    expect(resolvePwaThemeColor('liquid-glass', '#0A0E1A')).toBe('#0A0E1A')
    expect(resolvePwaThemeColor('classic', '#07090E')).toBe('#07090E')
    expect(resolvePwaThemeColor('classic')).toBe('#141017')
  })

  it('detects iOS Safari and iPadOS user agents accurately', () => {
    const iphoneUA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    const ipadDesktopModeUA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
    const macDesktopUA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    const androidUA =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'

    expect(isIOSUserAgent(iphoneUA, 5)).toBe(true)
    expect(isIOSUserAgent(ipadDesktopModeUA, 5)).toBe(true)
    expect(isIOSUserAgent(macDesktopUA, 0)).toBe(false)
    expect(isIOSUserAgent(androidUA, 5)).toBe(false)
  })

  it('detects standalone PWA mode from navigator.standalone or display-mode media query', () => {
    expect(
      isStandaloneDisplayMode({
        navigator: { standalone: true },
        matchMedia: () => ({ matches: false }),
      })
    ).toBe(true)

    expect(
      isStandaloneDisplayMode({
        navigator: { standalone: false },
        matchMedia: (q) => ({ matches: q.includes('standalone') }),
      })
    ).toBe(true)

    expect(
      isStandaloneDisplayMode({
        navigator: { standalone: false },
        matchMedia: () => ({ matches: false }),
      })
    ).toBe(false)
  })

  it('determines when to show iOS install prompt', () => {
    const iphoneSafariUA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

    expect(
      shouldShowIOSInstallPrompt({
        ua: iphoneSafariUA,
        maxTouchPoints: 5,
        isStandalone: false,
        isDismissed: false,
      })
    ).toBe(true)

    // Already installed as standalone PWA
    expect(
      shouldShowIOSInstallPrompt({
        ua: iphoneSafariUA,
        maxTouchPoints: 5,
        isStandalone: true,
        isDismissed: false,
      })
    ).toBe(false)

    // User already dismissed
    expect(
      shouldShowIOSInstallPrompt({
        ua: iphoneSafariUA,
        maxTouchPoints: 5,
        isStandalone: false,
        isDismissed: true,
      })
    ).toBe(false)
  })

  it('configures public/manifest.json with Minimal Editorial #141017 colors and iOS icons', () => {
    const manifestPath = path.join(process.cwd(), 'public', 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

    expect(manifest.display).toBe('standalone')
    expect(manifest.background_color).toBe('#141017')
    expect(manifest.theme_color).toBe('#141017')
    expect(manifest.icons.some((icon: { src: string }) => icon.src === '/apple-touch-icon.png')).toBe(true)
    expect(Array.isArray(manifest.shortcuts)).toBe(true)
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(3)
  })

  it('configures public/sw.js with both App Shell cache and Audio stream cache', () => {
    const swPath = path.join(process.cwd(), 'public', 'sw.js')
    const swContent = fs.readFileSync(swPath, 'utf8')

    expect(swContent).toContain('SHELL_CACHE_NAME')
    expect(swContent).toContain('musicweb-audio-v2')
    expect(swContent).toContain('/manifest.json')
    expect(swContent).toContain('/apple-touch-icon.png')
    expect(swContent).toContain('KEEP_ALIVE')
  })

  it('applies iOS safe-area insets, 16px anti-zoom input, and Minimal Editorial mobile surfaces across navigation & player components', () => {
    const scrollHeader = fs.readFileSync(
      path.join(process.cwd(), 'components', 'navigation', 'MobileScrollHeader.tsx'),
      'utf8'
    )
    expect(scrollHeader).toContain('env(safe-area-inset-top')
    expect(scrollHeader).toContain('text-[16px]')
    expect(scrollHeader).toContain('#1D1720')

    const headerNav = fs.readFileSync(
      path.join(process.cwd(), 'components', 'navigation', 'MobileHeaderNav.tsx'),
      'utf8'
    )
    expect(headerNav).toContain('env(safe-area-inset-top')
    expect(headerNav).toContain('env(safe-area-inset-bottom')

    const liquidNav = fs.readFileSync(
      path.join(process.cwd(), 'components', 'navigation', 'LiquidNavBar.tsx'),
      'utf8'
    )
    expect(liquidNav).toContain("themeStyle === 'minimal-flat'")
    expect(liquidNav).toContain('rgba(29, 23, 32, 0.96)')
    expect(liquidNav).toContain('#E8A94F')

    const playerBar = fs.readFileSync(
      path.join(process.cwd(), 'components', 'player', 'PlayerBar.tsx'),
      'utf8'
    )
    expect(playerBar).toContain('rounded-[18px]')
    expect(playerBar).toContain('#E8A94F')

    const fullviewPlayer = fs.readFileSync(
      path.join(process.cwd(), 'components', 'player', 'MobileFullviewPlayer.tsx'),
      'utf8'
    )
    expect(fullviewPlayer).toContain('border-l-[3px] border-[#E8A94F]')
    expect(fullviewPlayer).toContain('font-serif italic')
    expect(fullviewPlayer).toContain('font-mono tabular-nums')

    const installPrompt = fs.readFileSync(
      path.join(process.cwd(), 'components', 'pwa', 'IOSInstallPrompt.tsx'),
      'utf8'
    )
    expect(installPrompt).toContain('Thêm vào MH chính')
    expect(installPrompt).toContain('shouldShowIOSInstallPrompt')
  })
})
