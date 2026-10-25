import { normalizeNhacCuaTuiLyrics } from './nhaccuatui'
import { resolveNhacCuaTuiSong } from './nhaccuatuiClient'
import { fetchLyricsFromLrclib } from './lrclib'
import { customLyricsToLrclibResponse, hasLrcTimestamps } from './customLyrics'
import type { LrclibResponse } from './lrclib'
import type { Track } from '@/types'

export const LYRICS_UPDATED_EVENT = 'musicweb:lyrics-updated'

export type LyricsTrack = Pick<Track, 'title'> &
  Partial<
    Pick<
      Track,
      | 'id'
      | 'artist'
      | 'album'
      | 'duration'
      | 'youtube_id'
      | 'nhaccuatui_id'
      | 'soundcloud_id'
      | 'spotify_id'
      | 'file_path'
      | 'lyrics'
      | 'source'
    >
  >

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

const MAX_PRIMARY_LYRICS_ENTRIES = 200
const primaryLyricsCache = new Map<string, LrclibResponse>()
const primaryLyricsInFlight = new Map<string, Promise<LrclibResponse | null>>()

export function getTrackLyricsCacheKey(track: LyricsTrack): string {
  const t = (track.title || '').trim().toLowerCase()
  const a = (track.artist || '').trim().toLowerCase()
  return JSON.stringify([
    track.source || 'std', track.id || '', t, a,
    (track.album || '').trim().toLowerCase(), track.duration || 0,
    track.nhaccuatui_id || '', track.youtube_id || '',
  ])
}

export function clearPrimaryLyricsCache(): void {
  primaryLyricsCache.clear()
  primaryLyricsInFlight.clear()
}

export function setCustomLyricsInPrimaryCache(
  track: LyricsTrack,
  data: LrclibResponse | null,
): void {
  const cacheKey = getTrackLyricsCacheKey(track)
  primaryLyricsInFlight.delete(cacheKey)
  if (data && (data.syncedLyrics?.trim() || data.plainLyrics?.trim())) {
    primaryLyricsCache.set(cacheKey, data)
    while (primaryLyricsCache.size > MAX_PRIMARY_LYRICS_ENTRIES) {
      primaryLyricsCache.delete(primaryLyricsCache.keys().next().value!)
    }
  } else {
    primaryLyricsCache.delete(cacheKey)
  }
}

async function fetchCustomLyricsFromApi(track: LyricsTrack): Promise<LrclibResponse | null> {
  try {
    const params = new URLSearchParams()
    if (track.id) params.set('id', String(track.id))
    if (track.source) params.set('source', String(track.source))
    if (track.title) params.set('title', track.title)
    if (track.artist) params.set('artist', track.artist)
    if (track.album) params.set('album', track.album)
    if (track.duration) params.set('duration', String(track.duration))
    if (track.youtube_id) params.set('youtube_id', track.youtube_id)
    if (track.nhaccuatui_id) params.set('nhaccuatui_id', track.nhaccuatui_id)
    if (track.soundcloud_id) params.set('soundcloud_id', String(track.soundcloud_id))
    if (track.spotify_id) params.set('spotify_id', track.spotify_id)
    if (track.file_path) params.set('file_path', track.file_path)

    const res = await fetch(`/api/lyrics/custom?${params.toString()}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = await res.json()
    if (json?.found && json?.data) {
      return json.data as LrclibResponse
    }
  } catch {
    // Ignore network or parsing errors and continue to standard providers
  }

  return null
}

export async function getPrimaryLyrics(
  track: LyricsTrack,
): Promise<LrclibResponse | null> {
  const cacheKey = getTrackLyricsCacheKey(track)
  if (primaryLyricsCache.has(cacheKey)) {
    const cached = primaryLyricsCache.get(cacheKey)!
    primaryLyricsCache.delete(cacheKey)
    primaryLyricsCache.set(cacheKey, cached)
    return cached
  }
  if (primaryLyricsInFlight.has(cacheKey)) {
    return primaryLyricsInFlight.get(cacheKey)!
  }

  if (track.lyrics && track.lyrics.trim()) {
    const inlineCustom = customLyricsToLrclibResponse(track, track.lyrics)
    if (inlineCustom && (inlineCustom.syncedLyrics?.trim() || inlineCustom.plainLyrics?.trim())) {
      primaryLyricsCache.set(cacheKey, inlineCustom)
      while (primaryLyricsCache.size > MAX_PRIMARY_LYRICS_ENTRIES) {
        primaryLyricsCache.delete(primaryLyricsCache.keys().next().value!)
      }
      return inlineCustom
    }
  }

  const fetchPromise = (async (): Promise<LrclibResponse | null> => {
    try {
      // 0. Highest priority: Admin custom lyrics saved in DB (browser runtime).
      // Checked even before SoundCloud UGC/remix filter so Admin can write lyrics for remixes/covers.
      const customResult =
        typeof window !== 'undefined' && typeof fetch === 'function'
          ? await fetchCustomLyricsFromApi(track)
          : null
      if (customResult && (customResult.syncedLyrics?.trim() || customResult.plainLyrics?.trim())) {
        primaryLyricsCache.set(cacheKey, customResult)
        while (primaryLyricsCache.size > MAX_PRIMARY_LYRICS_ENTRIES) {
          primaryLyricsCache.delete(primaryLyricsCache.keys().next().value!)
        }
        return customResult
      }

      // If track is from SoundCloud and is a remix / UGC user upload, do NOT fetch lyrics from other songs
      if (track.source === 'soundcloud') {
        if (isSoundCloudUgcOrRemix(track.title, track.artist)) {
          return null
        }
      }

      // Synced NCT lyrics already satisfy the highest-priority provider result.
      const nctResult = track.nhaccuatui_id ? await fetchNctLyrics(track) : null
      const lrclibResult = nctResult?.syncedLyrics
        ? null
        : await fetchLyricsFromLrclib({
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          youtubeId: track.youtube_id,
          isSoundCloud: track.source === 'soundcloud',
        }).catch(() => null)

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

      // A provider miss can be temporary. Only retain usable successes.
      if (finalResult && (finalResult.syncedLyrics?.trim() || finalResult.plainLyrics?.trim())) {
        primaryLyricsCache.set(cacheKey, finalResult)
        while (primaryLyricsCache.size > MAX_PRIMARY_LYRICS_ENTRIES) {
          primaryLyricsCache.delete(primaryLyricsCache.keys().next().value!)
        }
      }
      return finalResult
    } catch {
      return null
    } finally {
      primaryLyricsInFlight.delete(cacheKey)
    }
  })()

  primaryLyricsInFlight.set(cacheKey, fetchPromise)
  return fetchPromise
}


