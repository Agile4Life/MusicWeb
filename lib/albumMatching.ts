import {
  containsPhrase,
  hasCatalogArtistEvidence,
  hasCatalogTitleEvidence,
  hasIncompatiblePlaybackVariant,
  normalizeIdentity,
} from './catalogMatching'
import { isKnownBadFallback, isRealAlbumName } from './albumCache'

const ALBUM_EDITION_SUFFIX_REGEX =
  /\s*(?:[\(\[\{]\s*(?:deluxe(?:\s+(?:edition|version))?|expanded(?:\s+(?:edition|version))?|special(?:\s+(?:edition|version))?|collector'?s?\s+edition|anniversary\s+edition|bonus\s+track\s+version|standard\s+edition|explicit(?:\s+version)?|clean(?:\s+version)?|remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?|[^)\]\}]*?\bedition\b|[^)\]\}]*?\bversion\b|single|ep)\s*[\)\]\}]|-\s*(?:single|ep|deluxe(?:\s+(?:edition|version))?|remaster(?:ed)?(?:\s+\d{4})?))\s*$/gi

const NON_IDENTITY_TITLE_ANNOTATION_REGEX =
  /\s*[\(\[\{]\s*(?:(?:official|music|video|audio|mv|m\/v|lyric|lyrics|visualizer|clip|hd|full|4k|uhd|vietsub|engsub|explicit|clean)(?:\s+|[-/])*)+\s*[\)\]\}]/gi
const PROD_CREDIT_ANNOTATION_REGEX =
  /\s*[\(\[\{]\s*(?:prod\.?|produced\s+by)\s+[^)\]\}]+[\)\]\}]/gi

const COMPILATION_ALBUM_KEYWORDS = [
  'now that s what i call music',
  'top hits',
  'greatest hits',
  'best of',
  'top 100',
  'top 50',
  'top 40',
  'billboard',
  'hot 100',
  'workout hits',
  'party hits',
  'summer hits',
  'chill hits',
  'throwback hits',
  'compilation',
  'tuyen tap',
  'tong hop',
  'nhac che',
  'karaoke',
  'tribute',
  'lullaby renditions',
  'piano Guys',
]

/**
 * Clean raw track title by stripping upload annotations and redundant leading artist prefix
 * while keeping real title words intact (e.g. "Single Ladies", "Video Games").
 */
export function cleanTrackTitleForAlbumSearch(
  rawTitle?: string | null,
  rawArtist?: string | null,
): string {
  if (!rawTitle) return ''
  let cleaned = rawTitle
    .replace(NON_IDENTITY_TITLE_ANNOTATION_REGEX, '')
    .replace(PROD_CREDIT_ANNOTATION_REGEX, '')
    .trim()

  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ').map((p) => p.trim()).filter(Boolean)
    if (parts.length >= 2 && rawArtist) {
      const firstPartNorm = normalizeIdentity(parts[0])
      const artistNorm = normalizeIdentity(rawArtist)
      const primaryArtist = normalizeIdentity(rawArtist.split(/[,&/]/)[0])
      if (
        firstPartNorm &&
        (firstPartNorm === artistNorm ||
          firstPartNorm === primaryArtist ||
          containsPhrase(artistNorm, firstPartNorm) ||
          (primaryArtist && containsPhrase(firstPartNorm, primaryArtist)))
      ) {
        cleaned = parts.slice(1).join(' - ').trim()
      }
    }
  }

  return cleaned
}

/**
 * Normalize text for album/title/artist comparison.
 * Properly converts Vietnamese Đ/đ -> d and strips upload/release suffixes
 * without corrupting legitimate title words like "Single", "Video", "Audio".
 */
export function normalizeAlbumText(str?: string | null): string {
  if (!str) return ''
  const stripped = str
    .replace(NON_IDENTITY_TITLE_ANNOTATION_REGEX, ' ')
    .replace(PROD_CREDIT_ANNOTATION_REGEX, ' ')
    .replace(/\s*-\s*(?:single|ep)\s*$/i, ' ')
    .replace(/\s*[\(\[\{]\s*(?:single|ep)\s*[\)\]\}]\s*$/i, ' ')
  return normalizeIdentity(stripped)
}

/**
 * Strip edition/version suffixes from an album name so base album names can match
 * across editions (e.g. "Midnights" <-> "Midnights (3am Edition)").
 */
export function stripAlbumEditionSuffix(albumName?: string | null): string {
  if (!albumName) return ''
  let current = albumName.trim()
  let prev = ''
  while (current !== prev) {
    prev = current
    current = current.replace(ALBUM_EDITION_SUFFIX_REGEX, '').trim()
  }
  return normalizeAlbumText(current)
}

/**
 * Strip trailing " - Single" or " - EP" from display album names returned by iTunes/Deezer.
 */
export function cleanDisplayAlbumName(albumName?: string | null): string {
  if (!albumName) return ''
  return albumName
    .replace(/\s*-\s*(?:Single|EP)\s*$/i, '')
    .trim()
}

/**
 * Strict word-boundary artist matching.
 * Supports multi-artist credits and 2-letter artists ("IU", "Vũ.", "U2")
 * while preventing substring false positives ("Son" != "Jackson", "Ana" != "Lana Del Rey").
 */
export function isAlbumArtistMatch(
  candidateArtist?: string | null,
  targetArtist?: string | null,
): boolean {
  if (!targetArtist?.trim() || !candidateArtist?.trim()) return false

  const candNorm = normalizeIdentity(candidateArtist)
  const targNorm = normalizeIdentity(targetArtist)
  if (!candNorm || !targNorm) return false

  if (candNorm === 'various artists' && targNorm !== 'various artists') {
    return false
  }

  if (candNorm === targNorm) return true

  return (
    hasCatalogArtistEvidence({ artist: candidateArtist }, targetArtist) ||
    hasCatalogArtistEvidence({ artist: targetArtist }, candidateArtist)
  )
}

/**
 * Strict track title matching for album resolution.
 * Prevents 1-word titles ("Anh", "Love") from matching longer unrelated titles ("Lover", "Love Story").
 */
export function isAlbumTrackTitleMatch(
  candidateTitle?: string | null,
  targetTitle?: string | null,
): boolean {
  if (!targetTitle?.trim()) return true
  if (!candidateTitle?.trim()) return false
  if (hasIncompatiblePlaybackVariant(candidateTitle, targetTitle)) return false
  return hasCatalogTitleEvidence(candidateTitle, targetTitle)
}

/**
 * Compare candidate album name against expected album name.
 * Matches exact normalized names or base album names after stripping edition suffixes,
 * without allowing arbitrary prefix false positives ("Love" != "Love Story").
 */
export function isAlbumNameMatch(
  candidateAlbum?: string | null,
  targetAlbum?: string | null,
): boolean {
  const candNorm = normalizeAlbumText(candidateAlbum)
  const targNorm = normalizeAlbumText(targetAlbum)
  if (!candNorm || !targNorm) return false

  if (candNorm === targNorm) return true

  const candBase = stripAlbumEditionSuffix(candidateAlbum)
  const targBase = stripAlbumEditionSuffix(targetAlbum)
  if (candBase && targBase && candBase === targBase) return true

  return false
}

/**
 * Check if an album is likely a 1-track single named after the track itself.
 */
export function isLikelySingleAlbum(
  albumTitle?: string | null,
  trackTitle?: string | null,
  totalTracks?: number | null,
  albumType?: string | null,
): boolean {
  if (albumType && albumType.toLowerCase() === 'single') return true
  if (typeof totalTracks === 'number' && totalTracks > 0 && totalTracks <= 1) return true
  if (!albumTitle) return true
  if (/\s-\s*single\s*$/i.test(albumTitle.trim())) return true

  if (trackTitle) {
    const albNorm = stripAlbumEditionSuffix(albumTitle) || normalizeAlbumText(albumTitle)
    const trkNorm = stripAlbumEditionSuffix(trackTitle) || normalizeAlbumText(trackTitle)
    if (albNorm && trkNorm && albNorm === trkNorm) {
      // If we know for sure it's a multi-track studio album (e.g. "Lover" with 18 tracks), it's NOT a single
      if (typeof totalTracks === 'number' && totalTracks > 3 && albumType?.toLowerCase() === 'album') {
        return false
      }
      return true
    }
  }

  return false
}

/**
 * Detect generic compilation / various artists / greatest hits albums so original studio albums win.
 */
export function isCompilationOrSpamAlbum(
  albumTitle?: string | null,
  artistName?: string | null,
  albumType?: string | null,
): boolean {
  if (albumType?.toLowerCase() === 'compilation') return true
  const artistNorm = normalizeIdentity(artistName)
  if (artistNorm === 'various artists' || artistNorm === 'various') return true

  const albNorm = normalizeIdentity(albumTitle)
  if (!albNorm) return true

  return COMPILATION_ALBUM_KEYWORDS.some((kw) => containsPhrase(albNorm, normalizeIdentity(kw)))
}

export interface AlbumTrackCandidate {
  trackTitle: string
  artistName: string
  albumId: string
  albumTitle: string
  coverUrl?: string | null
  totalTracks?: number | null
  albumType?: string | null
}

/**
 * Select the best album from track search candidates.
 * Prioritizes:
 * 1. Exact match with targetAlbum (if provided and real)
 * 2. Non-single, non-compilation studio album by the artist
 * 3. Multi-track EP / compilation
 * 4. Single release (as last resort)
 */
export function selectBestAlbumTrackCandidate<T extends AlbumTrackCandidate>(
  candidates: readonly T[],
  target: {
    title: string
    artist: string
    album?: string | null
  },
): T | null {
  const realTargetAlbum =
    target.album && isRealAlbumName(target.album, target.title) ? target.album : ''
  const targetTitleNorm = normalizeAlbumText(target.title)

  let best: T | null = null
  let bestScore = -Infinity

  for (const cand of candidates) {
    if (!cand.albumId || isKnownBadFallback(cand.albumId)) continue
    if (!cand.albumTitle || !isRealAlbumName(cand.albumTitle)) continue
    if (!isAlbumArtistMatch(cand.artistName, target.artist)) continue
    if (!isAlbumTrackTitleMatch(cand.trackTitle, target.title)) continue

    let score = 0
    const candTitleNorm = normalizeAlbumText(cand.trackTitle)
    if (candTitleNorm === targetTitleNorm) {
      score += 30
    }

    if (realTargetAlbum && isAlbumNameMatch(cand.albumTitle, realTargetAlbum)) {
      score += 100
    }

    const isSingle = isLikelySingleAlbum(
      cand.albumTitle,
      cand.trackTitle,
      cand.totalTracks,
      cand.albumType,
    )
    const isComp = isCompilationOrSpamAlbum(cand.albumTitle, cand.artistName, cand.albumType)

    if (!isSingle && !isComp) {
      score += 50
    } else if (!isSingle && isComp) {
      score += 15
    } else if (isSingle) {
      score -= 20
    }

    if (typeof cand.totalTracks === 'number' && cand.totalTracks > 1) {
      score += Math.min(cand.totalTracks, 20)
    }

    if (score > bestScore) {
      bestScore = score
      best = cand
    }
  }

  return best
}
