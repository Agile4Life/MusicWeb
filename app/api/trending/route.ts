import { NextResponse } from 'next/server'
import { getTrendingITunesTracks } from '@/lib/itunes'
import { searchYouTubeTracks, findBestYouTubeMatch } from '@/lib/youtube'
import { Track } from '@/types'

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

    // 1. Fetch Top RSS Chart for User's Country from Apple Music API
    const rawITunesTracks = await getTrendingITunesTracks(countryCode, limit)

    // 2. Pre-assign YouTube stream IDs for seamless instant playback
    const enhancedTracks = await Promise.all(
      rawITunesTracks.map(async (track: Track) => {
        try {
          const queryStr = `${track.artist} - ${track.title}`
          const ytCandidates = await searchYouTubeTracks(queryStr, 5)
          const bestMatch = findBestYouTubeMatch(
            ytCandidates,
            track.title,
            track.artist,
            track.duration,
            track.album
          )
          return bestMatch?.youtube_id ? { ...track, youtube_id: bestMatch.youtube_id } : track
        } catch {
          return track
        }
      })
    )

    // 3. Return JSON response with Vercel Edge CDN Cache-Control (24 Hours Cache)
    return NextResponse.json(
      {
        country: countryCode.toUpperCase(),
        tracks: enhancedTracks,
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
