// app/api/playlist-tracks/import-track/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const body = await req.json().catch(() => null)
  const { playlistId, position, track } = body || {}

  if (!playlistId || !track?.filePath) {
    return Response.json({ error: 'Thiếu playlistId hoặc track.filePath' }, { status: 400 })
  }

  try {
    // 0. Xác nhận playlist thuộc quyền sở hữu user hiện tại
    const { data: playlist, error: plErr } = await adminClient
      .from('playlists')
      .select('id')
      .eq('id', playlistId)
      .eq('user_id', userId)
      .single()

    if (plErr || !playlist) {
      return Response.json({ error: 'Không tìm thấy playlist hoặc không có quyền' }, { status: 403 })
    }

    // 1. Kiểm tra track đã tồn tại (dedupe theo nhaccuatui_id, youtube_id, file_path) chưa
    let dbTrackId: string | null = null

    if (track.nhaccuatuiId) {
      const { data: existingNct } = await adminClient
        .from('tracks')
        .select('id')
        .eq('nhaccuatui_id', track.nhaccuatuiId)
        .limit(1)
      if (existingNct && existingNct.length > 0) dbTrackId = existingNct[0].id
    }

    if (!dbTrackId && track.youtubeId) {
      const { data: existingYt } = await adminClient
        .from('tracks')
        .select('id')
        .eq('youtube_id', track.youtubeId)
        .limit(1)
      if (existingYt && existingYt.length > 0) dbTrackId = existingYt[0].id
    }

    if (!dbTrackId && track.filePath) {
      const { data: existing } = await adminClient
        .from('tracks')
        .select('id')
        .eq('file_path', track.filePath)
        .limit(1)
      if (existing && existing.length > 0) {
        dbTrackId = existing[0].id
      }
    }

    if (!dbTrackId) {
      // 2. Chưa có -> insert track mới
      const { data: inserted, error: insertErr } = await adminClient
        .from('tracks')
        .insert({
          user_id: userId,
          title: track.title || 'Untitled',
          artist: track.artist || 'Unknown Artist',
          album: track.album || null,
          duration: track.duration || 0,
          file_path: track.filePath,
          cover_url: track.coverUrl || null,
          source: track.source || null,
          youtube_id: track.youtubeId || null,
          spotify_id: track.spotifyId || null,
          nhaccuatui_id: track.nhaccuatuiId || null,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (insertErr) throw insertErr
      dbTrackId = inserted.id
    }

    // 3. Link vào playlist_tracks (check-then-insert an toàn chống lỗi ON CONFLICT)
    const { data: existingLink } = await adminClient
      .from('playlist_tracks')
      .select('id')
      .eq('playlist_id', playlistId)
      .eq('track_id', dbTrackId)
      .limit(1)

    if (!existingLink || existingLink.length === 0) {
      const { error: linkErr } = await adminClient
        .from('playlist_tracks')
        .insert({
          playlist_id: playlistId,
          track_id: dbTrackId,
          position: position || 0,
        })

      if (linkErr && linkErr.code !== '23505') throw linkErr
    }

    return Response.json({ success: true, trackId: dbTrackId })
  } catch (err: any) {
    console.error('[playlist-tracks/import-track] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
