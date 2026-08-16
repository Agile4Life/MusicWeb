import { NextRequest } from 'next/server'
import { searchSpotifyArtistExact, getSpotifyArtistTopTracks } from '@/lib/spotify'
import { searchDeezerArtist, extractDeezerArtistName } from '@/lib/deezer'
import { getPrimaryArtistName } from '@/lib/artistParser'
import { fetchArtistAudienceCount } from '@/lib/artistAudience'
import { searchYouTubeTracks } from '@/lib/youtube'
import { searchNhacCuaTuiDirect } from '@/lib/nhaccuatui'
import { Track } from '@/types'

function normalizeTitleForDedup(title: string): string {
  if (!title) return ''
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\(\[\{].*?[\)\]\}]/g, '')
    .replace(/official|audio|mv|video|lyrics|nhạc|bản chuẩn|full/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/**
 * GET /api/artist?name=<artist_name>
 * Uses NhacCuaTui (NCT) as PRIMARY source for Lossless Vietnamese audio & tracks.
 * Uses Spotify for Artist Thumbnail & Official Name + Top Tracks catalog.
 * Uses real-world audience counts for accurate Fan metrics.
 * Uses Deezer & YouTube as robust fallback sources for full coverage.
 */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name')

  if (!name || !name.trim()) {
    return Response.json({ error: 'Missing artist name' }, { status: 400 })
  }

  const queryName = name.trim()

  try {
    // 1. Search Spotify for exact artist name + high-res thumbnail (640x640)
    let spotifyArtist = await searchSpotifyArtistExact(queryName)
    if (!spotifyArtist) {
      const primary = getPrimaryArtistName(queryName)
      if (primary && primary.toLowerCase() !== queryName.toLowerCase()) {
        spotifyArtist = await searchSpotifyArtistExact(primary)
      }
    }

    // 2. Search Deezer for fallback thumbnail/name
    let deezerArtist = await searchDeezerArtist(queryName)
    if (!deezerArtist) {
      const primary = getPrimaryArtistName(queryName)
      if (primary && primary.toLowerCase() !== queryName.toLowerCase()) {
        deezerArtist = await searchDeezerArtist(primary)
      }
    }

    // Combine artist metadata
    const artist = {
      id: spotifyArtist?.id || deezerArtist?.id || `nct-${encodeURIComponent(queryName)}`,
      name: spotifyArtist?.name || deezerArtist?.name || queryName,
      picture_xl: spotifyArtist?.picture_xl || null,
      picture_big: spotifyArtist?.picture_big || spotifyArtist?.picture_xl || null,
      nb_fan: 0,
      source: spotifyArtist ? 'spotify' : deezerArtist ? 'deezer' : 'nhaccuatui',
    }

    // 3. Parallel fetch: NCT (Priority 1), Audience count, Spotify top tracks, Deezer top tracks & detail
    const [realAudience, nctTracks, spotifyTracks, artistRes, deezerTopRes] = await Promise.all([
      fetchArtistAudienceCount(artist.name).catch(() => null),
      searchNhacCuaTuiDirect(artist.name, 30).catch(() => []),
      spotifyArtist?.id
        ? getSpotifyArtistTopTracks(spotifyArtist.id, artist.name, 20).catch(() => [])
        : Promise.resolve([]),
      deezerArtist?.id
        ? fetch(`https://api.deezer.com/artist/${deezerArtist.id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(4500),
          }).catch(() => null)
        : null,
      deezerArtist?.id
        ? fetch(`https://api.deezer.com/artist/${deezerArtist.id}/top?limit=20`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(4500),
          }).catch(() => null)
        : null,
    ])

    if (realAudience && realAudience > 0) {
      artist.nb_fan = realAudience
    } else if (deezerArtist?.nb_fan) {
      artist.nb_fan = deezerArtist.nb_fan
    }

    if (artistRes && artistRes.ok) {
      const artistData = await artistRes.json()
      if (!artist.nb_fan && artistData.nb_fan) {
        artist.nb_fan = artistData.nb_fan
      }
      // Fallback pictures from Deezer if Spotify had no picture
      if (!artist.picture_xl) {
        artist.picture_xl = artistData.picture_xl || artistData.picture_big || artistData.picture_medium || null
        artist.picture_big = artistData.picture_big || artistData.picture_medium || null
      }
    }

    let rawDeezerTracks: Track[] = []
    if (deezerTopRes && deezerTopRes.ok) {
      const topData = await deezerTopRes.json()
      const items = topData.data || []

      rawDeezerTracks = items
        .filter((item: any) => item && item.id && (item.title || item.title_short))
        .map((item: any) => ({
          id: `deezer-${item.id}`,
          user_id: '00000000-0000-4000-a000-000000000001',
          title: item.title || item.title_short || 'Untitled Track',
          artist: extractDeezerArtistName(item, artist.name),
          album: item.album?.title || undefined,
          duration: Math.round(item.duration || 0),
          file_path: item.preview || item.link || `deezer:${item.id}`,
          audio_url: item.preview || undefined,
          cover_url:
            item.album?.cover_xl ||
            item.album?.cover_big ||
            item.album?.cover_medium ||
            item.album?.cover ||
            null,
          created_at: new Date().toISOString(),
          source: 'spotify' as const,
          spotify_id: String(item.id),
        }))
    }

    // 4. Combine tracks with NhacCuaTui (NCT) as PRIORITY #1, followed by Spotify & Deezer
    const combinedTracks: Track[] = [...nctTracks, ...spotifyTracks, ...rawDeezerTracks]
    const seenTitles = new Set<string>()
    let topTracks: Track[] = []

    for (const tr of combinedTracks) {
      const key = normalizeTitleForDedup(tr.title)
      if (!key || seenTitles.has(key)) continue
      seenTitles.add(key)
      topTracks.push(tr)
    }

    // 5. Fallback: If still no tracks found (e.g. niche/indie artists), search YouTube
    if (topTracks.length === 0) {
      try {
        const ytTracks = await searchYouTubeTracks(`${artist.name} official audio`, 15)
        if (ytTracks && ytTracks.length > 0) {
          for (const yt of ytTracks) {
            const key = normalizeTitleForDedup(yt.title)
            if (!key || seenTitles.has(key)) continue
            seenTitles.add(key)
            topTracks.push(yt)
          }
          if (!artist.picture_xl && ytTracks[0]?.cover_url) {
            artist.picture_xl = ytTracks[0].cover_url
            artist.picture_big = ytTracks[0].cover_url
          }
        }
      } catch (ytErr) {
        console.warn('YouTube artist tracks fallback error:', ytErr)
      }
    }

    // Fallback picture from first track thumbnail if still missing
    if (!artist.picture_xl && topTracks[0]?.cover_url) {
      artist.picture_xl = topTracks[0].cover_url
      artist.picture_big = topTracks[0].cover_url
    }

    return Response.json({
      artist,
      topTracks: topTracks.slice(0, 30),
    })
  } catch (err) {
    console.error('Artist API error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

