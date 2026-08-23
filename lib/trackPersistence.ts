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
  // Phase A & B Consolidated: Lookup by any ID across all users
  const idLookups: string[] = []
  if (normalizedTrack.nhaccuatui_id) idLookups.push(`nhaccuatui_id.eq.${normalizedTrack.nhaccuatui_id}`)
  if (normalizedTrack.spotify_id) idLookups.push(`spotify_id.eq.${normalizedTrack.spotify_id}`)
  if (normalizedTrack.youtube_id) idLookups.push(`youtube_id.eq.${normalizedTrack.youtube_id}`)
  if (normalizedTrack.soundcloud_id) idLookups.push(`file_path.eq.soundcloud:${normalizedTrack.soundcloud_id}`)
  if (normalizedTrack.soundcloud_permalink_url) idLookups.push(`file_path.eq.${normalizedTrack.soundcloud_permalink_url}`)
  if (normalizedTrack.file_path) idLookups.push(`file_path.eq.${normalizedTrack.file_path}`)

  if (idLookups.length > 0) {
    try {
      const { data: idMatches } = await supabase
        .from('tracks')
        .select('id, user_id')
        .or(idLookups.join(','))
        .limit(10)
      
      if (idMatches && idMatches.length > 0) {
        const userMatch = idMatches.find(m => m.user_id === userId)
        if (userMatch) return userMatch.id
        return idMatches[0].id
      }
    } catch (e) {
      console.warn('ID lookup error:', e)
    }
  }

  // Phase C: Search by exact title + artist match
  // TODO: [Ticket Data-Quality] Fix mismatch between client NFKC normalization and server exact string match in Phase C.
  // The client uses .trim().toLowerCase().normalize('NFKC') while the server uses exact string matching. 
  // This causes duplicates in DB when strings differ in Unicode normalization or casing.
  if (normalizedTrack.title) {
    const titleVal = normalizedTrack.title.trim()
    const artistVal = (normalizedTrack.artist || '').trim()

    try {
      let query = supabase.from('tracks').select('id, user_id').eq('title', titleVal)
      if (artistVal) {
        query = query.eq('artist', artistVal)
      }
      
      const { data: titleMatches } = await query.limit(10)
      if (titleMatches && titleMatches.length > 0) {
        const userMatch = titleMatches.find(m => m.user_id === userId)
        if (userMatch) return userMatch.id
        return titleMatches[0].id
      }
    } catch (e) {
      console.warn('Title lookup error:', e)
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
  playlistId: string,
  track: Track,
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`/api/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track }),
    })

    const data = await res.json().catch(() => null)

    if (res.status === 401) {
      return { success: false, message: 'Vui lòng đăng nhập để thêm bài hát vào playlist!' }
    }
    if (res.status === 403) {
      return { success: false, message: 'Bạn không có quyền với playlist này.' }
    }
    if (!res.ok) {
      return { success: false, message: data?.message ?? data?.error ?? 'Lỗi lưu bài hát vào CSDL' }
    }

    return { success: true, message: data?.message ?? 'Đã thêm bài hát vào playlist!' }
  } catch (err: any) {
    return { success: false, message: err?.message ?? 'Lỗi kết nối' }
  }
}

