import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSongResponse } from '@/lib/nhaccuatui'

export const dynamic = 'force-dynamic'

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctSongUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
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
  const id = url.searchParams.get('id')
  if (!id?.trim()) {
    return new Response(null, { status: 400 })
  }

  try {
    const songRes = await fetch(getNctSongUrl(id.trim()), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })

    if (!songRes.ok) return new Response(null, { status: 502 })

    const payload: unknown = await songRes.json()
    const song = normalizeNhacCuaTuiSongResponse(payload)
    if (!song || !song.audioUrl) return new Response(null, { status: 502 })

    const upstream = await fetch(song.audioUrl, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })

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
  const id = url.searchParams.get('id')
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing song id' }, { status: 400 })
  }

  try {
    const songRes = await fetch(getNctSongUrl(id.trim()), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })

    if (!songRes.ok) {
      return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
    }

    const payload: unknown = await songRes.json()
    const song = normalizeNhacCuaTuiSongResponse(payload)
    if (!song || !song.audioUrl) {
      return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
    }

    const upstreamHeaders = new Headers({ Accept: 'audio/mpeg' })
    const range = request.headers.get('range')
    if (range) upstreamHeaders.set('Range', range)

    const upstream = await fetch(song.audioUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })

    if (!upstream.ok) {
      return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
    }

    const headers = new Headers()
    headers.set('Cache-Control', 'private, no-store')
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
