import { Track } from '@/types'
import { extractDriveFileId, isPreviewUrl } from '@/lib/googleDriveUpload'
import { extractYouTubeVideoId } from '@/lib/youtube'
import { normalizeRetiredMusicTrack } from './retiredMusicSources'

export type TrackEngineType = 'html5' | 'youtube'

export type TrackSourceKind =
  | 'nhaccuatui'
  | 'soundcloud'
  | 'youtube'
  | 'drive'
  | 'spotify'
  | 'deezer'
  | 'local'
  | 'unknown'

export interface TrackClassification {
  source: TrackSourceKind
  engine: TrackEngineType
  isDirectPlayable: boolean
  isPreview: boolean
  needsCatalogResolution: boolean
  isBackgroundPlayable: boolean
  youtubeId?: string
  nhaccuatuiId?: string
  soundcloudId?: string
  driveFileId?: string
  directAudioUrl?: string
}

/**
 * Normalizes and infers the true source and IDs on a track object.
 * Defensive against legacy or incomplete metadata.
 */
export function inferTrackSource(track: Track): Track {
  track = normalizeRetiredMusicTrack(track)
  const fp = track.file_path || ''

  if (track.nhaccuatui_id || track.source === 'nhaccuatui' || fp.includes('nhaccuatui.com')) {
    return { ...track, source: 'nhaccuatui' }
  }

  if (
    track.soundcloud_id ||
    track.source === 'soundcloud' ||
    fp.includes('soundcloud.com') ||
    fp.startsWith('soundcloud:') ||
    track.id?.startsWith('sc-')
  ) {
    let scId = track.soundcloud_id
    if (!scId) {
      if (fp.startsWith('soundcloud:')) {
        scId = fp.slice('soundcloud:'.length).trim() || undefined
      } else if (track.id?.startsWith('sc-')) {
        scId = track.id.slice(3).trim() || undefined
      }
    }
    const scPermalink =
      track.soundcloud_permalink_url ||
      (fp.includes('soundcloud.com') ? fp : undefined)
    return {
      ...track,
      source: 'soundcloud',
      ...(scId ? { soundcloud_id: scId } : {}),
      ...(scPermalink ? { soundcloud_permalink_url: scPermalink } : {}),
    }
  }

  if (
    track.youtube_id ||
    track.source === 'youtube' ||
    fp.includes('youtube.com') ||
    fp.includes('youtu.be') ||
    track.id?.startsWith('yt-')
  ) {
    let ytId = track.youtube_id
    if (!ytId) {
      const match = fp.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/|^yt-)([a-zA-Z0-9_-]{11})/)
      if (match) ytId = match[1]
      else if (track.id?.startsWith('yt-')) ytId = track.id.replace('yt-', '')
    }
    return { ...track, source: 'youtube', youtube_id: ytId }
  }

  const driveId = track.drive_file_id || extractDriveFileId(fp)
  if (driveId) {
    return { ...track, source: 'local', drive_file_id: driveId }
  }

  if (
    track.spotify_id ||
    track.source === 'spotify' ||
    fp.includes('spotify.com') ||
    fp.startsWith('spotify:') ||
    track.id?.startsWith('spotify-') ||
    fp.includes('p.scdn.co')
  ) {
    return { ...track, source: 'spotify' }
  }

  if (
    (track as any).source === 'deezer' ||
    fp.includes('deezer.com') ||
    fp.startsWith('deezer:') ||
    fp.includes('dzcdn.net')
  ) {
    return { ...track, source: 'deezer' as any }
  }

  return track
}

/**
 * Classifies a track comprehensively to determine its engine, playability,
 * and resolution requirements across Desktop and iOS environments.
 */
export function classifyTrack(track: Track, isIOS = false): TrackClassification {
  const normalized = inferTrackSource(track)
  const fp = normalized.file_path || ''
  const audioUrl = normalized.audio_url || ''

  const driveId = normalized.drive_file_id || extractDriveFileId(fp) || undefined
  const ytId = normalized.youtube_id || (normalized.source === 'youtube' ? extractYouTubeVideoId(fp) : undefined) || (normalized.id?.startsWith('yt-') ? normalized.id.replace('yt-', '') : undefined) || undefined
  const nctId = normalized.nhaccuatui_id || (normalized.source === 'nhaccuatui' && !normalized.id?.startsWith('local-') ? normalized.id : undefined) || undefined
  const scId =
    normalized.soundcloud_id
      ? String(normalized.soundcloud_id)
      : fp.startsWith('soundcloud:')
        ? fp.slice('soundcloud:'.length).trim() || undefined
        : normalized.id?.startsWith('sc-')
          ? normalized.id.replace('sc-', '')
          : undefined
  const hasSoundCloudTarget = Boolean(
    scId ||
      fp.includes('soundcloud.com') ||
      (normalized.source_url && normalized.source_url.includes('soundcloud.com')) ||
      (normalized.soundcloud_permalink_url &&
        normalized.soundcloud_permalink_url.includes('soundcloud.com'))
  )
  const hasResolvedStreamProvider = Boolean(nctId || hasSoundCloudTarget || ytId || driveId)

  const hasPreviewUrl = Boolean(
    (audioUrl && (isPreviewUrl(audioUrl) || audioUrl.startsWith('skd:'))) ||
    (fp && (
      isPreviewUrl(fp) ||
      fp.startsWith('skd:') ||
      fp.startsWith('spotify:') ||
      fp.startsWith('deezer:') ||
      fp.includes('spotify.com') ||
      fp.includes('p.scdn.co')
    ))
  )

  const isPreview = hasPreviewUrl || (!hasResolvedStreamProvider && Boolean(
    normalized.source === 'spotify' ||
    (normalized as any).source === 'deezer' ||
    Boolean(normalized.spotify_id)
  ))

  let source: TrackSourceKind = 'unknown'
  if (nctId || normalized.source === 'nhaccuatui') {
    source = 'nhaccuatui'
  } else if (scId || normalized.source === 'soundcloud') {
    source = 'soundcloud'
  } else if (ytId || normalized.source === 'youtube') {
    source = 'youtube'
  } else if (driveId) {
    source = 'drive'
  } else if (normalized.source === 'spotify' || Boolean(normalized.spotify_id)) {
    source = 'spotify'
  } else if ((normalized as any).source === 'deezer') {
    source = 'deezer'
  } else if (normalized.source === 'local') {
    source = 'local'
  }

  // Has direct playable full-length stream without catalog resolution
  const isDirectPlayable = !isPreview && Boolean(
    (audioUrl && source !== 'nhaccuatui') ||
    source === 'soundcloud' ||
    Boolean(scId) ||
    Boolean(driveId) ||
    (source === 'local' && fp && !isPreviewUrl(fp))
  )

  // Needs full external stream resolver (Spotify / Deezer / Preview DRM)
  const needsCatalogResolution = !hasResolvedStreamProvider && (!isDirectPlayable || isPreview) && (
    source === 'spotify' ||
    source === 'deezer' ||
    Boolean(normalized.spotify_id) ||
    isPreview
  )

  // Can play in background (iOS lock-screen / Safari background audio)
  const isBackgroundPlayable = Boolean(
    ytId ||
    source === 'youtube' ||
    nctId ||
    source === 'nhaccuatui' ||
    scId ||
    source === 'soundcloud' ||
    driveId ||
    source === 'local' ||
    (audioUrl && audioUrl.startsWith('http') && !isPreviewUrl(audioUrl))
  )

  // Engine selection:
  // - On iOS: YouTube streams via HTML5 proxy (/api/youtube/stream) so it keeps playing when screen locks
  // - On Desktop/Android: YouTube plays via YouTube IFrame engine
  const engine: TrackEngineType = (ytId || source === 'youtube') && !isIOS ? 'youtube' : 'html5'

  return {
    source,
    engine,
    isDirectPlayable,
    isPreview,
    needsCatalogResolution,
    isBackgroundPlayable,
    youtubeId: ytId,
    nhaccuatuiId: nctId,
    soundcloudId: scId,
    driveFileId: driveId,
    directAudioUrl: audioUrl || (source === 'local' && fp ? fp : undefined),
  }
}

export function isBackgroundPlayableTrack(t: Track | null | undefined): boolean {
  if (!t) return false
  return classifyTrack(t).isBackgroundPlayable
}

export function isFullYouTubeQueue(q: Track[]): boolean {
  return q.length > 0 && q.every((t) => {
    const c = classifyTrack(t)
    return c.source === 'youtube' || Boolean(c.youtubeId)
  })
}
