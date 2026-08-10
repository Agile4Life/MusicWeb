import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSongResponse } from '@/lib/nhaccuatui'

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctSongUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
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

    const contentType = upstream.headers.get('content-type')
    if (contentType) headers.set('Content-Type', contentType)

    const contentLength = upstream.headers.get('content-length')
    if (contentLength) headers.set('Content-Length', contentLength)

    const contentRange = upstream.headers.get('content-range')
    if (contentRange) headers.set('Content-Range', contentRange)

    const acceptRanges = upstream.headers.get('accept-ranges')
    if (acceptRanges) headers.set('Accept-Ranges', acceptRanges)

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  } catch {
    return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
  }
}
