import { NextRequest, NextResponse } from 'next/server'
import { searchDeezerAlbums, extractDeezerArtistName } from '@/lib/deezer'
import { createClient } from '@supabase/supabase-js'
import { isKnownBadFallback, isRealAlbumName } from '@/lib/albumCache'
import { isRetiredMusicId } from '@/lib/retiredMusicSources'
import {
  cleanTrackTitleForAlbumSearch,
  normalizeAlbumText,
  cleanDisplayAlbumName,
  isAlbumArtistMatch,
  isAlbumTrackTitleMatch,
  isAlbumNameMatch,
  isLikelySingleAlbum,
  isCompilationOrSpamAlbum,
  selectBestAlbumTrackCandidate,
  type AlbumTrackCandidate,
} from '@/lib/albumMatching'

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

const resolveMemoryCache = new Map<string, { data: any; timestamp: number }>()
const RESOLVE_CACHE_TTL = 30 * 60 * 1000 // 30 mins

function cachedResolveResponse(data: any, key: string) {
  if (resolveMemoryCache.size > 300) {
    const oldestKey = resolveMemoryCache.keys().next().value
    if (oldestKey) resolveMemoryCache.delete(oldestKey)
  }
  resolveMemoryCache.set(key, { data, timestamp: Date.now() })
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
    },
  })
}

interface PersistAlbumMeta {
  albumId: string
  albumName: string
  coverUrl?: string | null
  totalTracks?: number | null
  releaseDate?: string | null
  albumType?: string | null
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const title = searchParams.get('title') || ''
    const artist = searchParams.get('artist') || ''
    let albumParam = searchParams.get('album') || ''
    const trackId = searchParams.get('track_id') || searchParams.get('id') || ''

    if (!title.trim() && !artist.trim() && !albumParam.trim()) {
      return NextResponse.json({ error: 'Missing title, artist, or album' }, { status: 400 })
    }

    const displayTitle = cleanTrackTitleForAlbumSearch(title, artist)
    const cleanTitle = normalizeAlbumText(displayTitle || title)
    let cleanAlbum = normalizeAlbumText(albumParam)

    // If album parameter matches song title or is a generic placeholder, ignore it so we can discover the parent studio album
    if (
      !cleanAlbum ||
      !isRealAlbumName(albumParam, displayTitle || title) ||
      cleanAlbum === cleanTitle ||
      cleanAlbum.startsWith('soundcloud')
    ) {
      cleanAlbum = ''
      albumParam = ''
    }

    let effectiveArtist = artist
    let effectiveTitle = displayTitle || title

    // If artist is generic or uploader-like, attempt to extract artist from raw title
    const artistLower = (artist || '').toLowerCase()
    const isGenericArtist =
      !artist ||
      artistLower.includes('soundcloud') ||
      artistLower.includes('official') ||
      artistLower.includes('channel') ||
      artistLower.includes('records') ||
      artistLower.includes('music') ||
      artistLower.includes('audio') ||
      artistLower.includes('vibes') ||
      artistLower.includes('media')

    if (title.includes(' - ') || title.includes(' | ')) {
      const delim = title.includes(' - ') ? ' - ' : ' | '
      const parts = title.split(delim).map((p) => p.trim()).filter(Boolean)
      if (parts.length >= 2 && isGenericArtist) {
        effectiveArtist = parts[0]
        effectiveTitle = cleanTrackTitleForAlbumSearch(parts.slice(1).join(' - '), parts[0])
      }
    }

    const primaryArtist = (effectiveArtist || artist).split(/[,&/]/)[0].trim()
    const finalCleanTitle = normalizeAlbumText(effectiveTitle || title)
    const finalCleanArtist = normalizeAlbumText(effectiveArtist || artist)
    const cacheKey = `${finalCleanTitle}_${finalCleanArtist}_${cleanAlbum}`

    const supabase = getSupabaseClient()

    // Helper to persist resolved album back to tracks DB table if trackId provided
    const persistToDb = async (meta: PersistAlbumMeta) => {
      const { albumId, albumName, coverUrl, totalTracks, releaseDate, albumType } = meta
      if (!supabase || !albumName || !isRealAlbumName(albumName) || !albumId || isKnownBadFallback(albumId)) {
        return
      }
      try {
        const albumRecord: Record<string, any> = {
          id: albumId,
          name: albumName,
          artist: effectiveArtist || artist || 'Various Artists',
          cover_url: coverUrl || null,
        }
        if (typeof totalTracks === 'number' && totalTracks > 0) {
          albumRecord.total_tracks = totalTracks
        }
        if (releaseDate) {
          albumRecord.release_date = releaseDate
        }
        if (albumType) {
          albumRecord.album_type = albumType
        }

        // Only overwrite spotify_albums if we have full metadata (totalTracks > 0);
        // otherwise insert with ignoreDuplicates so we never clobber an existing complete album row.
        await supabase.from('spotify_albums').upsert(albumRecord, {
          onConflict: 'id',
          ignoreDuplicates: !(typeof totalTracks === 'number' && totalTracks > 0),
        })

        const updatePayload: any = { album: albumName, spotify_album_id: albumId }

        if (
          trackId &&
          !trackId.startsWith('yt-') &&
          !trackId.startsWith('sc-') &&
          !trackId.startsWith('spotify-') &&
          !trackId.startsWith('deezer-') &&
          !trackId.startsWith('nct-') &&
          !isRetiredMusicId(trackId)
        ) {
          const { error: trackUpdateErr } = await supabase
            .from('tracks')
            .update(updatePayload)
            .eq('id', trackId)
            .is('spotify_album_id', null)

          if (trackUpdateErr && updatePayload.spotify_album_id) {
            await supabase
              .from('tracks')
              .update({ album: albumName })
              .eq('id', trackId)
              .is('album', null)
          }
        } else if (finalCleanTitle && finalCleanArtist) {
          const { data: matched } = await supabase
            .from('tracks')
            .select('id, title, artist')
            .is('spotify_album_id', null)
            .ilike('artist', `%${primaryArtist}%`)
            .limit(20)

          if (matched && matched.length > 0) {
            const targetIds = matched
              .filter(
                (t) =>
                  t.title &&
                  isAlbumTrackTitleMatch(t.title, effectiveTitle || title) &&
                  isAlbumArtistMatch(t.artist || effectiveArtist, effectiveArtist || artist),
              )
              .map((t) => t.id)

            if (targetIds.length > 0) {
              const { error: batchErr } = await supabase
                .from('tracks')
                .update(updatePayload)
                .in('id', targetIds)
                .is('spotify_album_id', null)

              if (batchErr && updatePayload.spotify_album_id) {
                await supabase
                  .from('tracks')
                  .update({ album: albumName })
                  .in('id', targetIds)
                  .is('album', null)
              }
            }
          }
        }
      } catch (e) {
        console.warn('Persist resolved album DB warning:', e)
      }
    }

    // 0. Check in-memory resolution cache
    const memCached = resolveMemoryCache.get(cacheKey)
    if (memCached && Date.now() - memCached.timestamp < RESOLVE_CACHE_TTL) {
      const cachedId = String(memCached.data?.albumId || '')
      const cachedName = String(memCached.data?.albumName || '')

      const isValidId = Boolean(cachedId) && !isKnownBadFallback(cachedId)
      const isNameMatching = !albumParam || isAlbumNameMatch(cachedName, albumParam)

      if (isValidId && isNameMatching) {
        if (cachedId && cachedName) {
          persistToDb({
            albumId: cachedId,
            albumName: cachedName,
            coverUrl: memCached.data?.coverUrl,
          }).catch(() => {})
        }
        return cachedResolveResponse(memCached.data, cacheKey)
      } else {
        resolveMemoryCache.delete(cacheKey)
      }
    }

    // 1. Check local Supabase DB cache first
    if (supabase) {
      try {
        if (finalCleanTitle && finalCleanArtist) {
          const { data: dbTrack } = await supabase
            .from('tracks')
            .select('spotify_album_id, album, artist, title')
            .not('spotify_album_id', 'is', null)
            .ilike('title', `%${(effectiveTitle || title).trim()}%`)
            .limit(15)

          if (dbTrack && dbTrack.length > 0) {
            const foundTrack = dbTrack.find((t) => {
              if (!t.spotify_album_id || isKnownBadFallback(t.spotify_album_id)) return false
              if (!t.album || !isRealAlbumName(t.album)) return false
              if (!isAlbumTrackTitleMatch(t.title, effectiveTitle || title)) return false
              if (!isAlbumArtistMatch(t.artist, effectiveArtist || artist)) return false
              if (albumParam && !isAlbumNameMatch(t.album, albumParam)) return false
              // Skip 1-track single rows in DB so we can still check if a studio album exists
              if (!albumParam && isLikelySingleAlbum(t.album, effectiveTitle || title)) return false
              return true
            })
            if (foundTrack && foundTrack.spotify_album_id) {
              const resData = {
                albumId: foundTrack.spotify_album_id,
                albumName: cleanDisplayAlbumName(foundTrack.album) || foundTrack.album || title,
              }
              return cachedResolveResponse(resData, cacheKey)
            }
          }
        }

        // Only query spotify_albums directly when we have an explicit album name (or checking multi-track title-track albums)
        if (finalCleanArtist && (albumParam || finalCleanTitle)) {
          const searchTerm = (albumParam || effectiveTitle || title).trim()
          const { data: dbAlbums } = await supabase
            .from('spotify_albums')
            .select('id, name, artist, cover_url, total_tracks, album_type')
            .ilike('name', `%${searchTerm}%`)
            .limit(20)

          if (dbAlbums && dbAlbums.length > 0) {
            const match = dbAlbums.find((alb) => {
              if (!alb.id || isKnownBadFallback(alb.id)) return false
              if (!isAlbumArtistMatch(alb.artist, effectiveArtist || artist)) return false

              if (albumParam) {
                return isAlbumNameMatch(alb.name, albumParam)
              }

              // When no albumParam was given, only match if the song is the exact title track of a multi-track studio album
              const isMultiTrackStudioAlbum =
                typeof alb.total_tracks === 'number' &&
                alb.total_tracks > 1 &&
                alb.album_type !== 'single'
              return isMultiTrackStudioAlbum && isAlbumNameMatch(alb.name, effectiveTitle || title)
            })

            if (match && match.id) {
              const resData = {
                albumId: match.id,
                albumName: cleanDisplayAlbumName(match.name) || match.name,
                coverUrl: match.cover_url,
              }
              return cachedResolveResponse(resData, cacheKey)
            }
          }
        }
      } catch (dbErr) {
        console.warn('DB album resolve error:', dbErr)
      }
    }

    // Helper: try to find the real parent studio album for a track via Deezer album search
    const tryFindRealAlbum = async (
      artistName: string,
      trackTitle: string,
    ): Promise<PersistAlbumMeta | null> => {
      try {
        const deezerAlbumResults = await searchDeezerAlbums(`${artistName}`.trim(), 12)
        if (!deezerAlbumResults || deezerAlbumResults.length === 0) return null

        const candidateAlbums = deezerAlbumResults
          .filter((a) => {
            if (!a || !a.id || isKnownBadFallback(a.id)) return false
            const hasMultipleTracks = (a.total_tracks || 0) > 1 && a.album_type !== 'single'
            if (!hasMultipleTracks) return false
            if (!isAlbumArtistMatch(a.artist, artistName)) return false
            if (isCompilationOrSpamAlbum(a.name, a.artist, a.album_type)) return false
            return true
          })
          .slice(0, 4)

        if (candidateAlbums.length === 0) return null

        const checks = await Promise.all(
          candidateAlbums.map(async (candAlbum) => {
            try {
              const albumDetailRes = await fetch(
                `https://api.deezer.com/album/${encodeURIComponent(candAlbum.id)}/tracks?limit=50`,
                { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3500) },
              )
              if (!albumDetailRes.ok) return null
              const albumDetailData = await albumDetailRes.json()
              const trackInAlbum = (albumDetailData.data || []).find((t: any) =>
                isAlbumTrackTitleMatch(t.title || t.title_short, trackTitle),
              )
              if (trackInAlbum) {
                return {
                  albumId: String(candAlbum.id),
                  albumName: cleanDisplayAlbumName(candAlbum.name) || candAlbum.name,
                  coverUrl: candAlbum.cover_url || null,
                  totalTracks: candAlbum.total_tracks,
                  releaseDate: candAlbum.release_date,
                  albumType: candAlbum.album_type,
                }
              }
            } catch {}
            return null
          }),
        )

        return checks.find((res): res is NonNullable<typeof res> => res !== null) || null
      } catch {}
      return null
    }

    // 2. Priority Direct Deezer Album Search — ONLY when caller provided a real album name
    if (cleanAlbum && albumParam && primaryArtist) {
      try {
        const directAlbumQuery = `${primaryArtist} ${albumParam}`.trim()
        const deezerResults = await searchDeezerAlbums(directAlbumQuery, 8)
        if (deezerResults && deezerResults.length > 0) {
          const matchingAlbums = deezerResults.filter(
            (a) =>
              a &&
              a.id &&
              !isKnownBadFallback(a.id) &&
              isAlbumNameMatch(a.name, albumParam) &&
              isAlbumArtistMatch(a.artist, effectiveArtist || artist),
          )
          // Prefer multi-track albums over singles when both match
          matchingAlbums.sort((a, b) => (b.total_tracks || 0) - (a.total_tracks || 0))
          const best = matchingAlbums[0]

          if (best && best.id) {
            const displayAlbum = cleanDisplayAlbumName(best.name) || best.name
            const resData = {
              albumId: String(best.id),
              albumName: displayAlbum,
              coverUrl: best.cover_url || null,
            }
            await persistToDb({
              ...resData,
              totalTracks: best.total_tracks,
              releaseDate: best.release_date,
              albumType: best.album_type,
            })
            return cachedResolveResponse(resData, cacheKey)
          }
        }
      } catch (dDirectErr) {
        console.warn('Deezer direct album search resolve warning:', dDirectErr)
      }
    }

    // Helper to map raw Deezer track search items to AlbumTrackCandidate
    const mapDeezerTrackCandidates = (items: any[]): AlbumTrackCandidate[] =>
      (items || [])
        .filter((item: any) => item && item.album?.id && !isKnownBadFallback(String(item.album.id)) && (item.title || item.title_short))
        .map((item: any) => ({
          trackTitle: item.title || item.title_short || '',
          artistName: extractDeezerArtistName(item),
          albumId: String(item.album.id),
          albumTitle: item.album.title || '',
          coverUrl:
            item.album.cover_xl ||
            item.album.cover_big ||
            item.album.cover_medium ||
            item.album.cover ||
            null,
          totalTracks: item.album.nb_tracks || undefined,
          albumType: item.album.record_type || item.album.type || undefined,
        }))

    // 3. Primary track-to-album resolution via Deezer search API (primary artist + display title)
    const searchQuery = `${primaryArtist} ${effectiveTitle || title}`.trim()
    if (searchQuery && primaryArtist) {
      try {
        const dTrackRes = await fetch(
          `https://api.deezer.com/search?q=${encodeURIComponent(searchQuery)}&limit=15`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) },
        )
        if (dTrackRes.ok) {
          const dData = await dTrackRes.json()
          const candidates = mapDeezerTrackCandidates(dData.data)
          const bestTrack = selectBestAlbumTrackCandidate(candidates, {
            title: effectiveTitle || title,
            artist: effectiveArtist || artist,
            album: albumParam,
          })

          if (bestTrack) {
            if (
              isLikelySingleAlbum(
                bestTrack.albumTitle,
                bestTrack.trackTitle,
                bestTrack.totalTracks,
                bestTrack.albumType,
              )
            ) {
              const realAlbum = await tryFindRealAlbum(primaryArtist, bestTrack.trackTitle)
              if (realAlbum) {
                await persistToDb(realAlbum)
                return cachedResolveResponse(
                  {
                    albumId: realAlbum.albumId,
                    albumName: realAlbum.albumName,
                    coverUrl: realAlbum.coverUrl,
                  },
                  cacheKey,
                )
              }
            }

            const displayAlbum =
              cleanDisplayAlbumName(bestTrack.albumTitle) || bestTrack.albumTitle || albumParam || 'Single'
            const resData = {
              albumId: bestTrack.albumId,
              albumName: displayAlbum,
              coverUrl: bestTrack.coverUrl || null,
            }
            await persistToDb({
              ...resData,
              totalTracks: bestTrack.totalTracks,
              albumType: bestTrack.albumType,
            })
            return cachedResolveResponse(resData, cacheKey)
          }
        }
      } catch (dTrackErr) {
        console.warn('Deezer track resolve warning:', dTrackErr)
      }
    }

    // 4. Title-Only Deezer Track Search (Strict Artist Match Only)
    if (finalCleanTitle && finalCleanArtist) {
      try {
        const dTitleRes = await fetch(
          `https://api.deezer.com/search?q=${encodeURIComponent(effectiveTitle || title)}&limit=15`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) },
        )
        if (dTitleRes.ok) {
          const dTitleData = await dTitleRes.json()
          const candidates = mapDeezerTrackCandidates(dTitleData.data)
          const bestTrack = selectBestAlbumTrackCandidate(candidates, {
            title: effectiveTitle || title,
            artist: effectiveArtist || artist,
            album: albumParam,
          })

          if (bestTrack) {
            if (
              isLikelySingleAlbum(
                bestTrack.albumTitle,
                bestTrack.trackTitle,
                bestTrack.totalTracks,
                bestTrack.albumType,
              )
            ) {
              const realAlbum = await tryFindRealAlbum(primaryArtist, bestTrack.trackTitle)
              if (realAlbum) {
                await persistToDb(realAlbum)
                return cachedResolveResponse(
                  {
                    albumId: realAlbum.albumId,
                    albumName: realAlbum.albumName,
                    coverUrl: realAlbum.coverUrl,
                  },
                  cacheKey,
                )
              }
            }

            const displayAlbum =
              cleanDisplayAlbumName(bestTrack.albumTitle) || bestTrack.albumTitle || albumParam || 'Single'
            const resData = {
              albumId: bestTrack.albumId,
              albumName: displayAlbum,
              coverUrl: bestTrack.coverUrl || null,
            }
            await persistToDb({
              ...resData,
              totalTracks: bestTrack.totalTracks,
              albumType: bestTrack.albumType,
            })
            return cachedResolveResponse(resData, cacheKey)
          }
        }
      } catch (dTitleErr) {
        console.warn('Deezer title search resolve warning:', dTitleErr)
      }
    }

    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  } catch (err: any) {
    console.error('API album resolve error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
