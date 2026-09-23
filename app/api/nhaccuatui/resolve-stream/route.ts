import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSongResponse } from '@/lib/nhaccuatui'
import { fetchWithRetry, isNetworkError, isTransientError } from '@/lib/fetchWithRetry'

export const dynamic = 'force-dynamic'

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctSongUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
}

import {
  getNctAudioCache,
  setNctAudioCache,
  getNctInFlight,
  setNctInFlight,
  deleteNctInFlight,
} from '@/lib/nctCacheStore'

async function resolveNctStreamUrlCached(id: string): Promise<{
  url: string
  title: string
  artist: string
  duration: number | null
  coverUrl: string | null
} | null> {
  const trimmed = id.trim()
  if (!trimmed) return null

  const cached = getNctAudioCache(trimmed)
  if (cached) {
    return {
      url: cached.audioUrl,
      title: cached.title || '',
      artist: cached.artist || '',
      duration: cached.duration ?? null,
      coverUrl: cached.coverUrl || null,
    }
  }

  const existingInFlight = getNctInFlight(trimmed)
  if (existingInFlight) {
    const song = await existingInFlight
    if (!song) return null
    return {
      url: song.audioUrl,
      title: song.title || '',
      artist: song.artist || '',
      duration: song.duration ?? null,
      coverUrl: song.coverUrl || null,
    }
  }

  const promise = (async (): Promise<{
    url: string
    title: string
    artist: string
    duration: number | null
    coverUrl: string | null
  } | null> => {
    try {
      // Retry once with fast backoff to fail-fast on cold start
      const songRes = await fetchWithRetry(
        () =>
          fetch(getNctSongUrl(trimmed), {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(3800),
          }),
        {
          retries: 1,
          baseDelayMs: 150,
          maxDelayMs: 400,
          retryOn: (outcome) =>
            outcome instanceof Response ? isTransientError(outcome) : isNetworkError(outcome),
        }
      )
      if (!songRes.ok) return null

      const payload: unknown = await songRes.json()
      const song = normalizeNhacCuaTuiSongResponse(payload)
      if (!song || !song.audioUrl) return null

      setNctAudioCache(trimmed, {
        audioUrl: song.audioUrl,
        title: song.title,
        artist: song.artist,
        duration: song.duration ?? null,
        coverUrl: song.coverUrl || null,
      })

      return {
        url: song.audioUrl,
        title: song.title,
        artist: song.artist,
        duration: song.duration ?? null,
        coverUrl: song.coverUrl || null,
      }
    } catch {
      return null
    } finally {
      deleteNctInFlight(trimmed)
    }
  })()

  // Adapt promise type for in-flight store
  const cacheInFlightPromise = promise.then((res) =>
    res
      ? {
          audioUrl: res.url,
          title: res.title,
          artist: res.artist,
          duration: res.duration,
          coverUrl: res.coverUrl,
          expiresAt: Date.now() + 10 * 60 * 1000,
        }
      : null
  )
  setNctInFlight(trimmed, cacheInFlightPromise)
  return promise
}

function applyCorsHeaders(headers: Headers) {
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type')
  headers.set('Accept-Ranges', 'bytes')
}

export async function OPTIONS() {
  const headers = new Headers()
  applyCorsHeaders(headers)
  return new Response(null, { status: 204, headers })
}

// Returns stream URL + metadata in ONE call for pre-warming.
// GET /api/nhaccuatui/resolve-stream?id=<nhaccuatui_id>
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') || url.searchParams.get('key')
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing song id' }, { status: 400 })
  }

  const result = await resolveNctStreamUrlCached(id.trim())
  if (!result) {
    return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
  }

  const headers = new Headers()
  headers.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=180')
  applyCorsHeaders(headers)
  const contentType = 'application/json'
  headers.set('Content-Type', contentType)

  return NextResponse.json(result, { status: 200, headers })
}
