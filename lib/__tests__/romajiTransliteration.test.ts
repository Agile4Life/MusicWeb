import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLyricsRomaji } from '../romajiTransliteration'

describe('fetchLyricsRomaji', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not call the API when no line has CJK characters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const result = await fetchLyricsRomaji(['Em ơi Hà Nội phố', 'Ta còn em'])
    expect(result).toEqual(['', ''])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls the API when any line has kana or kanji', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ romaji: ['', 'sakura'] }), { status: 200 })
    )
    const result = await fetchLyricsRomaji(['intro', 'さくら'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(['', 'sakura'])
  })
})
