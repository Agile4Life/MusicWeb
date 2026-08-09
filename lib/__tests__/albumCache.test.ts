import { describe, it, expect, beforeEach } from 'vitest'
import {
  ResolvedAlbum,
  isRealAlbumName,
  getCachedResolvedAlbum,
  setCachedResolvedAlbum,
  invalidateCachedAlbum,
  clearAlbumCache,
  isKnownBadFallback,
  MAX_CACHE_SIZE,
} from '../albumCache'

beforeEach(() => {
  clearAlbumCache()
})

// ── Basic cache ─────────────────────────────────────────
describe('basic cache operations', () => {
  it('set → get returns the same album', () => {
    const album: ResolvedAlbum = { albumId: '12345', albumName: 'Midnights' }
    setCachedResolvedAlbum('Anti-Hero', 'Taylor Swift', album)
    const cached = getCachedResolvedAlbum('Anti-Hero', 'Taylor Swift')
    expect(cached).toEqual(album)
  })

  it('missing key → undefined', () => {
    expect(getCachedResolvedAlbum('nonexistent', 'nobody')).toBeUndefined()
  })

  it('album without albumId → not cached', () => {
    setCachedResolvedAlbum('Test', 'Artist', { albumName: 'NoId' })
    expect(getCachedResolvedAlbum('Test', 'Artist')).toBeUndefined()
  })

  it('album without albumId and albumName → not cached', () => {
    setCachedResolvedAlbum('Test', 'Artist', {} as ResolvedAlbum)
    expect(getCachedResolvedAlbum('Test', 'Artist')).toBeUndefined()
  })
})

// ── Known-bad IDs ───────────────────────────────────────
describe('known-bad fallback IDs', () => {
  it('rejects and evicts 299152445', () => {
    setCachedResolvedAlbum('Song', 'Artist', { albumId: '299152445', albumName: 'Defiance' })
    expect(getCachedResolvedAlbum('Song', 'Artist')).toBeUndefined()
  })

  it('rejects and evicts 296970753', () => {
    setCachedResolvedAlbum('Song', 'Artist', { albumId: '296970753', albumName: 'Bad' })
    expect(getCachedResolvedAlbum('Song', 'Artist')).toBeUndefined()
  })

  it('accepts valid IDs', () => {
    const album: ResolvedAlbum = { albumId: '555888', albumName: 'GoodAlbum' }
    setCachedResolvedAlbum('Song', 'Artist', album)
    expect(getCachedResolvedAlbum('Song', 'Artist')).toEqual(album)
  })

  it('isKnownBadFallback helper works', () => {
    expect(isKnownBadFallback('299152445')).toBe(true)
    expect(isKnownBadFallback('296970753')).toBe(true)
    expect(isKnownBadFallback('12345')).toBe(false)
    expect(isKnownBadFallback(undefined)).toBe(false)
    expect(isKnownBadFallback('')).toBe(false)
  })
})

// ── Expected album matching ─────────────────────────────
describe('expected album matching', () => {
  beforeEach(() => {
    setCachedResolvedAlbum('Song', 'Artist', { albumId: '100', albumName: 'Midnights' })
  })

  it('exact match → accepted', () => {
    expect(getCachedResolvedAlbum('Song', 'Artist', 'Midnights')).toBeDefined()
  })

  it('case difference → accepted', () => {
    expect(getCachedResolvedAlbum('Song', 'Artist', 'midnights')).toBeDefined()
  })

  it('accent difference → accepted', () => {
    setCachedResolvedAlbum('Canción', 'Artista', { albumId: '200', albumName: 'Café' })
    expect(getCachedResolvedAlbum('Canción', 'Artista', 'Cafe')).toBeDefined()
  })

  it('clearly different album → rejected', () => {
    expect(getCachedResolvedAlbum('Song', 'Artist', 'Reputation')).toBeUndefined()
  })

  it('short album "Love" does NOT match "Love Story" via substring', () => {
    setCachedResolvedAlbum('Song2', 'Artist2', { albumId: '300', albumName: 'Love' })
    expect(getCachedResolvedAlbum('Song2', 'Artist2', 'Love Story')).toBeUndefined()
  })

  it('"Love Story" does NOT match "Love" via substring', () => {
    setCachedResolvedAlbum('Song3', 'Artist3', { albumId: '301', albumName: 'Love Story' })
    expect(getCachedResolvedAlbum('Song3', 'Artist3', 'Love')).toBeUndefined()
  })

  it('generic expectedAlbum is ignored (cache returned as-is)', () => {
    expect(getCachedResolvedAlbum('Song', 'Artist', 'Google Drive')).toBeDefined()
    expect(getCachedResolvedAlbum('Song', 'Artist', 'single')).toBeDefined()
    expect(getCachedResolvedAlbum('Song', 'Artist', 'Unknown Album')).toBeDefined()
  })

  it('cached entry without albumName fails when expectedAlbum is real', () => {
    setCachedResolvedAlbum('NoName', 'Artist', { albumId: '999' })
    expect(getCachedResolvedAlbum('NoName', 'Artist', 'RealAlbum')).toBeUndefined()
  })
})

// ── LRU eviction ────────────────────────────────────────
describe('LRU cache behavior', () => {
  it('evicts oldest entry when cache is full', () => {
    for (let i = 0; i < MAX_CACHE_SIZE + 1; i++) {
      setCachedResolvedAlbum(`Title${i}`, `Artist${i}`, {
        albumId: `id-${i}`,
        albumName: `Album${i}`,
      })
    }
    // First entry should be evicted
    expect(getCachedResolvedAlbum('Title0', 'Artist0')).toBeUndefined()
    // Last entry should exist
    expect(getCachedResolvedAlbum(`Title${MAX_CACHE_SIZE}`, `Artist${MAX_CACHE_SIZE}`)).toBeDefined()
  })

  it('recently accessed entry survives eviction', () => {
    for (let i = 0; i < MAX_CACHE_SIZE; i++) {
      setCachedResolvedAlbum(`Title${i}`, `Artist${i}`, {
        albumId: `id-${i}`,
        albumName: `Album${i}`,
      })
    }
    // Access the first entry → refreshes its recency
    getCachedResolvedAlbum('Title0', 'Artist0')

    // Insert one more → should evict Title1, not Title0
    setCachedResolvedAlbum('TitleNew', 'ArtistNew', {
      albumId: 'id-new',
      albumName: 'AlbumNew',
    })

    expect(getCachedResolvedAlbum('Title0', 'Artist0')).toBeDefined()
    expect(getCachedResolvedAlbum('Title1', 'Artist1')).toBeUndefined()
  })

  it('failed validation does NOT refresh LRU recency', () => {
    for (let i = 0; i < MAX_CACHE_SIZE; i++) {
      setCachedResolvedAlbum(`Title${i}`, `Artist${i}`, {
        albumId: `id-${i}`,
        albumName: `Album${i}`,
      })
    }
    // Read Title0 but with mismatched expectedAlbum → returns undefined, should NOT refresh
    const result = getCachedResolvedAlbum('Title0', 'Artist0', 'WrongAlbum')
    expect(result).toBeUndefined()

    // Fill cache to force eviction
    setCachedResolvedAlbum('TitleNew', 'ArtistNew', {
      albumId: 'id-new',
      albumName: 'AlbumNew',
    })

    // Title0 should be evicted (its recency was NOT refreshed)
    expect(getCachedResolvedAlbum('Title0', 'Artist0')).toBeUndefined()
  })

  it('overwriting existing key does not evict another entry', () => {
    for (let i = 0; i < MAX_CACHE_SIZE; i++) {
      setCachedResolvedAlbum(`Title${i}`, `Artist${i}`, {
        albumId: `id-${i}`,
        albumName: `Album${i}`,
      })
    }
    // Overwrite first entry
    setCachedResolvedAlbum('Title0', 'Artist0', {
      albumId: 'id-0-updated',
      albumName: 'AlbumUpdated',
    })

    // All entries should still exist
    expect(getCachedResolvedAlbum('Title0', 'Artist0')?.albumId).toBe('id-0-updated')
    expect(getCachedResolvedAlbum(`Title${MAX_CACHE_SIZE - 1}`, `Artist${MAX_CACHE_SIZE - 1}`)).toBeDefined()
  })
})

// ── Cache invalidation ──────────────────────────────────
describe('cache invalidation', () => {
  it('invalidateCachedAlbum removes one entry', () => {
    setCachedResolvedAlbum('Song1', 'Artist1', { albumId: '1', albumName: 'A1' })
    setCachedResolvedAlbum('Song2', 'Artist2', { albumId: '2', albumName: 'A2' })

    invalidateCachedAlbum('Song1', 'Artist1')

    expect(getCachedResolvedAlbum('Song1', 'Artist1')).toBeUndefined()
    expect(getCachedResolvedAlbum('Song2', 'Artist2')).toBeDefined()
  })

  it('clearAlbumCache removes all entries', () => {
    setCachedResolvedAlbum('Song1', 'Artist1', { albumId: '1', albumName: 'A1' })
    setCachedResolvedAlbum('Song2', 'Artist2', { albumId: '2', albumName: 'A2' })

    clearAlbumCache()

    expect(getCachedResolvedAlbum('Song1', 'Artist1')).toBeUndefined()
    expect(getCachedResolvedAlbum('Song2', 'Artist2')).toBeUndefined()
  })
})

// ── Artist/key regression ───────────────────────────────
describe('cache key correctness — artist names', () => {
  it('Earth, Wind & Fire — not collapsed to "earth"', () => {
    setCachedResolvedAlbum('September', 'Earth, Wind & Fire', { albumId: 'ewf1', albumName: 'The Best of' })
    setCachedResolvedAlbum('Dirt', 'Earth', { albumId: 'earth1', albumName: 'Planet' })

    expect(getCachedResolvedAlbum('September', 'Earth, Wind & Fire')?.albumId).toBe('ewf1')
    expect(getCachedResolvedAlbum('Dirt', 'Earth')?.albumId).toBe('earth1')
  })

  it('Simon & Garfunkel — not collapsed to "simon"', () => {
    setCachedResolvedAlbum('Sound of Silence', 'Simon & Garfunkel', { albumId: 'sg1', albumName: 'Wednesday Morning' })
    setCachedResolvedAlbum('Graceland', 'Simon', { albumId: 'ps1', albumName: 'Graceland' })

    expect(getCachedResolvedAlbum('Sound of Silence', 'Simon & Garfunkel')?.albumId).toBe('sg1')
    expect(getCachedResolvedAlbum('Graceland', 'Simon')?.albumId).toBe('ps1')
  })

  it('AC/DC — not collapsed to "ac"', () => {
    setCachedResolvedAlbum('Thunderstruck', 'AC/DC', { albumId: 'acdc1', albumName: 'The Razors Edge' })
    expect(getCachedResolvedAlbum('Thunderstruck', 'AC/DC')?.albumId).toBe('acdc1')
  })

  it('Hall & Oates — preserved', () => {
    setCachedResolvedAlbum('Maneater', 'Hall & Oates', { albumId: 'ho1', albumName: 'H2O' })
    expect(getCachedResolvedAlbum('Maneater', 'Hall & Oates')?.albumId).toBe('ho1')
  })

  it('Florence + The Machine — preserved', () => {
    setCachedResolvedAlbum('Dog Days', 'Florence + The Machine', { albumId: 'fm1', albumName: 'Lungs' })
    expect(getCachedResolvedAlbum('Dog Days', 'Florence + The Machine')?.albumId).toBe('fm1')
  })

  it('Taylor Swift feat. Post Malone — "feat." stripped for key normalization', () => {
    setCachedResolvedAlbum('Fortnight', 'Taylor Swift feat. Post Malone', { albumId: 'ts1', albumName: 'TTPD' })
    expect(getCachedResolvedAlbum('Fortnight', 'Taylor Swift')?.albumId).toBe('ts1')
  })

  it('feat. variant — "ft." also stripped', () => {
    setCachedResolvedAlbum('Song', 'Artist ft. Other', { albumId: 'a1', albumName: 'Album' })
    expect(getCachedResolvedAlbum('Song', 'Artist')?.albumId).toBe('a1')
  })
})

// ── isRealAlbumName ─────────────────────────────────────
describe('isRealAlbumName', () => {
  it('returns false for null/undefined/empty', () => {
    expect(isRealAlbumName(null)).toBe(false)
    expect(isRealAlbumName(undefined)).toBe(false)
    expect(isRealAlbumName('')).toBe(false)
    expect(isRealAlbumName('   ')).toBe(false)
  })

  it('returns false for generic placeholders', () => {
    expect(isRealAlbumName('Google Drive')).toBe(false)
    expect(isRealAlbumName('SINGLE')).toBe(false)
    expect(isRealAlbumName('unknown album')).toBe(false)
    expect(isRealAlbumName('EP')).toBe(false)
  })

  it('returns true for real album names', () => {
    expect(isRealAlbumName('Midnights')).toBe(true)
    expect(isRealAlbumName('petal')).toBe(true)
    expect(isRealAlbumName('The Dark Side of the Moon')).toBe(true)
  })
})
