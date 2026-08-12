/**
 * Helper to strip provider prefix from album IDs.
 * Order matters: "itunes-rss" must be before "itunes" so "itunes-rss-123" becomes "123" instead of "rss-123".
 */
export function stripAlbumIdPrefix(albumId: string): string {
  if (!albumId) return ''
  return albumId.replace(/^(itunes-rss|deezer|spotify|itunes)-/, '')
}
