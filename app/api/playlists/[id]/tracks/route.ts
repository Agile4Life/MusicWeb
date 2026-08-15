// app/api/playlists/[id]/tracks/route.ts
import { requireUser, requirePlaylistOwner, adminClient } from '@/lib/serverUser'
import { resolveExternalTrackId, isExternalTrack } from '@/lib/trackPersistence'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const params = await Promise.resolve(props.params)
  const playlistId = params.id

  const owned = await requirePlaylistOwner(playlistId, userId)
  if (owned instanceof Response) return owned

  const body = await req.json().catch(() => null)
  const track = body?.track
  if (!track) {
    return Response.json({ error: 'Thiếu track' }, { status: 400 })
  }

  let targetTrackId = track.id
  if (isExternalTrack(track) || !track.id || !UUID_REGEX.test(track.id)) {
    const resolvedId = await resolveExternalTrackId(adminClient, track, userId)
    if (!resolvedId) {
      return Response.json({ error: 'Lỗi lưu bài hát vào CSDL' }, { status: 500 })
    }
    targetTrackId = resolvedId
  }

  const { error: insertErr } = await adminClient.from('playlist_tracks').insert({
    playlist_id: playlistId,
    track_id: targetTrackId,
  })

  if (!insertErr) {
    return Response.json({ success: true, message: 'Đã thêm bài hát vào playlist!' })
  }

  // Bắt lỗi trùng (Unique constraint) — giữ đúng hành vi cũ
  if (insertErr.code === '23505' || insertErr.message?.includes('duplicate')) {
    return Response.json({ success: true, message: 'Bài hát này đã có trong playlist!' })
  }

  return Response.json({ success: false, message: insertErr.message }, { status: 500 })
}

export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const params = await Promise.resolve(props.params)
  const playlistId = params.id

  const owned = await requirePlaylistOwner(playlistId, userId)
  if (owned instanceof Response) return owned

  const { searchParams } = new URL(req.url)
  const trackId = searchParams.get('trackId')
  if (!trackId) {
    return Response.json({ error: 'Thiếu trackId' }, { status: 400 })
  }

  const { error } = await adminClient
    .from('playlist_tracks')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('track_id', trackId)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
