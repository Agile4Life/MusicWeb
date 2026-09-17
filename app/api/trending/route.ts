import { NextResponse } from 'next/server'
import { getTrendingSpotifyTracks, isCleanTrendingTrack } from '@/lib/spotify'
import { getTrendingDeezerTracks } from '@/lib/deezer'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const countryHeader =
      req.headers.get('x-vercel-ip-country') ||
      req.headers.get('cf-ipcountry') ||
      searchParams.get('country') ||
      'VN'

    const countryCode = countryHeader.toLowerCase()
    const limit = parseInt(searchParams.get('limit') || '12', 10)

    const [spotifyTrending, deezerTrending] = await Promise.all([
      getTrendingSpotifyTracks(limit).catch(() => []),
      getTrendingDeezerTracks(limit).catch(() => []),
    ])

    const combined = [...spotifyTrending, ...deezerTrending].filter((t) =>
      isCleanTrendingTrack(t.title, t.artist)
    )
    const tracks = combined.slice(0, limit)

    return NextResponse.json(
      {
        country: countryCode.toUpperCase(),
        tracks,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
        },
      }
    )
  } catch (err: any) {
    console.error('Trending API error:', err)
    return NextResponse.json({ country: 'VN', tracks: [] })
  }
}
