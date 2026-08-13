import type { SupabaseClient } from '@supabase/supabase-js'
import type { ListeningHistoryItem, Track } from '@/types'

function toError(message: string | undefined, fallback: string): Error {
  return new Error(message || fallback)
}

export async function fetchListeningHistory(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
): Promise<ListeningHistoryItem[]> {
  const { data: historyRows, error: historyError } = await supabase
    .from('listening_history')
    .select('id, user_id, track_id, played_at')
    .eq('user_id', userId)
    .order('played_at', { ascending: false })
    .limit(limit)

  if (historyError) {
    throw toError(historyError.message, 'Failed to fetch listening history')
  }

  const rows = historyRows ?? []
  const trackIds = Array.from(
    new Set(
      rows
        .map((row: ListeningHistoryItem) => row.track_id)
        .filter((trackId): trackId is string => Boolean(trackId)),
    ),
  )

  if (trackIds.length === 0) {
    return []
  }

  const { data: tracks, error: trackError } = await supabase
    .from('tracks')
    .select('*')
    .in('id', trackIds)

  if (trackError) {
    throw toError(trackError.message, 'Failed to fetch listening history tracks')
  }

  const trackMap = new Map<string, Track>()
  for (const track of tracks ?? []) {
    if (track?.id) {
      trackMap.set(track.id, track as Track)
    }
  }

  return rows.flatMap((row: ListeningHistoryItem) => {
    const track = trackMap.get(row.track_id)
    if (!track) return []
    return [
      {
        ...row,
        track,
      },
    ]
  })
}

export function getRecentUniqueTracks(items: ListeningHistoryItem[]): Track[] {
  const seen = new Set<string>()
  const uniqueTracks: Track[] = []

  for (const item of items) {
    if (!item.track || seen.has(item.track.id)) continue
    seen.add(item.track.id)
    uniqueTracks.push(item.track)
  }

  return uniqueTracks
}
