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
    const q = (searchParams.get('q') || '').trim()

    if (!q) {
      return NextResponse.json([])
    }

    const localDbAlbums: any[] = []
    const supabase = getSupabaseClient()

    if (supabase) {
      try {
        const { data: dbMatches } = await supabase
          .from('spotify_albums')
          .select('*')
          .or(`name.ilike.%${q}%,artist.ilike.%${q}%`)
          .limit(18)

        if (dbMatches && dbMatches.length > 0) {
          localDbAlbums.push(...dbMatches)
        }
      } catch (dbErr) {
        console.warn('DB album search error:', dbErr)
      }
    }

    const onlineAlbums = await searchDeezerAlbums(q, 36)

    const combined: any[] = [...localDbAlbums]
    const seenKeys = new Set(
      localDbAlbums.map((a) => `${(a.name || '').toLowerCase()}::${(a.artist || '').toLowerCase()}`)
    )

    for (const alb of onlineAlbums) {
      const key = `${(alb.name || '').toLowerCase()}::${(alb.artist || '').toLowerCase()}`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        combined.push(alb)
      }
    }

    return NextResponse.json(combined, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })
  } catch (err: any) {
    console.error('API Album search error:', err)
    return NextResponse.json([])
  }
}

