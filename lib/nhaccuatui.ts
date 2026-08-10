import type { Track } from '@/types'

export interface NhacCuaTuiSearchItem {
  id: string
  title: string
  artist: string
  thumbnail?: string
  duration?: number | null
}

export interface NhacCuaTuiSong {
  id: string
  title: string
  artist: string
  coverUrl?: string | null
  duration?: number | null
  lyric?: string | null
  audioUrl?: string
  streamUrl?: string
}

export interface NhacCuaTuiMatchTarget {
  title?: string | null
  artist?: string | null
  album?: string | null
  duration?: number | null
}

const NEGATIVE_MARKERS = [
  'remix',
  'cover',
  'karaoke',
  'nightcore',
  'sped up',
  'slowed',
  '8d',
  'instrumental',
  'beat',
  'live version',
]

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return null
}

export function normalizeNhacCuaTuiLyrics(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!normalized) return null

  const normalizedForComparison = normalizeNhacCuaTuiText(normalized)
  const placeholders = [
    'loi bai hat se xuat hien o day',
    'lyrics not available',
    'no lyrics available',
  ]
  if (
    placeholders.some((placeholder) => normalizedForComparison.includes(placeholder)) ||
    normalized.toLowerCase().includes('lời bài hát sẽ xuất hiện ở đây')
  ) return null

  return normalized
}

export function normalizeNhacCuaTuiText(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
    .replace(/feat\.?|ft\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function readCandidate(value: unknown): NhacCuaTuiSearchItem | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const id = asText(item.id)
  const title = asText(item.title || item.name)
  const artist = asText(item.artist || item.artistName)
  if (!id || !title || !artist) return null

  const candidate: NhacCuaTuiSearchItem = {
    id,
    title,
    artist,
    thumbnail: asText(item.thumbnail || item.coverUrl || item.cover_url) || undefined,
  }

  const duration = asDuration(item.duration)
  if (duration !== null) candidate.duration = duration

  return candidate
}

export function normalizeNhacCuaTuiSearchResponse(value: unknown): NhacCuaTuiSearchItem[] {
  const root = value as Record<string, unknown> | null
  const items = Array.isArray(value)
    ? value
    : root && Array.isArray(root.songs)
      ? root.songs
      : root && Array.isArray(root.data)
        ? root.data
        : root && Array.isArray(root.results)
          ? root.results
          : root && Array.isArray(root.items)
            ? root.items
            : []

  return items.map(readCandidate).filter((item): item is NhacCuaTuiSearchItem => Boolean(item))
}

export function normalizeNhacCuaTuiChartResponse(value: unknown): NhacCuaTuiSearchItem[] {
  if (!value || typeof value !== 'object') return []
  const root = value as Record<string, unknown>
  const songs = Array.isArray(root.songs) ? root.songs : []
  return songs.map(readCandidate).filter((item): item is NhacCuaTuiSearchItem => Boolean(item))
}

export function nhacCuaTuiSearchItemToTrack(item: NhacCuaTuiSearchItem): Track {
  return {
    id: `nct-${item.id}`,
    user_id: 'nhaccuatui-global',
    title: item.title,
    artist: item.artist,
    duration: item.duration || 0,
    file_path: '',
    cover_url: item.thumbnail || null,
    created_at: new Date().toISOString(),
    source: 'nhaccuatui',
    nhaccuatui_id: item.id,
  }
}

export function isValidNhacCuaTuiAudioUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'nct.vn' || url.hostname.endsWith('.nct.vn'))
  } catch {
    return false
  }
}

export interface NhacCuaTuiSongMetadata {
  id: string
  title: string
  artist: string
  duration: number | null
}

/**
 * Metadata-tolerant variant of normalizeNhacCuaTuiSongResponse: keeps songs whose
 * audioUrl is missing/invalid. Used by the YouTube-matching fallback, where the
 * missing NCT audio URL is exactly why a match is needed in the first place.
 */
export function normalizeNhacCuaTuiSongMetadata(value: unknown): NhacCuaTuiSongMetadata | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const item = root.song && typeof root.song === 'object' ? root.song as Record<string, unknown> : root
  const id = asText(item.id)
  const title = asText(item.title || item.name)
  const artist = asText(item.artist || item.artistName)

  if (!id || !title || !artist) return null

  return { id, title, artist, duration: asDuration(item.duration) }
}

export function normalizeNhacCuaTuiSongResponse(value: unknown): NhacCuaTuiSong | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const item = root.song && typeof root.song === 'object' ? root.song as Record<string, unknown> : root
  const id = asText(item.id)
  const title = asText(item.title || item.name)
  const artist = asText(item.artist || item.artistName)
  const audioUrl = item.audioUrl || item.audio_url || item.streamUrl || item.stream_url

  if (!id || !title || !artist || !isValidNhacCuaTuiAudioUrl(audioUrl)) return null

  return {
    id,
    title,
    artist,
    coverUrl: asText(item.coverUrl || item.cover_url || item.thumbnail) || null,
    duration: asDuration(item.duration),
    lyric: normalizeNhacCuaTuiLyrics(item.lyric || item.lyrics || item.lyricText),
    audioUrl,
  }
}

export function normalizePublicNhacCuaTuiSongResponse(value: unknown): NhacCuaTuiSong | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const item = root.song && typeof root.song === 'object' ? root.song as Record<string, unknown> : root
  const id = asText(item.id)
  const title = asText(item.title || item.name)
  const artist = asText(item.artist || item.artistName)
  const streamUrl = asText(item.streamUrl || item.stream_url)

  if (!id || !title || !artist || !streamUrl) return null

  return {
    id,
    title,
    artist,
    coverUrl: asText(item.coverUrl || item.cover_url || item.thumbnail) || null,
    duration: asDuration(item.duration),
    lyric: normalizeNhacCuaTuiLyrics(item.lyric || item.lyrics || item.lyricText),
    streamUrl,
  }
}

function tokenOverlap(target: string, candidate: string): number {
  const targetTokens = new Set(target.split(' ').filter((token) => token.length > 1))
  if (targetTokens.size === 0) return 0
  const candidateTokens = new Set(candidate.split(' '))
  let matched = 0
  for (const token of targetTokens) {
    if (candidateTokens.has(token) || candidate.includes(token)) matched++
  }
  return matched / targetTokens.size
}

export function findBestNhacCuaTuiMatch(
  candidates: NhacCuaTuiSearchItem[],
  target: NhacCuaTuiMatchTarget,
): NhacCuaTuiSearchItem | null {
  const targetTitle = normalizeNhacCuaTuiText(target.title)
  const targetArtist = normalizeNhacCuaTuiText(target.artist)
  if (!targetTitle) return null

  let best: NhacCuaTuiSearchItem | null = null
  let bestScore = 34

  for (const candidate of candidates) {
    const title = normalizeNhacCuaTuiText(candidate.title)
    const artist = normalizeNhacCuaTuiText(candidate.artist)
    if (!title || !artist) continue

    // Check negative markers on the RAW title too — normalized text strips
    // parenthesized markers (e.g. "(Cukak Remix)") which would bypass the filter.
    const rawTitle = ` ${(candidate.title || '').toLowerCase()} `
    const candidateHasNegativeMarker = NEGATIVE_MARKERS.some(
      (marker) => title.includes(marker) || rawTitle.includes(` ${marker} `)
    )
    if (candidateHasNegativeMarker) continue

    const titleOverlap = tokenOverlap(targetTitle, title)
    const artistOverlap = targetArtist ? tokenOverlap(targetArtist, artist) : 0
    const exactTitle = title === targetTitle
    const titleContains = title.includes(targetTitle) || targetTitle.includes(title)
    let score = titleOverlap * 45 + artistOverlap * 35
    if (exactTitle) score += 25
    else if (titleContains) score += 12

    if (target.duration && candidate.duration) {
      const durationDifference = Math.abs(target.duration - candidate.duration)
      if (durationDifference > 45) continue
      score -= Math.min(durationDifference, 45) * 0.35
    }

    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  return best
}
