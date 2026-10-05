/**
 * Client-side wrapper for /api/albums/resolve.
 * - Dedupes concurrent identical requests (PlayerBar + NowPlayingOverlay both resolve the same track).
 * - Negative-caches failures/404s briefly so repeated attempts don't hammer a slow upstream.
 */

export interface ResolvedAlbumResponse {
  albumId?: string
  albumName?: string
  [key: string]: unknown
}

export interface AlbumResolveParams {
  title: string
  artist: string
  album: string
  trackId: string
}

export const ALBUM_RESOLVE_NEGATIVE_TTL_MS = 60_000

const inflight = new Map<string, Promise<ResolvedAlbumResponse | null>>()
const negative = new Map<string, number>()

function keyOf(p: AlbumResolveParams) {
  return [p.title, p.artist, p.album, p.trackId].join('\u0001')
}

export function resetAlbumResolveClientState() {
  inflight.clear()
  negative.clear()
}

export function resolveAlbumDeduped(
  params: AlbumResolveParams,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<ResolvedAlbumResponse | null> {
  const key = keyOf(params)

  const expiresAt = negative.get(key)
  if (expiresAt !== undefined) {
    if (expiresAt > now()) return Promise.resolve(null)
    negative.delete(key)
  }

  const existing = inflight.get(key)
  if (existing) return existing

  const url =
    `/api/albums/resolve?title=${encodeURIComponent(params.title)}` +
    `&artist=${encodeURIComponent(params.artist)}` +
    `&album=${encodeURIComponent(params.album)}` +
    `&track_id=${encodeURIComponent(params.trackId)}`

  const p = fetchImpl(url)
    .then((res) => (res.ok ? (res.json() as Promise<ResolvedAlbumResponse>) : null))
    .catch(() => null)
    .then((data) => {
      if (!data || !data.albumId) negative.set(key, now() + ALBUM_RESOLVE_NEGATIVE_TTL_MS)
      return data
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, p)
  return p
}
