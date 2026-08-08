import { NextRequest, NextResponse } from 'next/server'
import { searchDeezerAlbums } from '@/lib/deezer'
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

    if (!title.trim()) {
      return NextResponse.json({ error: 'Missing album title' }, { status: 400 })
    }

    const supabase = getSupabaseClient()

    // 1. Check Supabase DB for matching album title/artist first
    if (supabase) {
      try {
        const { data: dbAlbum } = await supabase
          .from('spotify_albums')
          .select('id')
          .ilike('name', `%${title.trim()}%`)
          .limit(1)
          .maybeSingle()

        if (dbAlbum && dbAlbum.id) {
          return NextResponse.json({ albumId: dbAlbum.id })
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
        a.name.toLowerCase().includes(cleanTitle)
      ) || deezerResults[0]

      if (best && best.id) {
        return NextResponse.json({ albumId: best.id })
      }
    }

    // 3. Fallback search by title alone
    const titleResults = await searchDeezerAlbums(title.trim(), 3)
    if (titleResults && titleResults.length > 0) {
      return NextResponse.json({ albumId: titleResults[0].id })
    }

    return NextResponse.json({ error: 'Album not found' }, { status: 404 })
  } catch (err: any) {
    console.error('API album resolve error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
