import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchAudiusTracks, getTrendingAudiusTracks } from '@/lib/audius'
import { searchYouTubeTracks, getTrendingYouTubeTracks, findBestYouTubeMatch } from '@/lib/youtube'
import { searchITunesTracks, getTrendingITunesTracks } from '@/lib/itunes'
import { searchSpotifyTracks, getTrendingSpotifyTracks } from '@/lib/spotify'
import { Track } from '@/types'

// In-memory LRU search cache (TTL 3 minutes = 180,000 ms)
const searchCache = new Map<string, { data: any; timestamp: number }>()
const CACHE_TTL = 180 * 1000

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
        return NextResponse.json(cached.data)
      }

      const [ytTrending, audiusTrending, itunesTrending, spotifyTrending] = await Promise.all([
        getTrendingYouTubeTracks(8).catch(() => []),
        getTrendingAudiusTracks(8).catch(() => []),
        getTrendingITunesTracks(8).catch(() => []),
        getTrendingSpotifyTracks(8).catch(() => []),
      ])

      const responseData = {
        youtube: ytTrending,
        audius: audiusTrending,
        itunes: itunesTrending,
        spotify: spotifyTrending,
      }

      searchCache.set(cacheKey, { data: responseData, timestamp: Date.now() })
      return NextResponse.json(responseData)
    } catch (err: any) {
      return NextResponse.json({ youtube: [], audius: [], itunes: [], spotify: [] })
    }
  }

  if (!q.trim()) {
    return NextResponse.json({ local: [], youtube: [], audius: [], itunes: [], spotify: [] })
  }

  const query = q.trim().toLowerCase()
  const cacheKey = `${query}_${source}`

  // Check cache first for instant (<10ms) search response
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data)
  }

  try {
    const promises: Array<Promise<any>> = []

    // 1. Search local Supabase tracks
    if (source === 'all' || source === 'local') {
      const supabase = await createClient()
      promises.push(
        (async () => {
          try {
            const { data } = await supabase
              .from('tracks')
              .select('*')
              .or(`title.ilike.%${q.trim()}%,artist.ilike.%${q.trim()}%`)
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

    const responseData = {
      local: localTracks,
      youtube: youtubeTracks.filter(minDurationFilter),
      audius: audiusTracks.filter(minDurationFilter),
      itunes: enhancedITunes.filter(minDurationFilter),
      spotify: enhancedSpotify.filter(minDurationFilter),
    }

    if (searchCache.size > 200) {
      const oldestKey = searchCache.keys().next().value
      if (oldestKey) searchCache.delete(oldestKey)
    }
    searchCache.set(cacheKey, { data: responseData, timestamp: Date.now() })

    return NextResponse.json(responseData)
  } catch (err: any) {
    console.error('Unified search route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
