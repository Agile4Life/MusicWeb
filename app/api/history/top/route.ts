// app/api/history/top/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'
import { aggregateTopTracks, ListeningHistoryItem } from '@/lib/listeningHistory'

export async function GET(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100)
  const timeframe = searchParams.get('timeframe') || 'all'

  let days = 0
  if (timeframe === '7days') days = 7
  else if (timeframe === '30days') days = 30

  try {
    let query = adminClient
      .from('listening_history')
      .select('id, user_id, track_id, played_at')
      .eq('user_id', userId)

    if (days > 0) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      query = query.gte('played_at', cutoff)
    }

    const { data: historyRows, error: historyError } = await query
      .order('played_at', { ascending: false })
      .limit(2000)

    if (historyError) throw new Error(historyError.message)

    const rows = historyRows ?? []
    const totalPlays = rows.length
    if (totalPlays === 0) {
      return Response.json({ items: [], totalPlays: 0 })
    }

    const trackIds = Array.from(
      new Set(
        rows
          .map((r: any) => r.track_id)
          .filter(Boolean),
      ),
    )

    let trackMap = new Map<string, any>()
    if (trackIds.length > 0) {
      const { data: tracks, error: trackError } = await adminClient
        .from('tracks')
        .select('*')
        .in('id', trackIds)
      if (trackError) throw new Error(trackError.message)
      for (const t of tracks ?? []) trackMap.set(t.id, t)
    }

    const historyItems: ListeningHistoryItem[] = rows.flatMap((row: any) => {
      const track = trackMap.get(row.track_id)
      if (!track) return []
      return [{ ...row, track }]
    })

    const items = aggregateTopTracks(historyItems, limit)

    return Response.json({ items, totalPlays })
  } catch (err: any) {
    console.error('[history/top] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
