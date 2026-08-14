import { NextRequest, NextResponse } from 'next/server'
import { getSoundCloudExploreTracks } from '@/lib/soundcloudClient'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tag = searchParams.get('tag')?.trim() || 'all-music'
  const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20', 10)), 50)

  try {
    const tracks = await getSoundCloudExploreTracks(tag, limit)
    return NextResponse.json({ tracks, tag })
  } catch (err) {
    console.error('[API /api/soundcloud/explore] Error:', err)
    return NextResponse.json({ tracks: [], error: 'Explore failed' }, { status: 500 })
  }
}
