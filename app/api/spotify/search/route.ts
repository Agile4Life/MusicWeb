import { NextResponse } from 'next/server'
import { searchSpotifyTracks } from '@/lib/spotify'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''
  const limit = Math.min(Number(searchParams.get('limit')) || 20, 50)

  if (!q.trim()) {
    return NextResponse.json({ tracks: [], error: 'Missing query parameter "q"' }, { status: 400 })
  }

  try {
    const tracks = await searchSpotifyTracks(q, limit)
    return NextResponse.json({ tracks }, {
      headers: {
        'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300',
      },
    })
  } catch (err) {
    console.error('Spotify search API error:', err)
    return NextResponse.json({ tracks: [], error: 'Spotify search failed' }, { status: 500 })
  }
}
