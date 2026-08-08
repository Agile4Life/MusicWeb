import { NextResponse } from 'next/server'
import { fetchDeezerNewReleases } from '@/lib/deezer'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const albums = await fetchDeezerNewReleases(60)
    return NextResponse.json(albums, {
      headers: {
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
      },
    })
  } catch (err: any) {
    console.error('API new-releases error:', err)
    return NextResponse.json([])
  }
}
