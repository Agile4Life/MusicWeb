import { describe, it, expect } from 'vitest'
import { stripAlbumIdPrefix } from '../albumId'

describe('stripAlbumIdPrefix', () => {
  it('strips itunes-rss- prefix correctly', () => {
    expect(stripAlbumIdPrefix('itunes-rss-12345')).toBe('12345')
  })

  it('strips itunes- prefix correctly', () => {
    expect(stripAlbumIdPrefix('itunes-12345')).toBe('12345')
  })

  it('strips deezer- prefix correctly', () => {
    expect(stripAlbumIdPrefix('deezer-67890')).toBe('67890')
  })

  it('strips spotify- prefix correctly', () => {
    expect(stripAlbumIdPrefix('spotify-abcde')).toBe('abcde')
  })

  it('returns clean ID untouched if no prefix present', () => {
    expect(stripAlbumIdPrefix('12345')).toBe('12345')
  })
})
