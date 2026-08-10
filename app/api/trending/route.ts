import { NextResponse } from 'next/server'
import { getTrendingYouTubeTracks } from '@/lib/youtube'
import { getTrendingSpotifyTracks } from '@/lib/spotify'

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

    const [ytTrending, spotifyTrending] = await Promise.all([
      getTrendingYouTubeTracks(limit).catch(() => []),
      getTrendingSpotifyTracks(limit).catch(() => []),
    ])

    const tracks = ytTrending.length > 0 ? ytTrending : spotifyTrending

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
