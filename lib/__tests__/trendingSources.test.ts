import { afterEach, describe, expect, it, vi } from 'vitest'

const { playlist } = vi.hoisted(() => ({ playlist: vi.fn() }))
vi.mock('@/lib/spotify', () => ({ fetchSpotifyPlaylistTracks: playlist }))

describe('daily chart source', () => {
  afterEach(() => vi.clearAllMocks())

  it.each([
    ['all', '37i9dQZEVXbMDoHDwVN2tF'],
    ['vietnamese', '37i9dQZEVXbLdGSmz6xilI'],
    ['usuk', '37i9dQZEVXbLRQDuF5jeBp'],
    ['korean', '37i9dQZEVXbNxXF4SkHj9F'],
    ['chinese', '37i9dQZEVXbMnZEatlMSiu'],
    ['japanese', '37i9dQZEVXbKXQ4mDTEBXq'],
  ])('loads the current %s chart without transport caching', async (category, id) => {
    playlist.mockResolvedValue([{ spotify_id: 'song', title: 'Today', artist: 'Artist', album: 'Album', duration: 180, cover_url: null, isrc: null }])
    const { fetchDailySpotifyChartTracks } = await import('../trendingSources')
    const tracks = await fetchDailySpotifyChartTracks(category)
    expect(playlist).toHaveBeenCalledWith(id, { fresh: true })
    expect(tracks[0]).toMatchObject({ id: 'spotify-song', title: 'Today', source: 'spotify', spotify_id: 'song' })
  })

  it('strips generic Spotify chart banner URLs if present on chart tracks', async () => {
    playlist.mockResolvedValue([
      {
        spotify_id: '2sFepQNyl1WjpROruP8bJ0',
        title: 'Housewife',
        artist: 'Tate McRae',
        album: '',
        duration: 209,
        cover_url: 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_global_default.jpg',
        isrc: null,
      },
    ])
    const { fetchDailySpotifyChartTracks } = await import('../trendingSources')
    const tracks = await fetchDailySpotifyChartTracks('all')
    expect(tracks[0].cover_url).toBeNull()
  })

  it('filters out non-Vietnamese tracks from the vietnamese regional chart', async () => {
    playlist.mockResolvedValue([
      {
        spotify_id: '2HRgqmZQC0MC7GeNuDIXHN',
        title: 'Seven (feat. Latto) (Explicit Ver.)',
        artist: 'Jung Kook, Latto',
        album: 'Golden',
        duration: 184,
        cover_url: 'https://i.scdn.co/image/seven',
        isrc: null,
      },
      {
        spotify_id: '6ELX356o21U28T73ZxruUj',
        title: 'Tìm Em (feat. Bảo Anh)',
        artist: 'Hngle, Bảo Anh',
        album: 'Tìm Em',
        duration: 210,
        cover_url: 'https://i.scdn.co/image/tim-em',
        isrc: null,
      },
      {
        spotify_id: '6n2xOcqQrNOY0IfgATSwWs',
        title: 'Wrong Times',
        artist: 'YoungPuppy, Dangrangto',
        album: 'Wrong Times',
        duration: 195,
        cover_url: 'https://i.scdn.co/image/wrong-times',
        isrc: null,
      },
      {
        spotify_id: '3bgnrHHwyYRtz3ykzAVImy',
        title: 'Tarantino',
        artist: 'LISA',
        album: 'Alter Ego',
        duration: 175,
        cover_url: 'https://i.scdn.co/image/tarantino',
        isrc: null,
      },
    ])
    const { fetchDailySpotifyChartTracks } = await import('../trendingSources')
    const tracks = await fetchDailySpotifyChartTracks('vietnamese')
    expect(tracks.map((t) => t.title)).toEqual([
      'Tìm Em (feat. Bảo Anh)',
      'Wrong Times',
    ])
  })
})
