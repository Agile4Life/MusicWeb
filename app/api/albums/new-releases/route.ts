import { NextResponse } from 'next/server'
import { fetchNewReleases } from '@/lib/spotify'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const albums = await fetchNewReleases('VN', 24)
    return NextResponse.json(albums, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err: any) {
    console.error('API new-releases error:', err)
    return NextResponse.json([])
  }
}
