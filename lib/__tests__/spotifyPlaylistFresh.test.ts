import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSpotifyPlaylistTracks } from '../spotify'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Spotify playlist freshness', () => {
  it('bypasses fetch cache for daily charts while retaining import defaults', async () => {
    const entity = { name: 'Chart', trackList: [{ uri: 'spotify:track:today', title: 'Today', subtitle: 'Artist', duration: 180000 }] }
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { entity } } })}</script>`))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchSpotifyPlaylistTracks('chart', { fresh: true })).toHaveLength(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('next')
    await fetchSpotifyPlaylistTracks('import')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ next: { revalidate: 60 } })
  })

  it('also bypasses cache when the chart falls back to the official API', async () => {
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'client')
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'secret')
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes('/embed/')) return new Response('', { status: 503 })
      if (url.includes('/api/token')) return Response.json({ access_token: 'token', expires_in: 3600 })
      return Response.json({ total: 1, items: [{ track: { id: 'fresh', name: 'Today', artists: [{ name: 'Artist' }] } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchSpotifyPlaylistTracks('chart', { fresh: true })).toHaveLength(1)
    const request = fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/playlists/'))
    expect(request?.[1]).toMatchObject({ cache: 'no-store' })
    expect(request?.[1]).not.toHaveProperty('next')
  })
})
