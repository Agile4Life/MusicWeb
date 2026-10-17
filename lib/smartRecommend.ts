import { Track } from '@/types'
import { searchYouTubeTracks, NEGATIVE_KEYWORDS, normalizeTitle } from './youtube'
import { searchNhacCuaTuiDirect } from './nhaccuatui'
import { searchSoundCloudTracks } from './soundcloudClient'
import { deduplicateQueueTracks } from './utils'
import {
  classifyTrack,
  getStyleCompatibilityScore,
  isTrackStyleCompatible,
  removeDiacritics,
  type TrackGenre,
  type TrackRegion,
} from './trackClassifier'

export { removeDiacritics }

export interface TrackMetadataAnalysis {
  region: TrackRegion
  genre: TrackGenre | 'general'
  queryTerms: string[]
  relatedArtists?: string[]
}

/**
 * 🧠 Detect Region (Country/Language) and Genre of a Track
 */
export function analyzeTrackMetadata(track: Partial<Track> & { title?: string; artist?: string | null }): TrackMetadataAnalysis {
  const profile = classifyTrack(track)
  return {
    region: profile.region,
    genre: profile.genre,
    queryTerms: profile.queryTerms,
    relatedArtists: profile.relatedArtists,
  }
}

/**
 * 🚀 Fetch Smart Recommended Related Tracks matching region & genre
 * 🌟 Prioritizes NhacCuaTui & SoundCloud native tracks that pass strict Region & Genre compatibility,
 * with YouTube as secondary fallback.
 */
export async function getSmartRecommendedTracks(
  seedTrack: Track,
  existingQueue: Track[] = [],
  limit = 10
): Promise<Track[]> {
  if (!seedTrack) return []

  const seedProfile = classifyTrack(seedTrack)
  const existingIds = new Set(existingQueue.map((t) => t.id))
  existingIds.add(seedTrack.id)

  const cleanArtist =
    seedProfile.artistCanonical &&
    seedProfile.artistCanonical !== 'Nghệ sĩ chưa xác định' &&
    seedProfile.artistCanonical !== 'Chưa rõ nghệ sĩ'
      ? seedProfile.artistCanonical
      : ''

  const primaryQuery = cleanArtist || seedTrack.title
  const relatedQueries = seedProfile.relatedArtists.slice(0, 2)
  const topicQuery = seedProfile.queryTerms[seedProfile.queryTerms.length - 2] || seedProfile.queryTerms[0] || primaryQuery

  const scoredCandidates: { track: Track; score: number }[] = []

  try {
    // 1. Fetch NhacCuaTui (only for VN/Global) & SoundCloud candidates for seed + related artists + genre topic
    const shouldQueryNct = seedProfile.region === 'vn' || seedProfile.region === 'global'
    const nctQueries = shouldQueryNct
      ? [primaryQuery, ...relatedQueries.slice(0, 1), topicQuery].filter(Boolean)
      : []
    const scQueries = [primaryQuery, ...relatedQueries.slice(0, 1), topicQuery].filter(Boolean)

    const [nctSettled, scSettled] = await Promise.all([
      Promise.allSettled(nctQueries.map((q) => searchNhacCuaTuiDirect(q, 10))),
      Promise.allSettled(scQueries.map((q) => searchSoundCloudTracks(q, 10))),
    ])

    const rawCandidates: Track[] = []
    for (const res of nctSettled) {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        rawCandidates.push(...res.value)
      }
    }
    for (const res of scSettled) {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        rawCandidates.push(...res.value)
      }
    }

    for (const tr of rawCandidates) {
      if (!tr || existingIds.has(tr.id)) continue
      if (!isTrackStyleCompatible(seedProfile, tr)) continue
      const compat = getStyleCompatibilityScore(seedProfile, tr)
      existingIds.add(tr.id)
      scoredCandidates.push({
        track: tr,
        score: compat + (tr.source === 'nhaccuatui' ? 0.15 : 0.12),
      })
    }

    // 2. If we still need more tracks to reach the limit, fetch YouTube candidates as fallback
    if (scoredCandidates.length < limit) {
      const ytTasks = seedProfile.queryTerms.map((query) =>
        searchYouTubeTracks(query, 8)
          .then((results) =>
            results.filter((tr) => {
              const normTitle = normalizeTitle(tr.title || '')
              return !NEGATIVE_KEYWORDS.some((kw) => normTitle.includes(kw))
            })
          )
          .catch(() => [])
      )

      const ytResultsArray = await Promise.all(ytTasks)
      for (const ytResults of ytResultsArray) {
        for (const tr of ytResults) {
          if (!tr || existingIds.has(tr.id)) continue
          if (!isTrackStyleCompatible(seedProfile, tr, { allowLowConfidenceRegion: true })) continue
          const compat = getStyleCompatibilityScore(seedProfile, tr, { allowLowConfidenceRegion: true })
          existingIds.add(tr.id)
          scoredCandidates.push({ track: tr, score: compat })
        }
      }
    }
  } catch (err) {
    console.warn('getSmartRecommendedTracks warning:', err)
  }

  scoredCandidates.sort((a, b) => b.score - a.score)
  const deduplicated = deduplicateQueueTracks(scoredCandidates.map((item) => item.track))
  return deduplicated.slice(0, limit)
}
