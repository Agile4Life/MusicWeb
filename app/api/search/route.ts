import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchYouTubeTracks, findBestYouTubeMatch, isOriginalTrackOnly } from '@/lib/youtube'
import { searchSpotifyTracks, getTrendingSpotifyTracks } from '@/lib/spotify'
import { getTrendingDeezerTracks, searchDeezerTracks } from '@/lib/deezer'
import { searchSoundCloudTracks } from '@/lib/soundcloudClient'
import { normalizeNhacCuaTuiChartResponse, nhacCuaTuiSearchItemToTrack, searchNhacCuaTuiDirect } from '@/lib/nhaccuatui'
import { Track } from '@/types'

// In-memory LRU search cache & in-flight request deduplication map
const searchCache = new Map<string, { data: any; timestamp: number }>()
const inFlightRequests = new Map<string, Promise<any>>()
const CACHE_TTL = 180 * 1000

export const maxDuration = 15
export const dynamic = 'force-dynamic'

async function getNhacCuaTuiTrending(limit = 20): Promise<Track[]> {
  try {
    const nctUrl = new URL(process.env.NCT_API_BASE_URL || 'https://music-api.vanhuy2004h.io.vn')
    nctUrl.pathname = '/api/chart'
    nctUrl.search = ''
    const res = await fetch(nctUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const payload: unknown = await res.json()
    return normalizeNhacCuaTuiChartResponse(payload)
      .slice(0, limit)
      .map(nhacCuaTuiSearchItemToTrack)
  } catch {
    return []
  }
}

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
  const category = (searchParams.get('category') || 'all').toLowerCase().trim()

  // Handle Trending Global / Category-specific Request
  if (isTrending || (!q.trim() && searchParams.has('trending'))) {
    try {
      const cacheKey = `trending_${source}_${category}`
      const cached = searchCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cachedJsonResponse(cached.data)
      }

      if (inFlightRequests.has(cacheKey)) {
        const data = await inFlightRequests.get(cacheKey)
        return cachedJsonResponse(data)
      }

      const trendingPromise = (async () => {
        switch (category) {
          case 'vietnamese': {
            const [nctTrending, spotifyVpop, deezerVpop] = await Promise.all([
              getNhacCuaTuiTrending(24).catch(() => []),
              searchSpotifyTracks('v-pop top hits 2025 2026', 16).catch(() => []),
              searchDeezerTracks('nhạc việt top hits', 16).catch(() => []),
            ])
            return {
              nhaccuatui: nctTrending,
              local: [],
              youtube: [],
              audius: [],
              itunes: [],
              spotify: [...spotifyVpop, ...deezerVpop],
              deezer: [],
            }
          }
          case 'usuk': {
            const [spotifyUsUk, deezerUsUk, spotifyBillboard] = await Promise.all([
              getTrendingSpotifyTracks(16).catch(() => []),
              getTrendingDeezerTracks(16).catch(() => []),
              searchSpotifyTracks('billboard hot 100 hits', 16).catch(() => []),
            ])
            return {
              nhaccuatui: [],
              local: [],
              youtube: [],
              audius: [],
              itunes: [],
              spotify: [...spotifyUsUk, ...deezerUsUk, ...spotifyBillboard],
              deezer: [],
            }
          }
          case 'korean': {
            const [spotifyKpop, deezerKpop, ytKpop] = await Promise.all([
              searchSpotifyTracks('k-pop top hits 2025 2026', 20).catch(() => []),
              searchDeezerTracks('k-pop trending hits', 16).catch(() => []),
              searchYouTubeTracks('kpop trending music official audio', 12).catch(() => []),
            ])
            return {
              nhaccuatui: [],
              local: [],
              youtube: ytKpop,
              audius: [],
              itunes: [],
              spotify: [...spotifyKpop, ...deezerKpop],
              deezer: [],
            }
          }
          case 'chinese': {
            const [spotifyCpop, deezerCpop, ytCpop] = await Promise.all([
              searchSpotifyTracks('c-pop mandopop top hits', 20).catch(() => []),
              searchDeezerTracks('c-pop mandopop hits', 16).catch(() => []),
              searchYouTubeTracks('cpop hot music official audio', 12).catch(() => []),
            ])
            return {
              nhaccuatui: [],
              local: [],
              youtube: ytCpop,
              audius: [],
              itunes: [],
              spotify: [...spotifyCpop, ...deezerCpop],
              deezer: [],
            }
          }
          case 'japanese': {
            const [spotifyJpop, deezerJpop, ytJpop] = await Promise.all([
              searchSpotifyTracks('j-pop anime top hits 2025 2026', 20).catch(() => []),
              searchDeezerTracks('j-pop anime hits', 16).catch(() => []),
              searchYouTubeTracks('jpop anime trending official audio', 12).catch(() => []),
            ])
            return {
              nhaccuatui: [],
              local: [],
              youtube: ytJpop,
              audius: [],
              itunes: [],
              spotify: [...spotifyJpop, ...deezerJpop],
              deezer: [],
            }
          }
          case 'all':
          default: {
            const [nctTrending, spotifyTrending, deezerTrending] = await Promise.all([
              getNhacCuaTuiTrending(20).catch(() => []),
              getTrendingSpotifyTracks(16).catch(() => []),
              getTrendingDeezerTracks(16).catch(() => []),
            ])

            return {
              nhaccuatui: nctTrending,
              local: [],
              youtube: [],
              audius: [],
              itunes: [],
              spotify: [...spotifyTrending, ...deezerTrending],
              deezer: [],
            }
          }
        }
      })()

      inFlightRequests.set(cacheKey, trendingPromise)

      try {
        const responseData = await trendingPromise
        searchCache.set(cacheKey, { data: responseData, timestamp: Date.now() })
        return cachedJsonResponse(responseData)
      } finally {
        inFlightRequests.delete(cacheKey)
      }
    } catch (err: any) {
      return NextResponse.json({ nhaccuatui: [], local: [], youtube: [], audius: [], itunes: [], spotify: [], deezer: [] })
    }
  }

  if (!q.trim()) {
    return cachedJsonResponse({ local: [], youtube: [], audius: [], itunes: [], spotify: [], deezer: [] })
  }

  const query = q.trim().toLowerCase()
  const cacheKey = `${query}_${source}`

  // 1. Check completed cache first for instant (<10ms) search response
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // Re-insert to refresh LRU position
    searchCache.delete(cacheKey)
    searchCache.set(cacheKey, cached)
    return cachedJsonResponse(cached.data)
  }

  // 2. Check in-flight request to deduplicate concurrent duplicate requests from TopBar & Page
  if (inFlightRequests.has(cacheKey)) {
    try {
      const data = await inFlightRequests.get(cacheKey)
      return cachedJsonResponse(data)
    } catch {
      // Fall through if in-flight failed
    }
  }

  // 3. Create single shared promise for this query using Smart Sequential Fallback
  const searchPromise = (async () => {
    // Phase 1: Search Primary Sources (Local Supabase + Spotify + YouTube) in parallel
    const primaryPromises: Array<Promise<any>> = []

    // 0. Search NhacCuaTui tracks (Lossless Vietnamese Catalog - Top Priority)
    if (source === 'all' || source === 'nhaccuatui') {
      primaryPromises.push(searchNhacCuaTuiDirect(q.trim(), 12).catch(() => []))
    } else {
      primaryPromises.push(Promise.resolve([]))
    }

    // 1. Search local Supabase tracks
    if (source === 'all' || source === 'local') {
      const supabase = await createClient()
      primaryPromises.push(
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
      primaryPromises.push(Promise.resolve([]))
    }

    // 2. Search Spotify Global tracks (Primary Catalog)
    if (source === 'all' || source === 'spotify') {
      primaryPromises.push(searchSpotifyTracks(q.trim(), 10).catch(() => []))
    } else {
      primaryPromises.push(Promise.resolve([]))
    }

    // 2b. Search Deezer Global tracks
    if (source === 'all' || source === 'deezer') {
      primaryPromises.push(searchDeezerTracks(q.trim(), 10).catch(() => []))
    } else {
      primaryPromises.push(Promise.resolve([]))
    }

    // 3. Search YouTube tracks (for stream ID matching)
    if (source === 'all' || source === 'youtube' || source === 'spotify' || source === 'itunes') {
      primaryPromises.push(searchYouTubeTracks(q.trim(), 10).catch(() => []))
    } else {
      primaryPromises.push(Promise.resolve([]))
    }

    // 4. Search SoundCloud tracks
    if (source === 'all' || source === 'soundcloud') {
      primaryPromises.push(searchSoundCloudTracks(q.trim(), 10).catch(() => []))
    } else {
      primaryPromises.push(Promise.resolve([]))
    }

    const [nctTracks, localTracks, spotifyTracks, deezerTracks, youtubeTracks, soundCloudTracks] = await Promise.all(primaryPromises)

    const itunesTracks: Track[] = []
    const audiusTracks: Track[] = []

    // Pre-assign YouTube stream IDs for Spotify tracks using smart matching
    const enhancedSpotify = spotifyTracks.map((sTrack: Track) => {
      if (sTrack.youtube_id) return sTrack
      const match = findBestYouTubeMatch(youtubeTracks, sTrack.title, sTrack.artist, sTrack.duration, sTrack.album)
      return match?.youtube_id
        ? { ...sTrack, youtube_id: match.youtube_id, view_count: sTrack.view_count || match.view_count }
        : sTrack
    })

    const enhancedITunes: Track[] = []

    // Enrich YouTube tracks with high-res 1:1 Spotify/iTunes album artwork if available
    const enhancedYouTube = youtubeTracks.map((yTrack: Track) => {
      const normYTitle = (yTrack.title || '').toLowerCase().trim()
      if (!normYTitle) return yTrack

      const spMatch = spotifyTracks.find(
        (s: Track) => s.cover_url && normYTitle.includes(s.title.toLowerCase().trim().slice(0, 5))
      )
      if (spMatch?.cover_url) return { ...yTrack, cover_url: spMatch.cover_url }

      const itMatch = itunesTracks.find(
        (i: Track) => i.cover_url && normYTitle.includes(i.title.toLowerCase().trim().slice(0, 5))
      )
      if (itMatch?.cover_url) return { ...yTrack, cover_url: itMatch.cover_url }

      return yTrack
    })

    const isValidTrackFilter = (t: Track) => (!t.duration || t.duration >= 25) && isOriginalTrackOnly(t.title)

    const allResults = {
      local: localTracks.filter(isValidTrackFilter),
      nhaccuatui: (nctTracks || []).filter(isValidTrackFilter),
      youtube: enhancedYouTube.filter(isValidTrackFilter),
      audius: audiusTracks.filter(isValidTrackFilter),
      itunes: enhancedITunes.filter(isValidTrackFilter),
      spotify: enhancedSpotify.filter(isValidTrackFilter),
      deezer: deezerTracks.filter(isValidTrackFilter),
      soundcloud: (soundCloudTracks || []).filter(isValidTrackFilter),
    }

    // Single-source mode: only return the requested source so the UI shows one source at a time
    if (source === 'nhaccuatui') {
      return { local: [], nhaccuatui: allResults.nhaccuatui, youtube: [], audius: [], itunes: [], spotify: [], deezer: [], soundcloud: [] }
    }
    if (source === 'spotify') {
      return { local: [], nhaccuatui: [], youtube: [], audius: [], itunes: [], spotify: allResults.spotify, deezer: [], soundcloud: [] }
    }
    if (source === 'deezer') {
      return { local: [], nhaccuatui: [], youtube: [], audius: [], itunes: [], spotify: [], deezer: allResults.deezer, soundcloud: [] }
    }
    if (source === 'youtube') {
      return { local: [], nhaccuatui: [], youtube: allResults.youtube, audius: [], itunes: [], spotify: [], deezer: [], soundcloud: [] }
    }
    if (source === 'soundcloud') {
      return { local: [], nhaccuatui: [], youtube: [], audius: [], itunes: [], spotify: [], deezer: [], soundcloud: allResults.soundcloud }
    }
    return allResults
  })()

  inFlightRequests.set(cacheKey, searchPromise)

  try {
    const responseData = await searchPromise

    if (searchCache.size > 200) {
      const oldestKey = searchCache.keys().next().value
      if (oldestKey) searchCache.delete(oldestKey)
    }
    searchCache.set(cacheKey, { data: responseData, timestamp: Date.now() })

    return cachedJsonResponse(responseData)
  } catch (err: any) {
    console.error('Unified search route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    inFlightRequests.delete(cacheKey)
  }
}
