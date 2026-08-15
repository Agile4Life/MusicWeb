// app/api/tracks/[id]/cache-meta/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireUser() // chỉ cần đã đăng nhập, không cần là chủ track
  if (auth instanceof Response) return auth

  const params = await Promise.resolve(props.params)
  const trackId = params?.id

  if (!trackId) {
    return Response.json({ error: 'Thiếu ID bài hát' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const patch: Record<string, any> = {}
  if (typeof body?.youtube_id === 'string' && body.youtube_id.trim()) {
    patch.youtube_id = body.youtube_id.trim()
  }
  if (typeof body?.duration === 'number' && body.duration > 0) {
    patch.duration = Math.round(body.duration)
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'Không có field hợp lệ để cache' }, { status: 400 })
  }

  try {
    const { error } = await adminClient
      .from('tracks')
      .update(patch)
      .eq('id', trackId)

    if (error) throw error
    return Response.json({ success: true })
  } catch (err: any) {
    console.error('[tracks/cache-meta] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
