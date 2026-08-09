import { NextResponse } from 'next/server'
import { fetchSpotifyPlaylistMeta, fetchSpotifyPlaylistTracks } from '@/lib/spotify'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const playlistId = searchParams.get('id')
  const type = searchParams.get('type') || 'meta'

  if (!playlistId) {
    return NextResponse.json({ error: 'Missing playlist id' }, { status: 400 })
  }

  if (type === 'meta') {
    const meta = await fetchSpotifyPlaylistMeta(playlistId)
    if (!meta) {
      return NextResponse.json({ error: 'Playlist not found or private' }, { status: 404 })
    }
    return NextResponse.json(meta)
  }

  if (type === 'tracks') {
    const tracks = await fetchSpotifyPlaylistTracks(playlistId)
    return NextResponse.json(tracks)
  }

  return NextResponse.json({ error: 'Invalid request type' }, { status: 400 })
}
