import type { Track } from '@/types'
import { deduplicateQueueTracks } from './utils'
import type { GlobalSearchTracks } from './searchApi'

export function mergePrimarySearchResults(
  nhaccuatuiTracks: Track[],
  fallbackResults: GlobalSearchTracks,
): GlobalSearchTracks {
  return {
    ...fallbackResults,
    nhaccuatui: nhaccuatuiTracks,
  }
}

/**
 * Combine NhacCuaTui + Spotify + Deezer search results into one global result.
 * Duplicate tracks (same normalized title + artist) are kept only once —
 * deduplicateQueueTracks prefers NhacCuaTui, then local, then other sources.
 */
export function combineCombinedSearchResults(
  nhaccuatuiTracks: Track[],
  spotifyTracks: Track[],
  deezerTracks: Track[],
  soundCloudTracks: Track[] = [],
): GlobalSearchTracks {
  const combined = [nhaccuatuiTracks, spotifyTracks, deezerTracks, soundCloudTracks]
  const deduped = deduplicateQueueTracks([...nhaccuatuiTracks, ...spotifyTracks, ...deezerTracks, ...soundCloudTracks])
  const idSets = combined.map((list) => new Set(list.map((t) => t.id)))

  return {
    nhaccuatui: deduped.filter((t) => idSets[0].has(t.id)),
    spotify: deduped.filter((t) => idSets[1].has(t.id)),
    deezer: deduped.filter((t) => idSets[2].has(t.id)),
    soundcloud: deduped.filter((t) => idSets[3].has(t.id)),
    local: [],
    youtube: [],
    itunes: [],
    audius: [],
  }
}

export function flattenUnifiedSearchResults(results: GlobalSearchTracks): Track[] {
  return deduplicateQueueTracks([
    ...(results.nhaccuatui || []),
    ...(results.local || []),
    ...(results.spotify || []),
    ...(results.itunes || []),
    ...(results.youtube || []),
    ...(results.audius || []),
    ...(results.deezer || []),
    ...(results.soundcloud || []),
  ])
}
