import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const artist = { id: 13, name: 'Taylor Swift', nb_fan: 1000 }

describe('Deezer artist request ownership', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shares the artist lookup needed by concurrent radio and related-track operations', async () => {
    let finishArtist!: (response: Response) => void
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/search/artist')) {
        return new Promise<Response>((resolve) => { finishArtist = resolve })
      }
      return Promise.resolve(Response.json({ data: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { getDeezerArtistRadio, getDeezerRelatedArtistsTopTracks } = await import('../deezer')

    const requests = [getDeezerArtistRadio('Taylor Swift'), getDeezerRelatedArtistsTopTracks('Taylor Swift')]
    expect(fetchMock).toHaveBeenCalledTimes(1)
    finishArtist(Response.json({ data: [artist] }))
    await Promise.all(requests)

    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/search/artist'))).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/artist/13/radio'))).toBe(true)
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/artist/13/related'))).toBe(true)
  })

  it('retries a failed lookup and continues rejecting artists with a different identity', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce(Response.json({ data: [{ ...artist, name: 'Taylor Tribute' }] }))
      .mockResolvedValueOnce(Response.json({ data: [artist] }))
    vi.stubGlobal('fetch', fetchMock)
    const { searchDeezerArtist } = await import('../deezer')

    expect(await searchDeezerArtist('Taylor Swift')).toBeNull()
    expect(await searchDeezerArtist('Taylor Swift')).toBeNull()
    expect(await searchDeezerArtist('Taylor Swift')).toMatchObject(artist)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
