import type { SupabaseClient } from '@supabase/supabase-js'
import type { Track } from '@/types'

function toError(message: string | undefined, fallback: string): Error {
  return new Error(message || fallback)
}

export function inferTrackSource(track: Track): Track {
  if (track.source && track.source !== 'local') return track

  const fp = track.file_path || ''
  if (fp.includes('youtube.com') || fp.includes('youtu.be') || track.youtube_id || track.id?.startsWith?.('yt-')) {
    let ytId = track.youtube_id
    if (!ytId) {
      const match = fp.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/|^yt-)([a-zA-Z0-9_-]{11})/)
      if (match) ytId = match[1]
      else if (track.id?.startsWith?.('yt-')) ytId = track.id.replace('yt-', '')
    }
    return { ...track, source: 'youtube', youtube_id: ytId }
  }

  if (fp.includes('spotify.com') || track.spotify_id || track.id?.startsWith?.('spotify-')) {
    return { ...track, source: 'spotify' }
  }

  if (fp.includes('itunes.apple.com') || track.itunes_id || track.id?.startsWith?.('itunes-')) {
    return { ...track, source: 'itunes' }
  }

  if (fp.includes('audius.co') || track.audius_id || track.id?.startsWith?.('audius-')) {
    return { ...track, source: 'audius' }
  }

  return track
}

/**
 * Fetches user's favorite tracks reliably across two independent queries (favorite_tracks + tracks)
 * without depending on PostgREST foreign-key schema relationships.
 */
export async function fetchFavoriteTracks(
  supabase: SupabaseClient,
  userIds: string | string[],
  limit: number = 50
): Promise<Track[]> {
  const ids = Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [userIds])
        .filter((id): id is string => Boolean(id && typeof id === 'string'))
    )
  )

  if (ids.length === 0) {
    return []
  }

  // 1. Query favorite_tracks junction table
  const query = supabase
    .from('favorite_tracks')
    .select('id, user_id, track_id, created_at')

  const { data: favRows, error: favError } = await (
    ids.length === 1
      ? query.eq('user_id', ids[0])
      : query.in('user_id', ids)
  )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (favError) {
    throw toError(favError.message, 'Failed to fetch favorite tracks')
  }

  const rows = favRows ?? []
  const trackIds = Array.from(
    new Set(
      rows
        .map((row: any) => row.track_id)
        .filter((trackId): trackId is string => Boolean(trackId))
    )
  )

  if (trackIds.length === 0) {
    // Fallback: check if there are tracks directly marked is_favorite = true for this user
    try {
      const { data: legacyTracks } = await (
        ids.length === 1
          ? supabase.from('tracks').select('*').eq('user_id', ids[0])
          : supabase.from('tracks').select('*').in('user_id', ids)
      )
        .eq('is_favorite', true)
        .limit(limit)

      if (legacyTracks && legacyTracks.length > 0) {
        return legacyTracks.map((t) => inferTrackSource({ ...t, is_favorite: true }))
      }
    } catch {
      // ignore fallback error
    }
    return []
  }

  // 2. Query tracks table by trackIds
  const { data: tracks, error: trackError } = await supabase
    .from('tracks')
    .select('*')
    .in('id', trackIds)

  if (trackError) {
    throw toError(trackError.message, 'Failed to fetch favorite tracks data')
  }

  const trackMap = new Map<string, Track>()
  for (const track of tracks ?? []) {
    if (track?.id) {
      trackMap.set(track.id, track as Track)
    }
  }

  // 3. Preserve order of favorites in recency order
  const seen = new Set<string>()
  const result: Track[] = []

  for (const row of rows) {
    const track = trackMap.get(row.track_id)
    if (track && !seen.has(track.id)) {
      seen.add(track.id)
      result.push(inferTrackSource({ ...track, is_favorite: true }))
    }
  }

  return result
}
