import { describe, it, expect } from 'vitest'
import {
  LYRIC_CARD_THEMES,
  wrapCanvasText,
  calculateOptimalFontSize,
  getThemeById,
  calculateLyricsBlockStartX,
  calculateCompactCardHeight,
  toggleContiguousLyricLine,
} from '../lyricsShareCanvas'

describe('lyricsShareCanvas Engine', () => {
  it('defines distinct lyric card themes across cover, gradient, solid, and minimal categories', () => {
    expect(LYRIC_CARD_THEMES.length).toBeGreaterThanOrEqual(11)
    const themeIds = LYRIC_CARD_THEMES.map((t) => t.id)
    expect(themeIds).toContain('cover')
    expect(themeIds).toContain('dominant')
    expect(themeIds).toContain('midnight')
    expect(themeIds).toContain('cyberpunk')
    expect(themeIds).toContain('sunset')
    expect(themeIds).toContain('emerald')
    expect(themeIds).toContain('ocean')
    expect(themeIds).toContain('solid-black')
    expect(themeIds).toContain('solid-red')
    expect(themeIds).toContain('minimal-white')
    expect(themeIds).toContain('minimal-black')
    expect(themeIds).toContain('minimal-cream')

    const minimalThemes = LYRIC_CARD_THEMES.filter((t) => t.category === 'minimal')
    expect(minimalThemes.length).toBe(3)
  })

  it('retrieves fallback theme when invalid theme id is provided', () => {
    const fallbackTheme = getThemeById('non-existent-id')
    expect(fallbackTheme).toBeDefined()
    expect(fallbackTheme.id).toBe('dominant')
  })

  it('calculates optimal font size scaling based on line count and character length', () => {
    // 1 short line -> larger font
    const size1 = calculateOptimalFontSize(['Anh yêu em'])
    // 5 long lines -> scaled down font
    const size5 = calculateOptimalFontSize([
      'Dẫu cho mai sau đời muôn vàn trắc trở gian nan',
      'Thì anh vẫn sẽ luôn ở đây bên cạnh em',
      'Cùng em đi qua bao bão giông cuộc đời',
      'Đến tận cùng những tháng ngày bình yên',
      'Yêu em hơn cả chính bản thân anh',
    ])

    expect(size1).toBeGreaterThanOrEqual(size5)
    expect(size5).toBeGreaterThanOrEqual(46) // Minimum readable font size on 1080x1920
    expect(size1).toBeLessThanOrEqual(98) // Maximum hero font size
  })

  it('wraps text into multiple lines when exceeding maxWidth using a mock measureText', () => {
    const mockCtx = {
      measureText: (text: string) => ({
        width: text.length * 20, // 20px per character
      }),
    } as unknown as CanvasRenderingContext2D

    const singleLongLine = 'Dẫu cho mai sau đời muôn vàn trắc trở gian nan ta vẫn bên nhau'
    const maxWidth = 300 // Allows max 15 chars per line

    const wrapped = wrapCanvasText(mockCtx, singleLongLine, maxWidth)
    expect(wrapped.length).toBeGreaterThan(1)
    expect(wrapped.join(' ')).toBe(singleLongLine)
  })

  it('calculates block startX correctly to center the lyrics bounding box while maintaining left-alignment', () => {
    // Canvas is 1080px wide
    // Line widths: 400px, 600px, 500px -> max is 600px
    // Centered startX should be (1080 - 600) / 2 = 240px
    const startX = calculateLyricsBlockStartX([400, 600, 500], 1080, 110)
    expect(startX).toBe(240)

    // Very wide lines (e.g. 980px) -> capped at minMargin 110px
    const wideStartX = calculateLyricsBlockStartX([980, 950], 1080, 110)
    expect(wideStartX).toBe(110)

    // Empty lines array fallback
    expect(calculateLyricsBlockStartX([], 1080, 110)).toBe(110)
  })

  it('calculates compact card height tailored to 1-5 lines on 1080px Story width without empty gaps', () => {
    // 1 line with 92px font
    const h1 = calculateCompactCardHeight(1, 92, 460, 110)
    expect(h1).toBeLessThan(800)
    expect(h1).toBeGreaterThan(650)

    // 5 lines with 56px font
    const h5 = calculateCompactCardHeight(5, 56, 460, 110)
    expect(h5).toBeLessThan(1100)
    expect(h5).toBeGreaterThan(h1)
  })

  describe('toggleContiguousLyricLine', () => {
    it('initializes single line when empty', () => {
      const res = toggleContiguousLyricLine([], 3, 5)
      expect(res.nextIndices).toEqual([3])
    })

    it('expands contiguous range upwards and downwards within 5 lines limit', () => {
      // Expand downwards
      const res1 = toggleContiguousLyricLine([3], 4, 5)
      expect(res1.nextIndices).toEqual([3, 4])

      // Expand to range [3..6] (4 lines)
      const res2 = toggleContiguousLyricLine([3, 4], 6, 5)
      expect(res2.nextIndices).toEqual([3, 4, 5, 6])

      // Expand upwards: [3, 4, 5, 6] -> click 2 -> [2, 3, 4, 5, 6] (5 lines)
      const res3 = toggleContiguousLyricLine([3, 4, 5, 6], 2, 5)
      expect(res3.nextIndices).toEqual([2, 3, 4, 5, 6])
    })

    it('shrinks contiguous range when clicking edges or inside', () => {
      // Unselecting top edge
      const res1 = toggleContiguousLyricLine([2, 3, 4, 5, 6], 2, 5)
      expect(res1.nextIndices).toEqual([3, 4, 5, 6])

      // Unselecting bottom edge
      const res2 = toggleContiguousLyricLine([3, 4, 5, 6], 6, 5)
      expect(res2.nextIndices).toEqual([3, 4, 5])

      // Clicking middle line 4 -> shrinks range to [3, 4]
      const res3 = toggleContiguousLyricLine([3, 4, 5], 4, 5)
      expect(res3.nextIndices).toEqual([3, 4])
    })

    it('prevents deselecting the only remaining line', () => {
      const res = toggleContiguousLyricLine([3], 3, 5)
      expect(res.nextIndices).toEqual([3])
      expect(res.reason).toBe('min_required')
    })

    it('resets selection to clicked line when clicked line is not contiguous or exceeds 5 lines', () => {
      // Range is [2, 3, 4, 5, 6], user clicks far away at 15
      const res = toggleContiguousLyricLine([2, 3, 4, 5, 6], 15, 5)
      expect(res.nextIndices).toEqual([15])
      expect(res.reason).toBe('reset')
    })
  })
})
