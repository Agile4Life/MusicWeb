/**
 * Zero-lag in-memory client-side cache & event bus for resolved albums
 */
export interface ResolvedAlbum {
  albumId?: string
  albumName?: string
}

const resolvedAlbumCache = new Map<string, ResolvedAlbum>()

function makeKey(title?: string | null, artist?: string | null): string {
  const cleanT = (title || '').trim().toLowerCase().replace(/[\(\[\{].*?[\)\]\}]/g, '').trim()
  const cleanA = (artist || '').trim().toLowerCase().split(/\s*(?:ft\.?|feat\.?|\/|,|&)\s*/i)[0].trim()
  return `${cleanT}___${cleanA}`
}

export function getCachedResolvedAlbum(
  title?: string | null,
  artist?: string | null,
  expectedAlbum?: string | null
): ResolvedAlbum | undefined {
  const key = makeKey(title, artist)
  const cached = resolvedAlbumCache.get(key)
  if (!cached) return undefined

  // Sanity check: If cached album ID is a known bad fallback (e.g. Defiance 299152445)
  // or if cached album name doesn't match track title/expected album, clear cache entry
  if (cached.albumId?.includes('299152445') || cached.albumId?.includes('296970753')) {
    resolvedAlbumCache.delete(key)
    return undefined
  }

  if (cached.albumName) {
    const cachedNameNorm = (cached.albumName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const titleNorm = (title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const albumNorm = (expectedAlbum || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

    const matchesTitle = titleNorm && (cachedNameNorm.includes(titleNorm) || titleNorm.includes(cachedNameNorm))
    const matchesAlbum = albumNorm && (cachedNameNorm.includes(albumNorm) || albumNorm.includes(cachedNameNorm))

    if (!matchesTitle && !matchesAlbum) {
      resolvedAlbumCache.delete(key)
      return undefined
    }
  }

  return cached
}

export function setCachedResolvedAlbum(
  title: string | null | undefined,
  artist: string | null | undefined,
  album: ResolvedAlbum
) {
  const key = makeKey(title, artist)
  resolvedAlbumCache.set(key, album)

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('album-resolved', {
        detail: { key, title, artist, album },
      })
    )
  }
}
