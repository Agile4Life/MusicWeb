import { Track } from '@/types'
import { hasCatalogArtistEvidence, hasIncompatiblePlaybackVariant, normalizeIdentity } from './catalogMatching'
import { normalizeTitle } from './youtube'

export { normalizeTitle }

const DEDUPE_VARIANT_MARKERS = [
  'remix',
  'cover',
  'live',
  'karaoke',
  'instrumental',
  'slowed',
  'sped up',
  'speed up',
  'nightcore',
  'lofi',
  'lo fi',
  'acoustic',
  'mashup',
  'reverb',
  '8d',
]

function extractVariantSignature(title?: string): string {
  const norm = normalizeIdentity(title)
  if (!norm) return ''
  const padded = ` ${norm} `
  return DEDUPE_VARIANT_MARKERS.filter((marker) => padded.includes(` ${marker} `)).join('|')
}

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
    .replace(/\s+[-–—]\s+from\s+(?:["'“”][^"'“”]+["'“”]|the\s+.*|.*?\b(?:soundtrack|album|motion\s+picture|film|series|ost)\b.*)/i, ' ')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*/i, ' ')
    .replace(/\b(remix|reverb|slowed|speed up|sped up|lofi|lo-fi|lyrics?|lyric video|official video|official music video|official audio|official mv|mv|audio|full video|video|1\s*hour|1hour|30\s*min|loop|podcast|compilation|playlist|hot tiktok|tiktok|chu\u1ea9n hot|hay nhat|mashup|prod|beat)\b/gi, ' ')
    .replace(/\b(?:feat|ft)\.?\b/gi, ' ')
    .replace(/[\-\_\,\.\:\;\|\/\\]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Sinh khoá dedupe từ title + artist đã chuẩn hoá (kèm chữ ký biến thể phát)
 */
function getDedupeKey(track: Track): string {
  const cleanTitle = extractCoreSongTitle(track.title || '')
  const cleanArtist = normalizeTitle(track.artist || '')
  const variantSig = extractVariantSignature(track.title)
  if (!cleanTitle) return `id_${track.id}`
  return variantSig ? `${cleanTitle}::${cleanArtist}::${variantSig}` : `${cleanTitle}::${cleanArtist}`
}

function areArtistsCompatibleForDedupe(a: Track, b: Track): boolean {
  const artistA = (a.artist || '').trim()
  const artistB = (b.artist || '').trim()
  if (!artistA || !artistB) return true
  return (
    hasCatalogArtistEvidence({ title: a.title, artist: a.artist }, b.artist) ||
    hasCatalogArtistEvidence({ title: b.title, artist: b.artist }, a.artist)
  )
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
 * Enriches the winning track with missing album / cover / duration metadata from a duplicate track.
 * Crucial when NhacCuaTui or Local tracks win playback priority over Spotify/Deezer tracks
 * that carry full album metadata.
 */
export function mergeTrackMetadata(winner: Track, loser: Track): Track {
  if (!winner || !loser) return winner
  let changed = false
  const next: Track = { ...winner }

  const winnerAlbum = (winner.album || '').trim()
  const loserAlbum = (loser.album || '').trim()
  const isRealNonSingle = (albumStr: string, titleStr?: string | null) => {
    if (!albumStr) return false
    const lower = albumStr.toLowerCase()
    if (lower === 'single' || lower === 'ep' || lower === 'unknown album' || lower === 'album') return false
    if (/\s[-–—]\s*(single|ep)\s*$/i.test(albumStr)) return false
    if (titleStr && lower === titleStr.trim().toLowerCase()) return false
    return true
  }

  const winnerHasRealAlbum = isRealNonSingle(winnerAlbum, winner.title)
  const loserHasRealAlbum = isRealNonSingle(loserAlbum, loser.title)

  if (!winnerHasRealAlbum && loserHasRealAlbum) {
    next.album = loser.album
    changed = true
  } else if (!winnerAlbum && loserAlbum) {
    next.album = loser.album
    changed = true
  }

  if ((!winner.spotify_album_id || (!winnerHasRealAlbum && loserHasRealAlbum)) && loser.spotify_album_id) {
    next.spotify_album_id = loser.spotify_album_id
    changed = true
  }

  if (!winner.cover_url && loser.cover_url) {
    next.cover_url = loser.cover_url
    changed = true
  }

  if ((!winner.duration || winner.duration <= 0) && loser.duration && loser.duration > 0) {
    next.duration = loser.duration
    changed = true
  }

  return changed ? next : winner
}

/**
 * Smart queue & search track deduplication algorithm.
 * Normalizes title & artist to eliminate duplicate songs across Spotify, YouTube, iTunes & Drive,
 * while automatically keeping the highest quality official track and merging album metadata.
 */
export function deduplicateQueueTracks(tracks: Track[]): Track[] {
  if (!tracks || tracks.length <= 1) return tracks || []

  const seenMap = new Map<string, Track>()
  const seenDriveIds = new Set<string>()
  const seenCoreTitles = new Map<string, Track[]>()

  const upsertCoreTitleTrack = (coreKey: string, nextTrack: Track, prevTrack?: Track) => {
    const list = seenCoreTitles.get(coreKey) || []
    if (prevTrack) {
      const idx = list.indexOf(prevTrack)
      if (idx !== -1) {
        list[idx] = nextTrack
        seenCoreTitles.set(coreKey, list)
        return
      }
    }
    list.push(nextTrack)
    seenCoreTitles.set(coreKey, list)
  }

  for (const track of tracks) {
    if (!track || !track.title) continue
    if (/\b(1\s*hour|1hour|30\s*min|podcast)\b/i.test(track.title)) continue

    const driveId = extractDriveId(track.file_path || '')
    if (driveId) {
      if (seenDriveIds.has(driveId)) continue
      seenDriveIds.add(driveId)
    }

    const key = getDedupeKey(track)
    const coreTitle = extractCoreSongTitle(track.title)
    const variantSig = extractVariantSignature(track.title)
    const coreKey = coreTitle ? (variantSig ? `${coreTitle}::${variantSig}` : coreTitle) : ''

    const existingExact = seenMap.get(key)
    if (existingExact) {
      if (isBetterTrack(track, existingExact)) {
        const merged = mergeTrackMetadata(track, existingExact)
        seenMap.set(key, merged)
        if (coreKey) upsertCoreTitleTrack(coreKey, merged, existingExact)
      } else {
        const merged = mergeTrackMetadata(existingExact, track)
        if (merged !== existingExact) {
          seenMap.set(key, merged)
          if (coreKey) upsertCoreTitleTrack(coreKey, merged, existingExact)
        }
      }
      continue
    }

    // Check fuzzy core title deduplication if title is substantial (> 2 chars) AND artists & variants are compatible
    if (coreTitle && coreTitle.length > 2 && coreKey) {
      const existingCoreList = seenCoreTitles.get(coreKey) || []
      const existingCore = existingCoreList.find(
        (candidate) =>
          areArtistsCompatibleForDedupe(track, candidate) &&
          !hasIncompatiblePlaybackVariant(track.title, candidate.title) &&
          !hasIncompatiblePlaybackVariant(
            `${track.title || ''} ${track.artist || ''}`,
            `${candidate.title || ''} ${candidate.artist || ''}`,
          ),
      )
      if (existingCore) {
        if (isBetterTrack(track, existingCore)) {
          const merged = mergeTrackMetadata(track, existingCore)
          seenMap.delete(getDedupeKey(existingCore))
          seenMap.set(key, merged)
          upsertCoreTitleTrack(coreKey, merged, existingCore)
        } else {
          const merged = mergeTrackMetadata(existingCore, track)
          if (merged !== existingCore) {
            seenMap.set(getDedupeKey(existingCore), merged)
            upsertCoreTitleTrack(coreKey, merged, existingCore)
          }
        }
        continue
      }
    }

    seenMap.set(key, track)
    if (coreKey) upsertCoreTitleTrack(coreKey, track)
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

/**
 * Format seconds into mm:ss string
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export const formatDuration = formatTime
