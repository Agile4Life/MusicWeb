import { describe, expect, it } from 'vitest'
import {
  findBestNhacCuaTuiMatch,
  isValidNhacCuaTuiAudioUrl,
  nhacCuaTuiSearchItemToTrack,
  normalizeNhacCuaTuiLyrics,
  normalizeNhacCuaTuiSearchResponse,
  normalizeNhacCuaTuiSongResponse,
} from '../nhaccuatui'

describe('NhacCuaTui response normalization', () => {
  it('normalizes the search array returned by the ChillMsic backend', () => {
    expect(normalizeNhacCuaTuiSearchResponse([
      { id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto', thumbnail: 'https://img.test/cover.jpg' },
    ])).toEqual([
      { id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto', thumbnail: 'https://img.test/cover.jpg' },
    ])
  })

  it('accepts only HTTPS NCT stream URLs', () => {
    expect(isValidNhacCuaTuiAudioUrl('https://stream.nct.vn/song.mp3?st=123&e=456')).toBe(true)
    expect(isValidNhacCuaTuiAudioUrl('https://a01.nct.vn/song.mp3?st=123&e=456')).toBe(true)
    expect(isValidNhacCuaTuiAudioUrl('http://stream.nct.vn/song.mp3')).toBe(false)
    expect(isValidNhacCuaTuiAudioUrl('https://example.com/song.mp3')).toBe(false)
  })

  it('rejects song details without a usable audio URL', () => {
    expect(normalizeNhacCuaTuiSongResponse({ id: 'nct-1', title: 'X', artist: 'A' })).toBeNull()
  })

  it('normalizes NCT lyrics and removes empty placeholder content', () => {
    expect(normalizeNhacCuaTuiLyrics('<p>line one<br>line two</p>')).toBe('line one\nline two')
    expect(normalizeNhacCuaTuiLyrics('')).toBeNull()
    expect(normalizeNhacCuaTuiLyrics('Lời bài hát sẽ xuất hiện ở đây')).toBeNull()
  })

  it('maps NCT search metadata to a Track without a signed URL', () => {
    const track = nhacCuaTuiSearchItemToTrack({
      id: 'nct-1',
      title: 'Xương Rồng',
      artist: 'Dangrangto',
    })
    expect(track).toMatchObject({
      id: 'nct-nct-1',
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-1',
      file_path: '',
    })
    expect('audio_url' in track).toBe(false)
  })
})

describe('findBestNhacCuaTuiMatch', () => {
  it('selects the title and artist match over a title-only candidate', () => {
    const result = findBestNhacCuaTuiMatch([
      { id: 'wrong', title: 'Xương Rồng', artist: 'Khác' },
      { id: 'right', title: 'Xương Rồng', artist: 'Dangrangto' },
    ], { title: 'Xương Rồng', artist: 'Dangrangto', duration: 254 })

    expect(result?.id).toBe('right')
  })

  it('returns null when candidates are unrelated', () => {
    expect(findBestNhacCuaTuiMatch(
      [{ id: 'wrong', title: 'Một bài khác', artist: 'Khác' }],
      { title: 'Xương Rồng', artist: 'Dangrangto', duration: 254 },
    )).toBeNull()
  })
})
