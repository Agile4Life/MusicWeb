import { NextRequest, NextResponse } from 'next/server'
import { buildNextQueue } from '@/lib/queueRecommend'
import { QueueTrack } from '@/types/queue'
import { getServerSession } from 'next-auth'

const DEFAULT_LIMIT = 12
const MIN_LIMIT = 1
const MAX_LIMIT = 30

// In-memory cache for queue recommendations by seed track ID (15 minutes expiry)
const queueCache = new Map<string, { data: any; expiresAt: number }>()

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const currentTrackId = searchParams.get('current_track_id') || searchParams.get('seed_id') || ''
    const artist = searchParams.get('artist') || ''
    const title = searchParams.get('title') || ''
    const isrc = searchParams.get('isrc') || undefined
    const limitRaw = searchParams.get('limit')
    let userId = searchParams.get('user_id') || undefined

    let limit = DEFAULT_LIMIT
    if (limitRaw !== null) {
      const parsed = parseInt(limitRaw, 10)
      if (isNaN(parsed) || parsed < MIN_LIMIT) {
        return NextResponse.json(
          { error: 'Invalid limit parameter. Limit must be a positive integer.' },
          { status: 400 }
        )
      }
      limit = Math.min(parsed, MAX_LIMIT)
    }

    if (!artist && !title && !currentTrackId) {
      return NextResponse.json(
        { error: 'Missing current_track_id, artist, or title query parameter' },
        { status: 400 }
      )
    }

    if (!userId) {
      try {
        const session = await getServerSession()
        if (session?.user && (session.user as any).id) {
          userId = (session.user as any).id
        }
      } catch {}
    }

    // Generate structured cache key including all parameters that affect recommendation output
    const cacheKey = JSON.stringify({
      currentTrackId: currentTrackId || null,
      artist: artist || null,
      title: title || null,
      isrc: isrc || null,
      userId: userId || 'anonymous',
      limit,
    })

    const isAuth = Boolean(userId)
    const cacheControlHeader = isAuth
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, s-maxage=900, stale-while-revalidate=60'

    const cached = queueCache.get(cacheKey)

    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json(cached.data, {
        headers: { 'X-Cache': 'HIT', 'Cache-Control': cacheControlHeader },
      })
    }

    // Construct seed track
    let source: QueueTrack['source'] = 'spotify'
    if (currentTrackId.startsWith('deezer-')) source = 'deezer'
    else if (!currentTrackId.startsWith('spotify-')) source = 'internal_history'

    const seedTrack: QueueTrack = {
      id: currentTrackId || `seed-${Date.now()}`,
      title: title || 'Current Track',
      artist: artist || 'Nghệ sĩ chưa xác định',
      cover_url: null,
      duration: 180,
      isrc,
      source,
      source_id: currentTrackId.replace(/^(deezer|spotify)-/, ''),
      score: 1.0,
      score_reasons: ['seed_track'],
    }

    const result = await buildNextQueue(seedTrack, [], userId, limit)

    // Store in cache for 15 minutes (900,000 ms)
    queueCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + 15 * 60 * 1000,
    })

    // Clean up expired cache items if cache grows too large
    if (queueCache.size > 200) {
      const now = Date.now()
      for (const [k, v] of queueCache.entries()) {
        if (now >= v.expiresAt) queueCache.delete(k)
      }
    }

    return NextResponse.json(result, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': cacheControlHeader },
    })
  } catch (err: any) {
    console.error('Queue next API route error:', err)
    return NextResponse.json(
      {
        error: 'Failed to generate next queue',
        message: err?.message || String(err),
      },
      { status: 500 }
    )
  }
}
