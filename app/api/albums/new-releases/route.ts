import { NextResponse } from 'next/server'
import { fetchDeezerNewReleases } from '@/lib/deezer'
import { fetchSpotifyNewReleases } from '@/lib/spotify'
import { getTrendingITunesAlbums } from '@/lib/itunes'
import {
  cleanDisplayAlbumName,
  normalizeAlbumText,
  stripAlbumEditionSuffix,
} from '@/lib/albumMatching'

export const dynamic = 'force-dynamic'

interface TrendingAlbum {
  id: string
  name: string
  artist: string
  cover_url: string | null
  release_date: string
  total_tracks: number
  album_type: string
}

const MAX_ALBUMS = 60

function normalizeAlbumKey(name: string, artist: string): string {
  const cleanName = stripAlbumEditionSuffix(name) || normalizeAlbumText(name)
  const cleanArtist = normalizeAlbumText(artist)
  return `${cleanName}::${cleanArtist}`
}

export async function GET() {
  try {
    const [deezerRes, spotifyRes, itunesRes] = await Promise.allSettled([
      fetchDeezerNewReleases(MAX_ALBUMS),
      fetchSpotifyNewReleases('US', 40),
      getTrendingITunesAlbums('us', 40),
    ])

    const deezer = deezerRes.status === 'fulfilled' ? deezerRes.value : []
    const spotify = spotifyRes.status === 'fulfilled' ? spotifyRes.value : []
    const itunes = itunesRes.status === 'fulfilled' ? itunesRes.value : []

    const sources: TrendingAlbum[][] = [deezer, spotify, itunes]
    const seenKeys = new Set<string>()
    const merged: TrendingAlbum[] = []
    const maxLen = Math.max(deezer.length, spotify.length, itunes.length)

    // Round-robin interleave across platforms so no single source floods the feed
    for (let i = 0; i < maxLen && merged.length < MAX_ALBUMS; i++) {
      for (const list of sources) {
        const item = list[i]
        if (!item || !item.name) continue
        const key = normalizeAlbumKey(item.name, item.artist)
        if (!key || key === '::' || seenKeys.has(key)) continue
        seenKeys.add(key)
        merged.push({
          ...item,
          name: cleanDisplayAlbumName(item.name) || item.name,
        })
        if (merged.length >= MAX_ALBUMS) break
      }
    }

    return NextResponse.json(merged, {
      headers: {
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
      },
    })
  } catch {
    console.error('API new-releases error')
    return NextResponse.json([])
  }
}
