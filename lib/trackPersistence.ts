import type { SupabaseClient } from '@supabase/supabase-js'
import type { Track } from '@/types'

/**
 * Resolve a non-local (external) track to a real `tracks.id` (UUID) in Supabase.
 *
 * External search results (NhacCuaTui / YouTube / Spotify / Deezer) carry a
 * synthetic id like `nct-123` and are NOT rows in the `tracks` table yet, so
 * they cannot be referenced by `playlist_tracks`, `favorite_tracks` or
 * `listening_history` directly. This helper finds the matching DB row — or
 * inserts a complete one — and returns its UUID.
 *
 * Why this exists: the previous inline logic looked a track up ONLY by
 * `file_path`. NhacCuaTui search items have an empty `file_path`, so every NCT
 * track collided on `''`: the lookup either matched a previously saved NCT row
 * (adding the WRONG song, or failing on the playlist unique constraint) or
 * created duplicate rows. Keying off the stable source id fixes that, and
 * persisting the `source` + source-id columns keeps the saved track playable.
 *
 * @returns the DB track id, or `null` when persistence failed.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isExternalTrack(track: Track): boolean {
  if (!track.id) return false
  const syntheticId =
    track.id.startsWith('yt-') ||
    track.id.startsWith('spotify-') ||
    track.id.startsWith('deezer-') ||
    track.id.startsWith('nct-') ||
    track.id.startsWith('itunes-') ||
    track.id.startsWith('audius-')

  if (syntheticId) return true
  if (track.source && track.source !== 'local' && !UUID_REGEX.test(track.id)) return true
  return false
}

function inferTrackSource(track: Track): Track {
  if (track.source && track.source !== 'local' && UUID_REGEX.test(track.id || '')) return track

  const normalized: Track = { ...track }
  if (!normalized.source) {
    if (normalized.youtube_id || normalized.id?.startsWith('yt-')) normalized.source = 'youtube'
    else if (normalized.spotify_id || normalized.id?.startsWith('spotify-')) normalized.source = 'spotify'
    else if (normalized.nhaccuatui_id || normalized.id?.startsWith('nct-')) normalized.source = 'nhaccuatui'
    else if (normalized.itunes_id || normalized.id?.startsWith('itunes-')) normalized.source = 'itunes'
    else if (normalized.audius_id || normalized.id?.startsWith('audius-')) normalized.source = 'audius'
    else if (normalized.id?.startsWith('deezer-')) normalized.source = 'deezer'
    else {
      const fp = normalized.file_path || ''
      if (fp.includes('youtube.com') || fp.includes('youtu.be')) normalized.source = 'youtube'
      else if (fp.includes('spotify.com')) normalized.source = 'spotify'
      else if (fp.includes('itunes.apple.com')) normalized.source = 'itunes'
      else if (fp.includes('audius.co')) normalized.source = 'audius'
      else if (fp.includes('deezer.com') || fp.startsWith('deezer:')) normalized.source = 'deezer'
    }
  }

  if (!normalized.youtube_id && normalized.id?.startsWith('yt-')) {
    normalized.youtube_id = normalized.id.slice(3)
  }
  if (!normalized.spotify_id && normalized.id?.startsWith('spotify-')) {
    normalized.spotify_id = normalized.id.slice(8)
  }
  if (!normalized.nhaccuatui_id && normalized.id?.startsWith('nct-')) {
    normalized.nhaccuatui_id = normalized.id.slice(4)
  }
  if (!normalized.itunes_id && normalized.id?.startsWith('itunes-')) {
    normalized.itunes_id = normalized.id.slice(7)
  }
  if (!normalized.audius_id && normalized.id?.startsWith('audius-')) {
    normalized.audius_id = normalized.id.slice(7)
  }

  return normalized
}

export async function resolveExternalTrackId(
  supabase: SupabaseClient,
  track: Track,
  userId: string,
): Promise<string | null> {
  const normalizedTrack = inferTrackSource(track)
  const isExternalTrackFlag = isExternalTrack(normalizedTrack)

  if (!isExternalTrackFlag) return normalizedTrack.id

  // 1. Look for an existing row using the most stable identity first.
  //    file_path is the last resort because some sources (NhacCuaTui) leave it empty.
  const lookups: Array<{ column: string; value: string }> = []
  if (normalizedTrack.nhaccuatui_id) lookups.push({ column: 'nhaccuatui_id', value: normalizedTrack.nhaccuatui_id })
  if (normalizedTrack.spotify_id) lookups.push({ column: 'spotify_id', value: normalizedTrack.spotify_id })
  if (normalizedTrack.youtube_id) lookups.push({ column: 'youtube_id', value: normalizedTrack.youtube_id })
  if (normalizedTrack.itunes_id) lookups.push({ column: 'itunes_id', value: String(normalizedTrack.itunes_id) })
  if (normalizedTrack.audius_id) lookups.push({ column: 'audius_id', value: normalizedTrack.audius_id })
  if (normalizedTrack.file_path) lookups.push({ column: 'file_path', value: normalizedTrack.file_path })

  for (const { column, value } of lookups) {
    const { data } = await supabase
      .from('tracks')
      .select('id')
      .eq('user_id', userId)
      .eq(column, value)
      .limit(1)
    if (data && data.length > 0) return data[0].id
  }

  // 2. No existing row — insert a complete record. Guarantee a non-empty,
  //    unique file_path so later lookups and playback resolution keep working.
  const fallbackPath =
    normalizedTrack.file_path ||
    (normalizedTrack.nhaccuatui_id
      ? `nct:${normalizedTrack.nhaccuatui_id}`
      : normalizedTrack.youtube_id
        ? `https://www.youtube.com/watch?v=${normalizedTrack.youtube_id}`
        : normalizedTrack.spotify_id
          ? `spotify:${normalizedTrack.spotify_id}`
          : normalizedTrack.itunes_id
            ? `itunes:${normalizedTrack.itunes_id}`
            : normalizedTrack.audius_id
              ? `audius:${normalizedTrack.audius_id}`
              : '')

  const { data: inserted, error } = await supabase
    .from('tracks')
    .insert({
      user_id: userId,
      title: normalizedTrack.title,
      artist: normalizedTrack.artist || null,
      album: normalizedTrack.album || null,
      duration: normalizedTrack.duration || 0,
      file_path: fallbackPath,
      cover_url: normalizedTrack.cover_url || null,
      source: normalizedTrack.source || null,
      youtube_id: normalizedTrack.youtube_id || null,
      spotify_id: normalizedTrack.spotify_id || null,
      nhaccuatui_id: normalizedTrack.nhaccuatui_id || null,
      itunes_id: normalizedTrack.itunes_id || null,
      audius_id: normalizedTrack.audius_id || null,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (!error && inserted) return inserted.id

  // If the insert failed due to a unique song tuple on the user's library,
  // try to recover by finding the existing track row by title/artist.
  if (normalizedTrack.title) {
    const titleValue = normalizedTrack.title.trim()
    const artistValue = (normalizedTrack.artist || '').trim()
    let query = supabase.from('tracks').select('id').eq('user_id', userId).ilike('title', titleValue)

    if (artistValue) {
      query = query.ilike('artist', artistValue)
    } else {
      query = query.is('artist', null)
    }

    const { data: titleMatches } = await query.limit(1)
    if (titleMatches && titleMatches.length > 0) return titleMatches[0].id
  }

  return null
}
