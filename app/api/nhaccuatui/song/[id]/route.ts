import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSongResponse } from '@/lib/nhaccuatui'

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctSongUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!id?.trim()) return NextResponse.json({ error: 'Missing song id' }, { status: 400 })

  try {
    const upstream = await fetch(getNctSongUrl(id.trim()), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!upstream.ok) return NextResponse.json({ error: 'Song not found' }, { status: 404 })

    const payload: unknown = await upstream.json()
    const song = normalizeNhacCuaTuiSongResponse(payload)
    if (!song) return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })

    return NextResponse.json({ song }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
  }
}
