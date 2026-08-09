import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchSpotifyAlbumMeta, fetchFullAlbumTracks } from '@/lib/spotify'
import { fetchDeezerAlbumTracks } from '@/lib/deezer'
import { fetchITunesAlbumTracks } from '@/lib/itunes'

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: albumId } = await params
    if (!albumId) {
      return NextResponse.json({ error: 'Missing album id' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // 1. Check Supabase DB cache first
    if (supabase) {
      try {
        const { data: cached } = await supabase
          .from('spotify_albums')
          .select('*, tracks:tracks!spotify_album_id(*)')
          .eq('id', albumId)
          .maybeSingle()

        if (
          cached &&
          cached.tracks &&
          Array.isArray(cached.tracks) &&
          cached.tracks.length > 0 &&
          cached.tracks.length >= (cached.total_tracks || 1)
        ) {
          cached.tracks.sort((a: any, b: any) => {
            if ((a.disc_number || 1) !== (b.disc_number || 1)) {
              return (a.disc_number || 1) - (b.disc_number || 1)
            }
            return (a.track_number || 1) - (b.track_number || 1)
          })

          return NextResponse.json(
            {
              ...cached,
              tracks: cached.tracks.map((t: any) => ({ ...t, source: 'spotify' })),
            },
            {
              headers: {
                'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
              },
            }
          )
        }
      } catch (cacheErr) {
        console.warn('Album DB cache lookup error:', cacheErr)
      }
    }

    // 2. iTunes Album Lookup Branch (if albumId starts with iTunes prefix or RSS)
    if (albumId.startsWith('itunes') || albumId.startsWith('itunes-rss')) {
      try {
        const iTunesRes = await fetchITunesAlbumTracks(albumId)
        if (iTunesRes && iTunesRes.tracks.length > 0) {
          return NextResponse.json(iTunesRes, {
            headers: {
              'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
            },
          })
        }
      } catch (iErr) {
        console.warn('iTunes album fetch error:', iErr)
      }
    }

    // 3. Try Deezer Public API
    try {
      const deezerRes = await fetchDeezerAlbumTracks(albumId)
      if (deezerRes && deezerRes.meta && deezerRes.tracks.length > 0) {
        const { meta: albumMeta, tracks: tracksToSave } = deezerRes

        // Cache in Supabase asynchronously
        if (supabase) {
          ;(async () => {
            try {
              await supabase.from('spotify_albums').upsert({
                id: albumMeta.id,
                name: albumMeta.name,
                artist: albumMeta.artist,
                cover_url: albumMeta.cover_url,
                release_date: albumMeta.release_date,
                total_tracks: albumMeta.total_tracks || tracksToSave.length,
                album_type: albumMeta.album_type,
              })

              if (tracksToSave.length > 0) {
                await supabase.from('tracks').upsert(tracksToSave, {
                  onConflict: 'user_id,title,artist',
                  ignoreDuplicates: true,
                })
              }
            } catch (saveErr) {
              console.warn('Saving Deezer album to Supabase warning:', saveErr)
            }
          })().catch(() => {})
        }

        return NextResponse.json(
          {
            ...albumMeta,
            tracks: tracksToSave,
          },
          {
            headers: {
              'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
            },
          }
        )
      }
    } catch (dErr) {
      console.warn('Deezer album fetch warning:', dErr)
    }

    // 4. Try iTunes Fallback if not attempted yet
    if (!albumId.startsWith('itunes')) {
      try {
        const iTunesRes = await fetchITunesAlbumTracks(albumId)
        if (iTunesRes && iTunesRes.tracks.length > 0) {
          return NextResponse.json(iTunesRes, {
            headers: {
              'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
            },
          })
        }
      } catch (iErr) {
        // ignore
      }
    }

    // 5. Fallback to Spotify API (Only if valid Spotify ID pattern)
    if (!/^\d+$/.test(albumId)) {
      const albumMeta = await fetchSpotifyAlbumMeta(albumId)
      if (albumMeta) {
        const spotifyTracks = await fetchFullAlbumTracks(albumId)
        const systemUserId = '00000000-0000-4000-a000-000000000001'

        const tracksToSave = spotifyTracks.map((item: any) => ({
          user_id: systemUserId,
          title: item.name,
          artist: item.artists?.map((a: any) => a.name).join(', ') || albumMeta.artist,
          album: albumMeta.name,
          spotify_album_id: albumMeta.id,
          disc_number: item.disc_number || 1,
          track_number: item.track_number || 1,
          duration: Math.round((item.duration_ms || 0) / 1000),
          file_path: item.external_urls?.spotify || item.preview_url || `spotify:${item.id}`,
          cover_url: albumMeta.cover_url,
          spotify_id: item.id,
        }))

        // Save/cache in Supabase asynchronously
        if (supabase) {
          ;(async () => {
            try {
              await supabase.from('spotify_albums').upsert({
                id: albumMeta.id,
                name: albumMeta.name,
                artist: albumMeta.artist,
                cover_url: albumMeta.cover_url,
                release_date: albumMeta.release_date,
                total_tracks: albumMeta.total_tracks || tracksToSave.length,
                album_type: albumMeta.album_type,
              })

              if (tracksToSave.length > 0) {
                await supabase.from('tracks').upsert(tracksToSave, {
                  onConflict: 'user_id,title,artist',
                  ignoreDuplicates: true,
                })
              }
            } catch (saveErr) {
              console.warn('Saving album to Supabase warning:', saveErr)
            }
          })().catch(() => {})
        }

        const finalTracks = tracksToSave.map((t: any, idx: number) => ({
          ...t,
          id: `spotify-${t.spotify_id || idx}`,
          source: 'spotify' as const,
          created_at: new Date().toISOString(),
        }))

        return NextResponse.json(
          {
            ...albumMeta,
            tracks: finalTracks,
          },
          {
            headers: {
              'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
            },
          }
        )
      }
    }

    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  } catch (err: any) {
    console.error('API Album detail error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
