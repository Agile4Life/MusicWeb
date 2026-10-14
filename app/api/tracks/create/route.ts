import { NextRequest, NextResponse } from 'next/server'
import { requireUser, adminClient } from '@/lib/serverUser'

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  try {
    const body = await req.json()
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const filePath = typeof body?.file_path === 'string' ? body.file_path.trim() : ''

    if (!title || !filePath) {
      return NextResponse.json({ error: 'Thiếu tiêu đề hoặc đường dẫn bài hát' }, { status: 400 })
    }

    const insertPayload: Record<string, any> = {
      user_id: userId,
      title,
      artist: typeof body?.artist === 'string' && body.artist.trim() ? body.artist.trim() : null,
      album: typeof body?.album === 'string' && body.album.trim() ? body.album.trim() : null,
      duration: typeof body?.duration === 'number' && body.duration > 0 ? Math.round(body.duration) : 0,
      file_path: filePath,
    }

    if (typeof body?.file_size === 'number' && body.file_size > 0) {
      insertPayload.file_size = body.file_size
    }
    if (typeof body?.file_ext === 'string' && body.file_ext.trim()) {
      insertPayload.file_ext = body.file_ext.trim().toLowerCase()
    }
    if (typeof body?.drive_file_id === 'string' && body.drive_file_id.trim()) {
      insertPayload.drive_file_id = body.drive_file_id.trim()
    }
    if (typeof body?.cover_url === 'string' && body.cover_url.trim()) {
      insertPayload.cover_url = body.cover_url.trim()
    }
    if (typeof body?.source === 'string' && body.source.trim()) {
      insertPayload.source = body.source.trim()
    }
    if (typeof body?.youtube_id === 'string' && body.youtube_id.trim()) {
      insertPayload.youtube_id = body.youtube_id.trim()
    }
    if (typeof body?.spotify_id === 'string' && body.spotify_id.trim()) {
      insertPayload.spotify_id = body.spotify_id.trim()
    }
    if (typeof body?.nhaccuatui_id === 'string' && body.nhaccuatui_id.trim()) {
      insertPayload.nhaccuatui_id = body.nhaccuatui_id.trim()
    }

    const { data: trackData, error: dbError } = await adminClient
      .from('tracks')
      .insert(insertPayload)
      .select('*')
      .single()

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    const playlistId = typeof body?.playlist_id === 'string' ? body.playlist_id.trim() : ''
    if (playlistId && trackData?.id) {
      try {
        const { data: playlist } = await adminClient
          .from('playlists')
          .select('id, user_id')
          .eq('id', playlistId)
          .single()

        if (playlist && playlist.user_id === userId) {
          await adminClient.rpc('fn_add_track_to_playlist', {
            p_playlist_id: playlistId,
            p_track_id: trackData.id,
          })
        }
      } catch (plErr) {
        console.warn('[tracks/create] Could not add track to playlist:', plErr)
      }
    }

    return NextResponse.json({ ok: true, track: trackData })
  } catch (err: any) {
    console.error('[tracks/create] Error:', err)
    return NextResponse.json({ error: err?.message || 'Lỗi lưu bài hát' }, { status: 500 })
  }
}
