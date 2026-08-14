import type { SupabaseClient } from '@supabase/supabase-js'
import type { Track, Playlist } from '@/types'
import { getAllValidUserIds } from '@/lib/accessControl'
import { fetchListeningHistory, getRecentUniqueTracks } from '@/lib/listeningHistory'
import type { ReceiptTrackItem } from '@/lib/receiptCanvas'

export type ReceiptDataSource = 'queue' | 'history' | 'favorites' | 'playlist'

export interface FetchReceiptTracksParams {
  supabase: SupabaseClient
  source: ReceiptDataSource
  currentUser?: any
  nextAuthSession?: any
  currentTrack?: Track | null
  queue?: Track[]
  playlists?: Playlist[]
  limit?: number
}

/**
 * Fetches and transforms tracks for Receiptify based on the selected data source.
 * Handles database querying, multi-identity access control, and in-memory session fallbacks.
 */
export async function fetchReceiptTracks({
  supabase,
  source,
  currentUser,
  nextAuthSession,
  currentTrack,
  queue = [],
  playlists = [],
  limit = 50,
}: FetchReceiptTracksParams): Promise<ReceiptTrackItem[]> {
  const userIds = getAllValidUserIds(currentUser, nextAuthSession)

  if (source === 'queue') {
    const queueTracks: Track[] = []
    if (currentTrack) queueTracks.push(currentTrack)
    if (queue && queue.length > 0) {
      queue.forEach((t) => {
        if (!queueTracks.some((existing) => existing.id === t.id)) {
          queueTracks.push(t)
        }
      })
    }
    return queueTracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      duration: t.duration,
    }))
  }

  if (source === 'history') {
    let items: ReceiptTrackItem[] = []
    if (userIds.length > 0) {
      try {
        const entries = await fetchListeningHistory(supabase, userIds, limit)
        const unique = getRecentUniqueTracks(entries)
        items = unique.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          duration: t.duration,
        }))
      } catch (err) {
        console.warn('[ReceiptTracks] fetchListeningHistory error:', err)
      }
    }

    // Fallback: If DB history is empty or user is guest, use in-memory played / active queue tracks
    if (items.length === 0) {
      const fallbackTracks: Track[] = []
      if (currentTrack) fallbackTracks.push(currentTrack)
      if (queue && queue.length > 0) {
        queue.forEach((t) => {
          if (!fallbackTracks.some((existing) => existing.id === t.id)) {
            fallbackTracks.push(t)
          }
        })
      }
      items = fallbackTracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
      }))
    }

    return items
  }

  if (source === 'favorites') {
    let items: ReceiptTrackItem[] = []
    if (userIds.length > 0) {
      try {
        const { data: favRows, error: favError } = await supabase
          .from('favorite_tracks')
          .select('track_id, created_at')
          .in('user_id', userIds)
          .order('created_at', { ascending: false })
          .limit(limit)

        if (!favError && favRows && favRows.length > 0) {
          const trackIds = Array.from(
            new Set(favRows.map((r: any) => r.track_id).filter(Boolean))
          )
          if (trackIds.length > 0) {
            const { data: tracksData, error: trackError } = await supabase
              .from('tracks')
              .select('*')
              .in('id', trackIds)

            if (!trackError && tracksData) {
              const trackMap = new Map<string, Track>()
              tracksData.forEach((t: any) => {
                if (t?.id) trackMap.set(t.id, t as Track)
              })

              const seen = new Set<string>()
              favRows.forEach((r: any) => {
                const t = trackMap.get(r.track_id)
                if (t && !seen.has(t.id)) {
                  seen.add(t.id)
                  items.push({
                    id: t.id,
                    title: t.title,
                    artist: t.artist,
                    duration: t.duration,
                  })
                }
              })
            }
          }
        }
      } catch (err) {
        console.warn('[ReceiptTracks] favorites fetch error:', err)
      }
    }
    return items
  }

  if (source === 'playlist') {
    let items: ReceiptTrackItem[] = []
    if (playlists.length > 0) {
      try {
        const firstPlaylistId = playlists[0].id
        const { data: ptData, error: ptError } = await supabase
          .from('playlist_tracks')
          .select('track_id, position')
          .eq('playlist_id', firstPlaylistId)
          .order('position', { ascending: true })
          .limit(limit)

        if (!ptError && ptData && ptData.length > 0) {
          const trackIds = ptData.map((pt: any) => pt.track_id).filter(Boolean)
          if (trackIds.length > 0) {
            const { data: tracksData, error: trackError } = await supabase
              .from('tracks')
              .select('*')
              .in('id', trackIds)

            if (!trackError && tracksData) {
              const trackMap = new Map<string, Track>()
              tracksData.forEach((t: any) => {
                if (t?.id) trackMap.set(t.id, t as Track)
              })
              ptData.forEach((pt: any) => {
                const t = trackMap.get(pt.track_id)
                if (t) {
                  items.push({
                    id: t.id,
                    title: t.title,
                    artist: t.artist,
                    duration: t.duration,
                  })
                }
              })
            }
          }
        }
      } catch (err) {
        console.warn('[ReceiptTracks] playlist tracks fetch error:', err)
      }
    }
    return items
  }

  return []
}
