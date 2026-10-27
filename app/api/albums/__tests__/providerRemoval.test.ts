import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  spotifyMeta: vi.fn(),
  spotifyTracks: vi.fn(),
  spotifyReleases: vi.fn(),
  dbAlbums: [] as Record<string, unknown>[],
  dbTracks: [] as Record<string, unknown>[],
  idLookups: [] as string[][],
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/spotify', () => ({
  fetchSpotifyAlbumMeta: mocks.spotifyMeta,
  fetchFullAlbumTracks: mocks.spotifyTracks,
  fetchSpotifyNewReleases: mocks.spotifyReleases,
}))

function album(id: string, name = 'Studio Record') {
  return { id, name, artist: 'Test Artist', cover_url: null, release_date: '', total_tracks: 2, album_type: 'album' }
}

function rawDeezerAlbum(id = 200) {
  return {
    id, title: 'Studio Record', artist: { name: 'Test Artist' }, nb_tracks: 2, record_type: 'album',
    tracks: { data: [{ id: 201, title: 'First Song', track_position: 1 }, { id: 202, title: 'Second Song', track_position: 2 }] },
  }
}

function request(path: string) {
  return new NextRequest(`http://localhost${path}`)
}

function databaseClient() {
  return {
    from: vi.fn((table: string) => {
      const query: Record<string, ReturnType<typeof vi.fn>> = {}
      for (const method of ['select', 'or', 'not', 'ilike', 'eq', 'is', 'update']) {
        query[method] = vi.fn(() => query)
      }
      query.in = vi.fn((_column: string, ids: string[]) => {
        mocks.idLookups.push(ids)
        return query
      })
      query.limit = vi.fn(async () => ({ data: table === 'spotify_albums' ? mocks.dbAlbums : mocks.dbTracks }))
      query.upsert = vi.fn(async () => ({ error: null }))
      return query
    }),
  }
}

describe('album providers after retiring Audius and iTunes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
    mocks.dbAlbums = []
    mocks.dbTracks = []
    mocks.idLookups = []
    mocks.createClient.mockImplementation(databaseClient)
    mocks.spotifyMeta.mockResolvedValue(null)
    mocks.spotifyTracks.mockResolvedValue([])
    mocks.spotifyReleases.mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('keeps Spotify releases available when Deezer fails without requesting a retired chart', async () => {
    mocks.spotifyReleases.mockResolvedValue([album('spotify-current')])
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({}, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../new-releases/route')

    expect(await (await GET()).json()).toEqual([album('spotify-current')])
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('https://api.deezer.com/'))).toBe(true)
  })

  it('keeps Deezer releases available when Spotify fails', async () => {
    mocks.spotifyReleases.mockRejectedValue(new Error('Spotify unavailable'))
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ data: [rawDeezerAlbum()] }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../new-releases/route')

    const result = await (await GET()).json()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: '200', name: 'Studio Record' })
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('https://api.deezer.com/'))).toBe(true)
  })

  it('searches Deezer while excluding retired database albums', async () => {
    mocks.dbAlbums = [album('itunes-200', 'Retired iTunes'), album('audius-200', 'Retired Audius'), album('spotify-local', 'Saved Record')]
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ data: [rawDeezerAlbum()] }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../search/route')

    const result = await (await GET(request('/api/albums/search?q=Test'))).json()
    expect(result.map((item: { id: string }) => item.id)).toEqual(['spotify-local', '200'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('https://api.deezer.com/search/album?')
  })

  it('returns supported database search results on provider failure without a retired fallback', async () => {
    mocks.dbAlbums = [album('spotify-local')]
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({}, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../search/route')

    expect(await (await GET(request('/api/albums/search?q=Test'))).json()).toEqual(mocks.dbAlbums)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['itunes-200', 'itunes-rss-200', 'itunes:200', 'audius-200', 'audius:200'])('rejects retired detail ID %s before database or provider work', async (id) => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({}))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../[id]/route')

    const response = await GET(request(`/api/albums/${id}`), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(410)
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.spotifyMeta).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves a numeric Deezer album without querying retired numeric aliases', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json(rawDeezerAlbum()))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../[id]/route')

    const response = await GET(request('/api/albums/200'), { params: Promise.resolve({ id: '200' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: '200', tracks: [{ title: 'First Song' }, { title: 'Second Song' }] })
    expect(mocks.idLookups).toEqual([['200', 'deezer-200']])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps Spotify metadata fallback to Deezer when Spotify tracks are unavailable', async () => {
    mocks.spotifyMeta.mockResolvedValue(album('spotify-current'))
    const fetchMock = vi.fn(async (url: string) => Response.json(url.includes('/search/album?') ? { data: [rawDeezerAlbum()] } : rawDeezerAlbum()))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../[id]/route')

    const response = await GET(request('/api/albums/spotify-current'), { params: Promise.resolve({ id: 'spotify-current' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'spotify-current', name: 'Studio Record', tracks: [{ title: 'First Song' }, { title: 'Second Song' }] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith('https://api.deezer.com/'))).toBe(true)
  })

  it('returns a missing numeric album without attempting an iTunes collection lookup', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({}, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../[id]/route')

    const response = await GET(request('/api/albums/400'), { params: Promise.resolve({ id: '400' }) })
    expect(response.status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deezer.com/album/400')
  })

  it('ignores retired cached album metadata during detail fallback', async () => {
    mocks.dbAlbums = [{ ...album('itunes-400'), tracks: [{ id: 'legacy-track', title: 'First Song', track_number: 1 }, { id: 'legacy-track-2', title: 'Second Song', track_number: 2 }] }]
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({}, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../[id]/route')

    const response = await GET(request('/api/albums/400'), { params: Promise.resolve({ id: '400' }) })
    expect(response.status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['itunes-200', 'audius-200'])('ignores retired cached track album %s during resolve', async (id) => {
    mocks.dbTracks = [{ title: 'First Song', artist: 'Test Artist', album: 'Retired Record', spotify_album_id: id }]
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ data: [{ title: 'First Song', artist: { name: 'Test Artist' }, album: { id: 200, title: 'Studio Record', nb_tracks: 2, record_type: 'album' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../resolve/route')

    const result = await (await GET(request('/api/albums/resolve?title=First%20Song&artist=Test%20Artist'))).json()
    expect(result).toMatchObject({ albumId: '200', albumName: 'Studio Record' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores retired cached album rows and keeps direct Deezer album resolve', async () => {
    mocks.dbAlbums = [album('itunes-200')]
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ data: [rawDeezerAlbum()] }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../resolve/route')

    const result = await (await GET(request('/api/albums/resolve?title=First%20Song&artist=Test%20Artist&album=Studio%20Record'))).json()
    expect(result).toMatchObject({ albumId: '200', albumName: 'Studio Record' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops unresolved metadata searches after Deezer without requesting retired search APIs', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ data: [], results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('../resolve/route')

    const response = await GET(request('/api/albums/resolve?title=First%20Song&artist=Test%20Artist'))
    expect(response.status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('https://api.deezer.com/'))).toBe(true)
  })
})
