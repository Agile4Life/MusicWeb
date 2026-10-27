import { describe, expect, it } from 'vitest'
import { combineCombinedSearchResults, flattenUnifiedSearchResults, mergePrimarySearchResults } from '../searchFlow'
import type { GlobalSearchTracks } from '../searchApi'
import type { Track } from '@/types'

const makeTrack = (id: string, source: Track['source'], title = 'Xương Rồng'): Track => ({
  id,
  user_id: 'test',
  title,
  artist: 'Dangrangto',
  duration: 220,
  file_path: '',
  cover_url: null,
  created_at: '2026-08-10T00:00:00.000Z',
  source,
})

const emptyFallback: GlobalSearchTracks = {
  local: [],
  youtube: [],
  spotify: [],
  nhaccuatui: [],
  deezer: [],
}

describe('unified search flow', () => {
  it('puts NCT results first and keeps fallback data behind them', () => {
    const nctTrack = makeTrack('nct-1', 'nhaccuatui')
    const youtubeTrack = makeTrack('yt-1', 'youtube', 'Bài khác')

    const merged = mergePrimarySearchResults([nctTrack], {
      ...emptyFallback,
      youtube: [youtubeTrack],
    })

    expect(flattenUnifiedSearchResults(merged)).toEqual([nctTrack, youtubeTrack])
  })

  it('keeps the NCT copy when fallback providers return the same song', () => {
    const nctTrack = makeTrack('nct-1', 'nhaccuatui')
    const spotifyTrack = makeTrack('spotify-1', 'spotify', 'Xương Rồng Official Audio')

    const merged = mergePrimarySearchResults([nctTrack], {
      ...emptyFallback,
      spotify: [spotifyTrack],
    })

    expect(flattenUnifiedSearchResults(merged)).toHaveLength(1)
    expect(flattenUnifiedSearchResults(merged)[0].source).toBe('nhaccuatui')
  })

  it('ignores retired groups from older payloads when building the playable results', () => {
    const supportedTrack = makeTrack('spotify-current', 'spotify', 'Current song')
    const legacyPayload = {
      ...emptyFallback,
      spotify: [supportedTrack],
      itunes: [makeTrack('itunes-retired', 'spotify', 'Legacy preview')],
      audius: [makeTrack('audius-retired', 'spotify', 'Legacy stream')],
    }

    expect(flattenUnifiedSearchResults(legacyPayload)).toEqual([supportedTrack])
  })
})

describe('combineCombinedSearchResults', () => {
  it('deduplicates identical songs across NCT, Spotify and Deezer, keeping the NCT copy', () => {
    const nctTrack = makeTrack('nct-1', 'nhaccuatui', 'Xương Rồng')
    const spotifyTrack = makeTrack('spotify-1', 'spotify', 'Xương Rồng')
    const deezerTrack = makeTrack('deezer-1', 'spotify', 'Xương Rồng')

    const result = combineCombinedSearchResults([nctTrack], [spotifyTrack], [deezerTrack])

    expect(result.nhaccuatui).toHaveLength(1)
    expect(result.spotify).toHaveLength(0)
    expect(result.deezer).toHaveLength(0)
    expect(flattenUnifiedSearchResults(result)).toHaveLength(1)
    expect(flattenUnifiedSearchResults(result)[0].source).toBe('nhaccuatui')
    expect(result).not.toHaveProperty('itunes')
    expect(result).not.toHaveProperty('audius')
  })

  it('keeps unique tracks from all three sources', () => {
    const nctTrack = makeTrack('nct-1', 'nhaccuatui', 'Xương Rồng')
    const spotifyTrack = makeTrack('spotify-1', 'spotify', 'The Feeling')
    const deezerTrack = makeTrack('deezer-1', 'spotify', 'Dracula')

    const result = combineCombinedSearchResults([nctTrack], [spotifyTrack], [deezerTrack])

    expect(result.nhaccuatui).toHaveLength(1)
    expect(result.spotify).toHaveLength(1)
    expect(result.deezer).toHaveLength(1)
    expect(flattenUnifiedSearchResults(result)).toHaveLength(3)
  })

  it('ranks exact query matches above unrelated primary source tracks when query is provided', () => {
    const unrelatedNct = {
      ...makeTrack('nct-unrelated', 'nhaccuatui', 'Nụ Cười Xinh'),
      artist: 'Ca Sĩ A',
    }
    const exactSpotify = {
      ...makeTrack('sp-exact', 'spotify', 'Die With A Smile'),
      artist: 'Lady Gaga, Bruno Mars',
    }
    const remixNct = {
      ...makeTrack('nct-remix', 'nhaccuatui', 'Die With A Smile (Remix)'),
      artist: 'Lady Gaga, Bruno Mars',
    }

    const results: GlobalSearchTracks = {
      ...emptyFallback,
      nhaccuatui: [unrelatedNct, remixNct],
      spotify: [exactSpotify],
    }

    const ranked = flattenUnifiedSearchResults(results, 'Die With A Smile')
    expect(ranked[0].id).toBe('sp-exact')
    expect(ranked[1].id).toBe('nct-remix')
    expect(ranked[2].id).toBe('nct-unrelated')
  })

  it('preserves same-titled songs by different artists instead of collapsing them in deduplicateQueueTracks', () => {
    const babyMck = {
      ...makeTrack('drive-baby', 'local', 'Baby (feat. marzuz)'),
      artist: 'MCK',
    }
    const babyJustin = {
      ...makeTrack('sp-baby', 'spotify', 'Baby'),
      artist: 'Justin Bieber',
    }

    const results: GlobalSearchTracks = {
      ...emptyFallback,
      local: [babyMck],
      spotify: [babyJustin],
    }

    const flattened = flattenUnifiedSearchResults(results, 'Baby')
    expect(flattened.map((t) => t.id)).toContain('drive-baby')
    expect(flattened.map((t) => t.id)).toContain('sp-baby')
  })

  it('ranks combined title + artist queries accurately with Vietnamese diacritics and stage names', () => {
    const otherVu = {
      ...makeTrack('nct-lala', 'nhaccuatui', 'Lạ Lùng'),
      artist: 'Vũ.',
    }
    const otherBinhYen = {
      ...makeTrack('nct-by-other', 'nhaccuatui', 'Bình Yên Nơi Đâu'),
      artist: 'Sơn Tùng M-TP',
    }
    const targetBinhYenVu = {
      ...makeTrack('sp-by-vu', 'spotify', 'Bình Yên'),
      artist: 'Vũ.',
    }

    const results: GlobalSearchTracks = {
      ...emptyFallback,
      nhaccuatui: [otherVu, otherBinhYen],
      spotify: [targetBinhYenVu],
    }

    const ranked = flattenUnifiedSearchResults(results, 'bình yên vũ')
    expect(ranked[0].id).toBe('sp-by-vu')
  })
})


