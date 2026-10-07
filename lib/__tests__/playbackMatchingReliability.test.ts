import { describe, expect, it } from 'vitest'
import type { Track } from '@/types'
import { findBestNhacCuaTuiMatch } from '../nhaccuatui'
import { findBestYouTubeMatch } from '../youtube'

const candidate = (title: string, artist: string, duration = 240) => ({
  id: 'candidate', title, artist, duration, youtube_id: 'abcdefghijk',
})

describe.each(['NCT', 'YouTube'] as const)('%s catalog identity', (provider) => {
  function match(title: string, artist: string, targetTitle = 'Hello', targetArtist = 'Lionel Richie') {
    const entry = candidate(title, artist)
    return provider === 'NCT'
      ? findBestNhacCuaTuiMatch([entry], { title: targetTitle, artist: targetArtist, duration: 240 })
      : findBestYouTubeMatch([entry as Track], targetTitle, targetArtist, 240)
  }

  it('rejects a same-title, same-duration release by another artist', () => {
    expect(match('Hello', 'Adele - Topic')).toBeNull()
  })

  it('requires more than one overlapping word in a different artist name', () => {
    expect(match('Hello', 'Lionel Jones')).toBeNull()
  })

  it('does not split AC/DC into separate artists', () => {
    expect(match('Hello', 'AC', 'Hello', 'AC/DC')).toBeNull()
    expect(match('Hello', 'DC', 'Hello', 'AC/DC')).toBeNull()
    expect(match('Hello', 'AC/DC - Topic', 'Hello', 'AC/DC')).not.toBeNull()
  })

  it('accepts artist attribution in the title from a label uploader', () => {
    expect(match('Lionel Richie - Hello (Official Audio)', 'Universal Music')).not.toBeNull()
  })

  it('preserves matching a credited collaborator', () => {
    expect(match('Hello', 'Ed Sheeran - Topic', 'Hello', 'Taylor Swift feat. Ed Sheeran')).not.toBeNull()
  })

  it('accepts Heartbeat without mistaking beat for a separate marker', () => {
    expect(match('Heartbeat', 'BTS', 'Heartbeat', 'BTS')).not.toBeNull()
  })

  it('rejects a separate beat marker', () => {
    expect(match('Heartbeat (Beat)', 'BTS', 'Heartbeat', 'BTS')).toBeNull()
  })

  it('preserves explicitly requested remix versions', () => {
    expect(match('Hello (Remix)', 'Lionel Richie', 'Hello (Remix)')).not.toBeNull()
  })

  it('rejects a plain release when a remix was requested', () => {
    expect(match('Hello', 'Lionel Richie', 'Hello (Remix)')).toBeNull()
  })

  it('preserves an explicitly requested acoustic version', () => {
    expect(match('Hello (Acoustic Version)', 'Lionel Richie', 'Hello (Acoustic Version)')).not.toBeNull()
    expect(match('Hello', 'Lionel Richie', 'Hello (Acoustic Version)')).toBeNull()
  })

  it('rejects parenthesized karaoke even when title cleaning removes it', () => {
    expect(match('Hello (Karaoke)', 'Lionel Richie')).toBeNull()
  })
})
