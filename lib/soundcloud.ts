import { Track } from '@/types'

export interface SoundCloudUser {
  id: number
  username: string
  permalink_url?: string
  avatar_url?: string
  city?: string
  country_code?: string
}

export interface SoundCloudFormat {
  protocol: 'hls' | 'progressive' | string
  mime_type: string
}

export interface SoundCloudTranscoding {
  url: string
  preset?: string
  duration?: number
  snipped?: boolean
  format: SoundCloudFormat
  quality?: string
}

export interface SoundCloudMedia {
  transcodings: SoundCloudTranscoding[]
}

export interface SoundCloudRawTrack {
  id: number
  title: string
  description?: string | null
  duration: number // duration in ms
  genre?: string | null
  created_at?: string
  tag_list?: string
  artwork_url?: string | null
  permalink_url?: string
  streamable?: boolean
  downloadable?: boolean
  policy?: string
  snippet?: boolean
  monetization_model?: string
  access?: string
  playback_count?: number
  likes_count?: number
  user?: SoundCloudUser
  media?: SoundCloudMedia
}

/**
 * Returns true only if the track is 100% full audio (not a 30s Go+ preview or blocked track)
 */
export function isSoundCloudFullAudio(track: SoundCloudRawTrack | any): boolean {
  if (!track || typeof track.id === 'undefined') return false
  if (track.snippet === true) return false
  if (track.policy === 'SNIPPET' || track.policy === 'BLOCK') return false
  if (track.monetization_model === 'SUB_HIGH_TIER') return false
  if (track.access === 'blocked') return false

  const transcodings = track.media?.transcodings
  if (!Array.isArray(transcodings) || transcodings.length === 0) return false

  // Must contain at least one full stream transcoding (with /stream/ instead of /preview/)
  const hasFullStream = transcodings.some(
    (t) => typeof t?.url === 'string' && t.url.includes('/stream/')
  )

  return hasFullStream
}

/**
 * Upgrades SoundCloud standard low-res artwork (-large.jpg 100x100) to ultra high-res (-t500x500.jpg 500x500)
 */
export function getSoundCloudHighResArtwork(url?: string | null): string | null {
  if (!url) return null
  return url
    .replace('-large.', '-t500x500.')
    .replace('-badge.', '-t500x500.')
    .replace('-small.', '-t500x500.')
    .replace('-tiny.', '-t500x500.')
}

/**
 * Picks the best playable transcoding for the audio player (prefer progressive MP3 for universal HTML5 playback)
 */
export function getBestSoundCloudTranscoding(track: SoundCloudRawTrack | any): SoundCloudTranscoding | null {
  const transcodings: SoundCloudTranscoding[] = track?.media?.transcodings || []
  if (transcodings.length === 0) return null

  // 1. First choice: Progressive MP3 stream (full audio, universally supported by HTML5 <audio> on all browsers)
  const progressiveStream = transcodings.find(
    (t) => t.format?.protocol === 'progressive' && t.url?.includes('/stream/')
  )
  if (progressiveStream) return progressiveStream

  // 2. Second choice: Any progressive stream (full audio)
  const anyProgressive = transcodings.find((t) => t.format?.protocol === 'progressive')
  if (anyProgressive) return anyProgressive

  // 3. Third choice: HLS stream (full audio)
  const hlsStream = transcodings.find(
    (t) => t.format?.protocol === 'hls' && t.url?.includes('/stream/')
  )
  if (hlsStream) return hlsStream

  // 4. Fallback: Any transcoding with /stream/
  const anyStream = transcodings.find((t) => t.url?.includes('/stream/'))
  if (anyStream) return anyStream

  return transcodings[0] || null
}

/**
 * Transforms a SoundCloud API raw track into MusicWeb standard Track entity
 */
export function soundCloudTrackToAppTrack(scTrack: SoundCloudRawTrack): Track {
  const coverUrl =
    getSoundCloudHighResArtwork(scTrack.artwork_url) ||
    getSoundCloudHighResArtwork(scTrack.user?.avatar_url) ||
    null

  const durationSec = Math.max(1, Math.round((scTrack.duration || 0) / 1000))
  const trackId = `sc-${scTrack.id}`

  return {
    id: trackId,
    user_id: 'system',
    title: scTrack.title || 'SoundCloud Track',
    artist: scTrack.user?.username || 'SoundCloud Artist',
    artist_name: scTrack.user?.username || 'SoundCloud Artist',
    album: 'SoundCloud Single',
    album_title: 'SoundCloud Single',
    genre: scTrack.genre || 'SoundCloud',
    duration: durationSec,
    file_path: scTrack.permalink_url || '',
    cover_url: coverUrl,
    play_count: scTrack.playback_count || 0,
    created_at: scTrack.created_at || new Date().toISOString(),
    source: 'soundcloud',
    soundcloud_id: scTrack.id,
    soundcloud_permalink_url: scTrack.permalink_url,
    audio_url: `/api/soundcloud/stream?id=${scTrack.id}`,
  }
}
