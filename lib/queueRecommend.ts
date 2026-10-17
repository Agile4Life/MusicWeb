import { QueueTrack, NextQueueResponse } from '@/types/queue'
import { getDeezerArtistRadio, getDeezerRelatedArtistsTopTracks, getDeezerArtistTopTracks, searchDeezerTracks } from './deezer'
import { searchSpotifyTracks } from './spotify'
import { searchNhacCuaTuiDirect } from './nhaccuatui'
import { searchSoundCloudTracks } from './soundcloudClient'
import {
  classifyTrack,
  getStyleCompatibilityScore,
  isTrackStyleCompatible,
  removeDiacritics,
  type TrackStyleProfile,
} from './trackClassifier'
import { adminClient } from '@/lib/serverUser'
import { isOriginalTrackOnly, GENRE_ALLOWED_KEYWORDS } from './youtube'

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
 * Get all identity variants of a track (id, source_id, prefixed IDs).
 * Only generates cross-source prefix variants for the track's own source to
 * prevent false skip-collisions between sources that share numeric IDs
 * (e.g. SoundCloud id "4521" ≠ Deezer id "4521").
 */
export function getTrackIdentityVariants(track: Partial<QueueTrack>): string[] {
  const variants = new Set<string>()
  if (track.id) variants.add(track.id)

  if (track.source_id) {
    switch (track.source) {
      case 'spotify':
        variants.add(`spotify-${track.source_id}`)
        break
      case 'deezer':
        variants.add(`deezer-${track.source_id}`)
        break
      case 'nhaccuatui':
        variants.add(`nct-${track.source_id}`)
        break
      case 'soundcloud':
        variants.add(`sc-${track.source_id}`)
        break
      case 'internal_history':
        variants.add(track.source_id)
        break
    }
  }
  return Array.from(variants)
}

/**
 * Fetch Internal Collaborative Candidates from Supabase
 * Filtered by Region & Genre compatibility with seedTrack so old unrelated history never pollutes the queue.
 */
export async function getInternalCollaborativeCandidates(
  seedTrackId: string,
  seedArtist: string,
  userId?: string,
  seedTitle?: string
): Promise<{ tracks: QueueTrack[]; preferredArtists: Set<string> }> {
  const preferredArtists = new Set<string>()
  try {
    const seedProfile = classifyTrack({
      id: seedTrackId,
      title: seedTitle || '',
      artist: seedArtist,
    })
    const supabase = adminClient
    const { data, error } = await supabase.rpc('fn_get_collaborative_candidates', {
      p_track_id: seedTrackId,
      p_user_id: userId || null,
      p_limit: 20,
    })
    let candidateRows: { track_id: string; play_count?: number }[] = []
    if (!error && data && data.length > 0) {
      candidateRows = data
        .filter((item: any) => item.track_id)
        .map((item: any) => ({ track_id: item.track_id, play_count: item.play_count || 1 }))
    }

    if (userId) {
      const { data: userEvents } = await supabase
        .from('listen_events')
        .select('track_id, artist')
        .eq('user_id', userId)
        .eq('completed', true)
        .order('played_at', { ascending: false })
        .limit(40)
      if (userEvents && userEvents.length > 0) {
        const seen = new Set<string>(candidateRows.map((r) => r.track_id))
        for (const e of userEvents) {
          if (e.artist) {
            const artistProf = classifyTrack({ title: '', artist: e.artist })
            if (isTrackStyleCompatible(seedProfile, artistProf)) {
              const normA = normalizeString(e.artist)
              if (normA) preferredArtists.add(normA)
            }
          }
          if (e.track_id && e.track_id !== seedTrackId && !seen.has(e.track_id)) {
            seen.add(e.track_id)
            candidateRows.push({ track_id: e.track_id, play_count: 1 })
          }
        }
      }
    }

    if (candidateRows.length === 0) {
      return { tracks: [], preferredArtists }
    }

    const candidateTrackIds = candidateRows.map((r) => r.track_id)
    const { data: dbTracks } = await supabase
      .from('tracks')
      .select('id, title, artist, album, genre, cover_url, duration, spotify_id')
      .in('id', candidateTrackIds)
    const metaMap = new Map<string, any>()
    if (dbTracks) {
      for (const t of dbTracks) metaMap.set(t.id, t)
    }

    const maxCount = Math.max(...candidateRows.map((r) => r.play_count || 1), 1)
    const filteredTracks: QueueTrack[] = []

    for (const { track_id: tId, play_count } of candidateRows) {
      const realMeta = metaMap.get(tId)
      if (!realMeta || !realMeta.title) continue
      const knownArtist = realMeta.artist || undefined
      if (!knownArtist || knownArtist === 'Nghệ sĩ chưa xác định') continue

      // Strictly check Region & Genre compatibility before admitting historical track
      if (!isTrackStyleCompatible(seedProfile, realMeta)) {
        continue
      }

      const normA = normalizeString(knownArtist)
      if (normA) preferredArtists.add(normA)

      filteredTracks.push({
        id: tId,
        title: realMeta.title,
        artist: knownArtist,
        album: realMeta.album || undefined,
        cover_url: realMeta.cover_url || null,
        duration: realMeta.duration || 200,
        source: 'internal_history' as const,
        source_id: realMeta.spotify_id || tId,
        score: 1.0 + 0.3 * ((play_count || 1) / maxCount),
        score_reasons: ['internal_collaborative_filtering'],
      })

      if (filteredTracks.length >= 10) break
    }

    return { tracks: filteredTracks, preferredArtists }
  } catch (err) {
    console.warn('getInternalCollaborativeCandidates error:', err)
  }
  return { tracks: [], preferredArtists }
}

/**
 * Get list of track IDs user frequently skips (< 15s) in last 30 days
 */
export async function getFrequentlySkippedTrackIds(userId?: string): Promise<Set<string>> {
  const skippedSet = new Set<string>()
  if (!userId) return skippedSet

  try {
    const supabase = adminClient
    const { data, error } = await supabase.rpc('fn_get_frequently_skipped_tracks', {
      p_user_id: userId,
      p_days: 30,
    })

    if (!error && data) {
      for (const item of data) {
        if (item.track_id) skippedSet.add(item.track_id)
      }
    } else {
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
 * Spotify Search Fallback Generator (queries both artist and genre/region query terms)
 */
async function maybeSpotifySearchFallback(
  seedTrack: QueueTrack,
  seedProfile: TrackStyleProfile,
  limit = 10
): Promise<QueueTrack[]> {
  try {
    const queries: string[] = []
    if (seedTrack.artist && seedTrack.artist !== 'Nghệ sĩ chưa xác định') {
      queries.push(`artist:"${seedTrack.artist}"`)
    }
    if (seedProfile.relatedArtists.length > 0) {
      queries.push(seedProfile.relatedArtists[0])
    }
    if (seedProfile.queryTerms.length > 0) {
      queries.push(seedProfile.queryTerms[seedProfile.queryTerms.length - 2] || seedProfile.queryTerms[0])
    }

    const settled = await Promise.allSettled(
      queries.slice(0, 2).map((q) => searchSpotifyTracks(q, limit))
    )
    const tracks = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    return tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist || seedTrack.artist,
      album: t.album || undefined,
      cover_url: t.cover_url,
      duration: t.duration,
      source: 'spotify' as const,
      source_id: t.spotify_id || t.id.replace('spotify-', ''),
      preview_url: t.audio_url,
      score: 1.0,
      score_reasons: ['spotify_search_fallback'],
    }))
  } catch (err) {
    console.warn('Spotify fallback search error:', err)
  }
  return []
}

/**
 * Deduplicate candidates by ISRC or Title + Artist.
 */
export function dedupCandidates(candidates: QueueTrack[]): QueueTrack[] {
  const keyMap = new Map<string, QueueTrack>()
  const result: QueueTrack[] = []

  for (const track of candidates) {
    const key = getDedupKey(track)
    const existing = keyMap.get(key)
    if (!existing) {
      keyMap.set(key, {
        ...track,
        score_reasons: [...(track.score_reasons || [])],
      })
      result.push(keyMap.get(key)!)
    } else {
      if (!existing.isrc && track.isrc) {
        existing.isrc = track.isrc
      }
      if (!existing.preview_url && track.preview_url) {
        existing.preview_url = track.preview_url
      }
      for (const reason of track.score_reasons || []) {
        if (!existing.score_reasons.includes(reason)) {
          existing.score_reasons.push(reason)
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

    if ((i + 1) % 4 === 0 && expIdx < exploration.length) {
      const expTrack = { ...exploration[expIdx] }
      expTrack.score_reasons = [...expTrack.score_reasons, 'exploration_slot_injection']
      result.push(expTrack)
      expIdx++
    }
  }

  while (expIdx < exploration.length) {
    result.push(exploration[expIdx])
    expIdx++
  }

  return result
}

export interface FilterAndScoreOptions {
  sessionHistory?: QueueTrack[]
  skippedSet?: Set<string>
  userPreferredArtists?: Set<string>
}

/**
 * 🎯 Strict Region & Genre Gate + Style-First Multi-Factor Scoring
 */
export function filterAndScoreCandidates(
  seedTrack: QueueTrack,
  rawCandidates: QueueTrack[],
  options: FilterAndScoreOptions = {}
): QueueTrack[] {
  const sessionHistory = options.sessionHistory || []
  const skippedSet = options.skippedSet || new Set<string>()
  const userPreferredArtists = options.userPreferredArtists || new Set<string>()

  const candidates = dedupCandidates(rawCandidates)
  const seedProfile = classifyTrack(seedTrack)
  const normSeedArtist = normalizeString(seedTrack.artist)
  const seedNormTitle = normalizeString(seedTrack.title)
  const relatedSeedArtistsNorm = new Set(
    seedProfile.relatedArtists.map((a) => normalizeString(a)).filter(Boolean)
  )

  const sessionDedupKeys = new Set<string>()
  sessionDedupKeys.add(getDedupKey(seedTrack))
  const sessionRawIds = new Set<string>()
  sessionRawIds.add(seedTrack.id)
  for (const track of sessionHistory) {
    if (track.title || track.artist) {
      sessionDedupKeys.add(getDedupKey(track))
    }
    if (track.id) {
      sessionRawIds.add(track.id)
    }
  }

  const filterAllowedKeywords: string[] = GENRE_ALLOWED_KEYWORDS[seedProfile.genre] || []

  const scored: QueueTrack[] = []

  for (const c of candidates) {
    if (!isOriginalTrackOnly(c.title, filterAllowedKeywords)) continue
    if (sessionRawIds.has(c.id)) continue
    if (sessionDedupKeys.has(getDedupKey(c))) continue

    const candidateNormTitle = normalizeString(c.title)
    const candidateNormArtist = normalizeString(c.artist)
    const artistUnknown =
      Boolean((c as any)._artistUnknown) ||
      !candidateNormArtist ||
      c.artist === 'Nghệ sĩ chưa xác định'
    const isSameArtist = !artistUnknown && Boolean(normSeedArtist) && candidateNormArtist === normSeedArtist

    if (isSameArtist && seedNormTitle && candidateNormTitle && seedNormTitle.length > 2) {
      if (candidateNormTitle.includes(seedNormTitle) || seedNormTitle.includes(candidateNormTitle)) {
        continue
      }
    }

    if (skippedSet.size > 0) {
      const variants = getTrackIdentityVariants(c)
      if (variants.some((v) => skippedSet.has(v))) continue
    }

    const candProfile = classifyTrack(c)
    const trustedArtistContext =
      isSameArtist ||
      relatedSeedArtistsNorm.has(candidateNormArtist) ||
      c.score_reasons?.includes('deezer_artist_radio') ||
      c.score_reasons?.includes('deezer_related_artist_top')

    const compat = getStyleCompatibilityScore(seedProfile, candProfile, {
      allowLowConfidenceRegion: Boolean(trustedArtistContext),
    })

    // Strict Gate: reject candidates that fail Region or Genre compatibility
    if (compat < 0.45) {
      continue
    }

    // Style-First Multi-Factor Scoring
    let score = 1.0 + compat * 0.6
    const reasons = [...(c.score_reasons || [])]
    if (!reasons.includes('genre_region_match')) {
      reasons.push('genre_region_match')
    }

    const isRelatedArtist = !isSameArtist && relatedSeedArtistsNorm.has(candidateNormArtist)
    if (isSameArtist) {
      score += 0.3
      if (!reasons.includes('same_artist_bonus')) reasons.push('same_artist_bonus')
    } else if (isRelatedArtist) {
      score += 0.25
      if (!reasons.includes('related_style_artist_bonus')) reasons.push('related_style_artist_bonus')
    }

    const isUserPreferred =
      (!artistUnknown && userPreferredArtists.has(candidateNormArtist)) ||
      c.source === 'internal_history'
    if (isUserPreferred) {
      score += 0.35
      if (!reasons.includes('user_taste_artist_match')) reasons.push('user_taste_artist_match')
    }

    // Moderate source tie-breaker bonus for instant HTML5 streaming
    if (c.source === 'nhaccuatui') score += 0.15
    else if (c.source === 'soundcloud') score += 0.12
    else if (c.source === 'deezer') score += 0.1
    else if (c.source === 'spotify') score += 0.05

    const copy: QueueTrack = {
      ...c,
      score: parseFloat((Number.isFinite(score) ? score : 1.0).toFixed(3)),
      score_reasons: reasons,
    }
    delete (copy as any)._artistUnknown
    scored.push(copy)
  }

  scored.sort((a, b) => b.score - a.score)
  return scored
}

function mapNativeTrackToQueueTrack(
  t: any,
  fallbackArtist: string,
  source: 'nhaccuatui' | 'soundcloud' | 'deezer',
  reason: string
): QueueTrack {
  if (source === 'nhaccuatui') {
    return {
      id: t.id,
      title: t.title,
      artist: t.artist || fallbackArtist,
      cover_url: t.cover_url,
      duration: t.duration,
      source: 'nhaccuatui',
      source_id: t.nhaccuatui_id || t.id.replace('nct-', ''),
      score: 1.0,
      score_reasons: [reason],
    }
  }
  if (source === 'soundcloud') {
    return {
      id: t.id,
      title: t.title,
      artist: t.artist || fallbackArtist,
      cover_url: t.cover_url,
      duration: t.duration,
      source: 'soundcloud',
      source_id: String(t.soundcloud_id || t.id.replace('sc-', '')),
      score: 1.0,
      score_reasons: [reason],
    }
  }
  const sourceId = String(t.spotify_id || t.id.replace('deezer-', ''))
  return {
    id: t.id.startsWith('deezer-') ? t.id : `deezer-${sourceId}`,
    title: t.title,
    artist: t.artist || fallbackArtist,
    album: t.album || undefined,
    cover_url: t.cover_url,
    duration: t.duration,
    source: 'deezer',
    source_id: sourceId,
    preview_url: t.audio_url || undefined,
    score: 1.0,
    score_reasons: [reason],
  }
}

/**
 * 🚀 Main Auto-Queue Builder Algorithm
 * Combines Genre & Region-Aware Peer Queries, Deezer Radio/Related, Filtered Internal CF & Spotify Fallback
 */
export async function buildNextQueue(
  seedTrack: QueueTrack,
  sessionHistory: QueueTrack[] = [],
  userId?: string,
  limit = 12
): Promise<NextQueueResponse> {
  const sourcesUsed: string[] = []
  const sourcesFailed: string[] = []

  const seedProfile = classifyTrack(seedTrack)
  const artistQuery =
    seedProfile.artistCanonical &&
    seedProfile.artistCanonical !== 'Nghệ sĩ chưa xác định' &&
    seedProfile.artistCanonical !== 'Chưa rõ nghệ sĩ'
      ? seedProfile.artistCanonical
      : ''
  const searchSeedQuery = artistQuery || seedTrack.title || ''
  const peerArtists = seedProfile.relatedArtists.slice(0, 2)
  const genreRegionTopicQuery =
    seedProfile.queryTerms[seedProfile.queryTerms.length - 2] ||
    seedProfile.queryTerms[0] ||
    searchSeedQuery

  // Only query NhacCuaTui when the seed track is Vietnamese or Global
  const shouldUseNct = seedProfile.region === 'vn' || seedProfile.region === 'global'

  const [
    nctSeedRes,
    nctPeersRes,
    scSeedRes,
    scPeersRes,
    deezerRadioRes,
    deezerRelatedRes,
    deezerTopicRes,
    internalCFRes,
    skippedSet,
  ] = await Promise.all([
    shouldUseNct && searchSeedQuery
      ? searchNhacCuaTuiDirect(searchSeedQuery, 12).catch(() => [])
      : Promise.resolve([]),
    shouldUseNct && peerArtists.length > 0
      ? Promise.all(peerArtists.map((peer) => searchNhacCuaTuiDirect(peer, 8).catch(() => []))).then((arr) =>
          arr.flat()
        )
      : shouldUseNct && genreRegionTopicQuery
        ? searchNhacCuaTuiDirect(genreRegionTopicQuery, 10).catch(() => [])
        : Promise.resolve([]),
    searchSeedQuery ? searchSoundCloudTracks(searchSeedQuery, 12).catch(() => []) : Promise.resolve([]),
    peerArtists.length > 0
      ? Promise.all(peerArtists.map((peer) => searchSoundCloudTracks(peer, 6).catch(() => []))).then((arr) =>
          arr.flat()
        )
      : Promise.resolve([]),
    getDeezerArtistRadio(artistQuery || seedTrack.artist, 25).catch(() => []),
    getDeezerRelatedArtistsTopTracks(artistQuery || seedTrack.artist, 25).catch(() => []),
    genreRegionTopicQuery ? searchDeezerTracks(genreRegionTopicQuery, 12).catch(() => []) : Promise.resolve([]),
    getInternalCollaborativeCandidates(seedTrack.id, seedTrack.artist, userId, seedTrack.title),
    getFrequentlySkippedTrackIds(userId),
  ])

  const nctCombined = [...nctSeedRes, ...nctPeersRes]
  let nctTracks: QueueTrack[] = []
  if (nctCombined.length > 0) {
    nctTracks = nctCombined.map((t) =>
      mapNativeTrackToQueueTrack(t, seedTrack.artist, 'nhaccuatui', 'nhaccuatui_native_priority')
    )
    sourcesUsed.push('nhaccuatui')
  } else if (shouldUseNct) {
    sourcesFailed.push('nhaccuatui')
  }

  const scCombined = [...scSeedRes, ...scPeersRes]
  let soundCloudTracks: QueueTrack[] = []
  if (scCombined.length > 0) {
    soundCloudTracks = scCombined.map((t) =>
      mapNativeTrackToQueueTrack(t, seedTrack.artist, 'soundcloud', 'soundcloud_native_priority')
    )
    sourcesUsed.push('soundcloud')
  } else {
    sourcesFailed.push('soundcloud')
  }

  let deezerRadioTracks: QueueTrack[] = []
  if (deezerRadioRes.length > 0) {
    deezerRadioTracks = deezerRadioRes
    sourcesUsed.push('deezer_radio')
  } else {
    sourcesFailed.push('deezer_radio')
  }

  let deezerRelatedTracks: QueueTrack[] = []
  if (deezerRelatedRes.length > 0) {
    deezerRelatedTracks = deezerRelatedRes
    sourcesUsed.push('deezer_related')
  } else {
    sourcesFailed.push('deezer_related')
  }

  const deezerTopicTracks: QueueTrack[] = (deezerTopicRes || []).map((t) =>
    mapNativeTrackToQueueTrack(t, seedTrack.artist, 'deezer', 'deezer_genre_region_topic')
  )

  const internalCFTracks = internalCFRes.tracks
  const userPreferredArtists = internalCFRes.preferredArtists
  if (internalCFTracks.length > 0) {
    sourcesUsed.push('internal_cf')
  } else {
    sourcesFailed.push('internal_cf')
  }

  if (deezerRadioTracks.length === 0 && artistQuery) {
    const topTracks = await getDeezerArtistTopTracks(artistQuery, 15).catch(() => [])
    if (topTracks.length > 0) {
      deezerRadioTracks = topTracks
      sourcesUsed.push('deezer_top_fallback')
    }
  }

  const rawPool: QueueTrack[] = [
    ...nctTracks,
    ...soundCloudTracks,
    ...internalCFTracks,
    ...deezerRadioTracks,
    ...deezerRelatedTracks,
    ...deezerTopicTracks,
  ]

  let candidates = filterAndScoreCandidates(seedTrack, rawPool, {
    sessionHistory,
    skippedSet,
    userPreferredArtists,
  })

  // Trigger Spotify fallback if fewer than 5 compatible candidates survived
  const MIN_CANDIDATES_BEFORE_SPOTIFY = 5
  if (candidates.length < MIN_CANDIDATES_BEFORE_SPOTIFY) {
    const spotifyFallbackTracks = await maybeSpotifySearchFallback(seedTrack, seedProfile, 15)
    if (spotifyFallbackTracks.length > 0) {
      sourcesUsed.push('spotify_fallback')
      candidates = filterAndScoreCandidates(
        seedTrack,
        [...rawPool, ...spotifyFallbackTracks],
        {
          sessionHistory,
          skippedSet,
          userPreferredArtists,
        }
      )
    } else {
      sourcesFailed.push('spotify_fallback')
    }
  }

  // Enforce diversity constraint (Max 2 tracks per artist) & exploration slot injection
  let ranked = diversify(candidates, { maxPerArtist: 2 })
  ranked = injectExplorationSlots(ranked, { exploreRatio: 0.2 })

  const finalBatch = ranked.slice(0, limit)

  return {
    tracks: finalBatch,
    generated_at: new Date().toISOString(),
    sources_used: sourcesUsed,
    sources_failed: sourcesFailed,
  }
}
