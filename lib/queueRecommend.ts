import { QueueTrack, NextQueueResponse } from '@/types/queue'
import { getDeezerArtistRadio, getDeezerRelatedArtistsTopTracks, getDeezerArtistTopTracks } from './deezer'
import { searchSpotifyTracks } from './spotify'
import { removeDiacritics } from './smartRecommend'
import { createClient } from './supabase/server'
import { isOriginalTrackOnly } from './youtube'

/**
 * Normalize title or artist string for deduplication comparison
 */
export function normalizeString(str: string): string {
  if (!str) return ''
  return removeDiacritics(str)
    .replace(/[\(\[\{].*?[\)\]\}]/g, '') // remove bracketed text like (Official Video), [Remix]
    .replace(/\b(remix|reverb|slowed|speed up|sped up|lofi|lo-fi|lyrics?|lyric video|official video|official music video|official audio|official mv|mv|audio|full video|video|1\s*hour|1hour|30\s*min|loop|podcast|compilation|playlist|hot tiktok|tiktok|chu\u1ea9n hot|hay nhat|mashup|prod|beat)\b/gi, ' ')
    .replace(/[^a-z0-9]/g, '')           // keep only alphanumeric
    .trim()
}

/**
 * Generate dedup key: ISRC if available, else normalized title + artist
 */
export function getDedupKey(track: QueueTrack): string {
  if (track.isrc && track.isrc.trim()) {
    return `isrc:${track.isrc.trim().toUpperCase()}`
  }
  const normTitle = normalizeString(track.title)
  const normArtist = normalizeString(track.artist)
  return `meta:${normTitle}|${normArtist}`
}

/**
 * Fetch Internal Collaborative Candidates from Supabase
 * Users who listened to seedTrack also listened to...
 */
export async function getInternalCollaborativeCandidates(
  seedTrackId: string,
  seedArtist: string,
  userId?: string
): Promise<QueueTrack[]> {
  try {
    const supabase = await createClient()

    // 1. Try RPC fn_get_collaborative_candidates
    const { data, error } = await supabase.rpc('fn_get_collaborative_candidates', {
      p_track_id: seedTrackId,
      p_user_id: userId || null,
      p_limit: 15,
    })

    if (!error && data && data.length > 0) {
      return data.map((item: any, idx: number) => ({
        id: item.track_id,
        title: item.artist ? `${item.artist} Track` : 'Recommended Track',
        artist: item.artist || seedArtist,
        cover_url: null,
        duration: 210,
        source: 'internal_history',
        source_id: item.track_id,
        score: 1.2, // High priority for internal personalized CF
        score_reasons: ['internal_collaborative_filtering'],
      }))
    }

    // 2. Fallback query: top played tracks by current user or recent global events
    if (userId) {
      const { data: userEvents } = await supabase
        .from('listen_events')
        .select('track_id, artist')
        .eq('user_id', userId)
        .eq('completed', true)
        .order('played_at', { ascending: false })
        .limit(20)

      if (userEvents && userEvents.length > 0) {
        const uniqueTrackIds = Array.from(new Set(userEvents.map((e) => e.track_id))).filter(
          (id) => id !== seedTrackId
        )

        return uniqueTrackIds.slice(0, 10).map((tId) => ({
          id: tId,
          title: 'Bài hát gần đây',
          artist: seedArtist,
          cover_url: null,
          duration: 200,
          source: 'internal_history',
          source_id: tId,
          score: 1.1,
          score_reasons: ['internal_user_recent_history'],
        }))
      }
    }
  } catch (err) {
    console.warn('getInternalCollaborativeCandidates error:', err)
  }
  return []
}

/**
 * Get list of track IDs user frequently skips (< 15s) in last 30 days
 */
export async function getFrequentlySkippedTrackIds(userId?: string): Promise<Set<string>> {
  const skippedSet = new Set<string>()
  if (!userId) return skippedSet

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('fn_get_frequently_skipped_tracks', {
      p_user_id: userId,
      p_days: 30,
    })

    if (!error && data) {
      for (const item of data) {
        if (item.track_id) skippedSet.add(item.track_id)
      }
    } else {
      // Fallback query
      const { data: rawEvents } = await supabase
        .from('listen_events')
        .select('track_id, skip_at_seconds')
        .eq('user_id', userId)
        .eq('completed', false)
        .gte('played_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
        .limit(100)

      if (rawEvents) {
        const countMap: Record<string, number> = {}
        for (const ev of rawEvents) {
          if (!ev.skip_at_seconds || ev.skip_at_seconds < 15) {
            countMap[ev.track_id] = (countMap[ev.track_id] || 0) + 1
            if (countMap[ev.track_id] >= 2) {
              skippedSet.add(ev.track_id)
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('getFrequentlySkippedTrackIds error:', err)
  }
  return skippedSet
}

/**
 * Spotify Search Fallback Generator
 */
async function maybeSpotifySearchFallback(seedTrack: QueueTrack, limit = 10): Promise<QueueTrack[]> {
  try {
    const query = seedTrack.artist && seedTrack.artist !== 'Nghệ sĩ chưa xác định'
      ? `artist:"${seedTrack.artist}"`
      : seedTrack.title

    const tracks = await searchSpotifyTracks(query, limit)
    return tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist || seedTrack.artist,
      album: t.album || undefined,
      cover_url: t.cover_url,
      duration: t.duration,
      source: 'spotify',
      source_id: t.spotify_id || t.id.replace('spotify-', ''),
      preview_url: t.audio_url,
      score: 0.6, // Fallback priority
      score_reasons: ['spotify_search_fallback'],
    }))
  } catch (err) {
    console.warn('Spotify fallback search error:', err)
  }
  return []
}

/**
 * Deduplicate candidates by ISRC or Title + Artist
 */
export function dedupCandidates(candidates: QueueTrack[]): QueueTrack[] {
  const seenKeys = new Set<string>()
  const result: QueueTrack[] = []

  for (const track of candidates) {
    const key = getDedupKey(track)
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      result.push(track)
    } else {
      // Merge score reasons if duplicate found from a higher quality source
      const existingIndex = result.findIndex((t) => getDedupKey(t) === key)
      if (existingIndex !== -1) {
        const existing = result[existingIndex]
        if (!existing.isrc && track.isrc) {
          existing.isrc = track.isrc
        }
        if (!existing.preview_url && track.preview_url) {
          existing.preview_url = track.preview_url
        }
        for (const reason of track.score_reasons) {
          if (!existing.score_reasons.includes(reason)) {
            existing.score_reasons.push(reason)
          }
        }
      }
    }
  }
  return result
}

/**
 * Enforce Diversity Constraint: Max N tracks per artist in batch
 */
export function diversify(candidates: QueueTrack[], options: { maxPerArtist: number }): QueueTrack[] {
  const artistCount: Record<string, number> = {}
  const result: QueueTrack[] = []

  for (const track of candidates) {
    const normArtist = normalizeString(track.artist) || 'unknown'
    const count = artistCount[normArtist] || 0

    if (count < options.maxPerArtist) {
      artistCount[normArtist] = count + 1
      result.push(track)
    }
  }
  return result
}

/**
 * Inject Exploration Slots (20-30% discovery songs interleave)
 */
export function injectExplorationSlots(ranked: QueueTrack[], options = { exploreRatio: 0.2 }): QueueTrack[] {
  if (ranked.length <= 4) return ranked

  const topPoolSize = Math.floor(ranked.length * (1 - options.exploreRatio))
  const familiar = ranked.slice(0, topPoolSize)
  const exploration = ranked.slice(topPoolSize)

  if (exploration.length === 0) return ranked

  const result: QueueTrack[] = []
  let expIdx = 0

  for (let i = 0; i < familiar.length; i++) {
    result.push(familiar[i])

    // Every 4th position, inject an exploration track if available
    if ((i + 1) % 4 === 0 && expIdx < exploration.length) {
      const expTrack = { ...exploration[expIdx] }
      expTrack.score_reasons = [...expTrack.score_reasons, 'exploration_slot_injection']
      result.push(expTrack)
      expIdx++
    }
  }

  // Append remaining exploration tracks
  while (expIdx < exploration.length) {
    result.push(exploration[expIdx])
    expIdx++
  }

  return result
}

/**
 * 🚀 Main Auto-Queue Builder Algorithm
 * Combines Deezer Radio, Deezer Related Artists, Internal CF & Spotify Fallback
 */
export async function buildNextQueue(
  seedTrack: QueueTrack,
  sessionHistory: QueueTrack[] = [],
  userId?: string,
  limit = 12
): Promise<NextQueueResponse> {
  const sourcesUsed: string[] = []
  const sourcesFailed: string[] = []

  // 1. Parallel candidate generation
  const [deezerRadioRes, deezerRelatedRes, internalCFRes] = await Promise.allSettled([
    getDeezerArtistRadio(seedTrack.artist, 30),
    getDeezerRelatedArtistsTopTracks(seedTrack.artist, 30),
    getInternalCollaborativeCandidates(seedTrack.id, seedTrack.artist, userId),
  ])

  let deezerRadioTracks: QueueTrack[] = []
  if (deezerRadioRes.status === 'fulfilled' && deezerRadioRes.value.length > 0) {
    deezerRadioTracks = deezerRadioRes.value
    sourcesUsed.push('deezer_radio')
  } else {
    sourcesFailed.push('deezer_radio')
  }

  let deezerRelatedTracks: QueueTrack[] = []
  if (deezerRelatedRes.status === 'fulfilled' && deezerRelatedRes.value.length > 0) {
    deezerRelatedTracks = deezerRelatedRes.value
    sourcesUsed.push('deezer_related')
  } else {
    sourcesFailed.push('deezer_related')
  }

  let internalCFTracks: QueueTrack[] = []
  if (internalCFRes.status === 'fulfilled' && internalCFRes.value.length > 0) {
    internalCFTracks = internalCFRes.value
    sourcesUsed.push('internal_cf')
  } else {
    sourcesFailed.push('internal_cf')
  }

  // Fallback to Deezer Artist Top Tracks if radio returned nothing
  if (deezerRadioTracks.length === 0) {
    const topTracks = await getDeezerArtistTopTracks(seedTrack.artist, 15)
    if (topTracks.length > 0) {
      deezerRadioTracks = topTracks
      sourcesUsed.push('deezer_top_fallback')
    }
  }

  // Fallback to Spotify Search if total candidates < 5
  let spotifyFallbackTracks: QueueTrack[] = []
  const totalCandidatesSoFar = deezerRadioTracks.length + deezerRelatedTracks.length + internalCFTracks.length
  if (totalCandidatesSoFar < 5) {
    spotifyFallbackTracks = await maybeSpotifySearchFallback(seedTrack, 15)
    if (spotifyFallbackTracks.length > 0) {
      sourcesUsed.push('spotify_fallback')
    } else {
      sourcesFailed.push('spotify_fallback')
    }
  }

  let candidates: QueueTrack[] = [
    ...internalCFTracks,
    ...deezerRadioTracks,
    ...deezerRelatedTracks,
    ...spotifyFallbackTracks,
  ]

  // 2. Deduplication (ISRC primary, title+artist secondary)
  candidates = dedupCandidates(candidates)

  // 3. Filter out seedTrack & recent session history
  const seedNormTitle = normalizeString(seedTrack.title)
  const sessionDedupKeys = new Set<string>()
  sessionDedupKeys.add(getDedupKey(seedTrack))
  for (const track of sessionHistory) {
    sessionDedupKeys.add(getDedupKey(track))
  }

  candidates = candidates.filter((c) => {
    if (!isOriginalTrackOnly(c.title)) return false
    if (sessionDedupKeys.has(getDedupKey(c))) return false
    const candidateNormTitle = normalizeString(c.title)
    if (seedNormTitle && candidateNormTitle && seedNormTitle.length > 2) {
      if (candidateNormTitle.includes(seedNormTitle) || seedNormTitle.includes(candidateNormTitle)) {
        return false
      }
    }
    return true
  })

  // 4. Filter out user's frequently skipped tracks
  const skippedSet = await getFrequentlySkippedTrackIds(userId)
  if (skippedSet.size > 0) {
    candidates = candidates.filter((c) => !skippedSet.has(c.id) && !skippedSet.has(c.source_id))
  }

  // 5. Multi-factor Scoring
  const normSeedArtist = normalizeString(seedTrack.artist)

  for (const c of candidates) {
    // Base weight by source
    let score = c.score || 1.0
    if (c.source === 'internal_history') score += 0.2
    if (c.source === 'deezer') score += 0.1
    if (c.source === 'spotify') score += 0.05

    // Same Artist bonus (+0.3)
    const normCandidateArtist = normalizeString(c.artist)
    if (normCandidateArtist && normCandidateArtist === normSeedArtist) {
      score += 0.3
      c.score_reasons.push('same_artist_bonus')
    }

    c.score = parseFloat(score.toFixed(3))
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score)

  // 6. Diversity constraint: Max 2 tracks per artist in batch
  let ranked = diversify(candidates, { maxPerArtist: 2 })

  // 7. Inject Exploration Slots (20% ratio)
  ranked = injectExplorationSlots(ranked, { exploreRatio: 0.2 })

  const finalBatch = ranked.slice(0, limit)

  return {
    tracks: finalBatch,
    generated_at: new Date().toISOString(),
    sources_used: sourcesUsed,
    sources_failed: sourcesFailed,
  }
}
