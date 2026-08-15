// app/api/history/list/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function GET(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200)

  try {
    const { data: historyRows, error: historyError } = await adminClient
      .from('listening_history')
      .select('id, user_id, track_id, played_at')
      .eq('user_id', userId)
      .order('played_at', { ascending: false })
      .limit(limit)

    if (historyError) throw new Error(historyError.message)

    const trackIds = Array.from(new Set((historyRows ?? []).map((r: any) => r.track_id).filter(Boolean)))
    let trackMap = new Map<string, any>()

    if (trackIds.length > 0) {
      const { data: tracks, error: trackError } = await adminClient
        .from('tracks')
        .select('*')
        .in('id', trackIds)
      if (trackError) throw new Error(trackError.message)
      for (const t of tracks ?? []) trackMap.set(t.id, t)
    }

    const items = (historyRows ?? []).map((row: any) => ({
      id: row.id,
      played_at: row.played_at,
      track: trackMap.get(row.track_id) ?? null,
    }))

    return Response.json({ items })
  } catch (err: any) {
    console.error('[history/list] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
