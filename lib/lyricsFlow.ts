import { normalizeNhacCuaTuiLyrics } from './nhaccuatui'
import { resolveNhacCuaTuiSong } from './nhaccuatuiClient'
import { fetchLyricsFromLrclib } from './lrclib'
import type { LrclibResponse } from './lrclib'
import type { Track } from '@/types'

type LyricsTrack = Pick<Track, 'title'> &
  Partial<Pick<Track, 'id' | 'artist' | 'album' | 'duration' | 'youtube_id' | 'nhaccuatui_id' | 'source'>>

function hasLrcTimestamps(lyrics: string): boolean {
  return /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m.test(lyrics)
}

function nctLyricsToResponse(track: LyricsTrack, lyrics: string): LrclibResponse {
  const synced = hasLrcTimestamps(lyrics)
  return {
    id: Number(`9${(track.nhaccuatui_id || track.id || '').replace(/\D/g, '').slice(0, 8)}`) || 999999,
    trackName: track.title,
    artistName: track.artist || 'Nghệ sĩ chưa xác định',
    albumName: track.album || undefined,
    duration: track.duration || 0,
    instrumental: false,
    plainLyrics: synced ? null : lyrics,
    syncedLyrics: synced ? lyrics : null,
  }
}

async function fetchNctLyrics(track: LyricsTrack): Promise<LrclibResponse | null> {
  if (!track.nhaccuatui_id) return null
  try {
    const nctSong = await resolveNhacCuaTuiSong(track.nhaccuatui_id)
    const lyric = normalizeNhacCuaTuiLyrics(nctSong?.lyric)
    if (lyric) {
      return nctLyricsToResponse(track, lyric)
    }
  } catch {
    // Continue silently
  }
  return null
}

export function isSoundCloudUgcOrRemix(title: string, artist?: string | null): boolean {
  const t = (title || '').toLowerCase()
  const a = (artist || '').toLowerCase()

  // 1. Keywords indicating remix, cover, beat, dj set, edit, user recording
  const UGC_KEYWORDS = [
    'remix',
    'mashup',
    'cover',
    'bootleg',
    'nonstop',
    'vinahouse',
    'vinahey',
    'vina house',
    'edit',
    'slowed',
    'sped up',
    'speed up',
    'reverb',
    'nightcore',
    'flip',
    'type beat',
    'freestyle',
    'demo',
    'instrumental',
    'beat',
    'karaoke',
    'backing track',
    'mixset',
    'set mix',
    'dj set',
    'live mix',
    'club mix',
    'extended mix',
    'podcast',
    'acoustic cover',
    'guitar cover',
    'piano cover',
    'lofi chill',
    'chill beat',
    'nhạc không lời',
    'nhac khong loi',
    'prod by',
    'prod.',
    'hát rong',
    'street live',
  ]

  if (UGC_KEYWORDS.some((kw) => t.includes(kw))) {
    return true
  }

  // 2. Individual uploader patterns (DJ, user-..., numbers, remixer, etc.)
  if (
    a.startsWith('dj ') ||
    a.startsWith('user-') ||
    a.includes('mix') ||
    a.includes('remix') ||
    a.includes('producer') ||
    a.includes('records')
  ) {
    return true
  }

  return false
}

const primaryLyricsCache = new Map<string, LrclibResponse | null>()
const primaryLyricsInFlight = new Map<string, Promise<LrclibResponse | null>>()

export function getTrackLyricsCacheKey(track: LyricsTrack): string {
  const t = (track.title || '').trim().toLowerCase()
  const a = (track.artist || '').trim().toLowerCase()
  const s = track.source || 'std'
  const id = track.nhaccuatui_id || track.youtube_id || track.id || ''
  return `${s}__${id}__${t}__${a}`
}

export function clearPrimaryLyricsCache(): void {
  primaryLyricsCache.clear()
  primaryLyricsInFlight.clear()
}

export async function getPrimaryLyrics(
  track: LyricsTrack,
): Promise<LrclibResponse | null> {
  const cacheKey = getTrackLyricsCacheKey(track)
  if (primaryLyricsCache.has(cacheKey)) {
    return primaryLyricsCache.get(cacheKey)!
  }
  if (primaryLyricsInFlight.has(cacheKey)) {
    return primaryLyricsInFlight.get(cacheKey)!
  }

  // If track is from SoundCloud and is a remix / UGC user upload, do NOT fetch lyrics from other songs
  if (track.source === 'soundcloud') {
    if (isSoundCloudUgcOrRemix(track.title, track.artist)) {
      primaryLyricsCache.set(cacheKey, null)
      return null
    }
  }

  const fetchPromise = (async (): Promise<LrclibResponse | null> => {
    try {
      // Run both NCT and LRCLIB queries concurrently in parallel to eliminate sequential latency
      const [nctResult, lrclibResult] = await Promise.all([
        fetchNctLyrics(track),
        fetchLyricsFromLrclib({
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          youtubeId: track.youtube_id,
          isSoundCloud: track.source === 'soundcloud',
        }).catch(() => null),
      ])

      let finalResult: LrclibResponse | null = null
      // 1. Ưu tiên lyrics synced từ NCT nếu có
      if (nctResult?.syncedLyrics) {
        finalResult = nctResult
      } else if (lrclibResult?.syncedLyrics) {
        // 2. Nếu NCT không có sync, ưu tiên lyrics synced từ LRCLIB
        finalResult = lrclibResult
      } else {
        // 3. Nếu không bên nào có sync, fallback về text (plain lyrics)
        finalResult = nctResult || lrclibResult || null
      }

      primaryLyricsCache.set(cacheKey, finalResult)
      return finalResult
    } catch {
      primaryLyricsCache.set(cacheKey, null)
      return null
    } finally {
      primaryLyricsInFlight.delete(cacheKey)
    }
  })()

  primaryLyricsInFlight.set(cacheKey, fetchPromise)
  return fetchPromise
}


