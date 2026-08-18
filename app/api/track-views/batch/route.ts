import { NextRequest, NextResponse } from 'next/server'
import { fetchViewCountForVideo, searchYouTubeTracks } from '@/lib/youtube'

const viewCountMemoryCache = new Map<string, { viewCount: number | null; timestamp: number }>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour in-memory cache
const MAX_CACHE_SIZE = 1000

interface BatchTrackRequest {
  youtube_id?: string
  title?: string
  artist?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const tracks: BatchTrackRequest[] = Array.isArray(body.tracks) ? body.tracks : []

    if (tracks.length === 0) {
      return NextResponse.json({ views: {} }, {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
        },
      })
    }

    // Limit batch size to prevent abuse
    const limitedTracks = tracks.slice(0, 100)

    const results: Record<string, number | null> = {}
    const uncached: { index: number; cacheKey: string; track: BatchTrackRequest }[] = []

    // Phase 1: Check memory cache for all tracks
    for (let i = 0; i < limitedTracks.length; i++) {
      const track = limitedTracks[i]
      const cacheKey =
        track.youtube_id ||
        `${(track.title || '').trim().toLowerCase()}_${(track.artist || '').trim().toLowerCase()}`

      if (!cacheKey || cacheKey === '_') continue

      const cached = viewCountMemoryCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        results[cacheKey] = cached.viewCount
      } else {
        uncached.push({ index: i, cacheKey, track })
      }
    }

    // Phase 2: Resolve uncached tracks in parallel (limit concurrency to 5)
    const CONCURRENCY = 5
    for (let i = 0; i < uncached.length; i += CONCURRENCY) {
      const batch = uncached.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.allSettled(
        batch.map(async ({ track, cacheKey }) => {
          let viewCount: number | null = null

          // Try youtube_id first
          if (track.youtube_id) {
            viewCount = await fetchViewCountForVideo(track.youtube_id)
          }

          // Fallback: search YouTube by title + artist
          if (viewCount == null && track.title?.trim()) {
            const query = `${(track.artist || '').trim()} ${track.title.trim()} official`.trim()
            const searchResults = await searchYouTubeTracks(query, 3)
            if (searchResults && searchResults.length > 0) {
              const match =
                searchResults.find((r) => r.view_count != null && r.view_count > 0) || searchResults[0]
              viewCount = match?.view_count ?? null
            }
          }

          return { cacheKey, viewCount }
        })
      )

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const { cacheKey, viewCount } = result.value
          results[cacheKey] = viewCount

          // Store in memory cache
          if (viewCountMemoryCache.size > MAX_CACHE_SIZE) {
            const oldestKey = viewCountMemoryCache.keys().next().value
            if (oldestKey) viewCountMemoryCache.delete(oldestKey)
          }
          viewCountMemoryCache.set(cacheKey, { viewCount, timestamp: Date.now() })
        }
      }
    }

    return NextResponse.json(
      { views: results },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
        },
      }
    )
  } catch (err) {
    console.warn('API track-views/batch error:', err)
    return NextResponse.json({ views: {} })
  }
}
