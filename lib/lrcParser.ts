export interface LyricLine {
  time: number // in seconds
  text: string
}

/**
 * Parse .lrc string into structured array of LyricLine objects sorted by time
 * Example line: [01:15.30] Nắng ấm xa dần rồi
 */
export function parseLrc(lrcContent: string | null | undefined): LyricLine[] {
  if (!lrcContent) return []

  const lines = lrcContent.split('\n')
  const result: LyricLine[] = []

  // Timestamp regex: [mm:ss.xx] or [mm:ss:xx] or [mm:ss]
  const timeRegex = /\[(\d{2,}):(\d{2})(?:[\.\:](\d{2,3}))?\]/g

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Extract all timestamps in case a single line has multiple timestamps
    const timestamps: number[] = []
    let match: RegExpExecArray | null

    while ((match = timeRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      const msRaw = match[3] || '0'
      const milliseconds = msRaw.length === 3 ? parseInt(msRaw, 10) : parseInt(msRaw, 10) * 10
      const totalSeconds = minutes * 60 + seconds + milliseconds / 1000

      timestamps.push(totalSeconds)
    }

    // Text is everything after the timestamps
    const text = trimmed.replace(/\[\d{2,}:\d{2}(?:[\.\:]\d{2,3})?\]/g, '').trim()

    if (text.length > 0 && timestamps.length > 0) {
      for (const time of timestamps) {
        result.push({ time, text })
      }
    }
  }

  // Sort chronologically
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
 * Find index of active line for current playback time
 */
export function findActiveLyricIndex(lyrics: LyricLine[], currentTime: number): number {
  if (!lyrics || lyrics.length === 0) return -1

  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (currentTime >= lyrics[i].time - 0.3) {
      // Offset 0.3s for responsive highlighting
      return i
    }
  }

  return 0
}
