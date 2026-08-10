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
export async function resolveExternalTrackId(
  supabase: SupabaseClient,
  track: Track,
  userId: string,
): Promise<string | null> {
  const isExternalTrack =
    Boolean(track.source && track.source !== 'local') ||
    track.id?.startsWith('yt-') ||
    track.id?.startsWith('spotify-') ||
    track.id?.startsWith('deezer-') ||
    track.id?.startsWith('nct-') ||
    track.id?.startsWith('itunes-') ||
    track.id?.startsWith('audius-')

  if (!isExternalTrack) return track.id

  // 1. Look for an existing row using the most stable identity first.
  //    file_path is the last resort because some sources (NhacCuaTui) leave it empty.
  const lookups: Array<{ column: string; value: string }> = []
  if (track.nhaccuatui_id) lookups.push({ column: 'nhaccuatui_id', value: track.nhaccuatui_id })
  if (track.spotify_id) lookups.push({ column: 'spotify_id', value: track.spotify_id })
  if (track.youtube_id) lookups.push({ column: 'youtube_id', value: track.youtube_id })
  if (track.itunes_id) lookups.push({ column: 'itunes_id', value: String(track.itunes_id) })
  if (track.audius_id) lookups.push({ column: 'audius_id', value: track.audius_id })
  if (track.file_path) lookups.push({ column: 'file_path', value: track.file_path })

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
    track.file_path ||
    (track.nhaccuatui_id
      ? `nct:${track.nhaccuatui_id}`
      : track.youtube_id
        ? `https://www.youtube.com/watch?v=${track.youtube_id}`
        : track.spotify_id
          ? `spotify:${track.spotify_id}`
          : track.itunes_id
            ? `itunes:${track.itunes_id}`
            : track.audius_id
              ? `audius:${track.audius_id}`
              : '')

  const { data: inserted, error } = await supabase
    .from('tracks')
    .insert({
      user_id: userId,
      title: track.title,
      artist: track.artist || null,
      album: track.album || null,
      duration: track.duration || 0,
      file_path: fallbackPath,
      cover_url: track.cover_url || null,
      source: track.source,
      youtube_id: track.youtube_id || null,
      spotify_id: track.spotify_id || null,
      nhaccuatui_id: track.nhaccuatui_id || null,
      itunes_id: track.itunes_id || null,
      audius_id: track.audius_id || null,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (!error && inserted) return inserted.id

  // If the insert failed due to a unique song tuple on the user's library,
  // try to recover by finding the existing track row by title/artist.
  if (track.title) {
    const titleValue = track.title.trim()
    const artistValue = (track.artist || '').trim()
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
