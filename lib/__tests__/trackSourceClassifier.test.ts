import { describe, expect, it } from 'vitest'
import { classifyTrack, inferTrackSource, isBackgroundPlayableTrack, isFullYouTubeQueue } from '../trackSourceClassifier'
import { Track } from '@/types'

describe('trackSourceClassifier', () => {
  const baseTrack: Track = {
    id: 't-1',
    title: 'Test Song',
    artist: 'Test Artist',
    duration: 200,
    source: 'local',
    user_id: 'u-1',
    file_path: '/music/song.mp3',
    cover_url: null,
    created_at: new Date().toISOString(),
  }

  it('correctly classifies NhacCuaTui tracks', () => {
    const track: Track = { ...baseTrack, source: 'nhaccuatui', nhaccuatui_id: 'nct_123' }
    const c = classifyTrack(track, false)
    expect(c.source).toBe('nhaccuatui')
    expect(c.engine).toBe('html5')
    expect(c.nhaccuatuiId).toBe('nct_123')
    expect(c.needsCatalogResolution).toBe(false)
  })

  it('correctly classifies SoundCloud tracks', () => {
    const track: Track = { ...baseTrack, source: 'soundcloud', soundcloud_id: 'sc_456' }
    const c = classifyTrack(track, false)
    expect(c.source).toBe('soundcloud')
    expect(c.engine).toBe('html5')
    expect(c.isDirectPlayable).toBe(true)
  })

  it('correctly classifies YouTube tracks on desktop (youtube iframe engine) vs iOS (html5 audio proxy engine)', () => {
    const track: Track = { ...baseTrack, source: 'youtube', youtube_id: 'dQw4w9WgXcQ' }

    const desktopClassification = classifyTrack(track, false)
    expect(desktopClassification.source).toBe('youtube')
    expect(desktopClassification.engine).toBe('youtube')
    expect(desktopClassification.youtubeId).toBe('dQw4w9WgXcQ')

    const iosClassification = classifyTrack(track, true)
    expect(iosClassification.source).toBe('youtube')
    expect(iosClassification.engine).toBe('html5')
    expect(iosClassification.youtubeId).toBe('dQw4w9WgXcQ')
  })

  it('correctly identifies catalog tracks needing resolution (Spotify/iTunes/Deezer)', () => {
    const spotifyTrack: Track = { ...baseTrack, source: 'spotify', spotify_id: 'sp_123' }
    const itunesTrack: Track = { ...baseTrack, source: 'itunes', itunes_id: 'it_123' }

    expect(classifyTrack(spotifyTrack).needsCatalogResolution).toBe(true)
    expect(classifyTrack(itunesTrack).needsCatalogResolution).toBe(true)
  })

  it('correctly infers Google Drive file IDs and background playability', () => {
    const driveTrack: Track = { ...baseTrack, file_path: 'https://drive.google.com/file/d/1sT-kP6Z9ABCDEF1234567890/view' }
    const c = classifyTrack(driveTrack)
    expect(c.source).toBe('drive')
    expect(c.driveFileId).toBe('1sT-kP6Z9ABCDEF1234567890')
    expect(isBackgroundPlayableTrack(driveTrack)).toBe(true)
  })

  it('correctly identifies full YouTube queue', () => {
    const q: Track[] = [
      { ...baseTrack, id: '1', youtube_id: 'y1' },
      { ...baseTrack, id: '2', source: 'youtube', youtube_id: 'y2' },
    ]
    expect(isFullYouTubeQueue(q)).toBe(true)

    const mixedQ: Track[] = [
      { ...baseTrack, id: '1', youtube_id: 'y1' },
      { ...baseTrack, id: '2', source: 'local' },
    ]
    expect(isFullYouTubeQueue(mixedQ)).toBe(false)
  })
})
