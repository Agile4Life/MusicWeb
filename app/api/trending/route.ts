import { NextResponse } from 'next/server'
import { getDailyTrending, getDailyTrendingCacheControl } from '@/lib/dailyTrending'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const country = (
    req.headers.get('x-vercel-ip-country') ||
    req.headers.get('cf-ipcountry') ||
    searchParams.get('country') || 'VN'
  ).toUpperCase()
  const requestedLimit = Number.parseInt(searchParams.get('limit') || '12', 10)
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, requestedLimit)) : 12
  const category = (searchParams.get('category') || 'all').toLowerCase().trim()
  const data = await getDailyTrending(category)
  const tracks = [...data.spotify, ...data.nhaccuatui, ...data.deezer].slice(0, limit)
  return NextResponse.json({ country, tracks, trending: data.trending }, {
    headers: { 'Cache-Control': getDailyTrendingCacheControl(data) },
  })
}
