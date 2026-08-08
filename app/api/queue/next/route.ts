import { NextRequest, NextResponse } from 'next/server'
import { buildNextQueue } from '@/lib/queueRecommend'
import { QueueTrack } from '@/types/queue'
import { getServerSession } from 'next-auth'

// In-memory cache for queue recommendations by seed track ID (15 minutes expiry)
const queueCache = new Map<string, { data: any; expiresAt: number }>()

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const currentTrackId = searchParams.get('current_track_id') || searchParams.get('seed_id') || ''
    const artist = searchParams.get('artist') || ''
    const title = searchParams.get('title') || ''
    const isrc = searchParams.get('isrc') || undefined
    const limit = parseInt(searchParams.get('limit') || '12', 10)
    let userId = searchParams.get('user_id') || undefined

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

    // Generate cache key
    const cacheKey = `${currentTrackId}:${artist}:${title}:${userId || 'anonymous'}`
    const cached = queueCache.get(cacheKey)

    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json(cached.data, {
        headers: { 'X-Cache': 'HIT', 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60' },
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
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60' },
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
