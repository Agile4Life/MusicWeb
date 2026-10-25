import type { Track } from '@/types'
import {
  containsPhrase,
  extractArtistAliases,
  hasIncompatiblePlaybackVariant,
  measureIdentityTokenOverlap,
  normalizeIdentity,
  stripArtistFromCandidateTitle,
  stripNonIdentityAnnotations,
} from './catalogMatching'
import { deduplicateQueueTracks, extractCoreSongTitle } from './utils'
import type { GlobalSearchTracks } from './searchApi'

export function mergePrimarySearchResults(
  nhaccuatuiTracks: Track[],
  fallbackResults: GlobalSearchTracks,
): GlobalSearchTracks {
  return {
    ...fallbackResults,
    nhaccuatui: nhaccuatuiTracks,
  }
}

/**
 * Combine NhacCuaTui + Spotify + Deezer search results into one global result.
 * Duplicate tracks (same normalized title + artist) are kept only once —
 * deduplicateQueueTracks prefers NhacCuaTui, then local, then other sources.
 */
export function combineCombinedSearchResults(
  nhaccuatuiTracks: Track[],
  spotifyTracks: Track[],
  deezerTracks: Track[],
  soundCloudTracks: Track[] = [],
): GlobalSearchTracks {
  const combined = [nhaccuatuiTracks, spotifyTracks, deezerTracks, soundCloudTracks]
  const deduped = deduplicateQueueTracks([...nhaccuatuiTracks, ...spotifyTracks, ...deezerTracks, ...soundCloudTracks])
  const idSets = combined.map((list) => new Set(list.map((t) => t.id)))

  return {
    nhaccuatui: deduped.filter((t) => idSets[0].has(t.id)),
    spotify: deduped.filter((t) => idSets[1].has(t.id)),
    deezer: deduped.filter((t) => idSets[2].has(t.id)),
    soundcloud: deduped.filter((t) => idSets[3].has(t.id)),
    local: [],
    youtube: [],
  }
}

function getSourceBaseScore(track: Track): number {
  if (track.id?.startsWith('deezer-')) return 18
  switch (track.source) {
    case 'local':
      return 28
    case 'nhaccuatui':
      return 26
    case 'spotify':
      return 22
    case 'deezer':
      return 18
    case 'soundcloud':
      return 14
    case 'youtube':
      return 12
    default:
      return 10
  }
}

/**
 * Compute relevance score of a track against a user's search query.
 * Rewards exact/core title matches, artist matches, combined title+artist queries,
 * Vietnamese diacritic fidelity, and original studio tracks over unrequested remixes/covers.
 */
export function scoreTrackSearchRelevance(track: Track, rawQuery: string): number {
  const normQuery = normalizeIdentity(rawQuery)
  if (!normQuery) return getSourceBaseScore(track)

  const rawTitle = track.title || ''
  const rawArtist = track.artist || ''
  const cleanTitle = stripNonIdentityAnnotations(rawTitle) || normalizeIdentity(rawTitle)
  const bareTitle = extractCoreSongTitle(rawTitle)
  const normTitle = normalizeIdentity(rawTitle)
  const normArtist = normalizeIdentity(rawArtist)
  const coreTitle = stripArtistFromCandidateTitle(cleanTitle, normQuery, undefined, rawArtist)
  const artistAliases = extractArtistAliases(rawArtist)
  const combined = `${cleanTitle} ${normArtist} ${artistAliases.join(' ')}`.trim()
  const hasUnrequestedVariant =
    hasIncompatiblePlaybackVariant(rawTitle, rawQuery) ||
    hasIncompatiblePlaybackVariant(`${rawTitle} ${rawArtist}`, rawQuery)

  const queryTokens = normQuery.split(' ').filter(Boolean)
  const titleTokens = coreTitle.split(' ').filter(Boolean)
  const artistTokens = normArtist.split(' ').filter(Boolean)
  const allTrackTokens = combined.split(' ').filter(Boolean)

  let score = getSourceBaseScore(track)

  const isSingularPluralTitleMatch =
    normQuery.length >= 4 &&
    (coreTitle === `${normQuery}s` ||
      cleanTitle === `${normQuery}s` ||
      bareTitle === `${normQuery}s` ||
      normQuery === `${coreTitle}s` ||
      normQuery === `${cleanTitle}s`)

  // 1. Exact & phrase title / artist matches
  if (coreTitle === normQuery || cleanTitle === normQuery || normTitle === normQuery) {
    score += 130
  } else if (isSingularPluralTitleMatch) {
    score += 122
  } else if (!hasUnrequestedVariant && bareTitle === normQuery) {
    score += 118
  } else if (
    coreTitle.startsWith(`${normQuery} `) ||
    cleanTitle.startsWith(`${normQuery} `)
  ) {
    score += 80
  } else if (containsPhrase(coreTitle, normQuery) || containsPhrase(cleanTitle, normQuery)) {
    score += 65
  }

  if (normArtist === normQuery || artistAliases.includes(normQuery)) {
    score += 95
  } else if (
    containsPhrase(normArtist, normQuery) ||
    artistAliases.some((a) => containsPhrase(a, normQuery))
  ) {
    score += 55
  }

  // 2. Combined title + artist query (e.g. "bình yên vũ" or "sơn tùng lạc trôi")
  const queryCoverageInCombined = measureIdentityTokenOverlap(normQuery, combined)
  const queryCoverageInTitle = measureIdentityTokenOverlap(normQuery, coreTitle)
  const queryCoverageInArtist = measureIdentityTokenOverlap(normQuery, `${normArtist} ${artistAliases.join(' ')}`)

  if (queryCoverageInCombined === 1) {
    score += 65
    if (queryCoverageInTitle > 0 && queryCoverageInTitle < 1 && queryCoverageInArtist > 0) {
      // User typed both song title and artist name (tokens beyond the title match the artist)!
      const titleReverse = measureIdentityTokenOverlap(coreTitle, normQuery)
      score += 55 + titleReverse * 35
    }
  } else if (queryCoverageInCombined > 0) {
    score += queryCoverageInCombined * 45
  } else {
    // Check prefix match for partial typing in search bar suggestions
    let prefixMatched = 0
    for (const qToken of queryTokens) {
      if (allTrackTokens.some((tToken) => tToken.startsWith(qToken))) {
        prefixMatched++
      }
    }
    const prefixRatio = queryTokens.length > 0 ? prefixMatched / queryTokens.length : 0
    if (prefixRatio > 0) {
      score += prefixRatio * 35
    } else {
      score -= 150
    }
  }

  // 3. Precision bonus: prefer titles without excessive extra unrelated words
  if (queryCoverageInTitle >= 0.75 && titleTokens.length > 0) {
    const reverseTitleCoverage = measureIdentityTokenOverlap(coreTitle, normQuery)
    score += reverseTitleCoverage * 25
  } else if (artistTokens.length === 0 && queryCoverageInTitle === 0) {
    score -= 40
  }

  // 4. Penalize unrequested playback variants (Remix, Cover, Karaoke, Slowed, Live, Guitar, Edit)
  if (hasUnrequestedVariant) {
    score -= 45
  }

  // 5. Vietnamese diacritic exact match tie-breaker
  const nfcQuery = rawQuery.trim().toLowerCase().normalize('NFC')
  const nfcTitle = rawTitle.trim().toLowerCase().normalize('NFC')
  const nfcArtist = rawArtist.trim().toLowerCase().normalize('NFC')
  if (nfcQuery && (nfcTitle === nfcQuery || nfcTitle.includes(nfcQuery) || nfcArtist.includes(nfcQuery))) {
    score += 12
  }

  // 6. Metadata completeness bonus
  if (track.cover_url) score += 3
  if (track.duration && track.duration >= 60 && track.duration <= 600) score += 3

  return score
}

export function rankSearchTracks(tracks: Track[], query?: string): Track[] {
  const trimmed = query?.trim()
  if (!trimmed || tracks.length <= 1) return tracks
  return tracks
    .map((track, index) => ({
      track,
      index,
      score: scoreTrackSearchRelevance(track, trimmed),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.index - b.index
    })
    .map((entry) => entry.track)
}

export function flattenUnifiedSearchResults(results: GlobalSearchTracks, query?: string): Track[] {
  const deduped = deduplicateQueueTracks([
    ...(results.nhaccuatui || []),
    ...(results.local || []),
    ...(results.spotify || []),
    ...(results.youtube || []),
    ...(results.deezer || []),
    ...(results.soundcloud || []),
  ])
  return rankSearchTracks(deduped, query)
}

