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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const directVideoId = searchParams.get('videoId') || searchParams.get('youtube_id') || ''
    const title = searchParams.get('title') || ''
    const artist = searchParams.get('artist') || ''

    let plainLyrics: string | null = null
    let successfulVideoId = directVideoId

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
      return NextResponse.json({ error: 'No lyrics found on YouTube Music' }, { status: 404 })
    }

    return NextResponse.json({
      id: `yt-${successfulVideoId}`,
      trackName: title || 'YouTube Track',
      artistName: artist || 'YouTube Artist',
      plainLyrics,
      syncedLyrics: null,
      instrumental: false,
      source: 'youtube_music',
    })
  } catch (err: any) {
    console.error('YouTube lyrics route error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
