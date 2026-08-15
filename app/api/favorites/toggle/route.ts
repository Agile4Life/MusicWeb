// app/api/favorites/toggle/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const body = await req.json().catch(() => null)
  const trackId = body?.trackId
  const nextValue = body?.nextValue // true = thêm, false = bỏ

  if (!trackId || typeof nextValue !== 'boolean') {
    return Response.json({ error: 'Thiếu trackId hoặc nextValue' }, { status: 400 })
  }

  try {
    if (nextValue) {
      const { error } = await adminClient
        .from('favorite_tracks')
        .upsert({ user_id: userId, track_id: trackId }, { onConflict: 'user_id,track_id' })
      if (error) throw error
    } else {
      const { error } = await adminClient
        .from('favorite_tracks')
        .delete()
        .eq('user_id', userId)
        .eq('track_id', trackId)
      if (error) throw error
    }
    return Response.json({ success: true })
  } catch (err: any) {
    console.error('[favorites/toggle] Failed:', err.code, err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
