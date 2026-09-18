import { describe, expect, it } from 'vitest'
import { getNextPlaylistRoute } from '../playlistNavigation'

describe('getNextPlaylistRoute', () => {
  it('returns null when playlists array is empty', () => {
    expect(getNextPlaylistRoute([], '/')).toBeNull()
    expect(getNextPlaylistRoute([], '/playlist/123')).toBeNull()
  })

  it('navigates to first playlist if not currently on a playlist page', () => {
    const playlists = [{ id: 'p1' }, { id: 'p2' }]
    expect(getNextPlaylistRoute(playlists, '/')).toBe('/playlist/p1')
    expect(getNextPlaylistRoute(playlists, '/albums')).toBe('/playlist/p1')
    expect(getNextPlaylistRoute(playlists, '/favorites')).toBe('/playlist/p1')
  })

  it('cycles to the next playlist when currently on a playlist page', () => {
    const playlists = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
    expect(getNextPlaylistRoute(playlists, '/playlist/p1')).toBe('/playlist/p2')
    expect(getNextPlaylistRoute(playlists, '/playlist/p2')).toBe('/playlist/p3')
    expect(getNextPlaylistRoute(playlists, '/playlist/p3')).toBe('/playlist/p1')
  })

  it('falls back to first playlist if current playlist id is not in list', () => {
    const playlists = [{ id: 'p1' }, { id: 'p2' }]
    expect(getNextPlaylistRoute(playlists, '/playlist/unknown-id')).toBe('/playlist/p1')
  })
})
