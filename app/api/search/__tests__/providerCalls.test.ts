import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@/types'

const providers = vi.hoisted(() => ({
  nct: vi.fn(), spotify: vi.fn(), deezer: vi.fn(), youtube: vi.fn(), soundcloud: vi.fn(), local: vi.fn(),
}))
const trendingProviders = vi.hoisted(() => ({
  spotifyArtists: vi.fn(), deezerArtists: vi.fn(), deezerChart: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: providers.local }))
vi.mock('@/lib/nhaccuatui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/nhaccuatui')>(), searchNhacCuaTuiDirect: providers.nct,
}))
vi.mock('@/lib/spotify', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/spotify')>(),
  searchSpotifyTracks: providers.spotify,
  getTopArtistSpotifyTracks: trendingProviders.spotifyArtists,
}))
vi.mock('@/lib/deezer', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/deezer')>(),
  searchDeezerTracks: providers.deezer,
  getTopArtistDeezerTracks: trendingProviders.deezerArtists,
  getTrendingDeezerTracks: trendingProviders.deezerChart,
}))
vi.mock('@/lib/youtube', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/youtube')>(), searchYouTubeTracks: providers.youtube,
}))
vi.mock('@/lib/soundcloudClient', () => ({ searchSoundCloudTracks: providers.soundcloud }))

describe('search upstream provider budget', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    for (const provider of [providers.nct, providers.spotify, providers.deezer, providers.youtube, providers.soundcloud, ...Object.values(trendingProviders)]) {
      provider.mockResolvedValue([])
    }
    providers.local.mockResolvedValue({ from: () => ({ select: () => ({ or: () => ({ limit: async () => ({ data: [] }) }) }) }) })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ data: [] })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['spotify', 'deezer'] as const)('does not search YouTube for a %s-only request', async (source) => {
    const track = { id: `${source}-1`, title: 'Daylight', artist: 'Taylor Swift', source } as Track
    providers[source].mockResolvedValue([track])
    const { GET } = await import('../route')
    const response = await GET(new Request(`https://music.test/api/search?q=Daylight&source=${source}`))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result[source]).toMatchObject([track])
    expect(result.youtube).toEqual([])
    expect(result).not.toHaveProperty('itunes')
    expect(result).not.toHaveProperty('audius')
    expect(providers.youtube).not.toHaveBeenCalled()
    expect(providers.nct).not.toHaveBeenCalled()
    expect(providers.soundcloud).not.toHaveBeenCalled()
  })

  it('keeps all providers for an all-source request', async () => {
    const { GET } = await import('../route')
    const response = await GET(new Request('https://music.test/api/search?q=Daylight&source=all'))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).not.toHaveProperty('itunes')
    expect(result).not.toHaveProperty('audius')
    for (const provider of Object.values(providers)) expect(provider).toHaveBeenCalledOnce()
  })

  it('searches only playable providers during playback recovery', async () => {
    const { GET } = await import('../route')
    const response = await GET(new Request('https://music.test/api/search?q=Daylight&source=playback'))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).not.toHaveProperty('itunes')
    expect(result).not.toHaveProperty('audius')
    for (const provider of [providers.nct, providers.youtube, providers.soundcloud]) {
      expect(provider).toHaveBeenCalledOnce()
    }
    for (const provider of [providers.spotify, providers.deezer, providers.local]) {
      expect(provider).not.toHaveBeenCalled()
    }
  })

  it.each([
    ['local', 'local'],
    ['nhaccuatui', 'nct'],
    ['youtube', 'youtube'],
    ['soundcloud', 'soundcloud'],
  ] as const)('searches only the requested provider for source=%s', async (source, providerName) => {
    const track = { id: `${source}-1`, title: 'Daylight', artist: 'Taylor Swift', source } as Track
    if (providerName === 'local') {
      providers.local.mockResolvedValue({ from: () => ({ select: () => ({ or: () => ({ limit: async () => ({ data: [track] }) }) }) }) })
    } else {
      providers[providerName].mockResolvedValue([track])
    }
    const { GET } = await import('../route')
    const response = await GET(new Request(`https://music.test/api/search?q=Daylight&source=${source}`))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result[source]).toMatchObject([track])
    expect(result).not.toHaveProperty('itunes')
    expect(result).not.toHaveProperty('audius')
    for (const [name, provider] of Object.entries(providers)) {
      if (name === providerName) expect(provider).toHaveBeenCalledOnce()
      else expect(provider).not.toHaveBeenCalled()
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['itunes', 'q=Daylight'],
    ['audius', 'q=Daylight'],
    ['itunes', 'trending=true'],
    ['audius', 'trending=true'],
    ['itunes', ''],
    ['audius', ''],
  ])('rejects retired source=%s before provider work (%s)', async (source, params) => {
    const { GET } = await import('../route')
    const response = await GET(new Request(`https://music.test/api/search?source=${source}&${params}`))

    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty('error')
    for (const provider of [...Object.values(providers), ...Object.values(trendingProviders)]) {
      expect(provider).not.toHaveBeenCalled()
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['local', 'all'])(
    'migrates retired database tracks before assigning local search sources (%s)',
    async (source) => {
      const storedRetiredTrack = Object.freeze({
        id: '928d6866-f0a2-45f6-8b22-911404941433',
        user_id: 'test',
        title: 'Daylight',
        artist: 'Legacy Artist',
        duration: 220,
        source: 'audius',
        file_path: 'https://discovery.private-node.example/media/recording-42',
        audio_url: 'https://discovery.private-node.example/media/recording-42',
        cover_url: null,
        created_at: '2026-08-10T00:00:00.000Z',
      })
      const storedSupportedTrack = Object.freeze({
        id: '60a2452a-c1aa-4927-9e6c-337b268e06d8',
        user_id: 'test',
        title: 'Daylight Upload',
        artist: 'Local Artist',
        duration: 220,
        source: 'spotify',
        file_path: 'https://storage.music.test/uploads/daylight.mp3',
        spotify_album_id: 'itunes-123',
        source_url: 'https://music.apple.com/us/album/daylight/123',
        cover_url: null,
        created_at: '2026-08-10T00:00:00.000Z',
      })
      const originalRetiredTrack = { ...storedRetiredTrack }
      const originalSupportedTrack = { ...storedSupportedTrack }
      providers.local.mockResolvedValue({ from: () => ({ select: () => ({ or: () => ({
        limit: async () => ({ data: [storedRetiredTrack, storedSupportedTrack] }),
      }) }) }) })
      const { GET } = await import('../route')

      const response = await GET(new Request(`https://music.test/api/search?q=Daylight&source=${source}`))
      const result = await response.json()
      const migrated = result.local.find((track: Track) => track.id === storedRetiredTrack.id)
      const supported = result.local.find((track: Track) => track.id === storedSupportedTrack.id)

      expect(response.status).toBe(200)
      expect(migrated).toMatchObject({
        id: '928d6866-f0a2-45f6-8b22-911404941433',
        title: 'Daylight',
        artist: 'Legacy Artist',
        source: 'spotify',
        file_path: '',
      })
      expect(migrated).not.toHaveProperty('audio_url')
      expect(supported).toMatchObject({
        source: 'local',
        file_path: 'https://storage.music.test/uploads/daylight.mp3',
      })
      expect(supported).not.toHaveProperty('spotify_album_id')
      expect(supported).not.toHaveProperty('source_url')
      expect(storedRetiredTrack).toEqual(originalRetiredTrack)
      expect(storedSupportedTrack).toEqual(originalSupportedTrack)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['vietnamese', 'usuk', 'korean', 'chinese', 'japanese', 'all'])(
    'does not contact retired providers when %s trending catalogs are empty',
    async (category) => {
      const { GET } = await import('../route')
      const response = await GET(new Request(`https://music.test/api/search?trending=true&category=${category}`))
      const result = await response.json()

      expect(response.status).toBe(200)
      // The only direct transport is the NCT chart for these two categories.
      expect(fetch).toHaveBeenCalledTimes(category === 'vietnamese' || category === 'all' ? 1 : 0)
      const urls = vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)))
      expect(urls.map((url) => url.pathname)).toEqual(category === 'vietnamese' || category === 'all' ? ['/api/chart'] : [])
      expect(result.spotify).toEqual([])
      expect(result).not.toHaveProperty('itunes')
      expect(result).not.toHaveProperty('audius')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    },
  )

  it('returns only supported groups for an empty query without provider work', async () => {
    const { GET } = await import('../route')
    const response = await GET(new Request('https://music.test/api/search?q= '))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).not.toHaveProperty('itunes')
    expect(result).not.toHaveProperty('audius')
    for (const provider of Object.values(providers)) expect(provider).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
