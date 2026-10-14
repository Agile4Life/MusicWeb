// app/api/tracks/[id]/cache-meta/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/

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
  const candidateYoutubeId =
    typeof body?.youtube_id === 'string' && YOUTUBE_ID_REGEX.test(body.youtube_id.trim())
      ? body.youtube_id.trim()
      : undefined
  const candidateDuration =
    typeof body?.duration === 'number' && Number.isFinite(body.duration) && body.duration > 0 && body.duration < 86400
      ? Math.round(body.duration)
      : undefined

  if (!candidateYoutubeId && !candidateDuration) {
    return Response.json({ error: 'Không có field hợp lệ để cache' }, { status: 400 })
  }

  try {
    const { data: existingTrack, error: fetchErr } = await adminClient
      .from('tracks')
      .select('id, user_id, youtube_id, duration')
      .eq('id', trackId)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existingTrack) {
      return Response.json({ error: 'Bài hát không tồn tại' }, { status: 404 })
    }

    const isOwner = existingTrack.user_id === userId
    const patch: Record<string, any> = {}

    // Non-owners may only backfill missing metadata, never overwrite existing values
    if (candidateYoutubeId && (isOwner || !existingTrack.youtube_id)) {
      patch.youtube_id = candidateYoutubeId
    }
    if (candidateDuration && (isOwner || !existingTrack.duration || existingTrack.duration <= 0)) {
      patch.duration = candidateDuration
    }

    if (Object.keys(patch).length === 0) {
      return Response.json({ success: true, skipped: true })
    }

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
