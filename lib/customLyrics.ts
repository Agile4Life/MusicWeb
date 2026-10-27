import type { LrclibResponse } from './lrclib'

export interface EditableLyricLine {
  time: number | null
  text: string
}

export interface CustomLyricsTrackIdentity {
  id?: string | null
  source?: string | null
  title?: string | null
  artist?: string | null
  album?: string | null
  duration?: number | null
  youtube_id?: string | null
  nhaccuatui_id?: string | null
  soundcloud_id?: string | number | null
  spotify_id?: string | null
  file_path?: string | null
}

const LRC_LINE_TEST_REGEX = /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m
const LRC_LINE_EXTRACT_REGEX = /^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/
const LRC_ALL_TIMESTAMPS_LINE_REGEX = /^(?:\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*/gm

export function hasLrcTimestamps(lyrics: string): boolean {
  if (!lyrics) return false
  return LRC_LINE_TEST_REGEX.test(lyrics)
}

export function formatLrcTimestamp(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const totalCentiseconds = Math.round(safeSeconds * 100)
  const mins = Math.floor(totalCentiseconds / 6000)
  const remCentiseconds = totalCentiseconds % 6000
  const secs = Math.floor(remCentiseconds / 100)
  const cs = remCentiseconds % 100

  const mm = String(mins).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  const xx = String(cs).padStart(2, '0')
  return `[${mm}:${ss}.${xx}]`
}

export function customLyricsToLrclibResponse(
  track: {
    id?: string | null
    title: string
    artist?: string | null
    album?: string | null
    duration?: number | null
  },
  rawLyrics: string | null | undefined,
): LrclibResponse | null {
  const cleaned = (rawLyrics || '').replace(/\r\n/g, '\n').trim()
  if (!cleaned) return null

  const synced = hasLrcTimestamps(cleaned)
  const numericSeed = Number(
    `8${String(track.id || track.title || '')
      .replace(/\D/g, '')
      .slice(0, 8)}`,
  )

  return {
    id: Number.isFinite(numericSeed) && numericSeed > 0 ? numericSeed : 888888,
    trackName: track.title || 'Untitled Track',
    artistName: track.artist || 'Nghệ sĩ chưa xác định',
    albumName: track.album || undefined,
    duration: track.duration || 0,
    instrumental: false,
    plainLyrics: synced ? null : cleaned,
    syncedLyrics: synced ? cleaned : null,
  }
}

export function parseEditableLyricLines(rawText: string): EditableLyricLine[] {
  const normalized = (rawText || '').replace(/\r\n/g, '\n')
  if (!normalized.trim()) return []

  const rawLines = normalized.split('\n')
  const result: EditableLyricLine[] = []

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    // Ignore metadata tags like [ar:...], [ti:...]
    if (/^\[(ar|ti|al|by|offset|length|re|ve):/i.test(trimmed)) {
      continue
    }

    const match = trimmed.match(LRC_LINE_EXTRACT_REGEX)
    if (match) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      const fractionRaw = match[3] || '0'
      const fraction =
        fractionRaw.length === 1
          ? parseInt(fractionRaw, 10) * 100
          : fractionRaw.length === 2
            ? parseInt(fractionRaw, 10) * 10
            : parseInt(fractionRaw.slice(0, 3), 10)
      const timeInSeconds = +(minutes * 60 + seconds + fraction / 1000).toFixed(2)
      const cleanText = match[4].replace(/^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*/, '').trim()
      result.push({
        time: timeInSeconds,
        text: cleanText,
      })
    } else {
      result.push({
        time: null,
        text: trimmed,
      })
    }
  }

  return result
}

export function serializeEditableLyricLines(lines: EditableLyricLine[]): string {
  return lines
    .filter((l) => l.text.trim().length > 0)
    .map((line) => {
      if (line.time !== null && Number.isFinite(line.time) && line.time >= 0) {
        return `${formatLrcTimestamp(line.time)} ${line.text.trim()}`
      }
      return line.text.trim()
    })
    .join('\n')
}

export function stampLineAtIndex(
  lines: EditableLyricLine[],
  index: number,
  seconds: number,
): EditableLyricLine[] {
  if (index < 0 || index >= lines.length) return lines
  const safeSeconds = Math.max(0, +seconds.toFixed(2))
  return lines.map((line, idx) => (idx === index ? { ...line, time: safeSeconds } : line))
}

export function nudgeLineTimestamp(
  lines: EditableLyricLine[],
  index: number,
  deltaSeconds: number,
): EditableLyricLine[] {
  if (index < 0 || index >= lines.length) return lines
  const current = lines[index]
  if (current.time === null) return lines
  const nextTime = Math.max(0, +(current.time + deltaSeconds).toFixed(2))
  return lines.map((line, idx) => (idx === index ? { ...line, time: nextTime } : line))
}

export function stripAllLrcTimestamps(rawText: string): string {
  if (!rawText) return ''
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(LRC_ALL_TIMESTAMPS_LINE_REGEX, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !/^\[(ar|ti|al|by|offset|length|re|ve):/i.test(line))
    .join('\n')
    .trim()
}

export function makeCustomLyricsLookupKey(track: CustomLyricsTrackIdentity): string {
  const scId =
    track.soundcloud_id ||
    (track.file_path?.startsWith('soundcloud:')
      ? track.file_path.slice('soundcloud:'.length).trim()
      : track.id?.startsWith('sc-')
        ? track.id.slice(3).trim()
        : '')
  if (scId) return `sc:${String(scId).trim()}`
  if (track.nhaccuatui_id) return `nct:${track.nhaccuatui_id.trim()}`
  if (track.youtube_id) return `yt:${track.youtube_id.trim()}`
  if (track.spotify_id) return `sp:${track.spotify_id.trim()}`
  if (track.file_path && track.file_path.includes('soundcloud.com')) {
    return `scurl:${track.file_path.trim().toLowerCase()}`
  }

  const title = (track.title || '').trim().toLowerCase()
  const artist = (track.artist || '').trim().toLowerCase()
  if (title) {
    return `meta:${title}::${artist}`
  }
  return `id:${(track.id || 'unknown').trim()}`
}

