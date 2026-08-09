import type { Track } from '@/types'
import { resolveNhacCuaTuiTrack } from './nhaccuatuiClient'

/**
 * Convert an imported Spotify/YouTube candidate to a persisted NCT identity
 * when the catalog can resolve it. Signed stream URLs are intentionally not
 * copied into the returned track because they are short-lived.
 */
export async function resolvePlaylistTrackWithNct(track: Track): Promise<Track> {
  try {
    const song = await resolveNhacCuaTuiTrack(track)
    if (!song) return track

    const {
      audio_url: _audioUrl,
      audius_id: _audiusId,
      file_path: _filePath,
      itunes_id: _itunesId,
      spotify_id: _spotifyId,
      youtube_id: _youtubeId,
      ...fallbackMetadata
    } = track

    return {
      ...fallbackMetadata,
      id: `nct-${song.id}`,
      title: song.title,
      artist: song.artist,
      duration: song.duration ?? track.duration,
      file_path: '',
      cover_url: song.coverUrl || track.cover_url || null,
      source: 'nhaccuatui',
      nhaccuatui_id: song.id,
    }
  } catch {
    return track
  }
}
