import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchAudiusTracks, getTrendingAudiusTracks } from '@/lib/audius'
import { searchYouTubeTracks, getTrendingYouTubeTracks, findBestYouTubeMatch } from '@/lib/youtube'
import { searchITunesTracks, getTrendingITunesTracks } from '@/lib/itunes'
import { searchSpotifyTracks, getTrendingSpotifyTracks } from '@/lib/spotify'
import { Track } from '@/types'

// In-memory LRU search cache & in-flight request deduplication map
const searchCache = new Map<string, { data: any; timestamp: number }>()
const inFlightRequests = new Map<string, Promise<any>>()
const CACHE_TTL = 180 * 1000

export const maxDuration = 15

function cachedJsonResponse(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    },
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''
  const source = searchParams.get('source') || 'all'
  const isTrending = searchParams.get('trending') === 'true'

  // Handle Trending Global Request
  if (isTrending || (!q.trim() && searchParams.has('trending'))) {
    try {
      const cacheKey = `trending_${source}`
      const cached = searchCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cachedJsonResponse(cached.data)
      }

      if (inFlightRequests.has(cacheKey)) {
        const data = await inFlightRequests.get(cacheKey)
        return cachedJsonResponse(data)
      }

      const trendingPromise = (async () => {
        const [ytTrending, audiusTrending, itunesTrending, spotifyTrending] = await Promise.all([
          getTrendingYouTubeTracks(8).catch(() => []),
          getTrendingAudiusTracks(8).catch(() => []),
          getTrendingITunesTracks(8).catch(() => []),
          getTrendingSpotifyTracks(8).catch(() => []),
        ])

        return {
          youtube: ytTrending,
          audius: audiusTrending,
          itunes: itunesTrending,
          spotify: spotifyTrending,
        }
      })()

      inFlightRequests.set(cacheKey, trendingPromise)

      try {
        const responseData = await trendingPromise
        searchCache.set(cacheKey, { data: responseData, timestamp: Date.now() })
        return NextResponse.json(responseData)
      } finally {
        inFlightRequests.delete(cacheKey)
      }
    } catch (err: any) {
      return NextResponse.json({ youtube: [], audius: [], itunes: [], spotify: [] })
    }
  }

  if (!q.trim()) {
    return NextResponse.json({ local: [], youtube: [], audius: [], itunes: [], spotify: [] })
  }

  const query = q.trim().toLowerCase()
  const cacheKey = `${query}_${source}`

  // 1. Check completed cache first for instant (<10ms) search response
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // Re-insert to refresh LRU position
    searchCache.delete(cacheKey)
    searchCache.set(cacheKey, cached)
    return NextResponse.json(cached.data)
  }

  // 2. Check in-flight request to deduplicate concurrent duplicate requests from TopBar & Page
  if (inFlightRequests.has(cacheKey)) {
    try {
      const data = await inFlightRequests.get(cacheKey)
      return NextResponse.json(data)
    } catch {
      // Fall through if in-flight failed
    }
  }

  // 3. Create single shared promise for this query
  const searchPromise = (async () => {
    const promises: Array<Promise<any>> = []

    // 1. Search local Supabase tracks
    if (source === 'all' || source === 'local') {
      const supabase = await createClient()
      promises.push(
        (async () => {
          try {
            const cleanQuery = q.trim().replace(/[,()%"\\]/g, ' ').replace(/\s+/g, ' ').trim()
            if (!cleanQuery) return []
            const { data } = await supabase
              .from('tracks')
              .select('*')
              .or(`title.ilike.%${cleanQuery}%,artist.ilike.%${cleanQuery}%`)
              .limit(10)
            return (data || []).map((t: any) => ({ ...t, source: 'local' }))
          } catch {
            return []
          }
        })()
      )
    } else {
      promises.push(Promise.resolve([]))
    }

    // 2. Search YouTube tracks
    if (source === 'all' || source === 'youtube' || source === 'spotify' || source === 'itunes') {
      promises.push(searchYouTubeTracks(q.trim(), 10).catch(() => []))
    } else {
      promises.push(Promise.resolve([]))
    }

    // 3. Search Audius tracks
    if (source === 'all' || source === 'audius') {
      promises.push(searchAudiusTracks(q.trim(), 10).catch(() => []))
    } else {
      promises.push(Promise.resolve([]))
    }

    // 4. Search iTunes Global tracks
    if (source === 'all' || source === 'itunes') {
      promises.push(searchITunesTracks(q.trim(), 10).catch(() => []))
    } else {
      promises.push(Promise.resolve([]))
    }

    // 5. Search Spotify Global tracks
    if (source === 'all' || source === 'spotify') {
      promises.push(searchSpotifyTracks(q.trim(), 10).catch(() => []))
    } else {
      promises.push(Promise.resolve([]))
    }

    const [localTracks, youtubeTracks, audiusTracks, itunesTracks, spotifyTracks] = await Promise.all(promises)

    // Pre-assign YouTube stream IDs for Spotify & iTunes tracks using smart matching (avoiding wrong / 40+ min compilations)
    const enhancedSpotify = spotifyTracks.map((sTrack: Track) => {
      if (sTrack.youtube_id) return sTrack
      const match = findBestYouTubeMatch(youtubeTracks, sTrack.title, sTrack.artist, sTrack.duration)
      return match?.youtube_id ? { ...sTrack, youtube_id: match.youtube_id } : sTrack
    })

    const enhancedITunes = itunesTracks.map((iTrack: Track) => {
      if (iTrack.youtube_id) return iTrack
      const match = findBestYouTubeMatch(youtubeTracks, iTrack.title, iTrack.artist, iTrack.duration)
      return match?.youtube_id ? { ...iTrack, youtube_id: match.youtube_id } : iTrack
    })

    const minDurationFilter = (t: Track) => !t.duration || t.duration >= 25

    return {
      local: localTracks,
      youtube: youtubeTracks.filter(minDurationFilter),
      audius: audiusTracks.filter(minDurationFilter),
      itunes: enhancedITunes.filter(minDurationFilter),
      spotify: enhancedSpotify.filter(minDurationFilter),
    }
  })()

  inFlightRequests.set(cacheKey, searchPromise)

  try {
    const responseData = await searchPromise

    if (searchCache.size > 200) {
      const oldestKey = searchCache.keys().next().value
      if (oldestKey) searchCache.delete(oldestKey)
    }
    searchCache.set(cacheKey, { data: responseData, timestamp: Date.now() })

    return NextResponse.json(responseData)
  } catch (err: any) {
    console.error('Unified search route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    inFlightRequests.delete(cacheKey)
  }
}
