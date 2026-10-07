interface CatalogMetadata {
  title?: string | null
  artist?: string | null
  duration?: number | null
}

/** Keep word boundaries and non-Latin names while folding accents and punctuation. */
function normalizeIdentity(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[Đđ]/g, 'd')
    .toLowerCase()
    .replace(/vevo\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function containsPhrase(text: string, phrase: string): boolean {
  return !!phrase && ` ${text} `.includes(` ${phrase} `)
}

/** Require a complete credited name, including credits embedded in upload titles. */
export function hasCatalogArtistEvidence(candidate: CatalogMetadata, targetArtist?: string | null): boolean {
  if (!targetArtist?.trim()) return true
  const artists = targetArtist
    .split(/\s+(?:feat\.?|ft\.?|featuring|x)\s+|[,;&]|\s+\/\s+/i)
    .map(normalizeIdentity)
    .filter(Boolean)
  const title = normalizeIdentity(candidate.title)
  const artist = normalizeIdentity(candidate.artist)
  return artists.some((name) => containsPhrase(title, name) || containsPhrase(artist, name))
}

export const PLAYBACK_VARIANT_MARKERS = [
  'remix', 'cover', 'karaoke', 'nightcore', 'sped up', 'speed up', 'slowed',
  'reverb', '8d', 'instrumental', 'beat', 'live', 'lofi', 'lo-fi', 'mashup',
  'bass boosted', 'piano version', 'acoustic version', 'reaction',
]

/** Inspect raw titles so cleaning display annotations cannot hide a variant. */
export function hasIncompatiblePlaybackVariant(
  candidateTitle: string | null | undefined,
  targetTitle: string | null | undefined,
  markers: readonly string[] = PLAYBACK_VARIANT_MARKERS,
): boolean {
  const candidate = normalizeIdentity(candidateTitle)
  const target = normalizeIdentity(targetTitle)
  return markers.some((marker) => {
    const phrase = normalizeIdentity(marker)
    return containsPhrase(candidate, phrase) !== containsPhrase(target, phrase)
  })
}

export function isSoundCloudCatalogMatch(candidate: CatalogMetadata, target: CatalogMetadata): boolean {
  const title = normalizeIdentity(candidate.title)
  const targetTitle = normalizeIdentity(target.title)
  if (!title || !targetTitle) return false
  if (!containsPhrase(title, targetTitle) && !containsPhrase(targetTitle, title)) return false
  if (!hasCatalogArtistEvidence(candidate, target.artist)) return false
  if (hasIncompatiblePlaybackVariant(candidate.title, target.title)) return false
  return !candidate.duration || !target.duration || Math.abs(candidate.duration - target.duration) <= 30
}
