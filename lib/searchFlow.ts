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

export function flattenUnifiedSearchResults(results: GlobalSearchTracks): Track[] {
  return deduplicateQueueTracks([
    ...(results.nhaccuatui || []),
    ...(results.local || []),
    ...(results.spotify || []),
    ...(results.itunes || []),
    ...(results.youtube || []),
    ...(results.audius || []),
  ])
}
