import { NextRequest, NextResponse } from 'next/server'
import {
  searchSoundCloudPlaylists,
  getSoundCloudPlaylistTracks,
} from '@/lib/soundcloudClient'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')?.trim()
  const q = searchParams.get('q')?.trim()
  const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '8', 10)), 30)

  // 1. If ID is provided, resolve the playlist tracklist
  if (id) {
    try {
      const result = await getSoundCloudPlaylistTracks(id)
      if (!result) {
        return NextResponse.json({ error: 'Playlist not found' }, { status: 404 })
      }
      return NextResponse.json(result)
    } catch (err) {
      console.error('[API /api/soundcloud/playlists] Error resolving playlist:', err)
      return NextResponse.json({ error: 'Failed to fetch playlist' }, { status: 500 })
    }
  }

  // 2. Search / Explore playlists
  if (!q) {
    return NextResponse.json({ playlists: [] })
  }

  try {
    const playlists = await searchSoundCloudPlaylists(q, limit)
    return NextResponse.json({ playlists })
  } catch (err) {
    console.error('[API /api/soundcloud/playlists] Error searching playlists:', err)
    return NextResponse.json({ playlists: [], error: 'Search failed' }, { status: 500 })
  }
}
