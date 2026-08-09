import {
  findBestNhacCuaTuiMatch,
  isValidNhacCuaTuiAudioUrl,
  normalizeNhacCuaTuiSearchResponse,
  normalizeNhacCuaTuiSongResponse,
  type NhacCuaTuiSearchItem,
  type NhacCuaTuiMatchTarget,
  type NhacCuaTuiSong,
} from './nhaccuatui'
import type { Track } from '@/types'

async function readJson(response: Response): Promise<unknown | null> {
  if (!response.ok) return null

  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function searchNhacCuaTui(query: string): Promise<NhacCuaTuiSearchItem[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  try {
    const response = await fetch(`/api/nhaccuatui/search?q=${encodeURIComponent(trimmedQuery)}`, {
      cache: 'no-store',
    })
    const payload = await readJson(response)
    if (!payload || typeof payload !== 'object') return []

    const items = (payload as { items?: unknown }).items
    return normalizeNhacCuaTuiSearchResponse(items)
  } catch {
    return []
  }
}

export async function resolveNhacCuaTuiSong(id: string): Promise<NhacCuaTuiSong | null> {
  const trimmedId = id.trim()
  if (!trimmedId) return null

  try {
    const response = await fetch(`/api/nhaccuatui/song/${encodeURIComponent(trimmedId)}`, {
      cache: 'no-store',
    })
    const payload = await readJson(response)
    if (!payload || typeof payload !== 'object') return null

    const song = (payload as { song?: unknown }).song
    const normalized = normalizeNhacCuaTuiSongResponse(song || payload)
    return normalized && isValidNhacCuaTuiAudioUrl(normalized.audioUrl) ? normalized : null
  } catch {
    return null
  }
}

export async function resolveNhacCuaTuiAudio(
  target: NhacCuaTuiMatchTarget,
): Promise<NhacCuaTuiSong | null> {
  const query = `${target.title || ''} ${target.artist || ''}`.trim()
  const candidates = await searchNhacCuaTui(query)
  const match = findBestNhacCuaTuiMatch(candidates, target)
  return match ? resolveNhacCuaTuiSong(match.id) : null
}

export async function resolveNhacCuaTuiTrack(
  track: Pick<Track, 'title' | 'artist' | 'album' | 'duration' | 'source' | 'nhaccuatui_id'>,
): Promise<NhacCuaTuiSong | null> {
  if (track.nhaccuatui_id) return resolveNhacCuaTuiSong(track.nhaccuatui_id)

  return resolveNhacCuaTuiAudio({
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
  })
}
