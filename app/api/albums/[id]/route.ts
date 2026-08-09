import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchSpotifyAlbumMeta, fetchFullAlbumTracks } from '@/lib/spotify'
import { fetchDeezerAlbumTracks } from '@/lib/deezer'
import { fetchITunesAlbumTracks } from '@/lib/itunes'

const albumMemoryCache = new Map<string, { data: any; timestamp: number }>()
const ALBUM_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

function cachedAlbumResponse(data: any, albumId: string) {
  if (albumMemoryCache.size > 200) {
    const oldestKey = albumMemoryCache.keys().next().value
    if (oldestKey) albumMemoryCache.delete(oldestKey)
  }
  albumMemoryCache.set(albumId, { data, timestamp: Date.now() })

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
    },
  })
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

async function safeSaveAlbumToDb(supabase: any, albumMeta: any, tracksToSave: any[]) {
  if (!supabase || !albumMeta || !albumMeta.id) return
  try {
    await supabase.from('spotify_albums').upsert({
      id: String(albumMeta.id),
      name: albumMeta.name,
      artist: albumMeta.artist || 'Various Artists',
      cover_url: albumMeta.cover_url || null,
      release_date: albumMeta.release_date || '',
      total_tracks: albumMeta.total_tracks || tracksToSave.length,
      album_type: albumMeta.album_type || 'album',
    })

    if (tracksToSave && tracksToSave.length > 0) {
      const { error: upsertErr } = await supabase.from('tracks').upsert(tracksToSave, {
        onConflict: 'user_id,title,artist',
        ignoreDuplicates: true,
      })

      // Fallback if ON CONFLICT constraint error (42P10) occurs
      if (upsertErr) {
        try {
          const { data: existing } = await supabase
            .from('tracks')
            .select('title, artist')
            .eq('spotify_album_id', String(albumMeta.id))

          const existingKeys = new Set(
            (existing || []).map((t: any) => `${(t.title || '').toLowerCase()}::${(t.artist || '').toLowerCase()}`)
          )

          const newTracks = tracksToSave.filter(
            (t) => !existingKeys.has(`${(t.title || '').toLowerCase()}::${(t.artist || '').toLowerCase()}`)
          )

          if (newTracks.length > 0) {
            await supabase.from('tracks').insert(newTracks)
          }
        } catch (fbErr) {
          console.warn('Fallback track batch insert warning:', fbErr)
        }
      }
    }
  } catch (err) {
    console.warn('Saving album to Supabase warning:', err)
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawAlbumId } = await params
    if (!rawAlbumId) {
      return NextResponse.json({ error: 'Missing album id' }, { status: 400 })
    }

    const albumId = rawAlbumId.trim()
    const cleanId = albumId.replace(/^(deezer|spotify|itunes|itunes-rss)-/, '')
    const idVariants = Array.from(new Set([albumId, cleanId, `deezer-${cleanId}`, `itunes-${cleanId}`]))

    // 0. Check in-memory LRU cache (<2ms)
    for (const key of idVariants) {
      const memCached = albumMemoryCache.get(key)
      if (memCached && Date.now() - memCached.timestamp < ALBUM_CACHE_TTL) {
        return NextResponse.json(memCached.data, {
          headers: {
            'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
          },
        })
      }
    }

    const supabase = getSupabaseClient()

    // 1. Check Supabase DB cache first
    if (supabase) {
      try {
        const { data: cachedList } = await supabase
          .from('spotify_albums')
          .select('*, tracks:tracks!spotify_album_id(*)')
          .in('id', idVariants)
          .limit(1)

        const cached = cachedList && cachedList.length > 0 ? cachedList[0] : null

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

          return cachedAlbumResponse(
            {
              ...cached,
              tracks: cached.tracks.map((t: any) => ({
                ...t,
                cover_url: t.cover_url || cached.cover_url || null,
                source: t.source || 'spotify',
              })),
            },
            albumId
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
          if (supabase) {
            const tracksToSave = iTunesRes.tracks.map((t) => ({
              user_id: '00000000-0000-4000-a000-000000000001',
              title: t.title,
              artist: t.artist || iTunesRes.artist,
              album: iTunesRes.name,
              spotify_album_id: iTunesRes.id,
              disc_number: t.disc_number || 1,
              track_number: t.track_number || 1,
              duration: t.duration || 0,
              file_path: t.file_path || '',
              cover_url: t.cover_url || iTunesRes.cover_url,
              itunes_id: t.itunes_id ? String(t.itunes_id) : null,
            }))

            safeSaveAlbumToDb(supabase, iTunesRes, tracksToSave).catch(() => {})
          }
          return cachedAlbumResponse(iTunesRes, albumId)
        }
      } catch (iErr) {
        console.warn('iTunes album fetch error:', iErr)
      }
    }

    // 3. Spotify API Branch (Primary provider for alphanumeric Spotify IDs)
    if (albumId.startsWith('spotify') || !/^\d+$/.test(cleanId)) {
      try {
        const albumMeta = await fetchSpotifyAlbumMeta(cleanId)
        if (albumMeta) {
          const spotifyTracks = await fetchFullAlbumTracks(cleanId)
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

          if (supabase) {
            safeSaveAlbumToDb(supabase, albumMeta, tracksToSave).catch(() => {})
          }

          const finalTracks = tracksToSave.map((t: any, idx: number) => ({
            ...t,
            id: `spotify-${t.spotify_id || idx}`,
            source: 'spotify' as const,
            created_at: new Date().toISOString(),
          }))

          return cachedAlbumResponse(
            {
              ...albumMeta,
              tracks: finalTracks,
            },
            albumId
          )
        }
      } catch (spErr) {
        console.warn('Spotify album fetch error:', spErr)
      }
    }

    // 4. Deezer Public API Branch (Primary provider for strictly numeric IDs)
    if (/^\d+$/.test(cleanId) || albumId.startsWith('deezer')) {
      try {
        const deezerRes = await fetchDeezerAlbumTracks(albumId)
        if (deezerRes && deezerRes.meta && deezerRes.tracks.length > 0) {
          const { meta: albumMeta, tracks: tracksToSave } = deezerRes

          if (supabase) {
            safeSaveAlbumToDb(supabase, albumMeta, tracksToSave).catch(() => {})
          }

          return cachedAlbumResponse(
            {
              ...albumMeta,
              tracks: tracksToSave,
            },
            albumId
          )
        }
      } catch (dErr) {
        console.warn('Deezer album fetch warning:', dErr)
      }
    }

    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  } catch (err: any) {
    console.error('API Album detail error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}

