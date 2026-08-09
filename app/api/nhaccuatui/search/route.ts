import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSearchResponse } from '@/lib/nhaccuatui'

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctUrl(pathname: string, query?: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = pathname
  url.search = ''
  if (query) url.searchParams.set('q', query)
  return url
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() || ''
  if (!query) return NextResponse.json({ error: 'Missing query' }, { status: 400 })

  try {
    const upstream = await fetch(getNctUrl('/api/search', query), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'NhacCuaTui search unavailable' }, { status: 502 })
    }

    const payload: unknown = await upstream.json()
    return NextResponse.json({ items: normalizeNhacCuaTuiSearchResponse(payload) }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'NhacCuaTui search unavailable' }, { status: 502 })
  }
}
