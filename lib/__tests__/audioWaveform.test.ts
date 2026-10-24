import { describe, expect, it } from 'vitest'
import { waveformPeaks } from '../audioWaveform'

describe('waveformPeaks', () => {
  it('preserves the relative peaks and normalizes amplitude', () => {
    expect(waveformPeaks(new Float32Array([0, -.25, .5, 0, -1, 0]), 3)).toEqual([.25, .5, 1])
  })

  it('handles silent and shorter-than-display audio without invalid values', () => {
    expect(waveformPeaks(new Float32Array(8), 4)).toEqual([0, 0, 0, 0])
    const peaks = waveformPeaks(new Float32Array([.5]), 4)
    expect(peaks).toHaveLength(4)
    expect(peaks.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
    expect(waveformPeaks(new Float32Array(), 4)).toEqual([0, 0, 0, 0])
  })
})
