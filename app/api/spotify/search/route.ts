import { NextResponse } from 'next/server'
import { searchSpotifyTracks, getSpotifyAccessToken } from '@/lib/spotify'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''
  const limit = Math.min(Number(searchParams.get('limit')) || 20, 50)

  if (!q.trim()) {
    return NextResponse.json({ tracks: [], error: 'Missing query parameter "q"' }, { status: 400 })
  }

  // Pre-flight: check env vars are present
  const hasClientId = !!process.env.SPOTIFY_CLIENT_ID
  const hasClientSecret = !!process.env.SPOTIFY_CLIENT_SECRET

  if (!hasClientId || !hasClientSecret) {
    console.error('Spotify search: SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set in environment')
    return NextResponse.json({
      tracks: [],
      error: 'Spotify credentials not configured on server',
      debug: { hasClientId, hasClientSecret },
    }, { status: 503 })
  }

  // Verify token can be obtained
  const token = await getSpotifyAccessToken()
  if (!token) {
    return NextResponse.json({
      tracks: [],
      error: 'Failed to obtain Spotify access token — credentials may be invalid',
    }, { status: 502 })
  }

  try {
    const tracks = await searchSpotifyTracks(q, limit)
    return NextResponse.json({ tracks, count: tracks.length }, {
      headers: {
        'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300',
      },
    })
  } catch (err) {
    console.error('Spotify search API error:', err)
    return NextResponse.json({ tracks: [], error: 'Spotify search failed' }, { status: 500 })
  }
}

