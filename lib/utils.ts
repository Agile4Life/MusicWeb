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

    const cleanTitle = (track.title || '')
      .normalize('NFC')
      .replace(/[\(\[\{](official|mv|audio|lyric video|video|hd|4k)[\)\]\}]/gi, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')

    const cleanArtist = (track.artist || '')
      .normalize('NFC')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')

    const driveId = extractDriveId(track.file_path || '')
    const idKey = track.id ? `id_${track.id}` : null
    const driveKey = driveId ? `drive_${driveId}` : null
    const metaKey = `${cleanTitle}|||${cleanArtist}`

    if (idKey && seenKeys.has(idKey)) continue
    if (driveKey && seenKeys.has(driveKey)) continue
    if (seenKeys.has(metaKey)) continue

    if (idKey) seenKeys.add(idKey)
    if (driveKey) seenKeys.add(driveKey)
    seenKeys.add(metaKey)

    unique.push(track)
  }

  return unique
}
