import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/spotify', () => ({ fetchSpotifyNewReleases: vi.fn(async () => makeAlbums('spotify', 40)) }))

function makeAlbums(source: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${source}-${i}`, name: `${source} album ${i}`, artist: `${source} artist`, cover_url: null,
    release_date: '', total_tracks: 12, album_type: 'album',
  }))
}

describe('mixed new release upstream budget', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fills the 60-album mixed feed without four extra Deezer artist searches', async () => {
    const chart = makeAlbums('deezer', 50).map((album, i) => ({
      id: i + 1, title: album.name, artist: { name: album.artist }, nb_tracks: 12,
    }))
    const fetchMock = vi.fn(async (url: string) => Response.json({ data: url.includes('/chart/') ? chart : [] }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../new-releases/route')

    const response = await GET()
    const albums = await response.json()
    expect(albums).toHaveLength(60)
    expect(new Set(albums.map((album: { id: string }) => album.id)).size).toBe(60)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/chart/0/albums')
  })
})
