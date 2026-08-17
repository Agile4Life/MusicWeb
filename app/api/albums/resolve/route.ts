import { NextRequest, NextResponse } from 'next/server'
import { searchDeezerAlbums } from '@/lib/deezer'
import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

function cleanTitleString(rawTitle?: string | null, rawArtist?: string | null): string {
  if (!rawTitle) return ''
  let cleaned = rawTitle
    .replace(/[\(\[\{].*?(official|video|audio|mv|lyric|lyrics|full|hd|4k|mp3|visualizer).*?[\)\]\}]/gi, '')
    .trim()

  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ')
    if (parts.length >= 2) {
      const firstPartNorm = parts[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      const artistNorm = (rawArtist || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      const primaryArtist = artistNorm.split(/[,&/]/)[0].trim()
      if (artistNorm.includes(firstPartNorm) || (primaryArtist && firstPartNorm.includes(primaryArtist))) {
        cleaned = parts.slice(1).join(' - ').trim()
      }
    }
  }

  return cleaned
}

function normalizeText(str?: string | null): string {
  if (!str) return ''
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[&(),.\-_]/g, ' ')
    .replace(/\b(single|ep|album|remix|official|audio|video|mv)\b/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
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

    const displayTitle = cleanTitleString(title, artist)
    const cleanTitle = normalizeText(displayTitle || title)
    const cleanArtist = normalizeText(artist)
    let cleanAlbum = normalizeText(albumParam)

    const GENERIC_ALBUM_NAMES = new Set([
      'single',
      'ep',
      'album',
      'unknown album',
      'soundcloud',
      'soundcloud single',
      'soundcloud track',
      'soundcloud playlist',
      'soundcloud import',
      'soundcloud audio',
      'google drive',
      'google drive sync',
      'youtube music',
      'apple music top hits',
      'itunes global',
      'spotify album',
      'spotify import',
    ])

    // If album parameter matches song title or generic placeholder, ignore it to find the real album
    if (!cleanAlbum || cleanAlbum === cleanTitle || GENERIC_ALBUM_NAMES.has(cleanAlbum) || cleanAlbum.startsWith('soundcloud')) {
      cleanAlbum = ''
      albumParam = ''
    }

    let effectiveArtist = artist
    let effectiveTitle = displayTitle || title

    // If artist is generic or uploader-like, attempt to extract artist from raw title
    const artistLower = (artist || '').toLowerCase()
    const isGenericArtist = !artist || artistLower.includes('soundcloud') || artistLower.includes('official') || artistLower.includes('channel') || artistLower.includes('records') || artistLower.includes('music') || artistLower.includes('audio') || artistLower.includes('vibes') || artistLower.includes('media')

    if (title.includes(' - ') || title.includes(' | ')) {
      const delim = title.includes(' - ') ? ' - ' : ' | '
      const parts = title.split(delim).map((p) => p.trim()).filter(Boolean)
      if (parts.length >= 2 && isGenericArtist) {
        effectiveArtist = parts[0]
        effectiveTitle = parts.slice(1).join(' - ')
      }
    }

    const primaryArtist = (effectiveArtist || artist).split(/[,&/]/)[0].trim()
    const finalCleanTitle = normalizeText(effectiveTitle || title)
    const finalCleanArtist = normalizeText(effectiveArtist || artist)
    const cacheKey = `${finalCleanTitle}_${finalCleanArtist}_${cleanAlbum}`

    const supabase = getSupabaseClient()

    // Helper to persist resolved album back to tracks DB table if trackId provided
    const persistToDb = async (albumId: string, albumName: string, coverUrl?: string | null) => {
      if (!supabase || !albumName || albumName === 'Album' || !albumId) return
      try {
        // Upsert spotify_albums first so Foreign Key fk_tracks_spotify_albums constraint is satisfied
        await supabase.from('spotify_albums').upsert({
          id: albumId,
          name: albumName,
          artist: effectiveArtist || artist || 'Various Artists',
          cover_url: coverUrl || null,
        })

        const updatePayload: any = { album: albumName, spotify_album_id: albumId }

        if (trackId && !trackId.startsWith('yt-') && !trackId.startsWith('sc-') && !trackId.startsWith('spotify-') && !trackId.startsWith('itunes-') && !trackId.startsWith('deezer-')) {
          const { error: trackUpdateErr } = await supabase
            .from('tracks')
            .update(updatePayload)
            .eq('id', trackId)

          if (trackUpdateErr && updatePayload.spotify_album_id) {
            await supabase.from('tracks').update({ album: albumName }).eq('id', trackId)
          }
        } else if (finalCleanTitle && finalCleanArtist) {
          const { data: matched } = await supabase
            .from('tracks')
            .select('id, title')
            .ilike('artist', `%${(effectiveArtist || artist).trim() || ''}%`)
            .limit(20)

          if (matched && matched.length > 0) {
            const targetIds = matched
              .filter((t) => !t.title || normalizeText(t.title) === finalCleanTitle || t.title.toLowerCase().includes((effectiveTitle || title).trim().toLowerCase()))
              .map((t) => t.id)

            if (targetIds.length > 0) {
              const { error: batchErr } = await supabase
                .from('tracks')
                .update(updatePayload)
                .in('id', targetIds)

              if (batchErr && updatePayload.spotify_album_id) {
                await supabase.from('tracks').update({ album: albumName }).in('id', targetIds)
              }
            }
          }
        }
      } catch (e) {
        console.warn('Persist resolved album DB warning:', e)
      }
    }

    const memCached = resolveMemoryCache.get(cacheKey)
    if (memCached && Date.now() - memCached.timestamp < RESOLVE_CACHE_TTL) {
      const cachedId = String(memCached.data?.albumId || '')
      const cachedNameNorm = normalizeText(memCached.data?.albumName)
      const targetNorm = cleanAlbum || finalCleanTitle

      const isBadDefianceCache = cachedId.includes('299152445') || cachedId.includes('296970753')
      const isSingleCache = finalCleanTitle && cachedNameNorm === finalCleanTitle

      // STRICT name matching: exact equality OR target starts with album name (album is a prefix)
      const isNameMatching = !targetNorm || cachedNameNorm === targetNorm || targetNorm.startsWith(cachedNameNorm + ' ') || targetNorm.startsWith(cachedNameNorm + '(')

      if (!isBadDefianceCache && !isSingleCache && isNameMatching) {
        if (memCached.data?.albumId && memCached.data?.albumName) {
          persistToDb(memCached.data.albumId, memCached.data.albumName).catch(() => {})
        }
        return cachedResolveResponse(memCached.data, cacheKey)
      } else {
        // Purge invalid or single cached entry
        resolveMemoryCache.delete(cacheKey)
      }
    }

    // 1. Check local Supabase DB cache first
    if (supabase) {
      try {
        if (finalCleanTitle) {
          const { data: dbTrack } = await supabase
            .from('tracks')
            .select('spotify_album_id, album, artist')
            .not('spotify_album_id', 'is', null)
            .ilike('title', `%${(effectiveTitle || title).trim()}%`)
            .limit(10)

          if (dbTrack && dbTrack.length > 0) {
            const foundTrack = dbTrack.find((t) => {
              if (!t.spotify_album_id || normalizeText(t.album) === finalCleanTitle) return false
              if (finalCleanArtist && t.artist) {
                const dbArtistNorm = normalizeText(t.artist)
                // STRICT artist match: exact equality or proper prefix
                const exactMatch = dbArtistNorm === finalCleanArtist
                const albStartsWithArtist = dbArtistNorm.startsWith(finalCleanArtist + ' ')
                const artistStartsWithAlb = finalCleanArtist.startsWith(dbArtistNorm + ' ')
                if (!exactMatch && !albStartsWithArtist && !artistStartsWithAlb) return false
              }
              return true
            })
            if (foundTrack && foundTrack.spotify_album_id) {
              const resData = { albumId: foundTrack.spotify_album_id, albumName: foundTrack.album || title }
              return cachedResolveResponse(resData, cacheKey)
            }
          }
        }

        const targetSearchName = cleanAlbum || finalCleanTitle
        if (targetSearchName) {
          const { data: dbAlbums } = await supabase
            .from('spotify_albums')
            .select('id, name, artist, cover_url')

          if (dbAlbums && dbAlbums.length > 0) {
            const match = dbAlbums.find((alb) => {
              const albName = normalizeText(alb.name)
              const albArtist = normalizeText(alb.artist)
              const isNotSingle = !finalCleanTitle || albName !== finalCleanTitle

              // STRICT artist matching
              let artistMatch = false
              if (!finalCleanArtist) {
                artistMatch = false
              } else if (albArtist === finalCleanArtist) {
                artistMatch = true
              } else {
                const albStartsWithArtist = albArtist.startsWith(finalCleanArtist + ' ')
                const artistStartsWithAlb = finalCleanArtist.startsWith(albArtist + ' ')
                artistMatch = albStartsWithArtist || artistStartsWithAlb
              }

              let nameMatch = false
              if (albName === targetSearchName) {
                nameMatch = true
              } else if (targetSearchName.startsWith(albName + ' ') || targetSearchName.startsWith(albName + '(') || targetSearchName.startsWith(albName + '[')) {
                nameMatch = true
              }

              return isNotSingle && nameMatch && artistMatch
            })

            if (match && match.id) {
              const resData = { albumId: match.id, albumName: match.name, coverUrl: match.cover_url }
              return cachedResolveResponse(resData, cacheKey)
            }
          }
        }
      } catch (dbErr) {
        console.warn('DB album resolve error:', dbErr)
      }
    }

    // Helper: detect if a Deezer result is likely a single (album name ≈ track title)
    const isLikelySingle = (albumTitle?: string, trackTitle?: string) => {
      if (!albumTitle || !trackTitle) return false
      return normalizeText(albumTitle) === normalizeText(trackTitle)
    }

    // Helper: detect if candidate track title matches searched song title
    const isTitleMatch = (candidateTitle?: string) => {
      if (!finalCleanTitle) return true
      if (!candidateTitle) return false
      const cNorm = normalizeText(candidateTitle)
      if (!cNorm) return false

      if (cNorm === finalCleanTitle) return true
      if (cNorm.startsWith(finalCleanTitle) || finalCleanTitle.startsWith(cNorm)) return true

      const cWords = cNorm.split(' ').filter((w) => w.length > 1)
      const tWords = finalCleanTitle.split(' ').filter((w) => w.length > 1)
      if (tWords.length === 0 || cWords.length === 0) return false

      const matches = tWords.filter((w) => cWords.includes(w)).length
      return matches / tWords.length >= 0.7
    }

    // Helper for artist matching — STRICT matching to prevent cross-artist album assignment
    const isArtistMatch = (candidateArtist?: string) => {
      if (!finalCleanArtist) return false
      if (!candidateArtist) return false
      const cNorm = normalizeText(candidateArtist)
      if (!cNorm) return false

      if (cNorm === finalCleanArtist) return true
      if (cNorm.startsWith(finalCleanArtist + ' ') || finalCleanArtist.startsWith(cNorm + ' ')) return true
      if (cNorm.includes(finalCleanArtist) || finalCleanArtist.includes(cNorm)) {
        if (finalCleanArtist.length >= 3 && cNorm.length >= 3) return true
      }

      return false
    }

    // Helper: try to find the real parent album for a track via Deezer album search
    const tryFindRealAlbum = async (artistName: string, trackTitle: string): Promise<{ albumId: string; albumName: string; coverUrl: string | null } | null> => {
      try {
        const deezerAlbumResults = await searchDeezerAlbums(`${artistName}`.trim(), 10)
        if (deezerAlbumResults && deezerAlbumResults.length > 0) {
          const realAlbum = deezerAlbumResults.find((a) => {
            const albName = normalizeText(a.name)
            const isNotSingle = albName !== normalizeText(trackTitle)
            const hasMultipleTracks = (a as any).nb_tracks > 1
            return isNotSingle && hasMultipleTracks && isArtistMatch((a as any).artist?.name || (a as any).artist)
          })
          if (realAlbum && realAlbum.id) {
            try {
              const albumDetailRes = await fetch(
                `https://api.deezer.com/album/${realAlbum.id}/tracks?limit=50`,
                { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
              )
              if (albumDetailRes.ok) {
                const albumDetailData = await albumDetailRes.json()
                const trackInAlbum = (albumDetailData.data || []).find((t: any) =>
                  normalizeText(t.title).includes(normalizeText(trackTitle)) ||
                  normalizeText(trackTitle).includes(normalizeText(t.title))
                )
                if (trackInAlbum) {
                  return {
                    albumId: String(realAlbum.id),
                    albumName: realAlbum.name,
                    coverUrl: (realAlbum as any).cover_url || (realAlbum as any).cover_medium || (realAlbum as any).cover || null,
                  }
                }
              }
            } catch {}
          }
        }
      } catch {}
      return null
    }

    // 2. Priority Direct Deezer Album Search
    const directAlbumQuery = cleanAlbum
      ? `${primaryArtist} ${albumParam}`.trim()
      : `${primaryArtist} ${effectiveTitle || title}`.trim()

    if (directAlbumQuery && primaryArtist) {
      try {
        const deezerResults = await searchDeezerAlbums(directAlbumQuery, 5)
        if (deezerResults && deezerResults.length > 0) {
          const best = deezerResults.find((a) => {
            const albName = normalizeText(a.name)
            const target = cleanAlbum || finalCleanTitle
            const nameOk = !target || albName === target || target.startsWith(albName + ' ')
            return nameOk && isArtistMatch((a as any).artist?.name || (a as any).artist)
          })

          if (best && best.id) {
            const resData = {
              albumId: String(best.id),
              albumName: best.name,
              coverUrl: (best as any).cover_url || (best as any).cover || null,
            }
            await persistToDb(resData.albumId, resData.albumName, resData.coverUrl)
            return cachedResolveResponse(resData, cacheKey)
          }
        }
      } catch (dDirectErr) {
        console.warn('Deezer direct album search resolve warning:', dDirectErr)
      }
    }

    // 3. Primary track-to-album resolution via Deezer search API (primary artist + display title)
    const searchQuery = `${primaryArtist} ${effectiveTitle || title}`.trim()
    if (searchQuery && primaryArtist) {
      try {
        const dTrackRes = await fetch(
          `https://api.deezer.com/search?q=${encodeURIComponent(searchQuery)}&limit=5`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
        )
        if (dTrackRes.ok) {
          const dData = await dTrackRes.json()
          if (dData.data && dData.data.length > 0) {
            const bestTrack = dData.data.find((item: any) => isArtistMatch(item.artist?.name) && isTitleMatch(item.title))

            if (bestTrack && bestTrack.album?.id) {
              if (isLikelySingle(bestTrack.album.title, bestTrack.title)) {
                const realAlbum = await tryFindRealAlbum(primaryArtist, bestTrack.title)
                if (realAlbum) {
                  await persistToDb(realAlbum.albumId, realAlbum.albumName, realAlbum.coverUrl)
                  return cachedResolveResponse(realAlbum, cacheKey)
                }
              }

              const resData = {
                albumId: String(bestTrack.album.id),
                albumName: bestTrack.album.title || albumParam || 'Single',
                coverUrl: bestTrack.album.cover_medium || bestTrack.album.cover || null,
              }
              await persistToDb(resData.albumId, resData.albumName, resData.coverUrl)
              return cachedResolveResponse(resData, cacheKey)
            }
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
          `https://api.deezer.com/search?q=${encodeURIComponent(effectiveTitle || title)}&limit=5`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
        )
        if (dTitleRes.ok) {
          const dTitleData = await dTitleRes.json()
          if (dTitleData.data && dTitleData.data.length > 0) {
            const bestTrack = dTitleData.data.find((item: any) => isArtistMatch(item.artist?.name) && isTitleMatch(item.title))
            if (bestTrack && bestTrack.album?.id) {
              if (isLikelySingle(bestTrack.album.title, bestTrack.title)) {
                const realAlbum = await tryFindRealAlbum(primaryArtist, bestTrack.title)
                if (realAlbum) {
                  await persistToDb(realAlbum.albumId, realAlbum.albumName, realAlbum.coverUrl)
                  return cachedResolveResponse(realAlbum, cacheKey)
                }
              }

              const resData = {
                albumId: String(bestTrack.album.id),
                albumName: bestTrack.album.title || albumParam || 'Single',
                coverUrl: bestTrack.album.cover_medium || bestTrack.album.cover || null,
              }
              await persistToDb(resData.albumId, resData.albumName, resData.coverUrl)
              return cachedResolveResponse(resData, cacheKey)
            }
          }
        }
      } catch (dTitleErr) {
        console.warn('Deezer title search resolve warning:', dTitleErr)
      }
    }

    // 5. iTunes Track / Collection Search Fallback (Strict Artist Match Only)
    try {
      const iTunesSearchTerm = searchQuery || (effectiveTitle || title).trim()
      if (iTunesSearchTerm && finalCleanArtist) {
        const iRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(iTunesSearchTerm)}&entity=song&limit=5`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
        )
        if (iRes.ok) {
          const iData = await iRes.json()
          if (iData.results && iData.results.length > 0) {
            const match = iData.results.find((t: any) => t.collectionId && t.collectionName && isArtistMatch(t.artistName) && isTitleMatch(t.trackName || t.collectionName))
            if (match && match.collectionId) {
              const resData = {
                albumId: `itunes-${match.collectionId}`,
                albumName: match.collectionName || albumParam || 'Single',
                coverUrl: match.artworkUrl100 || null,
              }
              await persistToDb(resData.albumId, resData.albumName, resData.coverUrl)
              return cachedResolveResponse(resData, cacheKey)
            }
          }
        }
      }
    } catch (iErr) {
      console.warn('iTunes resolve fallback warning:', iErr)
    }

    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  } catch (err: any) {
    console.error('API album resolve error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}

