// app/api/playlists/[id]/route.ts
import { requireUser, requirePlaylistOwner, adminClient } from '@/lib/serverUser'

export async function PATCH(
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

  const body = await req.json().catch(() => ({}))
  const { name, description } = body

  const { data, error } = await adminClient
    .from('playlists')
    .update({ name, description })
    .eq('id', playlistId)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ playlist: data })
}

export async function DELETE(
  _req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const params = await Promise.resolve(props.params)
  const playlistId = params.id

  const owned = await requirePlaylistOwner(playlistId, userId)
  if (owned instanceof Response) return owned

  // Xóa các bài trong playlist trước (giữ đúng thứ tự như code cũ)
  await adminClient.from('playlist_tracks').delete().eq('playlist_id', playlistId)

  const { error } = await adminClient.from('playlists').delete().eq('id', playlistId)
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
