import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSongMetadata } from '@/lib/nhaccuatui'
import { findBestYouTubeMatch, searchYouTubeTracks } from '@/lib/youtube'
import { resolveYouTubeAudioStreamAndroid } from '@/lib/youtubeStream'
import { fetchWithRetry, isNetworkError, isTransientError } from '@/lib/fetchWithRetry'

export const dynamic = 'force-dynamic'

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctSongUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
}

// The NCT id -> YouTube video mapping is stable, so cache hits for a long
// window; misses are cached briefly to avoid hammering YouTube with
// unmatchable songs on every play attempt.
const matchCache = new Map<string, { videoId: string | null; expiresAt: number }>()
const MATCH_CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const MISS_CACHE_TTL = 10 * 60 * 1000

async function resolveYouTubeVideoIdForNctSong(id: string): Promise<string | null> {
  const cached = matchCache.get(id)
  if (cached && Date.now() < cached.expiresAt) return cached.videoId

  let videoId: string | null = null
  try {
    const songRes = await fetchWithRetry(
      () =>
        fetch(getNctSongUrl(id), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        }),
      {
        retries: 1,
        baseDelayMs: 200,
        maxDelayMs: 400,
        retryOn: (outcome) =>
          outcome instanceof Response ? isTransientError(outcome) : isNetworkError(outcome),
      }
    )
    if (songRes.ok) {
      const song = normalizeNhacCuaTuiSongMetadata(await songRes.json())
      if (song) {
        let candidates = await searchYouTubeTracks(`${song.title} ${song.artist}`.trim(), 10)
        // Strict scoring only — no "first result" fallback. A wrong match would be
        // cached into the worker's permanent R2 bucket, so missing is better than wrong.
        // Each picked video is also verified extractable from THIS server: YouTube
        // refuses some videos (LOGIN_REQUIRED) on datacenter IPs, and the worker can
        // only stream what this origin's proxy is able to resolve.
        for (let attempt = 0; attempt < 3; attempt++) {
          const best = findBestYouTubeMatch(candidates, song.title, song.artist, song.duration)
          if (!best?.youtube_id) break
          const resolved = await resolveYouTubeAudioStreamAndroid(best.youtube_id)
          if (resolved?.url) {
            videoId = best.youtube_id
            break
          }
          candidates = candidates.filter((c) => c.youtube_id !== best.youtube_id)
        }
      }
    }
  } catch {
    /* resolution failed -> cache a short-lived miss below */
  }

  matchCache.set(id, {
    videoId,
    expiresAt: Date.now() + (videoId ? MATCH_CACHE_TTL : MISS_CACHE_TTL),
  })
  return videoId
}

function applyCorsHeaders(headers: Headers) {
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type')
}

export async function OPTIONS() {
  const headers = new Headers()
  applyCorsHeaders(headers)
  return new Response(null, { status: 204, headers })
}

/**
 * Matching service for the Cloudflare MusicStream cache worker.
 *
 * GET /api/nhaccuatui/match-stream?id=<nctSongId>
 *   -> 200 { url: "<origin>/api/youtube/stream?id=<videoId>", videoId }
 *   -> 502 when the song has no usable metadata or no confident YouTube match
 *
 * The returned URL points at the YouTube PROXY endpoint on this same origin —
 * never a raw googlevideo URL, which is IP-bound to the instance that resolved
 * it and would 403 when fetched from the worker.
 */
export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url)
  const id = (requestUrl.searchParams.get('id') || '').trim()
  if (!id) {
    return NextResponse.json({ error: 'Missing song id' }, { status: 400 })
  }

  const headers = new Headers()
  applyCorsHeaders(headers)

  const videoId = await resolveYouTubeVideoIdForNctSong(id)
  if (!videoId) {
    return NextResponse.json({ error: 'No matching YouTube stream found' }, { status: 502, headers })
  }

  return NextResponse.json(
    { url: `${requestUrl.origin}/api/youtube/stream?id=${encodeURIComponent(videoId)}`, videoId },
    { status: 200, headers },
  )
}
