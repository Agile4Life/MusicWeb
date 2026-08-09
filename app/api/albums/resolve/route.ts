import { NextRequest, NextResponse } from 'next/server'
import { searchDeezerAlbums } from '@/lib/deezer'
import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
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
    const albumParam = searchParams.get('album') || ''
    const trackId = searchParams.get('track_id') || searchParams.get('id') || ''

    if (!title.trim() && !artist.trim() && !albumParam.trim()) {
      return NextResponse.json({ error: 'Missing title, artist, or album' }, { status: 400 })
    }

    const cleanTitle = normalizeText(title)
    const cleanArtist = normalizeText(artist)
    const cleanAlbum = normalizeText(albumParam)
    const cacheKey = `${cleanTitle}_${cleanArtist}_${cleanAlbum}`

    const memCached = resolveMemoryCache.get(cacheKey)
    if (memCached && Date.now() - memCached.timestamp < RESOLVE_CACHE_TTL) {
      return cachedResolveResponse(memCached.data, cacheKey)
    }

    const supabase = getSupabaseClient()

    // Helper to persist resolved album back to tracks DB table if trackId provided
    const persistToDb = (albumId: string, albumName: string) => {
      if (!supabase) return
      ;(async () => {
        try {
          if (trackId && !trackId.startsWith('yt-') && !trackId.startsWith('spotify-') && !trackId.startsWith('itunes-')) {
            await supabase
              .from('tracks')
              .update({ spotify_album_id: albumId, album: albumName })
              .eq('id', trackId)
          } else if (cleanTitle) {
            await supabase
              .from('tracks')
              .update({ spotify_album_id: albumId, album: albumName })
              .ilike('title', `%${title.trim()}%`)
              .is('spotify_album_id', null)
          }
        } catch (e) {
          console.warn('Persist resolved album DB warning:', e)
        }
      })().catch(() => {})
    }

    // 1. Check local Supabase DB cache first
    if (supabase) {
      try {
        if (cleanTitle) {
          const { data: dbTrack } = await supabase
            .from('tracks')
            .select('spotify_album_id, album')
            .not('spotify_album_id', 'is', null)
            .ilike('title', `%${title.trim()}%`)
            .limit(5)

          if (dbTrack && dbTrack.length > 0) {
            const foundTrack = dbTrack.find((t) => t.spotify_album_id)
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
            }) || dbAlbums.find((alb) => {
              const albName = normalizeText(alb.name)
              return albName === targetSearchName || albName.includes(targetSearchName) || targetSearchName.includes(albName)
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

    // 2. Primary track-to-album resolution via Deezer search API (artist + title)
    const searchQuery = `${artist.trim()} ${title.trim()}`.trim()
    if (searchQuery) {
      try {
        const dTrackRes = await fetch(
          `https://api.deezer.com/search?q=${encodeURIComponent(searchQuery)}&limit=5`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
        )
        if (dTrackRes.ok) {
          const dData = await dTrackRes.json()
          if (dData.data && dData.data.length > 0) {
            const bestTrack = dData.data.find((item: any) => {
              if (!cleanArtist || !item.artist?.name) return true
              const dArtist = normalizeText(item.artist.name)
              return dArtist.includes(cleanArtist) || cleanArtist.includes(dArtist)
            }) || dData.data[0]

            if (bestTrack && bestTrack.album?.id) {
              const resData = {
                albumId: String(bestTrack.album.id),
                albumName: bestTrack.album.title || albumParam || title,
                coverUrl: bestTrack.album.cover_medium || bestTrack.album.cover || null,
              }
              persistToDb(resData.albumId, resData.albumName)
              return cachedResolveResponse(resData, cacheKey)
            }
          }
        }
      } catch (dTrackErr) {
        console.warn('Deezer track resolve warning:', dTrackErr)
      }
    }

    // 3. Title-Only Deezer Track Search (for cases where artist is local/remix/channel like "Grando")
    if (cleanTitle) {
      try {
        const dTitleRes = await fetch(
          `https://api.deezer.com/search?q=${encodeURIComponent(title.trim())}&limit=5`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
        )
        if (dTitleRes.ok) {
          const dTitleData = await dTitleRes.json()
          if (dTitleData.data && dTitleData.data.length > 0) {
            const bestTrack = dTitleData.data[0]
            if (bestTrack && bestTrack.album?.id) {
              const resData = {
                albumId: String(bestTrack.album.id),
                albumName: bestTrack.album.title || albumParam || title,
                coverUrl: bestTrack.album.cover_medium || bestTrack.album.cover || null,
              }
              persistToDb(resData.albumId, resData.albumName)
              return cachedResolveResponse(resData, cacheKey)
            }
          }
        }
      } catch (dTitleErr) {
        console.warn('Deezer title search resolve warning:', dTitleErr)
      }
    }

    // 4. iTunes Track / Collection Search Fallback
    try {
      const iTunesSearchTerm = searchQuery || title.trim()
      if (iTunesSearchTerm) {
        const iRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(iTunesSearchTerm)}&entity=song&limit=5`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
        )
        if (iRes.ok) {
          const iData = await iRes.json()
          if (iData.results && iData.results.length > 0) {
            const match = iData.results.find((t: any) => t.collectionId && t.collectionName) || iData.results[0]
            if (match && match.collectionId) {
              const resData = {
                albumId: `itunes-${match.collectionId}`,
                albumName: match.collectionName || albumParam || title,
                coverUrl: match.artworkUrl100 || null,
              }
              persistToDb(resData.albumId, resData.albumName)
              return cachedResolveResponse(resData, cacheKey)
            }
          }
        }
      }
    } catch (iErr) {
      console.warn('iTunes resolve fallback warning:', iErr)
    }

    // 5. Deezer Album Direct Search Fallback
    const albumQuery = cleanAlbum ? `${artist.trim()} ${albumParam.trim()}`.trim() : searchQuery
    if (albumQuery) {
      const deezerResults = await searchDeezerAlbums(albumQuery, 5)
      if (deezerResults && deezerResults.length > 0) {
        const best = deezerResults.find((a) => {
          const albName = normalizeText(a.name)
          const target = cleanAlbum || cleanTitle
          return target ? albName.includes(target) || target.includes(albName) : true
        }) || deezerResults[0]

        if (best && best.id) {
          const resData = {
            albumId: String(best.id),
            albumName: best.name,
            coverUrl: (best as any).cover_url || (best as any).cover || null,
          }
          persistToDb(resData.albumId, resData.albumName)
          return cachedResolveResponse(resData, cacheKey)
        }
      }
    }

    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  } catch (err: any) {
    console.error('API album resolve error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
