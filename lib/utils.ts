import { Track } from '@/types'
import { normalizeTitle } from './youtube'

function extractDriveId(path?: string): string | null {
  if (!path) return null
  const m = path.match(/\/file\/d\/([a-zA-Z0-9_-]{18,45})/) || path.match(/id=([a-zA-Z0-9_-]{18,45})/)
  return m ? m[1] : null
}

/**
 * Sinh khoá dedupe từ title + artist đã chuẩn hoá
 */
function getDedupeKey(track: Track): string {
  const cleanTitle = normalizeTitle(track.title || '')
  const cleanArtist = normalizeTitle(track.artist || '')
  return `${cleanTitle}::${cleanArtist}`
}

/**
 * So sánh 2 track trùng tên, quyết định giữ bản chất lượng tốt hơn
 */
function isBetterTrack(candidate: Track, current: Track): boolean {
  const score = (t: Track): number => {
    const title = (t.title || '').toLowerCase()
    const artist = (t.artist || '').toLowerCase()
    let s = 0
    if (artist.includes('topic')) s += 100
    if (title.includes('official audio')) s += 60
    if (title.includes('official video') || title.includes('official music video')) s += 40
    if (title.includes('lyric') || title.includes('lyrics')) s += 20
    if (title.includes('lo-fi') || title.includes('lofi')) s -= 10
    if (title.includes('remix')) s -= 30
    if (title.includes('30min') || title.includes('loop') || title.includes('podcast')) s -= 200
    return s
  }
  return score(candidate) > score(current)
}

/**
 * Smart queue & search track deduplication algorithm.
 * Normalizes title & artist to eliminate duplicate songs across Spotify, YouTube, iTunes & Drive,
 * while automatically keeping the highest quality official track.
 */
export function deduplicateQueueTracks(tracks: Track[]): Track[] {
  if (!tracks || tracks.length <= 1) return tracks || []

  const seenMap = new Map<string, Track>()
  const seenDriveIds = new Set<string>()

  for (const track of tracks) {
    if (!track || !track.title) continue

    const driveId = extractDriveId(track.file_path || '')
    if (driveId) {
      if (seenDriveIds.has(driveId)) continue
      seenDriveIds.add(driveId)
    }

    const key = getDedupeKey(track)
    if (!key || key === '::') {
      seenMap.set(`id_${track.id}`, track)
      continue
    }

    const existing = seenMap.get(key)
    if (!existing) {
      seenMap.set(key, track)
      continue
    }

    // Nếu đã có bản trùng tên, ưu tiên giữ bản "tốt hơn" (Official Audio > MV > Remix)
    if (isBetterTrack(track, existing)) {
      seenMap.set(key, track)
    }
  }

  return Array.from(seenMap.values())
}
