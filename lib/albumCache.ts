'use client'

/**
 * Zero-lag in-memory client-side cache & event bus for resolved albums.
 *
 * Bounded LRU cache (max 500 entries) with:
 * - Known-bad Deezer fallback ID rejection
 * - Conservative exact-match album validation
 * - Collision-resistant cache keys (preserves compound artist names)
 * - Manual invalidation APIs
 */

export interface ResolvedAlbum {
  albumId?: string
  albumName?: string
}

// ── Generic placeholder detection ───────────────────────
const GENERIC_PLACEHOLDERS = new Set([
  'google drive',
  'google drive sync',
  'youtube music',
  'apple music top hits',
  'itunes global',
  'spotify album',
  'unknown album',
  'single',
  'ep',
])

export function isRealAlbumName(name?: string | null): boolean {
  if (!name) return false
  const trimmed = name.trim().toLowerCase()
  if (!trimmed) return false
  return !GENERIC_PLACEHOLDERS.has(trimmed)
}

// ── Known-bad fallback IDs ──────────────────────────────
/**
 * Known-bad Deezer album IDs that the resolver incorrectly returns as fallbacks.
 * These are exact Deezer numeric album IDs.
 */
const KNOWN_BAD_FALLBACK_ALBUM_IDS = new Set([
  '299152445',
  '296970753',
])

export function isKnownBadFallback(albumId?: string): boolean {
  return !!albumId && KNOWN_BAD_FALLBACK_ALBUM_IDS.has(albumId)
}

// ── LRU bounded cache ───────────────────────────────────
export const MAX_CACHE_SIZE = 500

const resolvedAlbumCache = new Map<string, ResolvedAlbum>()

/**
 * Move a key to the most-recent position in Map insertion order.
 * Call only after all validation succeeds.
 */
function touchLRU(key: string, value: ResolvedAlbum): void {
  resolvedAlbumCache.delete(key)
  resolvedAlbumCache.set(key, value)
}

// ── Cache key normalization ─────────────────────────────
/**
 * Build a cache key from title + artist.
 *
 * Title: lowercased, parenthetical/bracket content removed.
 * Artist: lowercased, only "feat."/"ft." collaboration suffixes stripped.
 *   Compound names like "Earth, Wind & Fire" are preserved intact.
 */
function makeKey(title?: string | null, artist?: string | null): string {
  const cleanT = (title || '')
    .trim()
    .toLowerCase()
    .replace(/[([{].*?[)}\]]/g, '')
    .trim()

  // Only strip "feat."/"ft." collaboration prefixes — preserve all other
  // punctuation so compound artist names remain intact as cache keys
  const cleanA = (artist || '')
    .trim()
    .toLowerCase()
    .split(/\s+(?:feat\.?|ft\.?)\s+/i)[0]
    .trim()

  return `${cleanT}___${cleanA}`
}

// ── Album name normalization ────────────────────────────
/**
 * Normalize an album name for comparison:
 * lowercase, trim, strip accents, collapse whitespace.
 */
function normalizeAlbumName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

// ── Public API ──────────────────────────────────────────

/**
 * Returns a validated cached album resolution.
 * Invalid known-bad entries are evicted during lookup.
 * Successful reads refresh LRU recency; failed validations do not.
 */
export function getCachedResolvedAlbum(
  title?: string | null,
  artist?: string | null,
  expectedAlbum?: string | null
): ResolvedAlbum | undefined {
  const key = makeKey(title, artist)
  const cached = resolvedAlbumCache.get(key)
  if (!cached) return undefined

  // Reject and evict known-bad Deezer fallback album IDs
  if (isKnownBadFallback(cached.albumId)) {
    resolvedAlbumCache.delete(key)
    return undefined
  }

  // If an expected real album is provided, verify cached album matches it
  if (expectedAlbum && isRealAlbumName(expectedAlbum)) {
    if (!cached.albumName) return undefined

    const cachedNorm = normalizeAlbumName(cached.albumName)
    const expectedNorm = normalizeAlbumName(expectedAlbum)

    // Exact normalized equality — no unsafe substring matching
    if (cachedNorm !== expectedNorm) {
      return undefined
    }
  }

  // All validation passed — refresh LRU recency
  touchLRU(key, cached)
  return cached
}

export function setCachedResolvedAlbum(
  title: string | null | undefined,
  artist: string | null | undefined,
  album: ResolvedAlbum
) {
  if (!album || !album.albumId) return

  const key = makeKey(title, artist)

  // Skip if exact same data is already cached (avoid duplicate events)
  const existing = resolvedAlbumCache.get(key)
  if (existing?.albumId === album.albumId && existing?.albumName === album.albumName) {
    return
  }

  // LRU eviction: if key already exists, delete-then-set updates insertion order.
  // If new key and cache is full, evict the least-recently-used (oldest) entry.
  if (resolvedAlbumCache.has(key)) {
    resolvedAlbumCache.delete(key)
  } else if (resolvedAlbumCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = resolvedAlbumCache.keys().next().value
    if (oldestKey !== undefined) resolvedAlbumCache.delete(oldestKey)
  }
  resolvedAlbumCache.set(key, album)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('album-resolved', {
        detail: { key, title, artist, album },
      })
    )
  }
}

// ── Manual invalidation ─────────────────────────────────

/** Remove a single cached album entry. */
export function invalidateCachedAlbum(
  title?: string | null,
  artist?: string | null
): void {
  const key = makeKey(title, artist)
  resolvedAlbumCache.delete(key)
}

/** Remove all cached album entries. */
export function clearAlbumCache(): void {
  resolvedAlbumCache.clear()
}
