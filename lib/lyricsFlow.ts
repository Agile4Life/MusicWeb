import { normalizeNhacCuaTuiLyrics } from './nhaccuatui'
import { resolveNhacCuaTuiSong } from './nhaccuatuiClient'
import { fetchLyricsFromLrclib } from './lrclib'
import type { LrclibResponse } from './lrclib'
import type { Track } from '@/types'

type LyricsTrack = Pick<Track, 'title' | 'artist' | 'album' | 'duration' | 'youtube_id' | 'nhaccuatui_id'> &
  Partial<Pick<Track, 'id'>>

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

export async function getPrimaryLyrics(
  track: LyricsTrack,
): Promise<LrclibResponse | null> {
  if (track.nhaccuatui_id) {
    try {
      const nctSong = await resolveNhacCuaTuiSong(track.nhaccuatui_id)
      const lyric = normalizeNhacCuaTuiLyrics(nctSong?.lyric)
      if (lyric) return nctLyricsToResponse(track, lyric)
    } catch {
      // Continue silently to LRCLIB and its YouTube Music fallback.
    }
  }

  return fetchLyricsFromLrclib({
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    youtubeId: track.youtube_id,
  })
}
