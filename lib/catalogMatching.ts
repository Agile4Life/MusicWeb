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
        /\s*[\(\[\{]\s*(?:official\s*(?:video|music\s*video|audio|mv|lyric\s*video|visualizer|clip)?|lyric\s*video|lyrics?|visualizer|audio|mv|hd|hq|high\s*quality|full\s*audio|original\s*audio|4k|m\/v|mv\s*hd|video|full\s*hd|vietsub|engsub|explicit|remaster(?:ed)?(?:\s+\d{4})?|prod\.?\s*(?:by\b)?[^)\]\}]*|ost\b[^)\]\}]*|from\s+[^)\]\}]*)\s*[\)\]\}]/gi,
        ' ',
      )
      .replace(/\s*[\(\[\{]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?(?:\s+by)?)\s+[^)\]\}]+[\)\]\}]/gi, ' ')
      .replace(/\s+(?:feat\.?|ft\.?|featuring|prod\.?\s+by)\s+.*/i, ' ')
      .replace(/\s+[-–—]\s+from\s+(?:["'“”][^"'“”]+["'“”]|the\s+.*|.*?\b(?:soundtrack|album|motion\s+picture|film|series|ost)\b.*)/i, ' ')
      .replace(
        /\s*(?:\||\/|-\s+)(?:official\s*(?:music\s*video|lyric\s*video|video|audio|mv|visualizer|clip)?|music\s*video|lyric\s*video|lyrics?|visualizer|official\s+mv|m\/v|full\s*hd|hq|high\s*quality|vietsub|engsub)\b.*/i,
        ' ',
      )
      .replace(/\s*-\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\b.*/i, ' '),
  )
}

const ARTIST_ALIAS_GROUPS: ReadonlyArray<readonly string[]> = [
  ['rpt mck', 'mck', 'nghiem vu hoang long', 'nger'],
  ['son tung m tp', 'son tung mtp'],
  ['den', 'den vau'],
  ['soobin', 'soobin hoang son'],
  ['tlinh', 't linh'],
  ['low g', 'lowg'],
  ['b ray', 'bray'],
  ['grey d', 'greyd'],
  ['hieuthuhai', 'hieu thu hai'],
  ['justatee', 'justa tee'],
  ['2pillz', '2 pillz'],
  ['w n', 'wn'],
  ['vu', 'hoang thai vu'],
]

function expandArtistAliases(normalizedArtist: string): string[] {
  if (!normalizedArtist) return []
  const aliases = new Set<string>([normalizedArtist])

  for (const group of ARTIST_ALIAS_GROUPS) {
    if (group.includes(normalizedArtist)) {
      for (const member of group) aliases.add(member)
    }
  }

  const crewStripped = normalizedArtist
    .replace(/^(?:rpt|gerdnang|dg\s+house|rz)\s+/i, '')
    .trim()
  if (crewStripped && crewStripped.length >= 3 && crewStripped !== normalizedArtist) {
    aliases.add(crewStripped)
  }

  const tokens = normalizedArtist.split(' ').filter(Boolean)
  if (tokens.length === 2 && (tokens[0].length <= 4 || tokens[1].length <= 3)) {
    const compact = tokens.join('')
    if (compact.length >= 3) {
      aliases.add(compact)
    }
  }

  return Array.from(aliases)
}

export function extractArtistAliases(rawArtist?: string | null): string[] {
  if (!rawArtist?.trim()) return []
  return rawArtist
    .replace(/[\(\[\{]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]\}]+)[\)\]\}]/gi, ' feat. $1 ')
    .split(/\s+(?:feat\.?|ft\.?|featuring|x|with|vs\.?|prod\.?(?:\s+by)?)\s+|[,;&×]|\s+\/\s+/i)
    .map(normalizeIdentity)
    .filter(Boolean)
    .flatMap(expandArtistAliases)
}

/** Require a complete credited name, including main artist credits embedded in upload titles. */
export function hasCatalogArtistEvidence(candidate: CatalogMetadata, targetArtist?: string | null): boolean {
  if (!targetArtist?.trim()) return true
  const artists = extractArtistAliases(targetArtist)
  const titleWithoutFeat = normalizeIdentity(
    (candidate.title || '')
      .replace(/[\(\[\{]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]\}]+[\)\]\}]/gi, ' ')
      .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*/i, ' '),
  )
  const artist = normalizeIdentity(candidate.artist)
  return artists.some((name) => containsPhrase(titleWithoutFeat, name) || containsPhrase(artist, name))
}

export const PLAYBACK_VARIANT_MARKERS = [
  'remix', 'cover', 'karaoke', 'nightcore', 'sped up', 'speed up', 'slowed',
  'reverb', '8d', 'instrumental', 'beat', 'live', 'lofi', 'lo-fi', 'mashup',
  'bass boosted', 'piano version', 'acoustic version', 'acoustic', 'radio edit',
  'edit', 'rework', 'bootleg', 'flip', 'rendition', 'orchestral', 'phonk', 'guitar',
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
    if (
      candidateTokens.has(token) ||
      (CJK_REGEX.test(token) && candidateNorm.includes(token)) ||
      (token.length >= 4 && candidateTokens.has(`${token}s`)) ||
      (token.length >= 5 && token.endsWith('s') && candidateTokens.has(token.slice(0, -1)))
    ) {
      matched++
    }
  }
  return matched / targetTokens.size
}

/**
 * Strip credited artist names from a normalized candidate title when the upload
 * embeds "Artist - Title" or "Title - Artist".
 */
export function stripArtistFromCandidateTitle(
  cleanCandidate: string,
  cleanTarget: string,
  artistHint?: string | null,
  candidateArtist?: string | null,
): string {
  if (!cleanCandidate || cleanCandidate === cleanTarget) return cleanCandidate
  const aliases = Array.from(
    new Set([...extractArtistAliases(artistHint), ...extractArtistAliases(candidateArtist)]),
  ).sort((a, b) => b.length - a.length)

  let stripped = cleanCandidate
  for (const alias of aliases) {
    if (!alias || alias === cleanTarget) continue
    if (stripped.startsWith(`${alias} `)) {
      const candidateRest = stripped.slice(alias.length).trim()
      if (candidateRest) stripped = candidateRest
    } else if (stripped.endsWith(` ${alias}`)) {
      const candidateRest = stripped.slice(0, stripped.length - alias.length).trim()
      if (candidateRest) stripped = candidateRest
    }
  }
  return stripped || cleanCandidate
}

/**
 * Verify that candidate title genuinely represents the target title.
 * Prevents both:
 *  - short 1-word candidates ("Anh") matching long targets ("Anh Da Quen Voi Co Don")
 *  - long multi-word candidates ("Anh Da Quen Voi Co Don") matching short targets ("Anh")
 */
export function hasCatalogTitleEvidence(
  candidateTitle: string | null | undefined,
  targetTitle: string | null | undefined,
  artistHint?: string | null,
  candidateArtist?: string | null,
): boolean {
  const cleanCandidate = stripNonIdentityAnnotations(candidateTitle) || normalizeIdentity(candidateTitle)
  const cleanTarget = stripNonIdentityAnnotations(targetTitle) || normalizeIdentity(targetTitle)
  if (!cleanCandidate || !cleanTarget) return false

  if (cleanCandidate === cleanTarget) return true

  const coreCandidate = stripArtistFromCandidateTitle(
    cleanCandidate,
    cleanTarget,
    artistHint,
    candidateArtist,
  )
  if (coreCandidate === cleanTarget) return true

  // Check if raw candidateTitle is formatted as "Artist - Title" or "Title | Subtitle"
  if (candidateTitle && /\s+[-–—|:]\s+/.test(candidateTitle)) {
    const segments = candidateTitle
      .split(/\s+[-–—|:]\s+/)
      .map((seg) => stripNonIdentityAnnotations(seg) || normalizeIdentity(seg))
      .filter(Boolean)
    if (segments.some((seg) => seg === cleanTarget)) {
      return true
    }
  }

  const forwardOverlap = measureIdentityTokenOverlap(cleanTarget, coreCandidate)
  const reverseOverlap = measureIdentityTokenOverlap(coreCandidate, cleanTarget)
  const candidateTokens = coreCandidate.split(' ').filter(Boolean)
  const targetTokens = cleanTarget.split(' ').filter(Boolean)

  if (containsPhrase(coreCandidate, cleanTarget) && reverseOverlap >= 0.6) {
    return true
  }

  // Reverse phrase containment is only valid when candidate has >= 2 words and covers >= 60% of target tokens
  if (
    containsPhrase(cleanTarget, coreCandidate) &&
    candidateTokens.length >= 2 &&
    forwardOverlap >= 0.6
  ) {
    return true
  }

  if (targetTokens.length >= 3 && forwardOverlap >= 0.8 && reverseOverlap >= 0.65) {
    return true
  }

  return false
}

export function isSoundCloudCatalogMatch(candidate: CatalogMetadata, target: CatalogMetadata): boolean {
  if (!hasCatalogTitleEvidence(candidate.title, target.title, target.artist, candidate.artist)) return false
  if (!hasCatalogArtistEvidence(candidate, target.artist)) return false
  if (
    hasIncompatiblePlaybackVariant(candidate.title, target.title) ||
    hasIncompatiblePlaybackVariant(
      `${candidate.title || ''} ${candidate.artist || ''}`,
      `${target.title || ''} ${target.artist || ''}`,
    )
  ) {
    return false
  }
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
    const coreCandidate = stripArtistFromCandidateTitle(
      cleanCandidate,
      cleanTarget,
      target.artist,
      candidate.artist,
    )
    const exactRawTitle = cleanCandidate === cleanTarget
    const exactCoreTitle = coreCandidate === cleanTarget
    const forwardOverlap = measureIdentityTokenOverlap(cleanTarget, coreCandidate)
    const reverseOverlap = measureIdentityTokenOverlap(coreCandidate, cleanTarget)
    let score =
      forwardOverlap * 45 +
      reverseOverlap * 15 +
      (exactRawTitle ? 35 : exactCoreTitle ? 25 : 0)

    if (target.artist?.trim()) {
      if (hasCatalogArtistEvidence({ title: '', artist: candidate.artist }, target.artist)) {
        score += 15
      }
      if (normalizeIdentity(candidate.artist) === normalizeIdentity(target.artist)) {
        score += 10
      }
    }

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
  if (!hasCatalogTitleEvidence(candidate.title, target.title, target.artist, candidate.artist)) return false
  if (target.artist?.trim()) {
    if (!hasCatalogArtistEvidence(candidate, target.artist)) return false
  } else {
    const cleanCandidate = stripNonIdentityAnnotations(candidate.title) || normalizeIdentity(candidate.title)
    const cleanTarget = stripNonIdentityAnnotations(target.title) || normalizeIdentity(target.title)
    const coreCandidate = stripArtistFromCandidateTitle(
      cleanCandidate,
      cleanTarget,
      undefined,
      candidate.artist,
    )
    if (cleanCandidate !== cleanTarget && coreCandidate !== cleanTarget) return false
  }
  if (
    hasIncompatiblePlaybackVariant(candidate.title, target.title) ||
    hasIncompatiblePlaybackVariant(
      `${candidate.title || ''} ${candidate.artist || ''}`,
      `${target.title || ''} ${target.artist || ''}`,
    )
  ) {
    return false
  }
  if (target.duration && candidate.duration && Math.abs(candidate.duration - target.duration) > maxDurationDiffSeconds) {
    return false
  }
  return true
}


