import { NextRequest, NextResponse } from 'next/server'
import { searchDeezerAlbums } from '@/lib/deezer'
import { searchITunesAlbums } from '@/lib/itunes'
import { createClient } from '@supabase/supabase-js'
import { isKnownBadFallback, isRealAlbumName } from '@/lib/albumCache'
import {
  cleanDisplayAlbumName,
  normalizeAlbumText,
  stripAlbumEditionSuffix,
} from '@/lib/albumMatching'

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

function buildAlbumDedupKey(name?: string | null, artist?: string | null): string {
  const normName = stripAlbumEditionSuffix(name) || normalizeAlbumText(name)
  const normArtist = normalizeAlbumText(artist)
  return `${normName}::${normArtist}`
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') || '').trim()

    if (!q) {
      return NextResponse.json([])
    }

    const supabase = getSupabaseClient()

    const [dbRes, deezerRes, itunesRes] = await Promise.allSettled([
      supabase
        ? supabase
            .from('spotify_albums')
            .select('*')
            .or(`name.ilike.%${q}%,artist.ilike.%${q}%`)
            .limit(18)
        : Promise.resolve({ data: [] }),
      searchDeezerAlbums(q, 30),
      searchITunesAlbums(q, 20),
    ])

    const localDbAlbums: any[] =
      dbRes.status === 'fulfilled' && Array.isArray(dbRes.value?.data)
        ? dbRes.value.data.filter(
            (a: any) =>
              a &&
              a.id &&
              !isKnownBadFallback(String(a.id)) &&
              isRealAlbumName(a.name),
          )
        : []

    const deezerAlbums = deezerRes.status === 'fulfilled' ? deezerRes.value : []
    const itunesAlbums = itunesRes.status === 'fulfilled' ? itunesRes.value : []

    const combinedMap = new Map<string, any>()

    const addCandidate = (alb: any) => {
      if (!alb || !alb.id || !alb.name || isKnownBadFallback(String(alb.id)) || !isRealAlbumName(alb.name)) {
        return
      }
      const cleanedName = cleanDisplayAlbumName(alb.name) || alb.name
      const normalizedItem = {
        ...alb,
        name: cleanedName,
      }
      const key = buildAlbumDedupKey(cleanedName, alb.artist)
      if (!key || key === '::') return

      const existing = combinedMap.get(key)
      if (!existing) {
        combinedMap.set(key, normalizedItem)
        return
      }

      // If existing entry is an incomplete DB stub (0 total_tracks or missing cover_url), upgrade it with rich online metadata
      const existingTracks = Number(existing.total_tracks || 0)
      const candidateTracks = Number(normalizedItem.total_tracks || 0)
      if (
        (existingTracks <= 0 && candidateTracks > 0) ||
        (!existing.cover_url && normalizedItem.cover_url)
      ) {
        combinedMap.set(key, {
          ...existing,
          ...normalizedItem,
          id: existingTracks > 0 ? existing.id : normalizedItem.id,
          cover_url: normalizedItem.cover_url || existing.cover_url,
          release_date: normalizedItem.release_date || existing.release_date,
          total_tracks: candidateTracks || existingTracks,
        })
      }
    }

    for (const alb of localDbAlbums) addCandidate(alb)
    for (const alb of deezerAlbums) addCandidate(alb)
    for (const alb of itunesAlbums) addCandidate(alb)

    const combined = Array.from(combinedMap.values())

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
