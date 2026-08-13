import { describe, expect, it } from 'vitest'

import { deriveAccentFromPixels } from '../coverColor'

describe('deriveAccentFromPixels', () => {
  it('returns the dominant saturated color as an rgb value', () => {
    const pixels = new Uint8ClampedArray([
      220, 40, 40, 255,
      210, 35, 35, 255,
      30, 30, 30, 255,
    ])

    expect(deriveAccentFromPixels(pixels, 'rgb(6 182 212)')).toBe('rgb(215 38 38)')
  })

  it('falls back when pixels are transparent or neutral', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 0,
      245, 245, 245, 255,
      18, 18, 18, 255,
    ])

    expect(deriveAccentFromPixels(pixels, 'rgb(6 182 212)')).toBe('rgb(6 182 212)')
  })
})
