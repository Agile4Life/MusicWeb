import type { SupabaseClient } from '@supabase/supabase-js'
import type { ListeningHistoryItem, Track } from '@/types'

export type { ListeningHistoryItem, Track }

function toError(message: string | undefined, fallback: string): Error {
  return new Error(message || fallback)
}

export async function fetchListeningHistory(
  supabase: SupabaseClient,
  userIds: string | string[],
  limit: number,
): Promise<ListeningHistoryItem[]> {
  const ids = Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [userIds])
        .filter((id): id is string => Boolean(id && typeof id === 'string')),
    ),
  )

  if (ids.length === 0) {
    return []
  }

  const query = supabase
    .from('listening_history')
    .select('id, user_id, track_id, played_at')

  const { data: historyRows, error: historyError } = await (
    ids.length === 1
      ? query.eq('user_id', ids[0])
      : query.in('user_id', ids)
  )
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

export interface TopHistoryTrackItem {
  track: Track
  playCount: number
  lastPlayedAt: string
}

/**
 * Aggregates a list of listening history entries into ranked unique tracks with play counts.
 */
export function aggregateTopTracks(
  items: ListeningHistoryItem[],
  limit: number = 50,
): TopHistoryTrackItem[] {
  const statsMap = new Map<string, { track: Track; playCount: number; lastPlayedAt: string }>()

  for (const item of items) {
    if (!item.track || !item.track.id) continue
    const trackId = item.track.id
    const existing = statsMap.get(trackId)
    const playedAt = item.played_at || new Date().toISOString()

    if (existing) {
      existing.playCount += 1
      if (new Date(playedAt) > new Date(existing.lastPlayedAt)) {
        existing.lastPlayedAt = playedAt
      }
    } else {
      statsMap.set(trackId, {
        track: {
          ...item.track,
          play_count: 1,
        },
        playCount: 1,
        lastPlayedAt: playedAt,
      })
    }
  }

  return Array.from(statsMap.values())
    .sort((a, b) => {
      if (b.playCount !== a.playCount) {
        return b.playCount - a.playCount
      }
      return new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime()
    })
    .slice(0, limit)
    .map((item) => ({
      ...item,
      track: {
        ...item.track,
        play_count: item.playCount,
      },
    }))
}

export async function fetchTopListeningHistory(
  supabase: SupabaseClient,
  userIds: string | string[],
  limit: number = 50,
  timeframeDays?: number,
): Promise<TopHistoryTrackItem[]> {
  const ids = Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [userIds])
        .filter((id): id is string => Boolean(id && typeof id === 'string')),
    ),
  )

  if (ids.length === 0) {
    return []
  }

  let query = supabase
    .from('listening_history')
    .select('id, user_id, track_id, played_at')

  if (ids.length === 1) {
    query = query.eq('user_id', ids[0])
  } else {
    query = query.in('user_id', ids)
  }

  if (typeof timeframeDays === 'number' && timeframeDays > 0) {
    const cutoff = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('played_at', cutoff)
  }

  const { data: historyRows, error: historyError } = await query
    .order('played_at', { ascending: false })
    .limit(2000)

  if (historyError) {
    throw toError(historyError.message, 'Failed to fetch listening history for top tracks')
  }

  const rows = historyRows ?? []
  if (rows.length === 0) return []

  const trackIds = Array.from(
    new Set(
      rows
        .map((row: ListeningHistoryItem) => row.track_id)
        .filter((trackId): trackId is string => Boolean(trackId)),
    ),
  )

  if (trackIds.length === 0) return []

  const { data: tracks, error: trackError } = await supabase
    .from('tracks')
    .select('*')
    .in('id', trackIds)

  if (trackError) {
    throw toError(trackError.message, 'Failed to fetch tracks for top listening history')
  }

  const trackMap = new Map<string, Track>()
  for (const track of tracks ?? []) {
    if (track?.id) {
      trackMap.set(track.id, track as Track)
    }
  }

  const historyItems: ListeningHistoryItem[] = rows.flatMap((row: ListeningHistoryItem) => {
    const track = trackMap.get(row.track_id)
    if (!track) return []
    return [{ ...row, track }]
  })

  return aggregateTopTracks(historyItems, limit)
}
