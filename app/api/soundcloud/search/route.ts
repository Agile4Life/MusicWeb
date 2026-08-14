import { NextRequest, NextResponse } from 'next/server'
import { searchSoundCloudTracks } from '@/lib/soundcloudClient'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '50', 10)), 100)
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10))

  if (!q) {
    return NextResponse.json({ tracks: [] })
  }

  try {
    const tracks = await searchSoundCloudTracks(q, limit, offset)
    return NextResponse.json({ tracks, offset, limit })
  } catch (err) {
    console.error('[API /api/soundcloud/search] Error:', err)
    return NextResponse.json({ tracks: [], error: 'Search failed' }, { status: 500 })
  }
}
