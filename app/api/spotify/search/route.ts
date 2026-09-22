import { NextResponse } from 'next/server'
import { searchSpotifyTracks, getSpotifyAccessToken } from '@/lib/spotify'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''
  const limit = Math.min(Number(searchParams.get('limit')) || 10, 10)

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
    // Do inline search with full diagnostics instead of calling searchSpotifyTracks
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=${limit}`
    const searchRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!searchRes.ok) {
      const errBody = await searchRes.text()
      console.error(`Spotify search HTTP ${searchRes.status}:`, errBody)
      return NextResponse.json({
        tracks: [],
        error: `Spotify search returned ${searchRes.status}`,
        debug: errBody,
      }, { status: 502 })
    }

    const data = await searchRes.json()
    const items = data.tracks?.items || []

    const tracks = items.map((item: any) => ({
      id: `spotify-${item.id}`,
      title: item.name,
      artist: item.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
      album: item.album?.name || '',
      duration: Math.round((item.duration_ms || 0) / 1000),
      cover_url: item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || null,
      spotify_id: item.id,
      preview_url: item.preview_url || null,
      spotify_url: item.external_urls?.spotify || null,
      source: 'spotify',
    }))

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

