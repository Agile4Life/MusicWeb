// app/api/user/init-data/route.ts
// Combined endpoint: fetches favorites status + listening history in one function invocation
import { requireUser, adminClient } from '@/lib/serverUser'
import { getRecentUniqueTracks } from '@/lib/listeningHistory'

export async function GET(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const { searchParams } = new URL(req.url)
  const historyLimit = Math.min(parseInt(searchParams.get('history_limit') || '100', 10), 200)

  try {
    // Run both queries in parallel — single function invocation instead of two
    const [favResult, historyResult] = await Promise.all([
      adminClient
        .from('favorite_tracks')
        .select('track_id')
        .eq('user_id', userId),
      adminClient
        .from('listening_history')
        .select('id, user_id, track_id, played_at')
        .eq('user_id', userId)
        .order('played_at', { ascending: false })
        .limit(historyLimit),
    ])

    // Process favorites
    const trackIds = (favResult.data ?? []).map((r: any) => r.track_id)

    // Process history
    const historyRows = historyResult.data ?? []
    const histTrackIds = Array.from(
      new Set(historyRows.map((r: any) => r.track_id).filter(Boolean))
    )
    let trackMap = new Map<string, any>()

    if (histTrackIds.length > 0) {
      const { data: tracks, error: trackError } = await adminClient
        .from('tracks')
        .select('*')
        .in('id', histTrackIds)
      if (!trackError) {
        for (const t of tracks ?? []) trackMap.set(t.id, t)
      }
    }

    const historyItems = historyRows.map((row: any) => ({
      id: row.id,
      played_at: row.played_at,
      track: trackMap.get(row.track_id) ?? null,
    }))

    return Response.json({
      trackIds,
      history: { items: historyItems },
    })
  } catch (err: any) {
    console.error('[user/init-data] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
