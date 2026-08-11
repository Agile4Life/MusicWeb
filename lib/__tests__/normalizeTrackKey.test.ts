import { describe, it, expect } from 'vitest'
import {
  normalizeTrackField,
  durationBucket,
  normalizeTrackKey,
} from '../normalizeTrackKey'

describe('normalizeTrackField', () => {
  it('lowercases and trims', () => {
    expect(normalizeTrackField('  Hello World  ')).toBe('hello world')
  })

  it('strips parenthetical suffixes (Official Video, Lyric Video, MV)', () => {
    expect(normalizeTrackField('Em Của Ngày Hôm Qua (Official MV)')).toBe('em cua ngay hom qua')
    expect(normalizeTrackField('See You Again [Lyric Video]')).toBe('see you again')
    expect(normalizeTrackField('Bad Guy (Audio)')).toBe('bad guy')
  })

  it('removes Vietnamese diacritics for key normalization', () => {
    expect(normalizeTrackField('Đường Một Chiều')).toBe('duong mot chieu')
    expect(normalizeTrackField('Có Chắc Yêu Là Đây')).toBe('co chac yeu la day')
  })

  it('strips feat./ft. and everything after', () => {
    expect(normalizeTrackField('Song feat. Artist B')).toBe('song')
    expect(normalizeTrackField('Song ft. Artist B')).toBe('song')
    expect(normalizeTrackField('Song (feat. Someone)')).toBe('song')
  })

  it('collapses multiple whitespace', () => {
    expect(normalizeTrackField('hello   world   foo')).toBe('hello world foo')
  })

  it('handles empty/null input', () => {
    expect(normalizeTrackField('')).toBe('')
    expect(normalizeTrackField(null as any)).toBe('')
    expect(normalizeTrackField(undefined as any)).toBe('')
  })

  it('strips punctuation (dashes, commas, dots, colons)', () => {
    expect(normalizeTrackField('hello - world: foo, bar.')).toBe('hello world foo bar')
  })
})

describe('durationBucket', () => {
  it('rounds to nearest 5 seconds', () => {
    expect(durationBucket(182)).toBe(180) // 3:02 → 3:00
    expect(durationBucket(183)).toBe(185) // 3:03 → 3:05
    expect(durationBucket(200)).toBe(200) // exact
    expect(durationBucket(0)).toBe(0)
  })

  it('returns 0 for undefined/null/NaN', () => {
    expect(durationBucket(undefined as any)).toBe(0)
    expect(durationBucket(NaN)).toBe(0)
    expect(durationBucket(null as any)).toBe(0)
  })

  it('absorbs ±2s variance between same song on different sources', () => {
    // 238 and 240 both → 240
    expect(durationBucket(238)).toBe(240)
    expect(durationBucket(240)).toBe(240)
    // 241 → 240, 243 → 245
    expect(durationBucket(241)).toBe(240)
    expect(durationBucket(243)).toBe(245)
  })
})

describe('normalizeTrackKey', () => {
  it('produces deterministic key from title + artist + duration', () => {
    const key = normalizeTrackKey('Em Của Ngày Hôm Qua', 'Sơn Tùng M-TP', 240)
    expect(key).toBe('em cua ngay hom qua___son tung m tp___240')
  })

  it('same song with different casing/diacritics → same key', () => {
    const k1 = normalizeTrackKey('em cua ngay hom qua', 'son tung m-tp', 240)
    const k2 = normalizeTrackKey('Em Của Ngày Hôm Qua', 'Sơn Tùng M-TP', 241)
    expect(k1).toBe(k2)
  })

  it('different songs → different keys', () => {
    const k1 = normalizeTrackKey('Lạc Trôi', 'Sơn Tùng M-TP', 260)
    const k2 = normalizeTrackKey('Em Của Ngày Hôm Qua', 'Sơn Tùng M-TP', 240)
    expect(k1).not.toBe(k2)
  })

  it('live/remix with different duration → different bucket → different key', () => {
    const original = normalizeTrackKey('Shape of You', 'Ed Sheeran', 234)
    const liveVersion = normalizeTrackKey('Shape of You', 'Ed Sheeran', 312)
    expect(original).not.toBe(liveVersion)
  })

  it('without duration → bucket is 0', () => {
    const key = normalizeTrackKey('Hello', 'Adele')
    expect(key).toContain('___0')
  })
})
