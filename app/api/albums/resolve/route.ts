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

    if (!title.trim() && !artist.trim()) {
      return NextResponse.json({ error: 'Missing title or artist' }, { status: 400 })
    }

    const cleanTitle = normalizeText(title)
    const cleanArtist = normalizeText(artist)
    const cacheKey = `${cleanTitle}_${cleanArtist}`

    const memCached = resolveMemoryCache.get(cacheKey)
    if (memCached && Date.now() - memCached.timestamp < RESOLVE_CACHE_TTL) {
      return NextResponse.json(memCached.data, {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=172800',
        },
      })
    }

    const supabase = getSupabaseClient()

    // 1. Check local Supabase DB cache first
    if (supabase && cleanTitle) {
      try {
        const { data: dbAlbums } = await supabase
          .from('spotify_albums')
          .select('id, name, artist')

        if (dbAlbums && dbAlbums.length > 0) {
          const match = dbAlbums.find((alb) => {
            const albName = normalizeText(alb.name)
            const albArtist = normalizeText(alb.artist)
            const nameMatch = albName === cleanTitle || albName.includes(cleanTitle) || cleanTitle.includes(albName)
            const artistMatch = !cleanArtist || albArtist.includes(cleanArtist) || cleanArtist.includes(albArtist)
            return nameMatch && artistMatch
          }) || dbAlbums.find((alb) => {
            const albName = normalizeText(alb.name)
            return albName === cleanTitle || albName.includes(cleanTitle) || cleanTitle.includes(albName)
          })

          if (match && match.id) {
            return NextResponse.json({ albumId: match.id, albumName: match.name })
          }
        }
      } catch (dbErr) {
        console.warn('DB album resolve error:', dbErr)
      }
    }

    // 2. Search primary global music database (Deezer)
    const query = `${artist.trim()} ${title.trim()}`.trim()
    const deezerResults = await searchDeezerAlbums(query, 5)

    if (deezerResults && deezerResults.length > 0) {
      const best = deezerResults.find((a) => {
        const albName = normalizeText(a.name)
        return cleanTitle ? albName.includes(cleanTitle) || cleanTitle.includes(albName) : true
      })

      if (best && best.id) {
        return NextResponse.json({ albumId: String(best.id), albumName: best.name })
      }
    }

    // 3. Search track API to get exact album container
    try {
      const dTrackRes = await fetch(
        `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3500) }
      )
      if (dTrackRes.ok) {
        const dData = await dTrackRes.json()
        if (dData.data && dData.data.length > 0 && dData.data[0].album?.id) {
          const item = dData.data[0]
          const albTitle = normalizeText(item.album.title)
          if (!cleanTitle || albTitle.includes(cleanTitle) || cleanTitle.includes(albTitle)) {
            return NextResponse.json({
              albumId: String(item.album.id),
              albumName: item.album.title || title,
            })
          }
        }
      }
    } catch (dTrackErr) {
      console.warn('Deezer track resolve warning:', dTrackErr)
    }

    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  } catch (err: any) {
    console.error('API album resolve error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
