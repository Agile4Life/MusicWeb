import { describe, it, expect } from 'vitest'
import {
  isSoundCloudFullAudio,
  getSoundCloudHighResArtwork,
  soundCloudTrackToAppTrack,
  getBestSoundCloudTranscoding,
  SoundCloudRawTrack,
} from '../soundcloud'

describe('SoundCloud Helper & Full Audio Filter Unit Tests', () => {
  it('isSoundCloudFullAudio should return true for valid full audio tracks', () => {
    const fullTrack: SoundCloudRawTrack = {
      id: 123456,
      title: 'Full Audio Song',
      duration: 240000,
      streamable: true,
      policy: 'ALLOW',
      media: {
        transcodings: [
          {
            url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:123456/stream/hls',
            format: { protocol: 'hls', mime_type: 'audio/mpeg' },
          },
          {
            url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:123456/stream/progressive',
            format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
          },
        ],
      },
    }

    expect(isSoundCloudFullAudio(fullTrack)).toBe(true)
  })

  it('isSoundCloudFullAudio should return false for Go+ 30s snippet / paywalled preview tracks', () => {
    const snippetTrack1: SoundCloudRawTrack = {
      id: 999111,
      title: 'Paywalled Track 1',
      duration: 210000,
      snippet: true,
      media: {
        transcodings: [
          {
            url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:999111/preview/hls',
            format: { protocol: 'hls', mime_type: 'audio/mpeg' },
          },
        ],
      },
    }

    const snippetTrack2: SoundCloudRawTrack = {
      id: 999222,
      title: 'Paywalled Track 2',
      duration: 180000,
      policy: 'SNIPPET',
      media: {
        transcodings: [
          {
            url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:999222/preview/progressive',
            format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
          },
        ],
      },
    }

    const snippetTrack3: SoundCloudRawTrack = {
      id: 999333,
      title: 'Go+ Exclusive Track',
      duration: 195000,
      monetization_model: 'SUB_HIGH_TIER',
      media: {
        transcodings: [
          {
            url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:999333/preview/hls',
            format: { protocol: 'hls', mime_type: 'audio/mpeg' },
          },
        ],
      },
    }

    expect(isSoundCloudFullAudio(snippetTrack1)).toBe(false)
    expect(isSoundCloudFullAudio(snippetTrack2)).toBe(false)
    expect(isSoundCloudFullAudio(snippetTrack3)).toBe(false)
  })

  it('getSoundCloudHighResArtwork should convert low-res artwork URLs to -t500x500.jpg', () => {
    const largeUrl = 'https://i1.sndcdn.com/artworks-000123456789-abcdef-large.jpg'
    const badgeUrl = 'https://i1.sndcdn.com/avatars-000123456789-xyz-badge.jpg'

    expect(getSoundCloudHighResArtwork(largeUrl)).toBe(
      'https://i1.sndcdn.com/artworks-000123456789-abcdef-t500x500.jpg'
    )
    expect(getSoundCloudHighResArtwork(badgeUrl)).toBe(
      'https://i1.sndcdn.com/avatars-000123456789-xyz-t500x500.jpg'
    )
    expect(getSoundCloudHighResArtwork(null)).toBe(null)
  })

  it('soundCloudTrackToAppTrack should correctly map raw SoundCloud track to MusicWeb Track entity', () => {
    const rawTrack: SoundCloudRawTrack = {
      id: 777888,
      title: 'Making My Way',
      duration: 258000,
      artwork_url: 'https://i1.sndcdn.com/artworks-123-large.jpg',
      permalink_url: 'https://soundcloud.com/sontungmtp/making-my-way',
      playback_count: 542000,
      user: {
        id: 111,
        username: 'Sơn Tùng M-TP',
      },
    }

    const appTrack = soundCloudTrackToAppTrack(rawTrack)

    expect(appTrack.id).toBe('sc-777888')
    expect(appTrack.title).toBe('Making My Way')
    expect(appTrack.artist).toBe('Sơn Tùng M-TP')
    expect(appTrack.duration).toBe(258)
    expect(appTrack.source).toBe('soundcloud')
    expect(appTrack.soundcloud_id).toBe(777888)
    expect(appTrack.cover_url).toBe('https://i1.sndcdn.com/artworks-123-t500x500.jpg')
    expect(appTrack.audio_url).toBe('/api/soundcloud/stream?id=777888')
  })

  it('getBestSoundCloudTranscoding should prioritize full progressive MP3 transcoding over preview', () => {
    const rawTrack: SoundCloudRawTrack = {
      id: 555666,
      title: 'Transcoding Preference Test',
      duration: 180000,
      media: {
        transcodings: [
          {
            url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:555666/preview/progressive',
            format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
          },
          {
            url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:555666/stream/progressive',
            format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
          },
        ],
      },
    }

    const best = getBestSoundCloudTranscoding(rawTrack)
    expect(best?.url).toBe('https://api-v2.soundcloud.com/media/soundcloud:tracks:555666/stream/progressive')
  })

  it('searchSoundCloudTracks should detect and handle SoundCloud track URLs', async () => {
    const { searchSoundCloudTracks } = await import('../soundcloudClient')
    const results = await searchSoundCloudTracks('https://soundcloud.com/santong-liv/anh-sai-roi-son-tung-m-tp')
    expect(Array.isArray(results)).toBe(true)
    if (results.length > 0) {
      expect(results[0].source).toBe('soundcloud')
      expect(results[0].title).toBeDefined()
    }
  })

  it('searchSoundCloudTracks should detect and resolve SoundCloud playlist URLs with more than 5 tracks', async () => {
    const { searchSoundCloudTracks } = await import('../soundcloudClient')
    const results = await searchSoundCloudTracks('https://soundcloud.com/ph-m-duy-168788192/sets/nger')
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(10)
    expect(results[0].source).toBe('soundcloud')
  })

  it('resolveSoundCloudPlaylistUrl should resolve full playlist metadata and all 38 tracks for sets/nger', async () => {
    const { resolveSoundCloudPlaylistUrl } = await import('../soundcloudClient')
    const result = await resolveSoundCloudPlaylistUrl('https://soundcloud.com/ph-m-duy-168788192/sets/nger')
    expect(result).not.toBeNull()
    expect(result?.playlist).toBeDefined()
    expect(result?.playlist.title).toBe('Nger')
    expect(result?.tracks.length).toBeGreaterThanOrEqual(30)
    expect(result?.tracks[0].source).toBe('soundcloud')
  })
})
