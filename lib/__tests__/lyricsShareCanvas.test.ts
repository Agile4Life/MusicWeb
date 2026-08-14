import { describe, it, expect } from 'vitest'
import {
  LYRIC_CARD_THEMES,
  wrapCanvasText,
  calculateOptimalFontSize,
  getThemeById,
} from '../lyricsShareCanvas'

describe('lyricsShareCanvas Engine', () => {
  it('defines 5 distinct lyric card themes', () => {
    expect(LYRIC_CARD_THEMES.length).toBe(5)
    const themeIds = LYRIC_CARD_THEMES.map((t) => t.id)
    expect(themeIds).toContain('dominant')
    expect(themeIds).toContain('midnight')
    expect(themeIds).toContain('cyberpunk')
    expect(themeIds).toContain('sunset')
    expect(themeIds).toContain('emerald')
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
    expect(size5).toBeGreaterThanOrEqual(38) // Minimum readable font size on 1080x1920
    expect(size1).toBeLessThanOrEqual(84) // Maximum hero font size
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
})
