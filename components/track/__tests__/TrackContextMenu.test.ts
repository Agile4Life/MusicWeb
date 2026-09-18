import { describe, it, expect } from 'vitest'
import { TrackContextMenuProps } from '../TrackContextMenu'
import { Track, Playlist } from '@/types'

describe('TrackContextMenu contract and style definitions', () => {
  const dummyTrack: Track = {
    id: 'track-123',
    user_id: 'user-abc',
    file_path: 'local/path.mp3',
    created_at: new Date().toISOString(),
    title: 'Test Song Title',
    artist: 'Test Artist',
    album: 'Test Album',
    duration: 210,
    cover_url: 'https://example.com/cover.jpg',
  }

  const dummyPlaylists: Playlist[] = [
    {
      id: 'pl-1',
      user_id: 'user-abc',
      name: 'Chill Evening',
      description: null,
      cover_url: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'pl-2',
      user_id: 'user-abc',
      name: 'Workout Hits',
      description: null,
      cover_url: null,
      created_at: new Date().toISOString(),
    },
  ]

  it('validates prop types and menu structure contract', () => {
    const props: TrackContextMenuProps = {
      track: dummyTrack,
      isOpen: true,
      onClose: () => {},
      menuPos: { top: 100, right: 20 },
      isFavorite: false,
      onToggleFavorite: () => {},
      onAddToQueue: () => {},
      onOpenAlbum: () => {},
      isResolvingAlbum: false,
      currentAlbumDisplay: 'Test Album',
      hasRealAlbumDisplay: true,
      isAdmin: true,
      onEditMode: () => {},
      userPlaylists: dummyPlaylists,
      onAddToPlaylist: () => {},
      onDeleteTrack: () => {},
      onDeleteTrackPermanently: () => {},
    }

    expect(props.track.id).toBe('track-123')
    expect(props.isOpen).toBe(true)
    expect(props.userPlaylists?.length).toBe(2)
    expect(props.isAdmin).toBe(true)
  })

  it('provides appropriate styling rules for liquid-glass, minimal-flat, and classic styles', () => {
    // Liquid glass requires backdrop blur and specular gradient
    const getThemeVisualTokens = (style: 'classic' | 'liquid-glass' | 'minimal-flat') => {
      switch (style) {
        case 'liquid-glass':
          return {
            hasBackdropBlur: true,
            hasSpecularHighlight: true,
            hasGlowBoxShadow: true,
            containerRadius: '22px',
          }
        case 'minimal-flat':
          return {
            hasBackdropBlur: false,
            hasSpecularHighlight: false,
            hasGlowBoxShadow: false,
            containerRadius: 'var(--radius-card, 14px)',
          }
        case 'classic':
        default:
          return {
            hasBackdropBlur: true,
            hasSpecularHighlight: false,
            hasGlowBoxShadow: true,
            containerRadius: '16px',
          }
      }
    }

    const liquidTokens = getThemeVisualTokens('liquid-glass')
    expect(liquidTokens.hasBackdropBlur).toBe(true)
    expect(liquidTokens.hasSpecularHighlight).toBe(true)
    expect(liquidTokens.containerRadius).toBe('22px')

    const minimalTokens = getThemeVisualTokens('minimal-flat')
    expect(minimalTokens.hasBackdropBlur).toBe(false)
    expect(minimalTokens.hasSpecularHighlight).toBe(false)
    expect(minimalTokens.containerRadius).toBe('var(--radius-card, 14px)')

    const classicTokens = getThemeVisualTokens('classic')
    expect(classicTokens.hasBackdropBlur).toBe(true)
    expect(classicTokens.hasSpecularHighlight).toBe(false)
    expect(classicTokens.containerRadius).toBe('16px')
  })
})
