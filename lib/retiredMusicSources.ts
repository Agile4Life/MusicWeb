import type { Track } from '@/types'

/** Only for rejecting or migrating persisted identifiers from removed providers. */
export function isRetiredMusicId(value: unknown): boolean {
  return typeof value === 'string' && /^(?:itunes|audius)(?:[-:]|$)/i.test(value.trim())
}

export function isRetiredMusicUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false
  if (isRetiredMusicId(value)) return true
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    const savedDiscoveryStream = /^\/v1\/tracks\/[^/]+\/stream\/?$/.test(url.pathname) &&
      url.searchParams.get('app_name') === 'MUSICWEB_PRO'
    return savedDiscoveryStream || ['audius.co', 'audius.org', 'apple.com', 'mzstatic.com']
      .some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

export function isRetiredMusicTrack(track: Track): boolean {
  const legacy = track as Track & Record<string, unknown>
  return isRetiredMusicId(legacy.source) || isRetiredMusicId(legacy.id) ||
    Boolean(legacy.itunes_id || legacy.audius_id) ||
    isRetiredMusicUrl(legacy.file_path) || isRetiredMusicUrl(legacy.audio_url)
}

/** Keep saved tracks playable by metadata, without using removed transports. */
export function normalizeRetiredMusicTrack(track: Track): Track {
  const legacy = track as Track & Record<string, unknown>
  const retiredTrack = isRetiredMusicTrack(track)
  const retiredAlbum = isRetiredMusicId(legacy.spotify_album_id)
  const retiredLink = isRetiredMusicUrl(legacy.source_url)
  if (!retiredTrack && !retiredAlbum && !retiredLink) return track

  const normalized = { ...legacy }
  if (retiredLink) delete normalized.source_url
  if (retiredAlbum) delete normalized.spotify_album_id
  if (!retiredTrack) return normalized
  delete normalized.itunes_id
  delete normalized.audius_id
  const supportedLocalTransport = track.source === 'local' && Boolean(
    (track.file_path && !isRetiredMusicUrl(track.file_path)) ||
    (track.audio_url && !isRetiredMusicUrl(track.audio_url))
  )
  const nativeSource = track.nhaccuatui_id ? 'nhaccuatui'
    : track.soundcloud_id ? 'soundcloud'
      : track.youtube_id ? 'youtube'
        : (track.drive_file_id || supportedLocalTransport) ? 'local' : undefined
  normalized.source = nativeSource || 'spotify'
  if (!nativeSource || isRetiredMusicUrl(normalized.file_path)) normalized.file_path = ''
  if (!nativeSource || isRetiredMusicUrl(normalized.audio_url)) delete normalized.audio_url
  // Some old Apple results stored their numeric Apple ID in spotify_id.
  if (!nativeSource || /^\d+$/.test(normalized.spotify_id || '')) delete normalized.spotify_id
  return normalized
}
