/**
 * Helper to strip provider prefix from album IDs.
 * Order matters: "itunes-rss" must be before "itunes" so "itunes-rss-123" becomes "123" instead of "rss-123".
 */
export function stripAlbumIdPrefix(albumId: string): string {
  if (!albumId) return ''
  return albumId.replace(/^(itunes-rss|deezer|spotify|itunes)-/, '')
}

const SYSTEM_USER_ID = '00000000-0000-4000-a000-000000000001'
const KNOWN_BAD_ALBUM_IDS = new Set(['299152445', '296970753'])

/**
 * Sort album tracks by disc_number ascending, then track_number ascending.
 */
export function sortAlbumTracks<T extends { disc_number?: number | null; track_number?: number | null }>(
  tracks: readonly T[],
): T[] {
  return [...tracks].sort((a, b) => {
    const discDiff = (a.disc_number || 1) - (b.disc_number || 1)
    if (discDiff !== 0) return discDiff
    return (a.track_number || 1) - (b.track_number || 1)
  })
}

/**
 * Validate and normalize a cached `spotify_albums` record joined with `tracks`.
 *
 * Returns `null` if:
 * - The album is a known-bad fallback ID
 * - `total_tracks` is missing/0 (e.g. a stub created by single-track resolution)
 * - Deduplicated valid album tracks are fewer than `total_tracks`
 *
 * Deduplicates multi-user track rows (preferring system user rows with explicit `track_number`)
 * and sorts tracks by disc_number and track_number.
 */
export function validateAndNormalizeCachedAlbum(cached: any): any | null {
  if (!cached || !cached.id || KNOWN_BAD_ALBUM_IDS.has(String(cached.id))) {
    return null
  }

  const expectedTotal = Number(cached.total_tracks || 0)
  if (!Number.isFinite(expectedTotal) || expectedTotal <= 0) {
    return null
  }

  const isSingleType = String(cached.album_type || '').toLowerCase() === 'single'
  if (!isSingleType && expectedTotal <= 1) {
    return null
  }

  if (!Array.isArray(cached.tracks) || cached.tracks.length === 0) {
    return null
  }

  // Prefer system-saved album tracks that carry explicit track_number metadata
  const candidates = [...cached.tracks].sort((a: any, b: any) => {
    const aHasTrackNum = typeof a.track_number === 'number' && a.track_number > 0 ? 1 : 0
    const bHasTrackNum = typeof b.track_number === 'number' && b.track_number > 0 ? 1 : 0
    if (aHasTrackNum !== bHasTrackNum) return bHasTrackNum - aHasTrackNum

    const aIsSystem = a.user_id === SYSTEM_USER_ID ? 1 : 0
    const bIsSystem = b.user_id === SYSTEM_USER_ID ? 1 : 0
    return bIsSystem - aIsSystem
  })

  const seenPositions = new Set<string>()
  const seenTitles = new Set<string>()
  const deduped: any[] = []

  for (const t of candidates) {
    if (!t || !t.title) continue
    // For multi-track albums, require explicit track_number so random user tracks don't pollute tracklist order
    if (expectedTotal > 1 && (typeof t.track_number !== 'number' || t.track_number <= 0)) {
      continue
    }

    const disc = t.disc_number || 1
    const posKey = typeof t.track_number === 'number' && t.track_number > 0 ? `${disc}::${t.track_number}` : ''
    const titleKey = `${disc}::${String(t.title).trim().toLowerCase()}`

    if (posKey && seenPositions.has(posKey)) continue
    if (seenTitles.has(titleKey)) continue

    if (posKey) seenPositions.add(posKey)
    seenTitles.add(titleKey)
    deduped.push(t)
  }

  if (deduped.length < expectedTotal) {
    return null
  }

  const sortedTracks = sortAlbumTracks(deduped).map((t: any) => ({
    ...t,
    album: cached.name || t.album,
    spotify_album_id: cached.id || t.spotify_album_id,
    cover_url: t.cover_url || cached.cover_url || null,
    source: t.source || 'spotify',
  }))

  return {
    ...cached,
    total_tracks: sortedTracks.length || expectedTotal,
    tracks: sortedTracks,
  }
}
