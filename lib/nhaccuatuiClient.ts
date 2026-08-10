import {
  findBestNhacCuaTuiMatch,
  normalizePublicNhacCuaTuiSongResponse,
  normalizeNhacCuaTuiSearchResponse,
  type NhacCuaTuiSearchItem,
  type NhacCuaTuiMatchTarget,
  type NhacCuaTuiSong,
} from './nhaccuatui'
import type { Track } from '@/types'

function getNhacCuaTuiStreamProxyBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_NCT_STREAM_CACHE_URL?.trim()
  if (!raw) return null

  try {
    const url = new URL(raw, typeof window !== 'undefined' ? window.location.href : 'http://localhost')
    const pathname = url.pathname.replace(/\/+$/, '')
    const normalizedPath = pathname.endsWith('/api/stream')
      ? pathname
      : `${pathname}/api/stream`

    return `${url.origin}${normalizedPath}`
  } catch {
    return null
  }
}

export function getNhacCuaTuiStreamUrl(
  track: Pick<Track, 'source' | 'nhaccuatui_id'>,
): string | null {
  if (track.source !== 'nhaccuatui' || !track.nhaccuatui_id) return null
  const proxyBase = getNhacCuaTuiStreamProxyBase()
  const endpoint = proxyBase ?? '/api/nhaccuatui/stream'
  return `${endpoint}?id=${encodeURIComponent(track.nhaccuatui_id)}`
}

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
    return normalizePublicNhacCuaTuiSongResponse(song || payload)
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
