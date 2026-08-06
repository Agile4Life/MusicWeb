import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchSpotifyAlbum, getSpotifyAlbumTracks } from '@/lib/spotify'
import { searchITunesAlbum, getITunesAlbumTracks } from '@/lib/itunes'
import { Track } from '@/types'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const albumName = searchParams.get('name') || ''
  const artistName = searchParams.get('artist') || ''

  if (!albumName.trim()) {
    return NextResponse.json({ tracks: [] })
  }

  const cleanName = albumName.trim()

  try {
    let officialTracks: Track[] = []

    // 1. Try Spotify Official Album Tracks API
    const spotifyAlbum = await searchSpotifyAlbum(cleanName, artistName).catch(() => null)
    if (spotifyAlbum && spotifyAlbum.id) {
      const spTracks = await getSpotifyAlbumTracks(
        spotifyAlbum.id,
        spotifyAlbum.cover_url || undefined,
        spotifyAlbum.name
      ).catch(() => [])
      if (spTracks.length > 0) {
        officialTracks = spTracks
      }
    }

    // 2. If Spotify returns no tracks, try iTunes Official Album Lookup API
    if (officialTracks.length === 0) {
      const itunesCollectionId = await searchITunesAlbum(cleanName).catch(() => null)
      if (itunesCollectionId) {
        const itTracks = await getITunesAlbumTracks(itunesCollectionId).catch(() => [])
        if (itTracks.length > 0) {
          officialTracks = itTracks
        }
      }
    }

    // 3. Fetch Local database tracks strictly matching this album name
    let localTracks: Track[] = []
    try {
      const supabase = await createClient()
      const { data } = await supabase
        .from('tracks')
        .select('*')
        .ilike('album', cleanName)

      if (data && data.length > 0) {
        localTracks = data.map((t: any) => ({ ...t, source: t.source || 'local' }))
      }
    } catch (err) {
      console.warn('Local album tracks query error:', err)
    }

    // If local tracks exist, prioritize them or merge
    const trackMap = new Map<string, Track>()
    officialTracks.forEach((t) => trackMap.set(t.title.toLowerCase(), t))
    localTracks.forEach((t) => trackMap.set(t.title.toLowerCase(), t))

    const finalTracklist = Array.from(trackMap.values())

    return NextResponse.json({
      tracks: finalTracklist,
      album: spotifyAlbum?.name || cleanName,
      artist: spotifyAlbum?.artist || artistName,
      cover_url: spotifyAlbum?.cover_url || finalTracklist[0]?.cover_url || null,
      total_tracks: finalTracklist.length,
    })
  } catch (err: any) {
    return NextResponse.json({ tracks: [], error: err.message }, { status: 500 })
  }
}
