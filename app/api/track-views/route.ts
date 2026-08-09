import { NextRequest, NextResponse } from 'next/server'
import { fetchViewCountForVideo, searchYouTubeTracks } from '@/lib/youtube'

const viewCountMemoryCache = new Map<string, { viewCount: number | null; timestamp: number }>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour in-memory cache

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const youtubeId = searchParams.get('youtube_id') || ''
    const title = searchParams.get('title') || ''
    const artist = searchParams.get('artist') || ''

    if (!youtubeId && !title.trim()) {
      return NextResponse.json({ viewCount: null })
    }

    const cacheKey = youtubeId || `${title.trim().toLowerCase()}_${artist.trim().toLowerCase()}`

    // 1. Check in-memory cache (<1ms)
    const cached = viewCountMemoryCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json(
        { viewCount: cached.viewCount },
        {
          headers: {
            'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
          },
        }
      )
    }

    let viewCount: number | null = null

    // 2. Fetch via youtube_id if available
    if (youtubeId) {
      viewCount = await fetchViewCountForVideo(youtubeId)
    }

    // 3. Fallback: Search YouTube by title + artist to get view count
    if (viewCount == null && title.trim()) {
      const query = `${artist.trim()} ${title.trim()} official`.trim()
      const results = await searchYouTubeTracks(query, 3)
      if (results && results.length > 0) {
        const match = results.find((r) => r.view_count != null && r.view_count > 0) || results[0]
        viewCount = match?.view_count ?? null
      }
    }

    // Cache result
    if (viewCountMemoryCache.size > 500) {
      const oldestKey = viewCountMemoryCache.keys().next().value
      if (oldestKey) viewCountMemoryCache.delete(oldestKey)
    }
    viewCountMemoryCache.set(cacheKey, { viewCount, timestamp: Date.now() })

    return NextResponse.json(
      { viewCount },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
        },
      }
    )
  } catch (err) {
    console.warn('API track-views error:', err)
    return NextResponse.json({ viewCount: null })
  }
}
