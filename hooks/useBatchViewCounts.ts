'use client'

import { useState, useEffect } from 'react'
import { Track } from '@/types'

/**
 * Batch-fetch YouTube view counts for a list of tracks in a single POST request.
 *
 * Returns a Map keyed by the same cache-key formula used by /api/track-views/batch:
 *   track.youtube_id  OR  `${title.trim().toLowerCase()}_${artist.trim().toLowerCase()}`
 *
 * This replaces the N+1 pattern where each TrackRow independently called
 * /api/track-views, causing burst Serverless Function invocations on Vercel.
 */
export function useBatchViewCounts(tracks: Track[]): Map<string, number | null> {
  const [batchViews, setBatchViews] = useState<Map<string, number | null>>(new Map())

  useEffect(() => {
    if (!tracks || tracks.length === 0) return

    // Only fetch for tracks that don't already have view_count embedded
    const needsFetch = tracks.filter(
      (t) => (t.view_count == null || t.view_count <= 0) && (t.title || t.youtube_id)
    )
    if (needsFetch.length === 0) return

    let isMounted = true
    const payload = needsFetch.map((t) => ({
      youtube_id: t.youtube_id || undefined,
      title: t.title || undefined,
      artist: t.artist || undefined,
    }))

    fetch('/api/track-views/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: payload }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data?.views) {
          setBatchViews(new Map(Object.entries(data.views)))
        }
      })
      .catch(() => {})

    return () => {
      isMounted = false
    }
  }, [tracks])

  return batchViews
}

/**
 * Compute the cache key for a track — must match the key used by
 * /api/track-views/batch and useBatchViewCounts.
 */
export function getViewCountCacheKey(track: Pick<Track, 'youtube_id' | 'title' | 'artist'>): string {
  return (
    track.youtube_id ||
    `${(track.title || '').trim().toLowerCase()}_${(track.artist || '').trim().toLowerCase()}`
  )
}
