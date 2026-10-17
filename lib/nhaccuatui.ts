import type { Track } from '@/types'
import {
  hasCatalogArtistEvidence,
  hasCatalogTitleEvidence,
  hasIncompatiblePlaybackVariant,
  measureIdentityTokenOverlap,
  stripArtistFromCandidateTitle,
  stripNonIdentityAnnotations,
} from './catalogMatching'

export interface NhacCuaTuiSearchItem {
  id: string
  title: string
  artist: string
  thumbnail?: string | null
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

function formatMsToLrcTag(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  const mm = String(minutes).padStart(2, '0')
  const ss = seconds.toFixed(2).padStart(5, '0')
  return `[${mm}:${ss}]`
}

export function normalizeNhacCuaTuiLyrics(value: unknown): string | null {
  if (Array.isArray(value)) {
    const lines = value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const rec = entry as Record<string, unknown>
        const text = typeof rec.text === 'string' ? rec.text.trim() : ''
        const time = typeof rec.time === 'number' && Number.isFinite(rec.time) ? rec.time : null
        if (!text) return null
        return time !== null ? `${formatMsToLrcTag(time)} ${text}` : text
      })
      .filter((line): line is string => Boolean(line))
    return lines.length > 0 ? lines.join('\n') : null
  }

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
    .replace(/[Đđ]/g, 'd')
    .toLowerCase()
    .replace(/\b(?:feat|ft)\.?\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function readCandidate(value: unknown): NhacCuaTuiSearchItem | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const id = asText(item.id)
  const title = asText(item.title || item.name)

  // id and title are mandatory — without them there's nothing to play or display
  if (!id || !title) return null

  const artist = asText(item.artist || item.artistName)

  const candidate: NhacCuaTuiSearchItem = {
    id,
    title,
    artist: artist || 'Nghệ sĩ chưa xác định',
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

/**
 * Direct server-side search on NhacCuaTui API
 */
export async function searchNhacCuaTuiDirect(query: string, limit = 20): Promise<Track[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  try {
    const nctUrl = new URL(process.env.NCT_API_BASE_URL || 'https://music-api.vanhuy2004h.io.vn')
    nctUrl.pathname = '/api/search'
    nctUrl.searchParams.set('q', trimmed)

    const res = await fetch(nctUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) return []
    const payload: unknown = await res.json()
    const items = normalizeNhacCuaTuiSearchResponse(payload)
    return items.slice(0, limit).map(nhacCuaTuiSearchItemToTrack)
  } catch (err) {
    console.warn('Direct NCT search error:', err)
    return []
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
    lyric:
      normalizeNhacCuaTuiLyrics(item.timedLyric || item.timed_lyric) ||
      normalizeNhacCuaTuiLyrics(item.lyric || item.lyrics || item.lyricText),
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
    lyric:
      normalizeNhacCuaTuiLyrics(item.timedLyric || item.timed_lyric) ||
      normalizeNhacCuaTuiLyrics(item.lyric || item.lyrics || item.lyricText),
    streamUrl,
  }
}

function tokenOverlap(target: string, candidate: string): number {
  return measureIdentityTokenOverlap(target, candidate)
}

export function findBestNhacCuaTuiMatch(
  candidates: NhacCuaTuiSearchItem[],
  target: NhacCuaTuiMatchTarget,
): NhacCuaTuiSearchItem | null {
  const targetTitle = stripNonIdentityAnnotations(target.title) || normalizeNhacCuaTuiText(target.title)
  const targetArtist = normalizeNhacCuaTuiText(target.artist)
  if (!targetTitle) return null

  let best: NhacCuaTuiSearchItem | null = null
  let bestScore = 34

  for (const candidate of candidates) {
    const title = stripNonIdentityAnnotations(candidate.title) || normalizeNhacCuaTuiText(candidate.title)
    const artist = normalizeNhacCuaTuiText(candidate.artist)
    if (!title || !artist) continue

    if (!hasCatalogArtistEvidence(candidate, target.artist)) continue
    if (hasIncompatiblePlaybackVariant(candidate.title, target.title)) continue

    const coreTitle = stripArtistFromCandidateTitle(
      title,
      targetTitle,
      target.artist,
      candidate.artist,
    )
    const titleOverlap = tokenOverlap(targetTitle, coreTitle)
    const reverseTitleOverlap = tokenOverlap(coreTitle, targetTitle)
    const hasPhraseEvidence = hasCatalogTitleEvidence(
      candidate.title,
      target.title,
      target.artist,
      candidate.artist,
    )
    const targetWordCount = targetTitle.split(' ').filter(Boolean).length
    const minOverlap = targetWordCount <= 2 ? 1 : 0.6

    // Hard Title Gate: never accept a candidate solely on artist score when title doesn't match,
    // and never let a short 1-2 word title match a long unrelated song title.
    if (targetWordCount <= 2) {
      if (!hasPhraseEvidence) continue
    } else if (!hasPhraseEvidence && (titleOverlap < minOverlap || reverseTitleOverlap < 0.5)) {
      continue
    }

    const artistOverlap = targetArtist ? tokenOverlap(targetArtist, artist) : 0
    const exactTitle = title === targetTitle || coreTitle === targetTitle
    let score = titleOverlap * 40 + reverseTitleOverlap * 10 + artistOverlap * 35
    if (exactTitle) score += 28
    else if (hasPhraseEvidence) score += 12

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

