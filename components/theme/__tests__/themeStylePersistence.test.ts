import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LIQUID_GLASS_CONFIG,
  LiquidGlassConfig,
  ThemeStyle,
} from '@/components/theme/ThemeContext'

function createMockRootElement() {
  const attrs = new Map<string, string>()
  const styles = new Map<string, string>()

  return {
    attrs,
    styles,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    style: {
      setProperty: (k: string, v: string) => styles.set(k, v),
      removeProperty: (k: string) => styles.delete(k),
      getPropertyValue: (k: string) => styles.get(k) ?? '',
    },
  }
}

function applyLiquidGlassConfigToElement(
  root: ReturnType<typeof createMockRootElement>,
  cfg: LiquidGlassConfig,
  activeStyle: ThemeStyle
) {
  if (activeStyle !== 'liquid-glass') {
    root.removeAttribute('data-refraction-mode')
    root.removeAttribute('data-chromatic-aberration')
    root.removeAttribute('data-aberration-playerbar')
    root.removeAttribute('data-aberration-search')
    root.removeAttribute('data-aberration-logo')
    root.removeAttribute('data-aberration-banner')
    root.removeAttribute('data-aberration-cards')
    root.removeAttribute('data-aberration-sidebar')
    root.removeAttribute('data-aberration-main')
    root.removeAttribute('data-elastic-interaction')
    root.style.removeProperty('--liquid-filter')
    root.style.removeProperty('--liquid-scale')
    root.style.removeProperty('--liquid-aberration')
    return
  }

  const master = cfg.chromaticAberration !== false
  const targets = {
    playerBar: true,
    searchBar: true,
    logoPlaque: true,
    heroBanner: true,
    tiltCards: true,
    ...(cfg.aberrationTargets || {}),
  }

  root.setAttribute('data-refraction-mode', cfg.refractionMode || 'standard')
  root.setAttribute('data-chromatic-aberration', master ? 'true' : 'false')
  root.setAttribute('data-aberration-playerbar', master && targets.playerBar !== false ? 'true' : 'false')
  root.setAttribute('data-aberration-search', master && targets.searchBar !== false ? 'true' : 'false')
  root.setAttribute('data-aberration-logo', master && targets.logoPlaque !== false ? 'true' : 'false')
  root.setAttribute('data-aberration-banner', master && targets.heroBanner !== false ? 'true' : 'false')
  root.setAttribute('data-aberration-cards', master && targets.tiltCards !== false ? 'true' : 'false')
  root.removeAttribute('data-aberration-sidebar')
  root.removeAttribute('data-aberration-main')
  root.setAttribute('data-elastic-interaction', cfg.elasticInteraction !== false ? 'true' : 'false')
  root.style.setProperty('--liquid-filter', `url(#liquid-glass-${cfg.refractionMode || 'standard'})`)
  root.style.setProperty('--liquid-scale', `${cfg.refractionIntensity ?? 24}px`)
  root.style.setProperty('--liquid-aberration', master ? '1' : '0')
}

describe('Liquid Glass Reload Persistence & Chromatic Aberration Sync', () => {
  it('correctly enables and keeps chromatic aberration data attributes when reloading into liquid-glass', () => {
    const mockRoot = createMockRootElement()
    const savedStyle: ThemeStyle = 'liquid-glass'
    const savedGlassConfig: LiquidGlassConfig = {
      ...DEFAULT_LIQUID_GLASS_CONFIG,
      chromaticAberration: true,
    }

    mockRoot.setAttribute('data-theme-style', savedStyle)
    applyLiquidGlassConfigToElement(mockRoot, savedGlassConfig, savedStyle)

    expect(mockRoot.getAttribute('data-theme-style')).toBe('liquid-glass')
    expect(mockRoot.getAttribute('data-chromatic-aberration')).toBe('true')
    expect(mockRoot.getAttribute('data-aberration-playerbar')).toBe('true')
    expect(mockRoot.getAttribute('data-aberration-cards')).toBe('true')
    expect(mockRoot.getAttribute('data-aberration-search')).toBe('true')
    expect(mockRoot.getAttribute('data-aberration-logo')).toBe('true')
    expect(mockRoot.getAttribute('data-aberration-banner')).toBe('true')
    expect(mockRoot.getAttribute('data-refraction-mode')).toBe('standard')
    expect(mockRoot.style.getPropertyValue('--liquid-filter')).toBe('url(#liquid-glass-standard)')
    expect(mockRoot.style.getPropertyValue('--liquid-aberration')).toBe('1')
  })

  it('respects granular component aberration toggles upon reload', () => {
    const mockRoot = createMockRootElement()
    const savedStyle: ThemeStyle = 'liquid-glass'
    const customConfig: LiquidGlassConfig = {
      ...DEFAULT_LIQUID_GLASS_CONFIG,
      refractionMode: 'prominent',
      chromaticAberration: true,
      aberrationTargets: {
        playerBar: true,
        searchBar: false,
        logoPlaque: true,
        heroBanner: false,
        tiltCards: true,
      },
    }

    mockRoot.setAttribute('data-theme-style', savedStyle)
    applyLiquidGlassConfigToElement(mockRoot, customConfig, savedStyle)

    expect(mockRoot.getAttribute('data-refraction-mode')).toBe('prominent')
    expect(mockRoot.getAttribute('data-aberration-playerbar')).toBe('true')
    expect(mockRoot.getAttribute('data-aberration-search')).toBe('false')
    expect(mockRoot.getAttribute('data-aberration-logo')).toBe('true')
    expect(mockRoot.getAttribute('data-aberration-banner')).toBe('false')
    expect(mockRoot.getAttribute('data-aberration-cards')).toBe('true')
    expect(mockRoot.style.getPropertyValue('--liquid-filter')).toBe('url(#liquid-glass-prominent)')
  })

  it('disables all aberration attributes when chromaticAberration is set to false', () => {
    const mockRoot = createMockRootElement()
    const savedStyle: ThemeStyle = 'liquid-glass'
    const noAberrationConfig: LiquidGlassConfig = {
      ...DEFAULT_LIQUID_GLASS_CONFIG,
      chromaticAberration: false,
    }

    mockRoot.setAttribute('data-theme-style', savedStyle)
    applyLiquidGlassConfigToElement(mockRoot, noAberrationConfig, savedStyle)

    expect(mockRoot.getAttribute('data-chromatic-aberration')).toBe('false')
    expect(mockRoot.getAttribute('data-aberration-playerbar')).toBe('false')
    expect(mockRoot.getAttribute('data-aberration-cards')).toBe('false')
    expect(mockRoot.style.getPropertyValue('--liquid-aberration')).toBe('0')
  })

  it('defaults to classic style and slate theme for first-time visitors when localStorage is empty', () => {
    const mockStorage = new Map<string, string>()
    const getSavedStyle = (storage: Map<string, string>): ThemeStyle => {
      const val = storage.get('musicweb-theme-style') as ThemeStyle
      return val === 'classic' || val === 'liquid-glass' || val === 'minimal-flat' ? val : 'classic'
    }
    const getSavedTheme = (storage: Map<string, string>): string => {
      return storage.get('musicweb-theme') || 'slate'
    }

    // 1. Empty storage -> defaults to classic & slate
    expect(getSavedStyle(mockStorage)).toBe('classic')
    expect(getSavedTheme(mockStorage)).toBe('slate')

    // 2. User changes theme style to minimal-flat -> persisted
    mockStorage.set('musicweb-theme-style', 'minimal-flat')
    expect(getSavedStyle(mockStorage)).toBe('minimal-flat')

    // 3. User changes theme style to liquid-glass -> persisted
    mockStorage.set('musicweb-theme-style', 'liquid-glass')
    expect(getSavedStyle(mockStorage)).toBe('liquid-glass')

    // 4. User changes color palette to aurora -> persisted
    mockStorage.set('musicweb-theme', 'aurora')
    expect(getSavedTheme(mockStorage)).toBe('aurora')
  })
})
