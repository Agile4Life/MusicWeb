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
    track.id.startsWith('audius-') ||
    track.id.startsWith('sc-')

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
    else if (normalized.soundcloud_id || normalized.id?.startsWith('sc-')) normalized.source = 'soundcloud'
    else if (normalized.id?.startsWith('deezer-')) normalized.source = 'deezer'
    else {
      const fp = normalized.file_path || ''
      if (fp.includes('youtube.com') || fp.includes('youtu.be')) normalized.source = 'youtube'
      else if (fp.includes('spotify.com')) normalized.source = 'spotify'
      else if (fp.includes('itunes.apple.com')) normalized.source = 'itunes'
      else if (fp.includes('audius.co')) normalized.source = 'audius'
      else if (fp.includes('soundcloud.com') || fp.startsWith('soundcloud:')) normalized.source = 'soundcloud'
      else if (fp.includes('deezer.com') || fp.startsWith('deezer:')) normalized.source = 'deezer'
    }
  }

  if (!normalized.youtube_id && (normalized.id?.startsWith('yt-') || normalized.source === 'youtube')) {
    normalized.youtube_id = normalized.id?.startsWith('yt-') ? normalized.id.slice(3) : normalized.id
  }
  if (!normalized.spotify_id && (normalized.id?.startsWith('spotify-') || normalized.source === 'spotify')) {
    normalized.spotify_id = normalized.id?.startsWith('spotify-') ? normalized.id.slice(8) : normalized.id
  }
  if (!normalized.nhaccuatui_id && (normalized.id?.startsWith('nct-') || normalized.source === 'nhaccuatui')) {
    normalized.nhaccuatui_id = normalized.id?.startsWith('nct-') ? normalized.id.slice(4) : normalized.id
  }
  if (!normalized.itunes_id && (normalized.id?.startsWith('itunes-') || normalized.source === 'itunes')) {
    normalized.itunes_id = normalized.id?.startsWith('itunes-') ? normalized.id.slice(7) : String(normalized.id)
  }
  if (!normalized.audius_id && (normalized.id?.startsWith('audius-') || normalized.source === 'audius')) {
    normalized.audius_id = normalized.id?.startsWith('audius-') ? normalized.id.slice(7) : normalized.id
  }
  if (!normalized.soundcloud_id && (normalized.id?.startsWith('sc-') || normalized.source === 'soundcloud')) {
    normalized.soundcloud_id = normalized.id?.startsWith('sc-') ? normalized.id.slice(3) : normalized.id
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

  if (!isExternalTrackFlag && normalizedTrack.id && UUID_REGEX.test(normalizedTrack.id)) {
    return normalizedTrack.id
  }

  // 1. Look for an existing row in `tracks` table.
  // We check BOTH per-user rows AND global/system rows so existing tracks can be reused.
  // Note: Only query columns that actually exist in the database schema (nhaccuatui_id, spotify_id, youtube_id, file_path)
  const lookups: Array<{ column: string; value: string }> = []
  if (normalizedTrack.nhaccuatui_id) lookups.push({ column: 'nhaccuatui_id', value: normalizedTrack.nhaccuatui_id })
  if (normalizedTrack.spotify_id) lookups.push({ column: 'spotify_id', value: normalizedTrack.spotify_id })
  if (normalizedTrack.youtube_id) lookups.push({ column: 'youtube_id', value: normalizedTrack.youtube_id })
  if (normalizedTrack.soundcloud_id) lookups.push({ column: 'file_path', value: `soundcloud:${normalizedTrack.soundcloud_id}` })
  if (normalizedTrack.soundcloud_permalink_url) lookups.push({ column: 'file_path', value: normalizedTrack.soundcloud_permalink_url })
  if (normalizedTrack.file_path) lookups.push({ column: 'file_path', value: normalizedTrack.file_path })

  // Phase A: Search under current user_id first
  for (const { column, value } of lookups) {
    if (!value) continue
    try {
      const { data } = await supabase
        .from('tracks')
        .select('id')
        .eq('user_id', userId)
        .eq(column, value)
        .limit(1)
      if (data && data.length > 0 && data[0].id) return data[0].id
    } catch {
      // Ignore column or query errors
    }
  }

  // Phase B: Search globally across all users / system user
  for (const { column, value } of lookups) {
    if (!value) continue
    try {
      const { data } = await supabase
        .from('tracks')
        .select('id')
        .eq(column, value)
        .limit(1)
      if (data && data.length > 0 && data[0].id) return data[0].id
    } catch {
      // Ignore column or query errors
    }
  }

  // Phase C: Search by exact title + artist match
  if (normalizedTrack.title) {
    const titleVal = normalizedTrack.title.trim()
    const artistVal = (normalizedTrack.artist || '').trim()

    let query = supabase.from('tracks').select('id').eq('user_id', userId).eq('title', titleVal)
    if (artistVal) {
      query = query.eq('artist', artistVal)
    }
    const { data: userTitleMatches } = await query.limit(1)
    if (userTitleMatches && userTitleMatches.length > 0 && userTitleMatches[0].id) {
      return userTitleMatches[0].id
    }

    let globalQuery = supabase.from('tracks').select('id').eq('title', titleVal)
    if (artistVal) {
      globalQuery = globalQuery.eq('artist', artistVal)
    }
    const { data: globalTitleMatches } = await globalQuery.limit(1)
    if (globalTitleMatches && globalTitleMatches.length > 0 && globalTitleMatches[0].id) {
      return globalTitleMatches[0].id
    }
  }

  // 2. No existing row found — insert a complete record for this user.
  const fallbackPath =
    normalizedTrack.file_path ||
    (normalizedTrack.nhaccuatui_id
      ? `nct:${normalizedTrack.nhaccuatui_id}`
      : normalizedTrack.youtube_id
        ? `https://www.youtube.com/watch?v=${normalizedTrack.youtube_id}`
        : normalizedTrack.spotify_id
          ? `spotify:${normalizedTrack.spotify_id}`
          : normalizedTrack.soundcloud_permalink_url
            ? normalizedTrack.soundcloud_permalink_url
            : normalizedTrack.soundcloud_id
              ? `soundcloud:${normalizedTrack.soundcloud_id}`
              : normalizedTrack.itunes_id
                ? `itunes:${normalizedTrack.itunes_id}`
                : normalizedTrack.audius_id
                  ? `audius:${normalizedTrack.audius_id}`
                  : `ext:${Date.now()}`)

  // Insert payload containing ONLY valid PostgreSQL table columns
  const insertPayload: Record<string, any> = {
    user_id: userId,
    title: normalizedTrack.title || 'Untitled Track',
    artist: normalizedTrack.artist || null,
    album: normalizedTrack.album || null,
    duration: normalizedTrack.duration || 0,
    file_path: fallbackPath,
    cover_url: normalizedTrack.cover_url || null,
    source: normalizedTrack.source || null,
    youtube_id: normalizedTrack.youtube_id || null,
    spotify_id: normalizedTrack.spotify_id || null,
    nhaccuatui_id: normalizedTrack.nhaccuatui_id || null,
    created_at: new Date().toISOString(),
  }

  const { data: inserted, error } = await supabase
    .from('tracks')
    .insert(insertPayload)
    .select('id')
    .single()

  if (!error && inserted && inserted.id) return inserted.id

  if (error) {
    console.warn('Track insert warning:', error.message || error)
  }

  // 3. Fallback recovery if insert failed (e.g. unique constraint or duplicate)
  if (normalizedTrack.title) {
    const titleVal = normalizedTrack.title.trim()

    const { data: fallbackUser } = await supabase
      .from('tracks')
      .select('id')
      .eq('user_id', userId)
      .eq('title', titleVal)
      .limit(1)
    if (fallbackUser && fallbackUser.length > 0 && fallbackUser[0].id) return fallbackUser[0].id

    const { data: fallbackGlobal } = await supabase
      .from('tracks')
      .select('id')
      .eq('title', titleVal)
      .limit(1)
    if (fallbackGlobal && fallbackGlobal.length > 0 && fallbackGlobal[0].id) return fallbackGlobal[0].id
  }

  // Final fallback: match by file_path
  if (fallbackPath) {
    const { data: pathMatch } = await supabase
      .from('tracks')
      .select('id')
      .eq('file_path', fallbackPath)
      .limit(1)
    if (pathMatch && pathMatch.length > 0 && pathMatch[0].id) return pathMatch[0].id
  }

  return null
}

export async function addTrackToPlaylist(
  supabase: SupabaseClient,
  playlistId: string,
  track: Track,
  userId: string,
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: 'Vui lòng đăng nhập để thêm bài hát vào playlist!' }
  }

  let targetTrackId = track.id

  if (
    isExternalTrack(track) ||
    !track.id ||
    !UUID_REGEX.test(track.id)
  ) {
    const resolvedId = await resolveExternalTrackId(supabase, track, userId)
    if (!resolvedId) {
      return { success: false, message: 'Lỗi lưu bài hát vào CSDL. Vui lòng thử lại!' }
    }
    targetTrackId = resolvedId
  }

  // 1. Direct insert to playlist_tracks table
  const { error: directInsertError } = await supabase.from('playlist_tracks').insert({
    playlist_id: playlistId,
    track_id: targetTrackId,
  })

  if (!directInsertError) {
    return { success: true, message: 'Đã thêm bài hát vào playlist!' }
  }

  // Handle duplicate / unique constraint
  if (
    directInsertError.code === '23505' ||
    directInsertError.message?.includes('unique') ||
    directInsertError.message?.includes('duplicate')
  ) {
    return { success: true, message: 'Bài hát này đã có trong playlist!' }
  }

  // 2. Fallback to RPC function
  const { error: rpcError } = await Promise.resolve(
    supabase.rpc('fn_add_track_to_playlist', {
      p_playlist_id: playlistId,
      p_track_id: targetTrackId,
    })
  )

  if (!rpcError) {
    return { success: true, message: 'Đã thêm bài hát vào playlist!' }
  }

  if (
    rpcError.code === '23505' ||
    rpcError.message?.includes('unique') ||
    rpcError.message?.includes('duplicate')
  ) {
    return { success: true, message: 'Bài hát này đã có trong playlist!' }
  }

  return {
    success: false,
    message: directInsertError.message || rpcError.message || 'Lỗi thêm bài hát vào playlist',
  }
}

