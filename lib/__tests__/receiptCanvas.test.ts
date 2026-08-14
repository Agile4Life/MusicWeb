import { describe, it, expect } from 'vitest'
import {
  RECEIPT_THEMES,
  getReceiptThemeById,
  formatReceiptDuration,
  formatTotalDuration,
  calculateReceiptHeight,
  ReceiptTrackItem,
} from '../receiptCanvas'

describe('receiptCanvas Engine', () => {
  it('defines 3 distinct receipt paper themes', () => {
    expect(RECEIPT_THEMES.length).toBe(3)
    const themeIds = RECEIPT_THEMES.map((t) => t.id)
    expect(themeIds).toContain('classic')
    expect(themeIds).toContain('midnight')
    expect(themeIds).toContain('cafe')
  })

  it('retrieves fallback theme when invalid theme id is provided', () => {
    const fallbackTheme = getReceiptThemeById('unknown-theme')
    expect(fallbackTheme).toBeDefined()
    expect(fallbackTheme.id).toBe('classic')
  })

  it('formats track duration properly to mm:ss', () => {
    expect(formatReceiptDuration(125)).toBe('02:05')
    expect(formatReceiptDuration(240)).toBe('04:00')
    expect(formatReceiptDuration(0)).toBe('03:20') // fallback default
    expect(formatReceiptDuration(null)).toBe('03:20')
  })

  it('calculates total duration across multiple tracks', () => {
    const tracks: ReceiptTrackItem[] = [
      { id: '1', title: 'Song 1', duration: 180 }, // 3:00
      { id: '2', title: 'Song 2', duration: 240 }, // 4:00
      { id: '3', title: 'Song 3', duration: 60 },  // 1:00
    ]
    // Total = 480s = 8:00
    expect(formatTotalDuration(tracks)).toBe('08:00')
  })

  it('formats total duration with hours when exceeding 60 minutes', () => {
    const tracks: ReceiptTrackItem[] = [
      { id: '1', title: 'Long Song 1', duration: 2000 },
      { id: '2', title: 'Long Song 2', duration: 2000 },
    ]
    // Total = 4000s = 01:06:40
    expect(formatTotalDuration(tracks)).toBe('01:06:40')
  })

  it('calculates receipt dynamic height proportionally based on track count', () => {
    const h5 = calculateReceiptHeight(5)
    const h10 = calculateReceiptHeight(10)
    const h20 = calculateReceiptHeight(20)

    expect(h5).toBeGreaterThan(600)
    expect(h10).toBeGreaterThan(h5)
    expect(h20).toBeGreaterThan(h10)
  })
})
