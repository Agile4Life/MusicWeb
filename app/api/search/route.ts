import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchYouTubeTracks, findBestYouTubeMatch, isOriginalTrackOnly, NEGATIVE_KEYWORDS } from '@/lib/youtube'
import { searchSpotifyTracks } from '@/lib/spotify'
import { searchDeezerTracks } from '@/lib/deezer'
import { searchSoundCloudTracks } from '@/lib/soundcloudClient'
import { findBestNhacCuaTuiMatch, searchNhacCuaTuiDirect } from '@/lib/nhaccuatui'
import { extractArtistAliases, isCatalogTrackMatch, measureIdentityTokenOverlap, normalizeIdentity } from '@/lib/catalogMatching'
import { STATIC_DRIVE_TRACKS } from '@/lib/driveTracksMap'
import { rankSearchTracks } from '@/lib/searchFlow'
import { isRetiredMusicTrack, normalizeRetiredMusicTrack } from '@/lib/retiredMusicSources'
import { inferTrackSource } from '@/lib/trackSourceClassifier'
import { Track } from '@/types'
import { getDailyTrending, getDailyTrendingCacheControl } from '@/lib/dailyTrending'

// In-memory LRU search cache & in-flight request deduplication map
const searchCache = new Map<string, { data: any; timestamp: number }>()
const inFlightRequests = new Map<string, Promise<any>>()
const CACHE_TTL = 180 * 1000

export const maxDuration = 15
export const dynamic = 'force-dynamic'

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

  if (source === 'itunes' || source === 'audius') {
    return NextResponse.json({ error: 'Unsupported search source' }, { status: 400 })
  }

  // Both public trending routes share one daily chart snapshot.
  if (isTrending || (!q.trim() && searchParams.has('trending'))) {
    const data = await getDailyTrending(category)
    return NextResponse.json(data, {
      headers: { 'Cache-Control': getDailyTrendingCacheControl(data) },
    })
  }

  if (!q.trim()) {
    return cachedJsonResponse({ local: [], youtube: [], spotify: [], deezer: [] })
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
    if (source === 'all' || source === 'playback' || source === 'nhaccuatui') {
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
            const dbTracks: Track[] = (data || []).map((t: any) => {
              const normalized = normalizeRetiredMusicTrack(t)
              return isRetiredMusicTrack(t) ? normalized : inferTrackSource({ ...normalized, source: 'local' as const })
            })
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

    // Single-source catalog results resolve playback on demand; YouTube enrichment is optional.
    if (source === 'all' || source === 'playback' || source === 'youtube') {
      primaryPromises.push(searchYouTubeTracks(q.trim(), 10).catch(() => []))
    } else {
      primaryPromises.push(Promise.resolve([]))
    }

    // 4. Search SoundCloud tracks
    if (source === 'all' || source === 'playback' || source === 'soundcloud') {
      primaryPromises.push(searchSoundCloudTracks(q.trim(), 10).catch(() => []))
    } else {
      primaryPromises.push(Promise.resolve([]))
    }

    const [nctTracks, localTracks, spotifyTracks, deezerTracks, youtubeTracks, soundCloudTracks] = await Promise.all(primaryPromises)

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

    // Enrich YouTube tracks with high-res 1:1 Spotify/Deezer album artwork when catalog identity matches
    const catalogArtworkPool = [...spotifyTracks, ...deezerTracks].filter((t) => Boolean(t.cover_url))
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
      spotify: rankSearchTracks(enhancedSpotify.filter(isValidTrackFilter), trimmedQuery),
      deezer: rankSearchTracks(enhancedDeezer.filter(isValidTrackFilter), trimmedQuery),
      soundcloud: rankSearchTracks((soundCloudTracks || []).filter(isValidTrackFilter), trimmedQuery),
    }

    // Single-source mode: only return the requested source so the UI shows one source at a time
    if (source === 'nhaccuatui') {
      return { local: [], nhaccuatui: allResults.nhaccuatui, youtube: [], spotify: [], deezer: [], soundcloud: [] }
    }
    if (source === 'spotify') {
      return { local: [], nhaccuatui: [], youtube: [], spotify: allResults.spotify, deezer: [], soundcloud: [] }
    }
    if (source === 'deezer') {
      return { local: [], nhaccuatui: [], youtube: [], spotify: [], deezer: allResults.deezer, soundcloud: [] }
    }
    if (source === 'youtube') {
      return { local: [], nhaccuatui: [], youtube: allResults.youtube, spotify: [], deezer: [], soundcloud: [] }
    }
    if (source === 'soundcloud') {
      return { local: [], nhaccuatui: [], youtube: [], spotify: [], deezer: [], soundcloud: allResults.soundcloud }
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
