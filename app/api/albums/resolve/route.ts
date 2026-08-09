import { NextRequest, NextResponse } from 'next/server'
import { searchDeezerAlbums } from '@/lib/deezer'
import { searchITunesTracks } from '@/lib/itunes'
import { createClient } from '@supabase/supabase-js'

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const title = searchParams.get('title') || ''
    const artist = searchParams.get('artist') || ''

    if (!title.trim() && !artist.trim()) {
      return NextResponse.json({ error: 'Missing title or artist' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // 1. Check Supabase DB for matching album title/artist first
    if (supabase && title.trim()) {
      try {
        const { data: dbAlbum } = await supabase
          .from('spotify_albums')
          .select('id, name')
          .ilike('name', `%${title.trim()}%`)
          .limit(1)
          .maybeSingle()

        if (dbAlbum && dbAlbum.id) {
          return NextResponse.json({ albumId: dbAlbum.id, albumName: dbAlbum.name })
        }
      } catch (dbErr) {
        console.warn('DB album resolve error:', dbErr)
      }
    }

    // 2. Search Deezer API for matching album by Artist + Title
    const query = `${artist.trim()} ${title.trim()}`.trim()
    const deezerResults = await searchDeezerAlbums(query, 5)

    if (deezerResults && deezerResults.length > 0) {
      const cleanTitle = title.trim().toLowerCase()
      const best = deezerResults.find((a) =>
        cleanTitle ? a.name.toLowerCase().includes(cleanTitle) : true
      ) || deezerResults[0]

      if (best && best.id) {
        return NextResponse.json({ albumId: best.id, albumName: best.name })
      }
    }

    // 3. Search Deezer tracks API to get track's album ID and title
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

    // 4. Fallback search by title alone on Deezer
    if (title.trim()) {
      const titleResults = await searchDeezerAlbums(title.trim(), 3)
      if (titleResults && titleResults.length > 0) {
        return NextResponse.json({ albumId: titleResults[0].id, albumName: titleResults[0].name })
      }
    }

    // 5. iTunes fallback search for song/album
    try {
      const iTunesTracks = await searchITunesTracks(query, 1)
      if (iTunesTracks.length > 0 && iTunesTracks[0].itunes_id) {
        const item = iTunesTracks[0]
        return NextResponse.json({
          albumId: `itunes-${item.itunes_id}`,
          albumName: item.album && !['iTunes Global', 'Apple Music Top Hits'].includes(item.album.trim()) ? item.album : item.title,
        })
      }
    } catch (iErr) {
      console.warn('iTunes resolve fallback error:', iErr)
    }

    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  } catch (err: any) {
    console.error('API album resolve error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}



