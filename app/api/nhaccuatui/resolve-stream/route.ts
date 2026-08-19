import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSongResponse } from '@/lib/nhaccuatui'
import { fetchWithRetry, isTransientError } from '@/lib/fetchWithRetry'

export const dynamic = 'force-dynamic'

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctSongUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
}

// Cache signed audio URLs for 8 minutes — mirrors the client-side TTL.
const nctResolveCache = new Map<string, {
  url: string
  title: string
  artist: string
  duration: number | null
  coverUrl: string | null
  expiresAt: number
}>()
const NCT_RESOLVE_CACHE_TTL = 5 * 60 * 1000

async function resolveNctStreamUrlCached(id: string): Promise<{
  url: string
  title: string
  artist: string
  duration: number | null
  coverUrl: string | null
} | null> {
  const trimmed = id.trim()
  if (!trimmed) return null

  const cached = nctResolveCache.get(trimmed)
  if (cached && Date.now() < cached.expiresAt) {
    return { url: cached.url, title: cached.title, artist: cached.artist, duration: cached.duration, coverUrl: cached.coverUrl }
  }

  try {
    // Retry up to 2 times with exponential backoff on transient errors.
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
        retryOn: (res: unknown) => {
          if (res instanceof Response) return isTransientError(res)
          return false
        },
      }
    )
    if (!songRes.ok) return null

    const payload: unknown = await songRes.json()
    const song = normalizeNhacCuaTuiSongResponse(payload)
    if (!song || !song.audioUrl) return null

    const entry = {
      url: song.audioUrl,
      title: song.title,
      artist: song.artist,
      duration: song.duration ?? null,
      coverUrl: song.coverUrl || null,
      expiresAt: Date.now() + NCT_RESOLVE_CACHE_TTL,
    }
    nctResolveCache.set(trimmed, entry)
    return { url: entry.url, title: entry.title, artist: entry.artist, duration: entry.duration, coverUrl: entry.coverUrl }
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
