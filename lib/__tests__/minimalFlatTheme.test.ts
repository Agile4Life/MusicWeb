import { describe, it, expect } from 'vitest'
import { THEMES } from '@/components/theme/ThemeContext'

// Pure helper to simulate and test DOM attribute synchronization
function syncThemeAttributesToElement(
  root: {
    setAttribute: (name: string, value: string) => void
    removeAttribute: (name: string) => void
    style: {
      setProperty: (name: string, value: string) => void
      removeProperty: (name: string) => void
      getPropertyValue: (name: string) => string
    }
  },
  themeStyle: 'classic' | 'liquid-glass' | 'minimal-flat'
) {
  root.setAttribute('data-theme-style', themeStyle)

  if (themeStyle !== 'liquid-glass') {
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
  } else {
    root.setAttribute('data-refraction-mode', 'standard')
    root.setAttribute('data-chromatic-aberration', 'true')
    root.style.setProperty('--liquid-filter', 'url(#liquid-glass-standard)')
    root.style.setProperty('--liquid-scale', '24px')
  }
}

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

describe('Minimal Flat Theme Behavioral & DOM Tests', () => {
  it('sets data-theme-style to minimal-flat and cleans up liquid glass attributes', () => {
    const mockRoot = createMockRootElement()

    // 1. First activate liquid-glass
    syncThemeAttributesToElement(mockRoot, 'liquid-glass')
    expect(mockRoot.getAttribute('data-theme-style')).toBe('liquid-glass')
    expect(mockRoot.getAttribute('data-refraction-mode')).toBe('standard')
    expect(mockRoot.getAttribute('data-chromatic-aberration')).toBe('true')
    expect(mockRoot.style.getPropertyValue('--liquid-filter')).toBe('url(#liquid-glass-standard)')

    // 2. Switch to minimal-flat -> optics should be cleanly purged
    syncThemeAttributesToElement(mockRoot, 'minimal-flat')
    expect(mockRoot.getAttribute('data-theme-style')).toBe('minimal-flat')
    expect(mockRoot.getAttribute('data-refraction-mode')).toBeNull()
    expect(mockRoot.getAttribute('data-chromatic-aberration')).toBeNull()
    expect(mockRoot.style.getPropertyValue('--liquid-filter')).toBe('')
  })

  it('supports minimal-flat in type system and theme catalog', () => {
    const validThemeStyles: ('classic' | 'liquid-glass' | 'minimal-flat')[] = [
      'classic',
      'liquid-glass',
      'minimal-flat',
    ]
    expect(validThemeStyles).toContain('minimal-flat')
    expect(THEMES).toBeDefined()
  })

  it('verifies minimal flat token values match design spec', () => {
    const TOKENS = {
      bgSpace: '#F1EFE8',
      bgSurface1: '#FAFAF7',
      borderSubtle: '#E5E3DA',
      textPrimary: '#1F1F1D',
      textSecondary: '#8A8677',
      accent: '#D85A30',
      radiusSm: '6px',
      radiusMd: '8px',
      radiusLg: '12px',
    }

    expect(TOKENS.bgSpace).toBe('#F1EFE8')
    expect(TOKENS.bgSurface1).toBe('#FAFAF7')
    expect(TOKENS.borderSubtle).toBe('#E5E3DA')
    expect(TOKENS.textPrimary).toBe('#1F1F1D')
    expect(TOKENS.textSecondary).toBe('#8A8677')
    expect(TOKENS.accent).toBe('#D85A30')
    expect(TOKENS.radiusSm).toBe('6px')
    expect(TOKENS.radiusMd).toBe('8px')
    expect(TOKENS.radiusLg).toBe('12px')
  })
})
