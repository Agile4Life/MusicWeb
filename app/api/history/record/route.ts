// app/api/history/record/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'
import { resolveExternalTrackId, isExternalTrack } from '@/lib/trackPersistence'

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const body = await req.json().catch(() => null)
  const track = body?.track
  if (!track?.id) {
    return Response.json({ error: 'Thiếu track' }, { status: 400 })
  }

  try {
    let dbTrackId = track.id
    if (isExternalTrack(track)) {
      const resolvedId = await resolveExternalTrackId(adminClient, track, userId)
      if (!resolvedId) {
        return Response.json({ error: 'Không resolve được track ngoài' }, { status: 500 })
      }
      dbTrackId = resolvedId
    }

    const { error: insertErr } = await adminClient.from('listening_history').insert({
      user_id: userId,
      track_id: dbTrackId,
      played_at: new Date().toISOString(),
    })

    if (insertErr) {
      console.error('[history/record] Insert FAILED:', insertErr.code, insertErr.message)
      return Response.json({ error: insertErr.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (err: any) {
    console.warn('History tracking error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
