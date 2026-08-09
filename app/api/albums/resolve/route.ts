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

    // If album parameter matches song title or generic placeholder, ignore it to find the real album
    if (cleanAlbum === cleanTitle || cleanAlbum === 'single' || cleanAlbum === 'unknown album') {
      cleanAlbum = ''
      albumParam = ''
    }

    const primaryArtist = artist.split(/[,&/]/)[0].trim()
    const cacheKey = `${cleanTitle}_${cleanArtist}_${cleanAlbum}`

    const supabase = getSupabaseClient()

    // Helper to persist resolved album back to tracks DB table if trackId provided
    const persistToDb = async (albumId: string, albumName: string, coverUrl?: string | null) => {
      if (!supabase || !albumName || albumName === 'Album' || !albumId) return
      try {
        // Upsert spotify_albums first so Foreign Key fk_tracks_spotify_albums constraint is satisfied
        await supabase.from('spotify_albums').upsert({
          id: albumId,
          name: albumName,
          artist: artist || 'Various Artists',
          cover_url: coverUrl || null,
        })

        const updatePayload: any = { album: albumName, spotify_album_id: albumId }

        if (trackId && !trackId.startsWith('yt-') && !trackId.startsWith('spotify-') && !trackId.startsWith('itunes-') && !trackId.startsWith('deezer-')) {
          const { error: trackUpdateErr } = await supabase
            .from('tracks')
            .update(updatePayload)
            .eq('id', trackId)

          if (trackUpdateErr && updatePayload.spotify_album_id) {
            await supabase.from('tracks').update({ album: albumName }).eq('id', trackId)
          }
        } else if (cleanTitle) {
          const { data: matched } = await supabase
            .from('tracks')
            .select('id, title')
            .ilike('artist', `%${artist.trim() || ''}%`)
            .limit(20)

          if (matched && matched.length > 0) {
            const targetIds = matched
              .filter((t) => !t.title || normalizeText(t.title) === cleanTitle || t.title.toLowerCase().includes(title.trim().toLowerCase()))
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
      const targetNorm = cleanAlbum || cleanTitle

      const isBadDefianceCache = cachedId.includes('299152445') || cachedId.includes('296970753')
      const isNameMatching = targetNorm && (cachedNameNorm.includes(targetNorm) || targetNorm.includes(cachedNameNorm))

      if (!isBadDefianceCache && isNameMatching) {
        if (memCached.data?.albumId && memCached.data?.albumName) {
          persistToDb(memCached.data.albumId, memCached.data.albumName).catch(() => {})
        }
        return cachedResolveResponse(memCached.data, cacheKey)
      } else {
        // Purge invalid cached entry
        resolveMemoryCache.delete(cacheKey)
      }
    }

    // 1. Check local Supabase DB cache first
    if (supabase) {
      try {
        if (cleanTitle) {
          const { data: dbTrack } = await supabase
            .from('tracks')
            .select('spotify_album_id, album, artist')
            .not('spotify_album_id', 'is', null)
            .ilike('title', `%${(displayTitle || title).trim()}%`)
            .limit(10)

          if (dbTrack && dbTrack.length > 0) {
            const foundTrack = dbTrack.find((t) => {
              if (!t.spotify_album_id || normalizeText(t.album) === cleanTitle) return false
              if (cleanArtist && t.artist) {
                const dbArtistNorm = normalizeText(t.artist)
                if (!dbArtistNorm.includes(cleanArtist) && !cleanArtist.includes(dbArtistNorm)) return false
              }
              return true
            })
            if (foundTrack && foundTrack.spotify_album_id) {
              const resData = { albumId: foundTrack.spotify_album_id, albumName: foundTrack.album || title }
              return cachedResolveResponse(resData, cacheKey)
            }
          }
        }

        const targetSearchName = cleanAlbum || cleanTitle
        if (targetSearchName) {
          const { data: dbAlbums } = await supabase
            .from('spotify_albums')
            .select('id, name, artist, cover_url')

          if (dbAlbums && dbAlbums.length > 0) {
            const match = dbAlbums.find((alb) => {
              const albName = normalizeText(alb.name)
              const albArtist = normalizeText(alb.artist)
              const nameMatch = albName === targetSearchName || albName.includes(targetSearchName) || targetSearchName.includes(albName)
              const artistMatch = !cleanArtist || albArtist.includes(cleanArtist) || cleanArtist.includes(albArtist)
              return nameMatch && artistMatch
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

    // Helper for artist matching
    const isArtistMatch = (candidateArtist?: string) => {
      if (!cleanArtist) return true
      if (!candidateArtist) return false
      const cNorm = normalizeText(candidateArtist)
      if (!cNorm) return false

      if (cNorm === cleanArtist || cNorm.includes(cleanArtist) || cleanArtist.includes(cNorm)) {
        return true
      }

      const cleanTokens = cleanArtist.split(' ').filter((t) => t.length > 2)
      const candidateTokens = cNorm.split(' ').filter((t) => t.length > 2)
      return cleanTokens.some((t) => candidateTokens.includes(t))
    }

    // 2. Priority Direct Deezer Album Search
    const directAlbumQuery = cleanAlbum
      ? `${primaryArtist} ${albumParam}`.trim()
      : `${primaryArtist} ${displayTitle || title}`.trim()

    if (directAlbumQuery) {
      try {
        const deezerResults = await searchDeezerAlbums(directAlbumQuery, 5)
        if (deezerResults && deezerResults.length > 0) {
          const best = deezerResults.find((a) => {
            const albName = normalizeText(a.name)
            const target = cleanAlbum || cleanTitle
            const nameOk = target ? albName.includes(target) || target.includes(albName) : true
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
    const searchQuery = `${primaryArtist} ${displayTitle || title}`.trim()
    if (searchQuery) {
      try {
        const dTrackRes = await fetch(
          `https://api.deezer.com/search?q=${encodeURIComponent(searchQuery)}&limit=5`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
        )
        if (dTrackRes.ok) {
          const dData = await dTrackRes.json()
          if (dData.data && dData.data.length > 0) {
            const bestTrack = dData.data.find((item: any) => isArtistMatch(item.artist?.name))

            if (bestTrack && bestTrack.album?.id) {
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
    if (cleanTitle) {
      try {
        const dTitleRes = await fetch(
          `https://api.deezer.com/search?q=${encodeURIComponent(displayTitle || title)}&limit=5`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
        )
        if (dTitleRes.ok) {
          const dTitleData = await dTitleRes.json()
          if (dTitleData.data && dTitleData.data.length > 0) {
            const bestTrack = dTitleData.data.find((item: any) => isArtistMatch(item.artist?.name))
            if (bestTrack && bestTrack.album?.id) {
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
      const iTunesSearchTerm = searchQuery || (displayTitle || title).trim()
      if (iTunesSearchTerm) {
        const iRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(iTunesSearchTerm)}&entity=song&limit=5`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
        )
        if (iRes.ok) {
          const iData = await iRes.json()
          if (iData.results && iData.results.length > 0) {
            const match = iData.results.find((t: any) => t.collectionId && t.collectionName && isArtistMatch(t.artistName))
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

