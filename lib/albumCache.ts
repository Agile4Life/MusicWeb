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

export function getCachedResolvedAlbum(title?: string | null, artist?: string | null): ResolvedAlbum | undefined {
  const key = makeKey(title, artist)
  return resolvedAlbumCache.get(key)
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
