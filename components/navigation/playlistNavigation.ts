export function getNextPlaylistRoute(
  playlists: Array<{ id: string }>,
  currentPathname: string
): string | null {
  if (!playlists || playlists.length === 0) {
    return null
  }
  if (currentPathname.startsWith('/playlist/')) {
    const currentId = currentPathname.replace('/playlist/', '')
    const curIdx = playlists.findIndex((p) => p.id === currentId)
    if (curIdx === -1) {
      return `/playlist/${playlists[0].id}`
    }
    const nextIdx = (curIdx + 1) % playlists.length
    return `/playlist/${playlists[nextIdx].id}`
  }
  return `/playlist/${playlists[0].id}`
}
