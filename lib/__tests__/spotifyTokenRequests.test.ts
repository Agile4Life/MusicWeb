import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Spotify token request ownership', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'test-client')
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'test-secret')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('shares a token request across simultaneous provider operations and caches the token', async () => {
    let finish!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const { getSpotifyAccessToken } = await import('../spotify')

    const requests = Array.from({ length: 8 }, () => getSpotifyAccessToken())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    finish(Response.json({ access_token: 'shared-token', expires_in: 3600 }))

    expect(await Promise.all(requests)).toEqual(Array(8).fill('shared-token'))
    expect(await getSpotifyAccessToken()).toBe('shared-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('releases a failed shared request so the next lookup can recover', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValue(Response.json({ access_token: 'recovered-token', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchMock)
    const { getSpotifyAccessToken } = await import('../spotify')

    expect(await Promise.all([getSpotifyAccessToken(), getSpotifyAccessToken()])).toEqual([null, null])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await getSpotifyAccessToken()).toBe('recovered-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refreshes an expired token instead of sharing the old completed request', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'old-token', expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'new-token', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchMock)
    const { getSpotifyAccessToken } = await import('../spotify')

    expect(await getSpotifyAccessToken()).toBe('old-token')
    vi.spyOn(Date, 'now').mockReturnValue(5_000_000)
    expect(await getSpotifyAccessToken()).toBe('new-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
