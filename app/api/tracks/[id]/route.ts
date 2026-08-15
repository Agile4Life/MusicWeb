// app/api/tracks/[id]/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const params = await Promise.resolve(props.params)
  const trackId = params?.id

  if (!trackId) {
    return Response.json({ error: 'Thiếu ID bài hát' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const { title, artist, album } = body || {}

  try {
    const updateData: Record<string, any> = { updated_at: new Date().toISOString() }
    if (typeof title === 'string') updateData.title = title.trim()
    if (artist !== undefined) updateData.artist = typeof artist === 'string' ? artist.trim() || null : null
    if (album !== undefined) updateData.album = typeof album === 'string' ? album.trim() || null : null

    const { data, error } = await adminClient
      .from('tracks')
      .update(updateData)
      .eq('id', trackId)
      .eq('user_id', userId) // chỉ chủ sở hữu mới sửa được
      .select()
      .single()

    if (error) throw error
    if (!data) {
      return Response.json({ error: 'Không tìm thấy track hoặc không có quyền sửa' }, { status: 403 })
    }
    return Response.json({ track: data })
  } catch (err: any) {
    console.error('[tracks/PATCH] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
