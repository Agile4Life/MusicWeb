import { NextRequest, NextResponse } from 'next/server'
import { searchDeezerAlbums } from '@/lib/deezer'
import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

function cleanString(str?: string | null): string {
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const title = searchParams.get('title') || ''
    const artist = searchParams.get('artist') || ''

    if (!title.trim() && !artist.trim()) {
      return NextResponse.json({ error: 'Missing title or artist' }, { status: 400 })
    }

    const cleanTitle = cleanString(title)
    const cleanArtist = cleanString(artist)
    const supabase = getSupabaseClient()

    // 1. Check Supabase spotify_albums table for exact or fuzzy match FIRST
    if (supabase) {
      try {
        const { data: dbAlbums } = await supabase
          .from('spotify_albums')
          .select('id, name, artist')

        if (dbAlbums && dbAlbums.length > 0) {
          const match = dbAlbums.find((alb) => {
            const albName = cleanString(alb.name)
            const albArtist = cleanString(alb.artist)
            const nameMatch = albName === cleanTitle || albName.includes(cleanTitle) || cleanTitle.includes(albName)
            const artistMatch = !cleanArtist || albArtist.includes(cleanArtist) || cleanArtist.includes(albArtist)
            return nameMatch && artistMatch
          }) || dbAlbums.find((alb) => {
            const albName = cleanString(alb.name)
            return albName === cleanTitle || albName.includes(cleanTitle) || cleanTitle.includes(albName)
          })

          if (match && match.id) {
            return NextResponse.json({ albumId: match.id, albumName: match.name })
          }
        }

        // 2. Check Supabase tracks table for existing tracks with spotify_album_id
        if (cleanTitle) {
          const { data: dbTracks } = await supabase
            .from('tracks')
            .select('spotify_album_id, album')
            .or(`title.ilike.%${title.trim()}%,album.ilike.%${title.trim()}%`)
            .not('spotify_album_id', 'is', null)
            .limit(5)

          if (dbTracks && dbTracks.length > 0) {
            const validTrack = dbTracks.find((t) => Boolean(t.spotify_album_id))
            if (validTrack && validTrack.spotify_album_id) {
              return NextResponse.json({
                albumId: validTrack.spotify_album_id,
                albumName: validTrack.album || title,
              })
            }
          }
        }
      } catch (dbErr) {
        console.warn('DB album resolve error:', dbErr)
      }
    }

    // 3. Search Deezer API for matching album by Artist + Title
    const query = `${artist.trim()} ${title.trim()}`.trim()
    const deezerResults = await searchDeezerAlbums(query, 5)

    if (deezerResults && deezerResults.length > 0) {
      const best = deezerResults.find((a) =>
        cleanTitle ? cleanString(a.name).includes(cleanTitle) || cleanTitle.includes(cleanString(a.name)) : true
      ) || deezerResults[0]

      if (best && best.id) {
        return NextResponse.json({ albumId: best.id, albumName: best.name })
      }
    }

    // 4. Search Deezer tracks API to get track's album ID and title
    try {
      const dTrackRes = await fetch(
        `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3000) }
      )
      if (dTrackRes.ok) {
        const dData = await dTrackRes.json()
        if (dData.data && dData.data.length > 0 && dData.data[0].album?.id) {
          const item = dData.data[0]
          return NextResponse.json({
            albumId: String(item.album.id),
            albumName: item.album.title || item.title || title,
          })
        }
      }
    } catch (dTrackErr) {
      console.warn('Deezer track resolve warning:', dTrackErr)
    }

    // 5. Fallback search by title alone on Deezer
    if (title.trim()) {
      const titleResults = await searchDeezerAlbums(title.trim(), 3)
      if (titleResults && titleResults.length > 0) {
        return NextResponse.json({ albumId: titleResults[0].id, albumName: titleResults[0].name })
      }
    }

    // 6. iTunes search by album entity (uses collectionId, NOT trackId)
    try {
      const iTunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=1`,
        { signal: AbortSignal.timeout(3000) }
      )
      if (iTunesRes.ok) {
        const iData = await iTunesRes.json()
        if (iData.results && iData.results.length > 0 && iData.results[0].collectionId) {
          const item = iData.results[0]
          return NextResponse.json({
            albumId: `itunes-${item.collectionId}`,
            albumName: item.collectionName || title,
          })
        }
      }
    } catch (iErr) {
      console.warn('iTunes album resolve fallback error:', iErr)
    }

    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  } catch (err: any) {
    console.error('API album resolve error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}



