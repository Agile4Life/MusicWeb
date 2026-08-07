export interface LyricLine {
  time: number // in seconds
  text: string
}

/**
 * Parse .lrc string into structured array of LyricLine objects sorted by time
 * Handles [offset: +/-ms] header tags properly
 */
export function parseLrc(lrcContent: string | null | undefined): LyricLine[] {
  if (!lrcContent) return []

  const lines = lrcContent.split('\n')
  const result: LyricLine[] = []

  let lrcOffsetMs = 0

  // Check for [offset: 500] or [offset: -200] header tag
  for (const line of lines) {
    const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\]/i)
    if (offsetMatch) {
      lrcOffsetMs = parseInt(offsetMatch[1], 10) || 0
      break
    }
  }

  const lrcOffsetSec = lrcOffsetMs / 1000
  const timeRegex = /\[(\d{2,}):(\d{2})(?:[\.\:](\d{2,3}))?\]/g

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || /^\[(ar|ti|al|by|offset|length):/i.test(trimmed)) continue

    const timestamps: number[] = []
    let match: RegExpExecArray | null

    timeRegex.lastIndex = 0
    while ((match = timeRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      const msRaw = match[3] || '0'
      const milliseconds = msRaw.length === 3 ? parseInt(msRaw, 10) : parseInt(msRaw, 10) * 10
      const totalSeconds = minutes * 60 + seconds + milliseconds / 1000 + lrcOffsetSec

      timestamps.push(Math.max(0, totalSeconds))
    }

    const text = trimmed.replace(/\[\d{2,}:\d{2}(?:[\.\:]\d{2,3})?\]/g, '').trim()

    if (text.length > 0 && timestamps.length > 0) {
      for (const time of timestamps) {
        result.push({ time, text })
      }
    }
  }

  result.sort((a, b) => a.time - b.time)
  return result
}

/**
 * Parse plain (unsynced) lyrics into lines without timestamps
 */
export function parsePlainLyrics(plainContent: string | null | undefined): LyricLine[] {
  if (!plainContent) return []

  return plainContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({ time: -1, text }))
}

/**
 * Find index of active line for current playback time accurately
 */
export function findActiveLyricIndex(lyrics: LyricLine[], currentTime: number, userOffset: number = 0): number {
  if (!lyrics || lyrics.length === 0) return -1

  const adjustedTime = currentTime + userOffset

  if (adjustedTime < lyrics[0].time) {
    return -1
  }

  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (adjustedTime >= lyrics[i].time) {
      return i
    }
  }

  return -1
}
