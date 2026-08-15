// app/api/playlists/[id]/route.ts
import { requireUser, requirePlaylistOwner, adminClient, getAuthenticatedUserId } from '@/lib/serverUser'

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const userId = await getAuthenticatedUserId()
  const params = await Promise.resolve(props.params)
  const playlistId = params?.id

  if (!playlistId) {
    return Response.json({ error: 'Thiếu ID playlist' }, { status: 400 })
  }

  try {
    const { data: playlist, error: plErr } = await adminClient
      .from('playlists')
      .select('*')
      .eq('id', playlistId)
      .single()

    if (plErr || !playlist) {
      return Response.json({ error: 'Playlist không tồn tại' }, { status: 404 })
    }

    // Check permissions: public OR owned by current user
    if (!playlist.is_public && playlist.user_id !== userId) {
      return Response.json({ error: 'Bạn không có quyền xem playlist này' }, { status: 403 })
    }

    // Fetch tracks joined with playlist_tracks
    const { data: ptData, error: ptErr } = await adminClient
      .from('playlist_tracks')
      .select('position, tracks:track_id(*)')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: true })

    if (ptErr) throw ptErr

    const tracks = (ptData || [])
      .map((item: any) => {
        if (!item.tracks) return null
        return {
          ...item.tracks,
          artist: item.tracks.artist || null,
          album: item.tracks.album || null,
        }
      })
      .filter(Boolean)

    return Response.json({ playlist, tracks })
  } catch (err: any) {
    console.error('[playlists/[id]/GET] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

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
  const { name, description, coverUrl, isPublic } = body

  const updates: Record<string, any> = {}
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()
  if (description !== undefined) updates.description = description
  if (coverUrl !== undefined) updates.cover_url = coverUrl
  if (isPublic !== undefined) updates.is_public = Boolean(isPublic)

  const { data, error } = await adminClient
    .from('playlists')
    .update(updates)
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
