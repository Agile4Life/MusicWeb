import { NextResponse } from 'next/server'
import { resolveYouTubeAudioStreamCached } from '../stream/route'

export const dynamic = 'force-dynamic'

/**
 * Resolves a YouTube video ID to a direct audio stream URL (JSON), without
 * proxying the bytes. Used by the Cloudflare MusicStream Cache Worker as the
 * MATCHING_SERVICE_URL fallback tier.
 *
 * GET /api/youtube/stream-url?id=<videoId> -> { url, mimeType }
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const videoId = searchParams.get('id') || searchParams.get('videoId')

    if (!videoId) {
      return NextResponse.json({ error: 'Missing YouTube video ID parameter' }, { status: 400 })
    }

    const resolved = await resolveYouTubeAudioStreamCached(videoId)
    if (!resolved || !resolved.url) {
      return NextResponse.json({ error: 'YouTube: could not extract playable audio stream' }, { status: 502 })
    }

    return NextResponse.json({ url: resolved.url, mimeType: resolved.mimeType })
  } catch (err: any) {
    console.error('YouTube stream-url GET error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
