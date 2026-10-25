import { describe, expect, it } from 'vitest'
import {
  customLyricsToLrclibResponse,
  formatLrcTimestamp,
  hasLrcTimestamps,
  makeCustomLyricsLookupKey,
  nudgeLineTimestamp,
  parseEditableLyricLines,
  serializeEditableLyricLines,
  stampLineAtIndex,
  stripAllLrcTimestamps,
} from '../customLyrics'

describe('customLyrics helpers', () => {
  it('formats seconds into [mm:ss.xx] LRC timestamps', () => {
    expect(formatLrcTimestamp(0)).toBe('[00:00.00]')
    expect(formatLrcTimestamp(5.234)).toBe('[00:05.23]')
    expect(formatLrcTimestamp(75.5)).toBe('[01:15.50]')
    expect(formatLrcTimestamp(-3)).toBe('[00:00.00]')
  })

  it('detects LRC timestamps and converts custom lyrics to LrclibResponse', () => {
    const track = {
      id: 'sc-123',
      title: 'Bài Hát Demo',
      artist: 'Ca Sĩ A',
      album: 'Album B',
      duration: 210,
    }

    const plainRes = customLyricsToLrclibResponse(track, 'Dòng 1\nDòng 2')
    expect(hasLrcTimestamps('Dòng 1\nDòng 2')).toBe(false)
    expect(plainRes?.plainLyrics).toBe('Dòng 1\nDòng 2')
    expect(plainRes?.syncedLyrics).toBeNull()

    const lrcText = '[00:04.50] Dòng 1\n[00:08.10] Dòng 2'
    const syncedRes = customLyricsToLrclibResponse(track, lrcText)
    expect(hasLrcTimestamps(lrcText)).toBe(true)
    expect(syncedRes?.syncedLyrics).toBe(lrcText)
    expect(syncedRes?.plainLyrics).toBeNull()
  })

  it('parses, stamps, nudges, and serializes editable lyric lines', () => {
    const raw = 'Câu mở đầu\n[00:10.00] Câu thứ hai'
    const parsed = parseEditableLyricLines(raw)
    expect(parsed).toEqual([
      { time: null, text: 'Câu mở đầu' },
      { time: 10, text: 'Câu thứ hai' },
    ])

    const stamped = stampLineAtIndex(parsed, 0, 3.45)
    expect(stamped[0]).toEqual({ time: 3.45, text: 'Câu mở đầu' })

    const nudged = nudgeLineTimestamp(stamped, 1, -0.2)
    expect(nudged[1].time).toBeCloseTo(9.8, 2)

    const serialized = serializeEditableLyricLines(nudged)
    expect(serialized).toBe('[00:03.45] Câu mở đầu\n[00:09.80] Câu thứ hai')
  })

  it('strips all LRC timestamps cleanly back to plain text', () => {
    const lrc = '[00:01.20] Câu một\n[00:05.00][00:06.00] Câu hai\nCâu ba'
    expect(stripAllLrcTimestamps(lrc)).toBe('Câu một\nCâu hai\nCâu ba')
  })

  it('creates stable lookup keys from track identifiers or title+artist', () => {
    expect(
      makeCustomLyricsLookupKey({
        title: '  Making My Way ',
        artist: 'Sơn Tùng M-TP',
        soundcloud_id: '1822834458',
      }),
    ).toContain('sc:1822834458')

    expect(
      makeCustomLyricsLookupKey({
        title: 'Making My Way',
        artist: 'Sơn Tùng M-TP',
      }),
    ).toBe('meta:making my way::sơn tùng m-tp')
  })
})

