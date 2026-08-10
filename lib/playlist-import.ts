import { Track } from '@/types'
import { SpotifyPlaylistTrack } from '@/lib/spotify'
import { searchYouTubeTracks, findBestYouTubeMatch } from '@/lib/youtube'
import { resolveNhacCuaTuiTrack } from '@/lib/nhaccuatuiClient'

export interface PlaylistImportResult {
  spotify_id: string
  spotifyTrack: SpotifyPlaylistTrack
  matchedTrack: Track | null
  matchConfidence: 'high' | 'low' | 'none'
}

// In-memory cache so re-importing overlapping playlists, or retrying a failed
// import, doesn't re-search for tracks already matched this session.
const matchCache = new Map<string, Track | null>()

/**
 * Match MỘT track Spotify. Ưu tiên Nhạc Của Tui (NCT) trước — nếu bài có trên
 * NCT sẽ dùng ngay nguồn + ảnh NCT; chỉ khi không tìm thấy mới fallback sang
 * YouTube. Tách riêng để dùng lại được cho cả batch import lẫn re-match thủ công.
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

  // 1. NCT-first: lấy bài từ Nhạc Của Tui (nguồn + ảnh theo web đang dùng)
  try {
    const nctSong = await resolveNhacCuaTuiTrack({
      title: spotifyTrack.title,
      artist: spotifyTrack.artist,
      album: spotifyTrack.album,
      duration: spotifyTrack.duration,
      source: 'spotify',
      nhaccuatui_id: undefined,
    })
    if (nctSong) {
      const nctTrack: Track = {
        id: `nct-${nctSong.id}`,
        user_id: 'nhaccuatui-global',
        title: nctSong.title || spotifyTrack.title,
        artist: nctSong.artist || spotifyTrack.artist,
        duration: nctSong.duration || spotifyTrack.duration || 0,
        file_path: '',
        cover_url: nctSong.coverUrl || null,
        created_at: new Date().toISOString(),
        source: 'nhaccuatui',
        nhaccuatui_id: nctSong.id,
      }
      matchCache.set(cacheKey, nctTrack)
      return {
        spotify_id: spotifyTrack.spotify_id,
        spotifyTrack,
        matchedTrack: nctTrack,
        matchConfidence: 'high',
      }
    }
  } catch (err) {
    console.warn('NCT match error:', spotifyTrack.title, err)
  }

  // 2. Fallback: YouTube
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
