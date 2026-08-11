/**
 * Normalize a text field for use as a cache key component.
 * Strips diacritics, parenthetical suffixes, feat./ft., punctuation,
 * and collapses whitespace. Designed for Vietnamese + international text.
 */
export function normalizeTrackField(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .trim()
    .toLowerCase()
    // Strip parenthetical/bracket suffixes (Official MV, Lyric Video, Audio, etc.)
    .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/gi, '')
    // Strip feat./ft. and everything after
    .replace(/\s*(?:feat\.?|ft\.?)\s+.*/i, '')
    // Remove Vietnamese diacritics via NFD decomposition
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Đ/đ → d (not handled by NFD)
    .replace(/[Đđ]/g, 'd')
    // Strip punctuation (dashes, commas, dots, colons, semicolons)
    .replace(/[-_,.:;!?'"]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Bucket a duration in seconds to the nearest multiple of 5.
 * Absorbs ±2.5s variance between the same song on different sources.
 */
export function durationBucket(seconds: number | null | undefined): number {
  if (seconds == null || isNaN(seconds)) return 0
  return Math.round(seconds / 5) * 5
}

/**
 * Build a deterministic cache key from track metadata.
 * Format: `{normalizedTitle}___{normalizedArtist}___{durationBucket}`
 */
export function normalizeTrackKey(
  title: string,
  artist?: string | null,
  duration?: number | null,
  _album?: string | null, // reserved for future use
): string {
  const t = normalizeTrackField(title)
  const a = normalizeTrackField(artist)
  const d = durationBucket(duration)
  return `${t}___${a}___${d}`
}
