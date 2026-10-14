import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSongResponse } from '@/lib/nhaccuatui'
import { getNhacCuaTuiStreamUrl } from '@/lib/nhaccuatuiClient'
import { getNctAudioCache, getNctInFlight, setNctAudioCache } from '@/lib/nctCacheStore'
import { fetchWithRetry, isNetworkError, isTransientError } from '@/lib/fetchWithRetry'

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctSongUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
}

function buildPublicSongPayload(
  id: string,
  entry: {
    title: string
    artist: string
    coverUrl?: string | null
    duration?: number | null
    lyric?: string | null
  },
) {
  return {
    song: {
      id,
      title: entry.title,
      artist: entry.artist,
      coverUrl: entry.coverUrl ?? null,
      duration: entry.duration ?? null,
      lyric: entry.lyric ?? null,
      streamUrl:
        getNhacCuaTuiStreamUrl(id) || `/api/nhaccuatui/stream?id=${encodeURIComponent(id)}`,
    },
  }
}

const nctSongCache = new Map<string, { data: any; expiresAt: number }>()
const inFlightNctSong = new Map<string, Promise<any>>()
const NCT_SONG_CACHE_TTL = 10 * 60 * 1000
const NCT_SONG_MAX_CACHE = 1000

function evictNctSongIfFull(): void {
  if (nctSongCache.size >= NCT_SONG_MAX_CACHE) {
    const oldest = nctSongCache.keys().next().value
    if (oldest !== undefined) nctSongCache.delete(oldest)
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const trimmedId = (id || '').trim()
  if (!trimmedId) return NextResponse.json({ error: 'Missing song id' }, { status: 400 })

  const sharedCached = getNctAudioCache(trimmedId)
  if (sharedCached?.title && sharedCached?.artist) {
    const data = buildPublicSongPayload(trimmedId, {
      title: sharedCached.title,
      artist: sharedCached.artist,
      coverUrl: sharedCached.coverUrl,
      duration: sharedCached.duration,
      lyric: sharedCached.lyric,
    })
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120' },
    })
  }

  const cached = nctSongCache.get(trimmedId)
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120' },
    })
  }

  const sharedInFlight = getNctInFlight(trimmedId)
  if (sharedInFlight) {
    const sharedSong = await sharedInFlight
    if (sharedSong?.title && sharedSong?.artist) {
      const data = buildPublicSongPayload(trimmedId, {
        title: sharedSong.title,
        artist: sharedSong.artist,
        coverUrl: sharedSong.coverUrl,
        duration: sharedSong.duration,
        lyric: sharedSong.lyric,
      })
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120' },
      })
    }
  }

  const existingInFlight = inFlightNctSong.get(trimmedId)
  if (existingInFlight) {
    const data = await existingInFlight
    if (!data) return NextResponse.json({ error: 'Song not found' }, { status: 404 })
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120' },
    })
  }

  const fetchPromise = (async () => {
    try {
      const upstream = await fetchWithRetry(
        () =>
          fetch(getNctSongUrl(trimmedId), {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          }),
        {
          retries: 2,
          baseDelayMs: 200,
          maxDelayMs: 800,
          retryOn: (outcome) =>
            outcome instanceof Response ? isTransientError(outcome) : isNetworkError(outcome),
        }
      )
      if (!upstream.ok) return null

      const payload: unknown = await upstream.json()
      const song = normalizeNhacCuaTuiSongResponse(payload)
      if (!song) return null

      if (song.audioUrl) {
        setNctAudioCache(trimmedId, {
          audioUrl: song.audioUrl,
          title: song.title,
          artist: song.artist,
          duration: song.duration ?? null,
          coverUrl: song.coverUrl || null,
          lyric: song.lyric ?? null,
        })
      }

      const result = buildPublicSongPayload(song.id, song)

      evictNctSongIfFull()
      nctSongCache.set(trimmedId, { data: result, expiresAt: Date.now() + NCT_SONG_CACHE_TTL })
      return result
    } catch {
      return null
    }
  })()

  inFlightNctSong.set(trimmedId, fetchPromise)

  let finalData = null
  try {
    finalData = await fetchPromise
  } finally {
    inFlightNctSong.delete(trimmedId)
  }

  if (!finalData) {
    return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
  }

  return NextResponse.json(finalData, {
    headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120' },
  })
}
