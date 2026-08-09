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
  const timeRegex = /\[(\d+):(\d{2})(?:[\.\:](\d{1,3}))?\]/g

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
      let milliseconds = 0
      if (msRaw.length === 1) milliseconds = parseInt(msRaw, 10) * 100
      else if (msRaw.length === 2) milliseconds = parseInt(msRaw, 10) * 10
      else milliseconds = parseInt(msRaw, 10)

      const totalSeconds = minutes * 60 + seconds + milliseconds / 1000 + lrcOffsetSec

      timestamps.push(Math.max(0, totalSeconds))
    }

    const text = trimmed.replace(/\[\d+:\d{2}(?:[\.\:]\d{1,3})?\]/g, '').trim()

    // Only use the first timestamp per line. Enhanced/karaoke LRC repeats
    // the full line text at multiple word-level timestamps — pushing all of
    // them creates duplicate lines that appear to "jump" during playback.
    if (text.length > 0 && timestamps.length > 0) {
      result.push({ time: timestamps[0], text })
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
 * Find index of active line for current playback time accurately via Binary Search
 */
export function findActiveLyricIndex(lyrics: LyricLine[], currentTime: number, userOffset: number = 0): number {
  if (!lyrics || lyrics.length === 0) return -1

  const adjustedTime = currentTime + userOffset
  if (adjustedTime < lyrics[0].time) return -1

  let lo = 0
  let hi = lyrics.length - 1
  let result = -1

  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lyrics[mid].time <= adjustedTime) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  return result
}
