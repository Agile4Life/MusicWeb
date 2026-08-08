import { Track } from './index'

export interface QueueTrack {
  id: string                // id nội bộ, dạng `${source}-${source_id}`
  title: string
  artist: string
  album?: string
  cover_url: string | null
  duration: number
  isrc?: string              // KHÓA để khử trùng lặp giữa Spotify/Deezer
  source: 'deezer' | 'spotify' | 'internal_history'
  source_id: string
  preview_url?: string
  score: number               // điểm xếp hạng
  score_reasons: string[]     // debug: lý do chọn bài
}

export interface NextQueueResponse {
  tracks: QueueTrack[]
  generated_at: string
  sources_used: string[]
  sources_failed: string[]
}

export interface ListenEventPayload {
  track_id: string
  artist?: string
  completed: boolean
  skip_at_seconds?: number | null
}

/**
 * Convert standard app Track to QueueTrack
 */
export function trackToQueueTrack(track: Track): QueueTrack {
  let source: QueueTrack['source'] = 'spotify'
  let sourceId = track.id

  if (track.source === 'spotify' || track.spotify_id || track.id.startsWith('spotify-')) {
    source = 'spotify'
    sourceId = track.spotify_id || track.id.replace('spotify-', '')
  } else if (track.id.startsWith('deezer-')) {
    source = 'deezer'
    sourceId = track.id.replace('deezer-', '')
  } else {
    source = 'internal_history'
  }

  return {
    id: track.id,
    title: track.title,
    artist: track.artist || 'Nghệ sĩ chưa xác định',
    album: track.album || undefined,
    cover_url: track.cover_url || null,
    duration: track.duration || 0,
    source,
    source_id: sourceId,
    preview_url: track.audio_url || (track.file_path.startsWith('http') ? track.file_path : undefined),
    score: 1.0,
    score_reasons: ['current_playing_seed'],
  }
}

/**
 * Convert QueueTrack to standard app Track for player queue compatibility
 */
export function queueTrackToTrack(qt: QueueTrack, defaultUserId = '00000000-0000-4000-a000-000000000001'): Track {
  const isDeezer = qt.source === 'deezer' || qt.id.startsWith('deezer-')
  const isSpotify = qt.source === 'spotify' || qt.id.startsWith('spotify-')

  const audioUrl = qt.preview_url || undefined

  return {
    id: qt.id,
    user_id: defaultUserId,
    title: qt.title,
    artist: qt.artist,
    album: qt.album || null,
    duration: qt.duration,
    file_path: audioUrl || (isDeezer ? `deezer:${qt.source_id}` : isSpotify ? `spotify:${qt.source_id}` : qt.id),
    cover_url: qt.cover_url,
    created_at: new Date().toISOString(),
    source: isSpotify ? 'spotify' : isDeezer ? 'spotify' : 'local', // seamless playback engine map
    audio_url: audioUrl,
    spotify_id: isSpotify ? qt.source_id : undefined,
  }
}
