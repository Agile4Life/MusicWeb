import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSongResponse } from '@/lib/nhaccuatui'
import { fetchWithRetry, isNetworkError, isTransientError } from '@/lib/fetchWithRetry'

export const dynamic = 'force-dynamic'
// Maximum execution time per invocation (Vercel Pro limit = 300s).
// NCT stream resolution + CDN pipe can take 8-15s on cold path.
export const maxDuration = 300

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctSongUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
}

// Signed NCT stream URLs are reused within a short window to avoid hitting the
// external API on every track switch (that call is the slow part of loading).
const nctAudioUrlCache = new Map<string, { audioUrl: string; expiresAt: number }>()
const NCT_CACHE_TTL = 8 * 60 * 1000

async function resolveNctAudioUrlCached(id: string): Promise<string | null> {
  const trimmed = id.trim()
  if (!trimmed) return null

  const cached = nctAudioUrlCache.get(trimmed)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.audioUrl
  }

  try {
    // Retry up to 2 times with exponential backoff on transient errors.
    // Only retry on HTTP 502/503/504/500 or network/timeout errors.
    const songRes = await fetchWithRetry(
      () =>
        fetch(getNctSongUrl(trimmed), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        }),
      {
        retries: 2,
        baseDelayMs: 200,
        maxDelayMs: 800,
        retryOn: (outcome) =>
          outcome instanceof Response ? isTransientError(outcome) : isNetworkError(outcome),
      }
    )
    if (!songRes.ok) return null

    const payload: unknown = await songRes.json()
    const song = normalizeNhacCuaTuiSongResponse(payload)
    if (!song || !song.audioUrl) return null

    nctAudioUrlCache.set(trimmed, { audioUrl: song.audioUrl, expiresAt: Date.now() + NCT_CACHE_TTL })
    return song.audioUrl
  } catch {
    return null
  }
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

export async function HEAD(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') || url.searchParams.get('key')
  if (!id?.trim()) {
    return new Response(null, { status: 400 })
  }

  try {
    let audioUrl = await resolveNctAudioUrlCached(id.trim())
    if (!audioUrl) return new Response(null, { status: 502 })

    let upstream = await fetch(audioUrl, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })

    // Cached URL may have expired upstream — re-resolve once before giving up
    if (!upstream.ok) {
      nctAudioUrlCache.delete(id.trim())
      audioUrl = await resolveNctAudioUrlCached(id.trim())
      if (!audioUrl) return new Response(null, { status: 502 })
      upstream = await fetch(audioUrl, {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })
    }

    const headers = new Headers()
    headers.set('Cache-Control', 'private, no-store')
    applyCorsHeaders(headers)

    const contentType = upstream.headers.get('content-type') || 'audio/mpeg'
    headers.set('Content-Type', contentType)

    const contentLength = upstream.headers.get('content-length')
    if (contentLength) headers.set('Content-Length', contentLength)

    return new Response(null, { status: upstream.status, headers })
  } catch {
    return new Response(null, { status: 502 })
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') || url.searchParams.get('key')
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing song id' }, { status: 400 })
  }

  try {
    let audioUrl = await resolveNctAudioUrlCached(id.trim())
    if (!audioUrl) {
      return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
    }

    const upstreamHeaders = new Headers({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
    })
    const range = request.headers.get('range')
    if (range) upstreamHeaders.set('Range', range)

    let upstream = await fetch(audioUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })

    // Cached URL may have expired upstream — re-resolve once before giving up
    if (!upstream.ok) {
      nctAudioUrlCache.delete(id.trim())
      audioUrl = await resolveNctAudioUrlCached(id.trim())
      if (!audioUrl) {
        return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
      }
      upstream = await fetch(audioUrl, {
        method: 'GET',
        headers: upstreamHeaders,
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })
    }

    if (!upstream.ok) {
      return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
    }

    const headers = new Headers()
    headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600')
    applyCorsHeaders(headers)

    const contentType = upstream.headers.get('content-type')
    if (contentType) headers.set('Content-Type', contentType)

    const contentLength = upstream.headers.get('content-length')
    if (contentLength) headers.set('Content-Length', contentLength)

    const contentRange = upstream.headers.get('content-range')
    if (contentRange) headers.set('Content-Range', contentRange)

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  } catch {
    return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
  }
}
