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
  // Local tracks already reference a real DB row.
  if (!track.source || track.source === 'local') return track.id

  // 1. Look for an existing row using the most stable identity first.
  //    file_path is the last resort because some sources (NhacCuaTui) leave it empty.
  const lookups: Array<{ column: string; value: string }> = []
  if (track.nhaccuatui_id) lookups.push({ column: 'nhaccuatui_id', value: track.nhaccuatui_id })
  if (track.spotify_id) lookups.push({ column: 'spotify_id', value: track.spotify_id })
  if (track.youtube_id) lookups.push({ column: 'youtube_id', value: track.youtube_id })
  if (track.file_path) lookups.push({ column: 'file_path', value: track.file_path })

  for (const { column, value } of lookups) {
    const { data } = await supabase.from('tracks').select('id').eq(column, value).limit(1)
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
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !inserted) return null
  return inserted.id
}
