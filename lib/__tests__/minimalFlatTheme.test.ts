import { describe, it, expect } from 'vitest'
import { THEMES } from '@/components/theme/ThemeContext'

describe('Minimal Flat Theme Spec & Constants', () => {
  it('exports valid theme structure', () => {
    expect(THEMES).toBeDefined()
    expect(THEMES.slate).toBeDefined()
  })

  it('defines MINIMAL_FLAT_TOKENS adhering to spec rules', () => {
    const MINIMAL_FLAT_TOKENS = {
      bgSpace: '#FAFAF7',
      bgSurface2: '#F1EFE8',
      borderSubtle: '#E5E3DA',
      textPrimary: '#1F1F1D',
      textSecondary: '#8A8677',
      accent: '#D85A30',
      radiusThumb: '6px',
      radiusControl: '8px',
      radiusContainer: '12px',
    }

    expect(MINIMAL_FLAT_TOKENS.bgSpace).toBe('#FAFAF7')
    expect(MINIMAL_FLAT_TOKENS.bgSurface2).toBe('#F1EFE8')
    expect(MINIMAL_FLAT_TOKENS.borderSubtle).toBe('#E5E3DA')
    expect(MINIMAL_FLAT_TOKENS.textPrimary).toBe('#1F1F1D')
    expect(MINIMAL_FLAT_TOKENS.textSecondary).toBe('#8A8677')
    expect(MINIMAL_FLAT_TOKENS.accent).toBe('#D85A30')
    expect(MINIMAL_FLAT_TOKENS.radiusThumb).toBe('6px')
    expect(MINIMAL_FLAT_TOKENS.radiusControl).toBe('8px')
    expect(MINIMAL_FLAT_TOKENS.radiusContainer).toBe('12px')
  })

  it('supports minimal-flat as a valid ThemeStyle option', () => {
    const validThemeStyles: ('classic' | 'liquid-glass' | 'minimal-flat')[] = [
      'classic',
      'liquid-glass',
      'minimal-flat',
    ]
    expect(validThemeStyles).toContain('minimal-flat')
  })
})
