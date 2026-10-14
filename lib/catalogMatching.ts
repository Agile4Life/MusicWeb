export interface CatalogMetadata {
  title?: string | null
  artist?: string | null
  duration?: number | null
}

/** Keep word boundaries and non-Latin names while folding accents and punctuation. */
export function normalizeIdentity(value: string | null | undefined): string {
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

export function containsPhrase(text: string, phrase: string): boolean {
  return !!phrase && ` ${text} `.includes(` ${phrase} `)
}

/**
 * Strip non-identity upload annotations (Official Video, MV, Lyrics, 4K, feat. credits)
 * while preserving recording version markers (Remix, Live, Acoustic, Radio Edit, etc.).
 */
export function stripNonIdentityAnnotations(value: string | null | undefined): string {
  if (!value) return ''
  return normalizeIdentity(
    value
      .replace(
        /\s*[\(\[\{]\s*(?:official\s*(?:video|music\s*video|audio|mv|lyric\s*video|visualizer|clip)?|lyric\s*video|lyrics?|visualizer|audio|mv|hd|4k|m\/v|mv\s*hd|video|full\s*hd|vietsub|engsub|explicit|remaster(?:ed)?(?:\s+\d{4})?)\s*[\)\]\}]/gi,
        ' ',
      )
      .replace(/\s*[\(\[\{]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]\}]+[\)\]\}]/gi, ' ')
      .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*/i, ' ')
      .replace(/\s*-\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\b.*/i, ' '),
  )
}

function expandArtistAliases(normalizedArtist: string): string[] {
  const aliases = new Set<string>([normalizedArtist])
  if (normalizedArtist === 'rpt mck' || normalizedArtist === 'mck' || normalizedArtist === 'nghiem vu hoang long') {
    aliases.add('mck')
    aliases.add('rpt mck')
  }
  return Array.from(aliases)
}

/** Require a complete credited name, including credits embedded in upload titles. */
export function hasCatalogArtistEvidence(candidate: CatalogMetadata, targetArtist?: string | null): boolean {
  if (!targetArtist?.trim()) return true
  const rawArtists = targetArtist
    .split(/\s+(?:feat\.?|ft\.?|featuring|x)\s+|[,;&]|\s+\/\s+/i)
    .map(normalizeIdentity)
    .filter(Boolean)
  const artists = rawArtists.flatMap(expandArtistAliases)
  const title = normalizeIdentity(candidate.title)
  const artist = normalizeIdentity(candidate.artist)
  return artists.some((name) => containsPhrase(title, name) || containsPhrase(artist, name))
}

export const PLAYBACK_VARIANT_MARKERS = [
  'remix', 'cover', 'karaoke', 'nightcore', 'sped up', 'speed up', 'slowed',
  'reverb', '8d', 'instrumental', 'beat', 'live', 'lofi', 'lo-fi', 'mashup',
  'bass boosted', 'piano version', 'acoustic version', 'acoustic', 'radio edit',
  'single version', 'demo', 'parody', 'nhac che', 'ai cover', 'guitar version',
  'nhac chuong', 'ringtone', 'tach loi', 'medley', 'lien khuc', 'reaction',
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

const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

export function measureIdentityTokenOverlap(targetNorm: string, candidateNorm: string): number {
  const rawTokens = targetNorm.split(' ').filter(Boolean)
  const longerTokens = rawTokens.filter((t) => t.length > 1 || CJK_REGEX.test(t))
  const targetTokens = new Set(longerTokens.length > 0 ? longerTokens : rawTokens)
  if (targetTokens.size === 0) return 0
  const candidateTokens = new Set(candidateNorm.split(' ').filter(Boolean))
  let matched = 0
  for (const token of targetTokens) {
    if (candidateTokens.has(token) || (CJK_REGEX.test(token) && candidateNorm.includes(token))) {
      matched++
    }
  }
  return matched / targetTokens.size
}

/**
 * Verify that candidate title genuinely represents the target title.
 * Prevents short 1-word candidates (e.g. "Anh") from matching long targets ("Anh Da Quen Voi Co Don").
 */
export function hasCatalogTitleEvidence(
  candidateTitle: string | null | undefined,
  targetTitle: string | null | undefined,
): boolean {
  const cleanCandidate = stripNonIdentityAnnotations(candidateTitle) || normalizeIdentity(candidateTitle)
  const cleanTarget = stripNonIdentityAnnotations(targetTitle) || normalizeIdentity(targetTitle)
  if (!cleanCandidate || !cleanTarget) return false

  if (cleanCandidate === cleanTarget) return true
  if (containsPhrase(cleanCandidate, cleanTarget)) return true

  const candidateTokens = cleanCandidate.split(' ').filter(Boolean)
  const overlap = measureIdentityTokenOverlap(cleanTarget, cleanCandidate)

  // Reverse phrase containment is only valid when candidate has >= 2 words and covers >= 60% of target tokens
  if (
    containsPhrase(cleanTarget, cleanCandidate) &&
    candidateTokens.length >= 2 &&
    overlap >= 0.6
  ) {
    return true
  }

  return false
}

export function isSoundCloudCatalogMatch(candidate: CatalogMetadata, target: CatalogMetadata): boolean {
  if (!hasCatalogTitleEvidence(candidate.title, target.title)) return false
  if (!hasCatalogArtistEvidence(candidate, target.artist)) return false
  if (hasIncompatiblePlaybackVariant(candidate.title, target.title)) return false
  return !candidate.duration || !target.duration || Math.abs(candidate.duration - target.duration) <= 30
}

export function findBestSoundCloudMatch<T extends CatalogMetadata>(
  candidates: readonly T[],
  target: CatalogMetadata,
): T | null {
  const cleanTarget = stripNonIdentityAnnotations(target.title) || normalizeIdentity(target.title)
  if (!cleanTarget) return null

  let best: T | null = null
  let bestScore = -Infinity

  for (const candidate of candidates) {
    if (!isSoundCloudCatalogMatch(candidate, target)) continue
    const cleanCandidate = stripNonIdentityAnnotations(candidate.title) || normalizeIdentity(candidate.title)
    const exactTitle = cleanCandidate === cleanTarget
    const overlap = measureIdentityTokenOverlap(cleanTarget, cleanCandidate)
    let score = overlap * 60 + (exactTitle ? 35 : 0)

    if (target.duration && candidate.duration) {
      const diff = Math.abs(target.duration - candidate.duration)
      score -= diff * 0.8
    }

    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best
}

export function isCatalogTrackMatch(
  candidate: CatalogMetadata,
  target: CatalogMetadata,
  maxDurationDiffSeconds = 45,
): boolean {
  if (!hasCatalogTitleEvidence(candidate.title, target.title)) return false
  if (target.artist?.trim()) {
    if (!hasCatalogArtistEvidence(candidate, target.artist)) return false
  } else {
    const cleanCandidate = stripNonIdentityAnnotations(candidate.title) || normalizeIdentity(candidate.title)
    const cleanTarget = stripNonIdentityAnnotations(target.title) || normalizeIdentity(target.title)
    if (cleanCandidate !== cleanTarget) return false
  }
  if (hasIncompatiblePlaybackVariant(candidate.title, target.title)) return false
  if (target.duration && candidate.duration && Math.abs(candidate.duration - target.duration) > maxDurationDiffSeconds) {
    return false
  }
  return true
}
