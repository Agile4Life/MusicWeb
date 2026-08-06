import { Track } from '@/types'

function extractDriveId(path?: string): string | null {
  if (!path) return null
  const m = path.match(/\/file\/d\/([a-zA-Z0-9_-]{18,45})/) || path.match(/id=([a-zA-Z0-9_-]{18,45})/)
  return m ? m[1] : null
}

/**
 * Smart queue & search track deduplication algorithm.
 * Normalizes title & artist to eliminate duplicate songs across Spotify, YouTube, iTunes & Drive.
 */
export function deduplicateQueueTracks(tracks: Track[]): Track[] {
  if (!tracks || tracks.length <= 1) return tracks || []

  const unique: Track[] = []
  const seenKeys = new Set<string>()

  for (const track of tracks) {
    if (!track || !track.title) continue

    let rawTitle = (track.title || '').normalize('NFKC').toLowerCase()
    let rawArtist = (track.artist || '').normalize('NFKC').toLowerCase()

    // 1. Strip leading artist prefix e.g. "Ngọt - Xanh" -> "Xanh"
    if (rawArtist && rawTitle.startsWith(rawArtist)) {
      rawTitle = rawTitle.slice(rawArtist.length).replace(/^[\s._-]+/, '')
    }
    // 2. Strip trailing artist suffix e.g. "Xanh - Ngọt" -> "Xanh"
    if (rawArtist && rawTitle.endsWith(rawArtist)) {
      rawTitle = rawTitle.slice(0, -rawArtist.length).replace(/[\s._-]+$/, '')
    }

    rawTitle = rawTitle
      .replace(/^[^-]+-\s*/, '')
      .replace(/\s*-[^-]+$/, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[\s._-]+/g, ' ')
      .trim()

    rawArtist = rawArtist.replace(/[\s._-]+/g, ' ').trim()

    const driveId = extractDriveId(track.file_path || '')
    const key = driveId ? `drive_${driveId}` : `${rawTitle}|||${rawArtist}`

    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      unique.push(track)
    }
  }

  return unique
}
