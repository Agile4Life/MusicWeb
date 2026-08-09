import { Track } from '@/types'
import { SpotifyPlaylistTrack } from '@/lib/spotify'
import { searchYouTubeTracks, findBestYouTubeMatch } from '@/lib/youtube'

export interface PlaylistImportResult {
  spotify_id: string
  spotifyTrack: SpotifyPlaylistTrack
  matchedTrack: Track | null
  matchConfidence: 'high' | 'low' | 'none'
}

// In-memory cache so re-importing overlapping playlists, or retrying a failed
// import, doesn't re-search YouTube for tracks already matched this session.
const matchCache = new Map<string, Track | null>()

/**
 * Match MỘT track Spotify sang YouTube. Tách riêng để dùng lại được cho
 * cả batch import lẫn re-match thủ công 1 bài từ UI review.
 */
export async function matchSingleTrack(spotifyTrack: SpotifyPlaylistTrack): Promise<PlaylistImportResult> {
  const cacheKey = spotifyTrack.isrc || spotifyTrack.spotify_id

  if (matchCache.has(cacheKey)) {
    const cached = matchCache.get(cacheKey)!
    return {
      spotify_id: spotifyTrack.spotify_id,
      spotifyTrack,
      matchedTrack: cached,
      matchConfidence: cached ? 'high' : 'none',
    }
  }

  try {
    const query = `${spotifyTrack.title} ${spotifyTrack.artist}`
    const candidates = await searchYouTubeTracks(query, 8)
    const best = findBestYouTubeMatch(
      candidates,
      spotifyTrack.title,
      spotifyTrack.artist,
      spotifyTrack.duration,
      spotifyTrack.album
    )

    matchCache.set(cacheKey, best)

    // Confidence heuristic: duration within 5s + exact title/artist match implies high
    // confidence; anything found but with looser duration tolerance is "low" and should
    // be flagged for user review rather than silently trusted.
    let confidence: 'high' | 'low' | 'none' = 'none'
    if (best) {
      const durationDiff = Math.abs((best.duration || 0) - spotifyTrack.duration)
      confidence = durationDiff <= 5 ? 'high' : 'low'
    }

    return { spotify_id: spotifyTrack.spotify_id, spotifyTrack, matchedTrack: best, matchConfidence: confidence }
  } catch (err) {
    console.warn('Track match error:', spotifyTrack.title, err)
    return { spotify_id: spotifyTrack.spotify_id, spotifyTrack, matchedTrack: null, matchConfidence: 'none' }
  }
}

/**
 * Match toàn bộ playlist với concurrency giới hạn, báo tiến độ qua callback.
 * KHÔNG chạy tất cả song song cùng lúc — dễ bị YouTube rate-limit hoặc làm
 * trình duyệt/server quá tải nếu playlist có hàng trăm bài.
 */
export async function matchPlaylistToYouTube(
  tracks: SpotifyPlaylistTrack[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 4,
  signal?: AbortSignal
): Promise<PlaylistImportResult[]> {
  const results: PlaylistImportResult[] = new Array(tracks.length)
  let nextIndex = 0
  let completed = 0

  async function worker() {
    while (nextIndex < tracks.length) {
      if (signal?.aborted) return
      const currentIndex = nextIndex++
      const result = await matchSingleTrack(tracks[currentIndex])
      results[currentIndex] = result
      completed++
      onProgress?.(completed, tracks.length)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tracks.length) }, () => worker())
  await Promise.all(workers)

  return results
}
