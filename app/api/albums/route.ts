import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTopITunesAlbums, OfficialAlbum } from '@/lib/itunes'
import { getTopSpotifyAlbums } from '@/lib/spotify'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const source = searchParams.get('source') || 'all'

  try {
    const promises: Array<Promise<any>> = [
      getTopITunesAlbums(25).catch(() => []),
      getTopSpotifyAlbums(25).catch(() => []),
    ]

    const [itunesAlbums, spotifyAlbums] = await Promise.all(promises)

    // Fetch Local Database official albums
    let localAlbums: OfficialAlbum[] = []
    try {
      const supabase = await createClient()
      const { data: rawTracks } = await supabase
        .from('tracks')
        .select('*')
        .not('album', 'is', null)

      if (rawTracks && rawTracks.length > 0) {
        const grouped: Record<string, any> = {}
        rawTracks.forEach((t: any) => {
          const alb = (t.album || '').trim()
          // Exclude single fallback strings
          if (
            !alb ||
            alb === 'Single & Remixes' ||
            alb === 'Google Drive' ||
            alb === 'Google Drive Sync' ||
            alb === 'Drive Single & Remixes'
          ) {
            return
          }

          if (!grouped[alb]) {
            grouped[alb] = {
              id: `local-album-${encodeURIComponent(alb)}`,
              name: alb,
              artist: t.artist || 'Nghệ sĩ chưa xác định',
              cover_url: t.cover_url || null,
              trackCount: 0,
              source: 'local',
            }
          }
          grouped[alb].trackCount += 1
          if (!grouped[alb].cover_url && t.cover_url) {
            grouped[alb].cover_url = t.cover_url
          }
        })
        localAlbums = Object.values(grouped)
      }
    } catch (err) {
      console.warn('Local albums fetch error:', err)
    }

    // Merge all official albums without duplicate album names
    const albumMap = new Map<string, OfficialAlbum>()

    // Local albums first
    localAlbums.forEach((a) => albumMap.set(a.name.toLowerCase(), a))

    // iTunes official albums
    itunesAlbums.forEach((a: OfficialAlbum) => {
      const key = a.name.toLowerCase()
      if (!albumMap.has(key)) {
        albumMap.set(key, a)
      }
    })

    // Spotify official albums
    spotifyAlbums.forEach((a: any) => {
      const key = a.name.toLowerCase()
      if (!albumMap.has(key)) {
        albumMap.set(key, a)
      }
    })

    const allOfficialAlbums = Array.from(albumMap.values())

    return NextResponse.json({
      albums: allOfficialAlbums,
      itunes: itunesAlbums,
      spotify: spotifyAlbums,
      local: localAlbums,
    })
  } catch (err: any) {
    return NextResponse.json({ albums: [], error: err.message }, { status: 500 })
  }
}
