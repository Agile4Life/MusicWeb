import { describe, expect, it } from 'vitest'
import { flattenUnifiedSearchResults, mergePrimarySearchResults } from '../searchFlow'
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
  audius: [],
  itunes: [],
  spotify: [],
  nhaccuatui: [],
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
})
