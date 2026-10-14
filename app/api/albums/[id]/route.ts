import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchSpotifyAlbumMeta, fetchFullAlbumTracks } from '@/lib/spotify'
import { fetchDeezerAlbumTracks, searchDeezerAlbums } from '@/lib/deezer'
import { fetchITunesAlbumTracks, searchITunesAlbums } from '@/lib/itunes'
import {
  stripAlbumIdPrefix,
  sortAlbumTracks,
  validateAndNormalizeCachedAlbum,
} from '@/lib/albumId'
import { isAlbumArtistMatch, isAlbumNameMatch } from '@/lib/albumMatching'

const albumMemoryCache = new Map<string, { data: any; timestamp: number }>()
const ALBUM_CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const SYSTEM_USER_ID = '00000000-0000-4000-a000-000000000001'

function touchMemCache(key: string, value: { data: any; timestamp: number }) {
  albumMemoryCache.delete(key)
  albumMemoryCache.set(key, value)
}

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
    const albumIdStr = String(albumMeta.id)
    const totalTracks = tracksToSave?.length || albumMeta.total_tracks || 0

    await supabase.from('spotify_albums').upsert({
      id: albumIdStr,
      name: albumMeta.name,
      artist: albumMeta.artist || 'Various Artists',
      cover_url: albumMeta.cover_url || null,
      release_date: albumMeta.release_date || '',
      total_tracks: totalTracks,
      album_type: albumMeta.album_type || (totalTracks === 1 ? 'single' : 'album'),
    })

    if (tracksToSave && tracksToSave.length > 0) {
      // Sanitize to valid PostgreSQL `tracks` columns only (strip synthetic non-UUID `id` and `audio_url`)
      const dbRows = tracksToSave.map((t: any, idx: number) => ({
        user_id: t.user_id || SYSTEM_USER_ID,
        title: t.title || 'Untitled Track',
        artist: t.artist || albumMeta.artist || 'Various Artists',
        album: albumMeta.name || t.album || null,
        spotify_album_id: albumIdStr,
        disc_number: t.disc_number || 1,
        track_number: t.track_number || idx + 1,
        duration: Math.round(Number(t.duration) || 0),
        file_path: t.file_path || `ext:${albumIdStr}:${idx + 1}`,
        cover_url: t.cover_url || albumMeta.cover_url || null,
        spotify_id: t.spotify_id ? String(t.spotify_id) : null,
        source: t.source || 'spotify',
      }))

      const { error: upsertErr } = await supabase.from('tracks').upsert(dbRows, {
        onConflict: 'user_id,title,artist,spotify_album_id',
        ignoreDuplicates: true,
      })

      // Fallback if ON CONFLICT constraint error (42P10) occurs
      if (upsertErr) {
        try {
          const { data: existing } = await supabase
            .from('tracks')
            .select('title, artist, spotify_album_id')
            .eq('spotify_album_id', albumIdStr)

          const existingKeys = new Set(
            (existing || []).map(
              (t: any) =>
                `${(t.title || '').toLowerCase()}::${(t.artist || '').toLowerCase()}::${(t.spotify_album_id || '').toLowerCase()}`
            )
          )

          const newTracks = dbRows.filter(
            (t) =>
              !existingKeys.has(
                `${(t.title || '').toLowerCase()}::${(t.artist || '').toLowerCase()}::${(t.spotify_album_id || '').toLowerCase()}`
              )
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
    const cleanId = stripAlbumIdPrefix(albumId)
    const idVariants = Array.from(new Set([albumId, cleanId, `deezer-${cleanId}`, `itunes-${cleanId}`]))

    // 0. Check in-memory LRU cache (<2ms)
    for (const key of idVariants) {
      const memCached = albumMemoryCache.get(key)
      if (
        memCached &&
        Date.now() - memCached.timestamp < ALBUM_CACHE_TTL &&
        Array.isArray(memCached.data?.tracks) &&
        memCached.data.tracks.length > 0
      ) {
        touchMemCache(key, memCached)
        return NextResponse.json(memCached.data, {
          headers: {
            'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
          },
        })
      }
    }

    const supabase = getSupabaseClient()
    let fallbackMeta: { id?: string; name?: string; artist?: string; cover_url?: string | null; release_date?: string } | null = null

    // 1. Check Supabase DB cache first
    if (supabase) {
      try {
        const { data: cachedList } = await supabase
          .from('spotify_albums')
          .select('*, tracks:tracks!spotify_album_id(*)')
          .in('id', idVariants)
          .limit(1)

        const cached = cachedList && cachedList.length > 0 ? cachedList[0] : null
        if (cached && cached.name && cached.artist) {
          fallbackMeta = cached
        }

        const validatedCached = validateAndNormalizeCachedAlbum(cached)
        if (validatedCached) {
          return cachedAlbumResponse(validatedCached, albumId)
        }
      } catch (cacheErr) {
        console.warn('Album DB cache lookup error:', cacheErr)
      }
    }

    // 2. Spotify API Branch (Primary provider for alphanumeric Spotify IDs)
    if (albumId.startsWith('spotify') || !/^\d+$/.test(cleanId)) {
      try {
        const albumMeta = await fetchSpotifyAlbumMeta(cleanId)
        if (albumMeta) {
          fallbackMeta = albumMeta
          const spotifyTracks = await fetchFullAlbumTracks(cleanId)

          if (spotifyTracks.length > 0) {
            const tracksToSave = sortAlbumTracks(
              spotifyTracks.map((item: any, idx: number) => ({
                user_id: SYSTEM_USER_ID,
                title: item.name,
                artist: item.artists?.map((a: any) => a.name).join(', ') || albumMeta.artist,
                album: albumMeta.name,
                spotify_album_id: albumMeta.id,
                disc_number: item.disc_number || 1,
                track_number: item.track_number || idx + 1,
                duration: Math.round((item.duration_ms || 0) / 1000),
                file_path: item.external_urls?.spotify || item.preview_url || `spotify:${item.id}`,
                cover_url: albumMeta.cover_url,
                spotify_id: item.id,
                source: 'spotify' as const,
              })),
            )

            const enrichedMeta = {
              ...albumMeta,
              total_tracks: tracksToSave.length || albumMeta.total_tracks,
            }

            if (supabase) {
              safeSaveAlbumToDb(supabase, enrichedMeta, tracksToSave).catch(() => {})
            }

            const finalTracks = tracksToSave.map((t: any, idx: number) => ({
              ...t,
              id: `spotify-${t.spotify_id || idx}`,
              source: 'spotify' as const,
              created_at: new Date().toISOString(),
            }))

            return cachedAlbumResponse(
              {
                ...enrichedMeta,
                tracks: finalTracks,
              },
              albumId
            )
          }
        }
      } catch (spErr) {
        console.warn('Spotify album fetch error:', spErr)
      }
    }

    // 3. iTunes Public API Branch (itunes-{collectionId})
    if (albumId.startsWith('itunes-')) {
      try {
        const itunesDetail = await fetchITunesAlbumTracks(albumId)
        if (itunesDetail && itunesDetail.tracks.length > 0) {
          const { tracks: itunesTracks, ...meta } = itunesDetail
          const sortedTracks = sortAlbumTracks(itunesTracks)

          if (supabase) {
            safeSaveAlbumToDb(supabase, meta, sortedTracks).catch(() => {})
          }

          return cachedAlbumResponse(
            {
              ...meta,
              tracks: sortedTracks,
            },
            albumId
          )
        }
      } catch (itErr) {
        console.warn('iTunes album fetch warning:', itErr)
      }
    }

    // 4. Deezer Public API Branch (Primary provider for strictly numeric IDs)
    if (!albumId.startsWith('itunes-') && (/^\d+$/.test(cleanId) || albumId.startsWith('deezer'))) {
      try {
        const deezerRes = await fetchDeezerAlbumTracks(albumId)
        if (deezerRes && deezerRes.meta && deezerRes.tracks.length > 0) {
          const { meta: albumMeta, tracks: tracksToSave } = deezerRes
          const sortedTracks = sortAlbumTracks(tracksToSave)

          if (supabase) {
            safeSaveAlbumToDb(supabase, albumMeta, sortedTracks).catch(() => {})
          }

          return cachedAlbumResponse(
            {
              ...albumMeta,
              tracks: sortedTracks,
            },
            albumId
          )
        }
      } catch (dErr) {
        console.warn('Deezer album fetch warning:', dErr)
      }

      // If numeric ID was actually an iTunes collectionId without prefix, try iTunes lookup
      try {
        const itunesFallback = await fetchITunesAlbumTracks(`itunes-${cleanId}`)
        if (itunesFallback && itunesFallback.tracks.length > 0) {
          const { tracks: itunesTracks, ...meta } = itunesFallback
          const sortedTracks = sortAlbumTracks(itunesTracks)
          if (supabase) {
            safeSaveAlbumToDb(supabase, meta, sortedTracks).catch(() => {})
          }
          return cachedAlbumResponse({ ...meta, tracks: sortedTracks }, albumId)
        }
      } catch {}
    }

    // 5. Cross-Provider Metadata Fallback: If we know the album's name & artist (from Spotify meta or DB stub),
    // resolve its full tracklist via Deezer or iTunes so the user never hits a dead 404.
    if (fallbackMeta?.name && fallbackMeta?.artist) {
      const searchQuery = `${fallbackMeta.artist} ${fallbackMeta.name}`.trim()
      try {
        const deezerCandidates = await searchDeezerAlbums(searchQuery, 6)
        const matchedDeezer = deezerCandidates.find(
          (a) =>
            isAlbumNameMatch(a.name, fallbackMeta!.name) &&
            isAlbumArtistMatch(a.artist, fallbackMeta!.artist),
        )
        if (matchedDeezer?.id) {
          const deezerRes = await fetchDeezerAlbumTracks(matchedDeezer.id)
          if (deezerRes && deezerRes.tracks.length > 0) {
            const mergedMeta = {
              ...deezerRes.meta,
              id: albumId,
              name: fallbackMeta.name || deezerRes.meta.name,
              artist: fallbackMeta.artist || deezerRes.meta.artist,
              cover_url: fallbackMeta.cover_url || deezerRes.meta.cover_url,
              release_date: fallbackMeta.release_date || deezerRes.meta.release_date,
            }
            const sortedTracks = sortAlbumTracks(deezerRes.tracks).map((t) => ({
              ...t,
              album: mergedMeta.name,
              spotify_album_id: albumId,
              cover_url: t.cover_url || mergedMeta.cover_url || null,
            }))
            if (supabase) {
              safeSaveAlbumToDb(supabase, mergedMeta, sortedTracks).catch(() => {})
            }
            return cachedAlbumResponse({ ...mergedMeta, tracks: sortedTracks }, albumId)
          }
        }
      } catch {}

      try {
        const itunesCandidates = await searchITunesAlbums(searchQuery, 6)
        const matchedITunes = itunesCandidates.find(
          (a) =>
            isAlbumNameMatch(a.name, fallbackMeta!.name) &&
            isAlbumArtistMatch(a.artist, fallbackMeta!.artist),
        )
        if (matchedITunes?.id) {
          const itunesDetail = await fetchITunesAlbumTracks(matchedITunes.id)
          if (itunesDetail && itunesDetail.tracks.length > 0) {
            const { tracks: itunesTracks, ...meta } = itunesDetail
            const mergedMeta = {
              ...meta,
              id: albumId,
              name: fallbackMeta.name || meta.name,
              artist: fallbackMeta.artist || meta.artist,
              cover_url: fallbackMeta.cover_url || meta.cover_url,
              release_date: fallbackMeta.release_date || meta.release_date,
            }
            const sortedTracks = sortAlbumTracks(itunesTracks).map((t) => ({
              ...t,
              album: mergedMeta.name,
              spotify_album_id: albumId,
              cover_url: t.cover_url || mergedMeta.cover_url || null,
            }))
            if (supabase) {
              safeSaveAlbumToDb(supabase, mergedMeta, sortedTracks).catch(() => {})
            }
            return cachedAlbumResponse({ ...mergedMeta, tracks: sortedTracks }, albumId)
          }
        }
      } catch {}
    }

    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  } catch (err: any) {
    console.error('API Album detail error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
