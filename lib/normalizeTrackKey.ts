const NON_IDENTITY_GROUP_PATTERN =
  /^\s*(?:official\s*(?:video|music\s*video|audio|mv|lyric\s*video|visualizer|clip)?|lyric\s*video|lyrics?|visualizer|audio|mv|hd|hq|high\s*quality|full\s*audio|original\s*audio|4k|m\/v|mv\s*hd|video|full\s*hd|vietsub|engsub|explicit|clip|full|remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)\s*$/i

const VERSION_MARKER_PATTERN =
  /\b(?:remix|mix|live|acoustic|unplugged|radio\s*edit|edit|single\s*version|extended|vip|club|dub|cover|karaoke|instrumental|beat|sped\s*up|speed\s*up|slowed|reverb|8d|nightcore|lofi|lo\s*fi|mashup|demo|piano|guitar|version|ver)\b/i

/**
 * Normalize a text field for use as a cache key component.
 * Strips diacritics, non-identity upload suffixes (Official MV, Lyric Video, Audio),
 * feat./ft., and punctuation while preserving recording versions (Remix, Live, Acoustic, Radio Edit)
 * and non-Latin Unicode characters.
 */
export function normalizeTrackField(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .trim()
    .toLowerCase()
    // Strip parenthetical feat./ft./with credits
    .replace(/[\(\[\{]\s*(?:feat\.?|ft\.?|featuring|with)\b[^\)\]\}]*[\)\]\}]/gi, ' ')
    // Strip parenthetical/bracket suffixes only when they are non-identity annotations (keep Remix, Live, Acoustic, etc.)
    .replace(/[\(\[\{]([^\)\]\}]*)[\)\]\}]/g, (_match, inner: string) => {
      if (VERSION_MARKER_PATTERN.test(inner)) {
        return ` ${inner} `
      }
      if (NON_IDENTITY_GROUP_PATTERN.test(inner)) {
        return ' '
      }
      return ' '
    })
    // Strip trailing feat./ft. and soundtrack attribution (- From "...")
    .replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.*/i, '')
    .replace(/\s+[-–—]\s+from\s+(?:["'“”][^"'“”]+["'“”]|the\s+.*|.*?\b(?:soundtrack|album|motion\s+picture|film|series|ost)\b.*)/i, ' ')
    // Remove Vietnamese diacritics via NFD decomposition
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Đ/đ → d (not handled by NFD)
    .replace(/[Đđ]/g, 'd')
    // Strip punctuation while preserving Unicode letters and numbers
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
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
 * Format: `{normalizedTitle}___{normalizedArtist}___{durationBucket}` (plus `___${normalizedAlbum}` when album is provided)
 */
export function normalizeTrackKey(
  title: string,
  artist?: string | null,
  duration?: number | null,
  album?: string | null,
): string {
  const t = normalizeTrackField(title)
  const a = normalizeTrackField(artist)
  const d = durationBucket(duration)
  const al = normalizeTrackField(album)
  return al ? `${t}___${a}___${d}___${al}` : `${t}___${a}___${d}`
}
