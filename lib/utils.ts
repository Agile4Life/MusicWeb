import { Track } from '@/types'
import { normalizeTitle, isOriginalTrackOnly } from './youtube'

function extractDriveId(path?: string): string | null {
  if (!path) return null
  const m = path.match(/\/file\/d\/([a-zA-Z0-9_-]{18,45})/) || path.match(/id=([a-zA-Z0-9_-]{18,45})/)
  return m ? m[1] : null
}

export function extractCoreSongTitle(title?: string): string {
  if (!title) return ''
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
    .replace(/\b(remix|reverb|slowed|speed up|sped up|lofi|lo-fi|lyrics?|lyric video|official video|official music video|official audio|official mv|mv|audio|full video|video|1\s*hour|1hour|30\s*min|loop|podcast|compilation|playlist|hot tiktok|tiktok|chu\u1ea9n hot|hay nhat|mashup|prod|beat)\b/gi, ' ')
    .replace(/feat\.?|ft\.?/gi, ' ')
    .replace(/[\-\_\,\.\:\;\|\/\\]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Sinh khoá dedupe từ title + artist đã chuẩn hoá
 */
function getDedupeKey(track: Track): string {
  const cleanTitle = extractCoreSongTitle(track.title || '')
  const cleanArtist = normalizeTitle(track.artist || '')
  if (!cleanTitle) return `id_${track.id}`
  return `${cleanTitle}::${cleanArtist}`
}

/**
 * So sánh 2 track trùng tên, quyết định giữ bản chất lượng tốt hơn
 */
function isBetterTrack(candidate: Track, current: Track): boolean {
  const sourcePriority = (track: Track): number => {
    if (track.source === 'nhaccuatui') return 1000
    if (track.source === 'local' || !track.source) return 900
    return 0
  }

  if (sourcePriority(candidate) !== sourcePriority(current)) {
    return sourcePriority(candidate) > sourcePriority(current)
  }

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
    if (title.includes('30min') || title.includes('loop') || title.includes('1 hour') || title.includes('podcast')) s -= 200
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
  const seenCoreTitles = new Map<string, Track>()

  for (const track of tracks) {
    if (!track || !track.title) continue
    if (!isOriginalTrackOnly(track.title)) continue

    const driveId = extractDriveId(track.file_path || '')
    if (driveId) {
      if (seenDriveIds.has(driveId)) continue
      seenDriveIds.add(driveId)
    }

    const key = getDedupeKey(track)
    const coreTitle = extractCoreSongTitle(track.title)

    const existingExact = seenMap.get(key)
    if (existingExact) {
      if (isBetterTrack(track, existingExact)) {
        seenMap.set(key, track)
        if (coreTitle) seenCoreTitles.set(coreTitle, track)
      }
      continue
    }

    // Check fuzzy core title deduplication if title is substantial (> 2 chars)
    if (coreTitle && coreTitle.length > 2) {
      const existingCore = seenCoreTitles.get(coreTitle)
      if (existingCore) {
        if (isBetterTrack(track, existingCore)) {
          seenMap.delete(getDedupeKey(existingCore))
          seenMap.set(key, track)
          seenCoreTitles.set(coreTitle, track)
        }
        continue
      }
    }

    seenMap.set(key, track)
    if (coreTitle) seenCoreTitles.set(coreTitle, track)
  }

  return Array.from(seenMap.values())
}

/**
 * Format view count kiểu YouTube: 1.2K, 3.4M, 1.1B
 */
export function formatViewCount(count: number | null | undefined): string {
  if (count == null || count < 0) return ''
  if (count < 1000) return `${count} lượt xem`
  if (count < 1_000_000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K lượt xem`
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M lượt xem`
  return `${(count / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B lượt xem`
}
