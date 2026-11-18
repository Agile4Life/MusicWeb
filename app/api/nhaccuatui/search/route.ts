import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSearchResponse } from '@/lib/nhaccuatui'
import { getNctSearchCache, setNctSearchCache } from '@/lib/nctCacheStore'
import { nctApiFetch, NCT_LEGACY_BASE } from '@/lib/nctGraph'


function getNctUrl(pathname: string, query?: string): URL {
  const url = new URL(NCT_LEGACY_BASE)
  url.pathname = pathname
  url.search = ''
  if (query) url.searchParams.set('q', query)
  return url
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() || ''
  if (!query) return NextResponse.json({ error: 'Missing query' }, { status: 400 })

  const cachedItems = getNctSearchCache(query)
  if (cachedItems) {
    return NextResponse.json({ items: cachedItems }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  try {
    const upstream = await nctApiFetch(getNctUrl('/api/search', query), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'NhacCuaTui search unavailable' }, { status: 502 })
    }

    const payload: unknown = await upstream.json()
    const items = normalizeNhacCuaTuiSearchResponse(payload)
    if (items.length > 0) {
      setNctSearchCache(query, items)
    }
    return NextResponse.json({ items }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'NhacCuaTui search unavailable' }, { status: 502 })
  }
}
