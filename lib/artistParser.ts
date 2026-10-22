export interface ParsedArtist {
  name: string
  separator?: string
}

/**
 * Parses raw artist string into individual artist names and their delimiters.
 * Handles:
 * - Comma: "Artist A, Artist B"
 * - Feat / Ft: "Artist A feat. Artist B", "Artist A ft. Artist B", "Artist A (feat. Artist B)"
 * - Ampersand: "Artist A & Artist B"
 * - Cross: "Artist A x Artist B", "Artist A X Artist B", "Artist A × Artist B"
 * - Slash: "Artist A / Artist B" (with spaces, so AC/DC and W/N remain intact)
 * - Semicolon: "Artist A; Artist B"
 */
export function parseArtists(rawArtist: string | null | undefined): ParsedArtist[] {
  if (!rawArtist || !rawArtist.trim()) {
    return []
  }

  let str = rawArtist.trim()

  // First handle parenthetical (feat. X) / (ft. X) at the end or inside
  // e.g. "Charlie Puth (feat. Jung Kook)" -> "Charlie Puth feat. Jung Kook"
  str = str.replace(/\s*\(\s*(?:feat\.?|ft\.?)\s+([^)]+)\)/gi, ' feat. $1')

  // Delimiters with surrounding spaces or punctuation:
  // 1. ", " or ","
  // 2. " feat. ", " ft. ", " feat ", " ft " (case-insensitive)
  // 3. " & "
  // 4. " x ", " X ", " × " (surrounded by spaces to avoid names like DMX or The xx)
  // 5. " / " (surrounded by spaces so AC/DC and W/N are not split)
  // 6. "; " or ";"
  const tokenRegex = /(\s*(?:,\s*|\s+(?:feat\.?|ft\.?|&|[xX×]|\/)\s+|;\s*))/i
  const exactDelimiterRegex = /^\s*(?:,\s*|\s+(?:feat\.?|ft\.?|&|[xX×]|\/)\s+|;\s*)$/i

  const parts = str.split(tokenRegex)
  const result: ParsedArtist[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue

    // Check if this part is a delimiter
    if (exactDelimiterRegex.test(part)) {
      if (result.length > 0) {
        result[result.length - 1].separator = part
      }
    } else {
      const cleanName = part.trim()
      if (cleanName) {
        result.push({ name: cleanName })
      }
    }
  }

  return result.length > 0 ? result : [{ name: str }]
}

/**
 * Extracts only the primary (first) artist name from a combined artist string.
 */
export function getPrimaryArtistName(rawArtist: string | null | undefined): string {
  const parsed = parseArtists(rawArtist)
  return parsed[0]?.name || rawArtist?.trim() || ''
}
