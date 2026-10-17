import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchYouTubeTracks, findBestYouTubeMatch, isOriginalTrackOnly, NEGATIVE_KEYWORDS } from '@/lib/youtube'
import { searchSpotifyTracks, getTrendingSpotifyTracks, getTopArtistSpotifyTracks, isCleanTrendingTrack } from '@/lib/spotify'
import { getTrendingDeezerTracks, searchDeezerTracks } from '@/lib/deezer'
import { searchSoundCloudTracks } from '@/lib/soundcloudClient'
import { findBestNhacCuaTuiMatch, normalizeNhacCuaTuiChartResponse, nhacCuaTuiSearchItemToTrack, searchNhacCuaTuiDirect } from '@/lib/nhaccuatui'
import { extractArtistAliases, isCatalogTrackMatch, measureIdentityTokenOverlap, normalizeIdentity } from '@/lib/catalogMatching'
import { STATIC_DRIVE_TRACKS } from '@/lib/driveTracksMap'
import { rankSearchTracks } from '@/lib/searchFlow'
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
        try {
          const data = await inFlightRequests.get(cacheKey)
          return cachedJsonResponse(data)
        } catch {
          // Fall through if in-flight failed
        }
      }

      const trendingPromise = (async () => {
        switch (category) {
          case 'vietnamese': {
            const [nctTrending, spotifyVpop, deezerVpop] = await Promise.all([
              getNhacCuaTuiTrending(24).catch(() => []),
              getTopArtistSpotifyTracks(['Sơn Tùng M-TP', 'Vũ.', 'HIEUTHUHAI', 'SOOBIN', 'Wren Evans', 'tlinh', 'MCK', 'MONO'], 3).catch(() => []),
              searchDeezerTracks('Sơn Tùng M-TP Vũ HIEUTHUHAI', 16).catch(() => []),
            ])
            const cleanSpotify = [...spotifyVpop, ...deezerVpop].filter((t) => isCleanTrendingTrack(t.title, t.artist))
            return {
              nhaccuatui: nctTrending.filter((t) => isCleanTrendingTrack(t.title, t.artist)),
              local: [],
              youtube: [],
              audius: [],
              itunes: [],
              spotify: cleanSpotify,
              deezer: [],
            }
          }
          case 'usuk': {
            const [spotifyUsUkArtists, deezerUsUk] = await Promise.all([
              getTopArtistSpotifyTracks(
                [
                  'Taylor Swift',
                  'The Weeknd',
                  'Billie Eilish',
                  'Bruno Mars',
                  'Sabrina Carpenter',
                  'Ariana Grande',
                  'Dua Lipa',
                  'Post Malone',
                  'Drake',
                  'Olivia Rodrigo',
                  'Lady Gaga',
                  'Kendrick Lamar',
                ],
                2
              ).catch(() => []),
              getTrendingDeezerTracks(20).catch(() => []),
            ])
            const cleanSpotify = [...spotifyUsUkArtists, ...deezerUsUk].filter((t) => isCleanTrendingTrack(t.title, t.artist))
            return {
              nhaccuatui: [],
              local: [],
              youtube: [],
              audius: [],
              itunes: [],
              spotify: cleanSpotify,
              deezer: [],
            }
          }
          case 'korean': {
            const [spotifyKpopArtists, deezerKpop] = await Promise.all([
              getTopArtistSpotifyTracks(
                ['NewJeans', 'aespa', 'BLACKPINK', 'BTS', 'LE SSERAFIM', 'IVE', 'TWICE', 'SEVENTEEN', 'ILLIT', 'Stray Kids'],
                2
              ).catch(() => []),
              searchDeezerTracks('NewJeans aespa BTS BLACKPINK', 16).catch(() => []),
            ])
            const cleanSpotify = [...spotifyKpopArtists, ...deezerKpop].filter((t) => isCleanTrendingTrack(t.title, t.artist))
            return {
              nhaccuatui: [],
              local: [],
              youtube: [],
              audius: [],
              itunes: [],
              spotify: cleanSpotify,
              deezer: [],
            }
          }
          case 'chinese': {
            const [spotifyCpopArtists, deezerCpop] = await Promise.all([
              getTopArtistSpotifyTracks(
                ['Jay Chou', 'JJ Lin', 'G.E.M.', 'Eric Chou', 'Mayday', 'Jolin Tsai', 'Eason Chan', 'A-Lin'],
                2
              ).catch(() => []),
              searchDeezerTracks('Jay Chou JJ Lin GEM', 16).catch(() => []),
            ])
            const cleanSpotify = [...spotifyCpopArtists, ...deezerCpop].filter((t) => isCleanTrendingTrack(t.title, t.artist))
            return {
              nhaccuatui: [],
              local: [],
              youtube: [],
              audius: [],
              itunes: [],
              spotify: cleanSpotify,
              deezer: [],
            }
          }
          case 'japanese': {
            const [spotifyJpopArtists, deezerJpop] = await Promise.all([
              getTopArtistSpotifyTracks(
                ['YOASOBI', 'Ado', 'Kenshi Yonezu', 'LiSA', 'Fujii Kaze', 'Aimer', 'RADWIMPS', 'Official HIGE DANDISM'],
                2
              ).catch(() => []),
              searchDeezerTracks('YOASOBI Ado Kenshi Yonezu', 16).catch(() => []),
            ])
            const cleanSpotify = [...spotifyJpopArtists, ...deezerJpop].filter((t) => isCleanTrendingTrack(t.title, t.artist))
            return {
              nhaccuatui: [],
              local: [],
              youtube: [],
              audius: [],
              itunes: [],
              spotify: cleanSpotify,
              deezer: [],
            }
          }
          case 'all':
          default: {
            const [nctTrending, spotifyGlobalArtists, deezerTrending] = await Promise.all([
              getNhacCuaTuiTrending(20).catch(() => []),
              getTopArtistSpotifyTracks(
                ['Taylor Swift', 'The Weeknd', 'NewJeans', 'Bruno Mars', 'Billie Eilish', 'Sơn Tùng M-TP', 'YOASOBI', 'Sabrina Carpenter'],
                2
              ).catch(() => []),
              getTrendingDeezerTracks(16).catch(() => []),
            ])
            const cleanSpotify = [...spotifyGlobalArtists, ...deezerTrending].filter((t) => isCleanTrendingTrack(t.title, t.artist))

            return {
              nhaccuatui: nctTrending.filter((t) => isCleanTrendingTrack(t.title, t.artist)),
              local: [],
              youtube: [],
              audius: [],
              itunes: [],
              spotify: cleanSpotify,
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

    // 1. Search local Supabase tracks + preloaded Google Drive tracks (diacritic-insensitive)
    if (source === 'all' || source === 'local') {
      const supabase = await createClient()
      primaryPromises.push(
        (async () => {
          const cleanQuery = q.trim().replace(/[,()%"\\]/g, ' ').replace(/\s+/g, ' ').trim()
          if (!cleanQuery) return []

          const normQ = normalizeIdentity(cleanQuery)
          const staticMatches: Track[] = normQ
            ? STATIC_DRIVE_TRACKS.filter((st) => {
                const normTitle = normalizeIdentity(st.title)
                const normArtist = normalizeIdentity(st.artist)
                const normAlbum = normalizeIdentity(st.album)
                const aliases = extractArtistAliases(st.artist)
                const combined = `${normTitle} ${normArtist} ${normAlbum} ${aliases.join(' ')}`.trim()
                return (
                  combined.includes(normQ) ||
                  measureIdentityTokenOverlap(normQ, combined) >= 0.75
                )
              }).map((st) => ({
                id: st.id,
                user_id: 'system',
                title: st.title,
                artist: st.artist,
                album: st.album ?? null,
                duration: st.duration ?? 0,
                file_path: st.file_path,
                cover_url: st.cover_url ?? null,
                created_at: '2025-01-01T00:00:00.000Z',
                source: 'local' as const,
              }))
            : []

          try {
            const { data } = await supabase
              .from('tracks')
              .select('*')
              .or(`title.ilike.%${cleanQuery}%,artist.ilike.%${cleanQuery}%`)
              .limit(10)
            const dbTracks: Track[] = (data || []).map((t: any) => ({ ...t, source: 'local' as const }))
            const seenIds = new Set(dbTracks.map((t) => t.id))
            return [...dbTracks, ...staticMatches.filter((t) => !seenIds.has(t.id))]
          } catch {
            return staticMatches
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
    if (source === 'all' || source === 'youtube' || source === 'spotify' || source === 'deezer' || source === 'itunes') {
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

    // Enrich Spotify & Deezer tracks with NCT stream ID (when matched in batch) and YouTube view_count,
    // without setting youtube_id on unresolved catalog tracks (which would bypass NCT/SoundCloud resolution)
    const nctSearchItems = nctTracks
      .filter((t: Track) => Boolean(t.nhaccuatui_id))
      .map((t: Track) => ({
        id: t.nhaccuatui_id!,
        title: t.title,
        artist: t.artist || '',
        duration: t.duration,
        thumbnail: t.cover_url || undefined,
      }))

    const enrichCatalogSearchTrack = (cTrack: Track): Track => {
      const nctMatch = findBestNhacCuaTuiMatch(nctSearchItems, {
        title: cTrack.title,
        artist: cTrack.artist,
        duration: cTrack.duration,
        album: cTrack.album,
      })
      const ytMatch = findBestYouTubeMatch(youtubeTracks, cTrack.title, cTrack.artist, cTrack.duration, cTrack.album)
      return {
        ...cTrack,
        ...(nctMatch?.id ? { nhaccuatui_id: nctMatch.id } : {}),
        ...(ytMatch?.view_count && !cTrack.view_count ? { view_count: ytMatch.view_count } : {}),
      }
    }

    const enhancedSpotify = spotifyTracks.map(enrichCatalogSearchTrack)
    const enhancedDeezer = deezerTracks.map(enrichCatalogSearchTrack)

    const enhancedITunes: Track[] = []

    // Enrich YouTube tracks with high-res 1:1 Spotify/Deezer/iTunes album artwork when catalog identity matches
    const catalogArtworkPool = [...spotifyTracks, ...deezerTracks, ...itunesTracks].filter((t) => Boolean(t.cover_url))
    const enhancedYouTube = youtubeTracks.map((yTrack: Track) => {
      if (!yTrack.title) return yTrack
      const match = catalogArtworkPool.find((cTrack) =>
        isCatalogTrackMatch(yTrack, {
          title: cTrack.title,
          artist: cTrack.artist,
          duration: cTrack.duration,
        })
      )
      return match?.cover_url ? { ...yTrack, cover_url: match.cover_url } : yTrack
    })

    const lowerQuery = q.toLowerCase().normalize('NFC')
    const allowedNegativeKeywords = NEGATIVE_KEYWORDS.filter((kw) => lowerQuery.includes(kw))
    const isValidTrackFilter = (t: Track) =>
      (!t.duration || t.duration >= 25) && isOriginalTrackOnly(t.title, allowedNegativeKeywords)

    const trimmedQuery = q.trim()
    const allResults = {
      local: rankSearchTracks(localTracks.filter(isValidTrackFilter), trimmedQuery),
      nhaccuatui: rankSearchTracks((nctTracks || []).filter(isValidTrackFilter), trimmedQuery),
      youtube: rankSearchTracks(enhancedYouTube.filter(isValidTrackFilter), trimmedQuery),
      audius: rankSearchTracks(audiusTracks.filter(isValidTrackFilter), trimmedQuery),
      itunes: rankSearchTracks(enhancedITunes.filter(isValidTrackFilter), trimmedQuery),
      spotify: rankSearchTracks(enhancedSpotify.filter(isValidTrackFilter), trimmedQuery),
      deezer: rankSearchTracks(enhancedDeezer.filter(isValidTrackFilter), trimmedQuery),
      soundcloud: rankSearchTracks((soundCloudTracks || []).filter(isValidTrackFilter), trimmedQuery),
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
