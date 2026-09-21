import { NextRequest, NextResponse } from 'next/server'

function cleanHtmlEntities(str?: string | null): string {
  if (!str) return ''
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

async function fetchLyricsFromYouTube(videoId: string): Promise<string | null> {
  try {
    const nextRes = await fetch('https://www.youtube.com/youtubei/v1/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'vi',
            gl: 'VN',
          },
        },
        videoId,
      }),
      signal: AbortSignal.timeout(6000),
    })

    if (!nextRes.ok) return null
    const nextData = await nextRes.json()

    const tabs = nextData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || []
    let browseId: string | null = null

    for (const t of tabs) {
      const endpoint = t.tabRenderer?.endpoint?.browseEndpoint
      if (endpoint?.browseId?.startsWith('MPLYt')) {
        browseId = endpoint.browseId
        break
      }
    }

    if (!browseId) return null

    const browseRes = await fetch('https://www.youtube.com/youtubei/v1/browse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'vi',
            gl: 'VN',
          },
        },
        browseId,
      }),
      signal: AbortSignal.timeout(6000),
    })

    if (!browseRes.ok) return null
    const browseData = await browseRes.json()

    const shelf = browseData?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer
    const rawLyrics = shelf?.description?.runs?.map((r: any) => r.text).join('') || ''

    const clean = cleanHtmlEntities(rawLyrics.trim())

    const GENERIC_PLACEHOLDERS = [
      'nếu bài hát có lời',
      'lyrics not available',
      'no lyrics available',
      'lời bài hát sẽ xuất hiện ở đây',
    ]

    if (!clean || clean.length < 15 || GENERIC_PLACEHOLDERS.some((p) => clean.toLowerCase().includes(p))) {
      return null
    }

    return clean
  } catch (err) {
    console.error('YouTube lyrics InnerTube error:', err)
    return null
  }
}

async function searchYouTubeVideoIds(query: string): Promise<string[]> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'vi',
            gl: 'VN',
          },
        },
        query,
      }),
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) return []
    const data = await res.json()

    const str = JSON.stringify(data)
    const matches = Array.from(new Set(Array.from(str.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)).map((m) => m[1])))
    return matches.slice(0, 5)
  } catch {
    return []
  }
}

interface LyricsResult {
  id: string
  trackName: string
  artistName: string
  plainLyrics: string
  syncedLyrics: string | null
  instrumental: boolean
  source: string
}

const lyricsCache = new Map<string, { result: LyricsResult | null; expiresAt: number }>()
const inFlightLyrics = new Map<string, Promise<LyricsResult | null>>()
const LYRICS_TTL_MS = 60 * 60 * 1000 // 1 hour
const LYRICS_MISS_TTL_MS = 3 * 60 * 1000 // 3 minutes for misses
const LYRICS_MAX_CACHE = 1000

function evictLyricsIfFull(): void {
  if (lyricsCache.size >= LYRICS_MAX_CACHE) {
    const oldest = lyricsCache.keys().next().value
    if (oldest !== undefined) lyricsCache.delete(oldest)
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const directVideoId = (searchParams.get('videoId') || searchParams.get('youtube_id') || '').trim()
    const title = (searchParams.get('title') || '').trim()
    const artist = (searchParams.get('artist') || '').trim()

    if (!directVideoId && !title) {
      return NextResponse.json({ error: 'Missing videoId or title parameter' }, { status: 400 })
    }

    // Instrumental Guard: return 404 for beats and instrumentals
    const isInstrumental =
      title.toLowerCase().includes('instrumental') ||
      title.toLowerCase().includes('beat') ||
      title.toLowerCase().includes('karaoke') ||
      title.toLowerCase().includes('nhạc không lời') ||
      title.toLowerCase().includes('nhac khong loi') ||
      title.toLowerCase().includes('nonstop')

    if (isInstrumental) {
      return NextResponse.json({ error: 'Instrumental tracks do not have lyrics' }, { status: 404 })
    }

    const cacheKey = `${directVideoId}___${title.toLowerCase()}___${artist.toLowerCase()}`

    // 1. Cache check
    const cached = lyricsCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) {
      if (!cached.result) {
        return NextResponse.json({ error: 'No lyrics found on YouTube Music' }, { status: 404 })
      }
      return NextResponse.json(cached.result, {
        headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
      })
    }

    // 2. In-flight coalescing
    const existingInFlight = inFlightLyrics.get(cacheKey)
    if (existingInFlight) {
      const result = await existingInFlight
      if (!result) {
        return NextResponse.json({ error: 'No lyrics found on YouTube Music' }, { status: 404 })
      }
      return NextResponse.json(result, {
        headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
      })
    }

    const fetchPromise = (async (): Promise<LyricsResult | null> => {
      let plainLyrics: string | null = null
      let successfulVideoId = directVideoId

      // 1. Try direct videoId if provided
      if (directVideoId) {
        plainLyrics = await fetchLyricsFromYouTube(directVideoId)
      }

      // 2. If direct videoId failed or was missing, try searching YouTube Music audio tracks
      if (!plainLyrics && (title || artist)) {
        const searchQuery = `${title} ${artist} audio`.trim()
        const candidateIds = await searchYouTubeVideoIds(searchQuery)
        if (candidateIds.length > 0) {
          // Only inspect the top 1 exact search candidate to prevent mismatching other songs
          const topCandidate = candidateIds[0]
          if (topCandidate !== directVideoId) {
            plainLyrics = await fetchLyricsFromYouTube(topCandidate)
            if (plainLyrics) {
              successfulVideoId = topCandidate
            }
          }
        }
      }

      if (!plainLyrics) {
        evictLyricsIfFull()
        lyricsCache.set(cacheKey, { result: null, expiresAt: Date.now() + LYRICS_MISS_TTL_MS })
        return null
      }

      const result: LyricsResult = {
        id: `yt-${successfulVideoId}`,
        trackName: title || 'YouTube Track',
        artistName: artist || 'YouTube Artist',
        plainLyrics,
        syncedLyrics: null,
        instrumental: false,
        source: 'youtube_music',
      }

      evictLyricsIfFull()
      lyricsCache.set(cacheKey, { result, expiresAt: Date.now() + LYRICS_TTL_MS })
      return result
    })()

    inFlightLyrics.set(cacheKey, fetchPromise)

    let finalResult: LyricsResult | null = null
    try {
      finalResult = await fetchPromise
    } finally {
      inFlightLyrics.delete(cacheKey)
    }

    if (!finalResult) {
      return NextResponse.json({ error: 'No lyrics found on YouTube Music' }, { status: 404 })
    }

    return NextResponse.json(finalResult, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600' },
    })
  } catch (err: any) {
    console.error('YouTube lyrics route error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
