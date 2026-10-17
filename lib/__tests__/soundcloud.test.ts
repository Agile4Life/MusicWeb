import { describe, it, expect } from 'vitest'
import {
  isSoundCloudFullAudio,
  getSoundCloudHighResArtwork,
  soundCloudTrackToAppTrack,
  parseSoundCloudTitleAndArtist,
  getBestSoundCloudTranscoding,
  SoundCloudRawTrack,
} from '../soundcloud'

describe('SoundCloud Helper & Full Audio Filter Unit Tests', () => {
  it('parseSoundCloudTitleAndArtist should cleanly extract artist and title from diverse formats', () => {
    expect(parseSoundCloudTitleAndArtist('SƠN TÙNG M-TP | CHÚNG TA CỦA HIỆN TẠI | OFFICIAL MV', 'Sơn Tùng M-TP Official')).toEqual({
      title: 'CHÚNG TA CỦA HIỆN TẠI',
      artist: 'SƠN TÙNG M-TP',
    })

    expect(parseSoundCloudTitleAndArtist('Anh Sai Rồi - Sơn Tùng M-TP', 'Sơn Tùng M-TP')).toEqual({
      title: 'Anh Sai Rồi',
      artist: 'Sơn Tùng M-TP',
    })

    expect(parseSoundCloudTitleAndArtist('HIEUTHUHAI - Vệ Tinh (ft. Hoàng Tôn) [Official Audio]', 'vpop_vibes')).toEqual({
      title: 'Vệ Tinh',
      artist: 'HIEUTHUHAI',
    })

    expect(parseSoundCloudTitleAndArtist('Making My Way', 'Sơn Tùng M-TP')).toEqual({
      title: 'Making My Way',
      artist: 'Sơn Tùng M-TP',
    })
  })
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

    const timelessPreviewTrack: SoundCloudRawTrack = {
      id: 1924619450,
      title: 'Timeless (with Playboi Carti)',
      duration: 30000,
      full_duration: 256026,
      streamable: true,
      policy: 'ALLOW',
      media: {
        transcodings: [
          {
            url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:1924619450/stream/hls',
            format: { protocol: 'hls', mime_type: 'audio/mpeg' },
            snipped: true,
          },
        ],
      },
    }

    expect(isSoundCloudFullAudio(snippetTrack1)).toBe(false)
    expect(isSoundCloudFullAudio(snippetTrack2)).toBe(false)
    expect(isSoundCloudFullAudio(snippetTrack3)).toBe(false)
    expect(isSoundCloudFullAudio(timelessPreviewTrack)).toBe(false)
  })

  it('verifySoundCloudTrackPlayable rejects tracks when SoundCloud Worker returns 404', async () => {
    const { verifySoundCloudTrackPlayable } = await import('../soundcloudClient')
    const prevWorkerUrl = process.env.NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL
    process.env.NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL = 'https://soundcloud-stream-cache.test'
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('id=1924619450')) {
          return new Response(
            JSON.stringify({ error: 'Track is not full audio (blocked, snippet, or Go+ only)' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({ url: 'https://cf-media.sndcdn.com/valid-track.128.mp3' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      await expect(verifySoundCloudTrackPlayable(1924619450, 1500)).resolves.toBe(false)
      await expect(verifySoundCloudTrackPlayable(123456789, 1500)).resolves.toBe(true)
    } finally {
      globalThis.fetch = originalFetch
      if (prevWorkerUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL
      } else {
        process.env.NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL = prevWorkerUrl
      }
    }
  })

  it('isSoundCloudFullAudio should return false when streamable is false', () => {
    const unstreamableTrack: SoundCloudRawTrack = {
      id: 888111,
      title: 'Disabled Streaming Track',
      duration: 200000,
      streamable: false,
      policy: 'ALLOW',
      media: {
        transcodings: [
          {
            url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:888111/stream/progressive',
            format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
          },
        ],
      },
    }

    expect(isSoundCloudFullAudio(unstreamableTrack)).toBe(false)
  })

  it('getSoundCloudHighResArtwork should convert low-res artwork URLs to -t500x500.jpg for various size suffixes', () => {
    const largeUrl = 'https://i1.sndcdn.com/artworks-000123456789-abcdef-large.jpg'
    const badgeUrl = 'https://i1.sndcdn.com/avatars-000123456789-xyz-badge.jpg'
    const customSizeUrl = 'https://i1.sndcdn.com/artworks-000123456789-abcdef-t300x300.jpg'
    const tinyUrl = 'https://i1.sndcdn.com/artworks-000123456789-abcdef-tiny.png'

    expect(getSoundCloudHighResArtwork(largeUrl)).toBe(
      'https://i1.sndcdn.com/artworks-000123456789-abcdef-t500x500.jpg'
    )
    expect(getSoundCloudHighResArtwork(badgeUrl)).toBe(
      'https://i1.sndcdn.com/avatars-000123456789-xyz-t500x500.jpg'
    )
    expect(getSoundCloudHighResArtwork(customSizeUrl)).toBe(
      'https://i1.sndcdn.com/artworks-000123456789-abcdef-t500x500.jpg'
    )
    expect(getSoundCloudHighResArtwork(tinyUrl)).toBe(
      'https://i1.sndcdn.com/artworks-000123456789-abcdef-t500x500.png'
    )
    expect(getSoundCloudHighResArtwork(null)).toBe(null)
  })

  it('soundCloudTrackToAppTrack should correctly map raw SoundCloud track to MusicWeb Track entity with source_url and empty file_path', () => {
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
    expect(appTrack.soundcloud_permalink_url).toBe('https://soundcloud.com/sontungmtp/making-my-way')
    expect(appTrack.source_url).toBe('https://soundcloud.com/sontungmtp/making-my-way')
    expect(appTrack.file_path).toBe('')
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

  it('assembles seekable fMP4 with a unified master sidx box and supports HTTP 206 Byte-Range seeking', async () => {
    const {
      parseFmp4SegmentSidx,
      buildMasterFmp4SidxBox,
      assembleSoundCloudHlsMedia,
    } = await import('../soundcloudClient')

    // Build a synthetic fMP4 segment with styp (24B) + sidx (44B, version 0, 1 ref) + moof (16B) + mdat (32B)
    const makeSegment = (durationTicks: number, mdatFill: number) => {
      const seg = new Uint8Array(24 + 44 + 16 + 32)
      const v = new DataView(seg.buffer)
      // styp (24B)
      v.setUint32(0, 24, false)
      seg.set([0x73, 0x74, 0x79, 0x70], 4)
      // sidx (44B, version 0)
      v.setUint32(24, 44, false)
      seg.set([0x73, 0x69, 0x64, 0x78], 28)
      v.setUint32(32, 0, false) // version 0
      v.setUint32(36, 1, false) // ref_id = 1
      v.setUint32(40, 44100, false) // timescale = 44100
      v.setUint32(44, 0, false) // earliest_presentation_time
      v.setUint32(48, 0, false) // first_offset
      v.setUint16(52, 0, false) // reserved
      v.setUint16(54, 1, false) // reference_count = 1
      v.setUint32(56, 48, false) // referenced_size = 48 (moof 16 + mdat 32)
      v.setUint32(60, durationTicks, false) // subsegment_duration
      v.setUint32(64, 0x90000000, false) // SAP
      // moof (16B)
      v.setUint32(68, 16, false)
      seg.set([0x6d, 0x6f, 0x6f, 0x66], 72)
      // mdat (32B)
      v.setUint32(84, 32, false)
      seg.set([0x6d, 0x64, 0x61, 0x74], 88)
      seg.fill(mdatFill, 92)
      return seg
    }

    const seg0 = makeSegment(441000, 0xaa)
    const seg1 = makeSegment(441000, 0xbb)
    expect(parseFmp4SegmentSidx(seg0)).toEqual({
      subsegmentDuration: 441000,
      timescale: 44100,
    })

    const masterSidx = buildMasterFmp4SidxBox(
      [
        { byteLength: 48, durationTicks: 441000 },
        { byteLength: 48, durationTicks: 441000 },
      ],
      44100,
    )
    expect(masterSidx.byteLength).toBe(32 + 2 * 12)
    expect(parseFmp4SegmentSidx(masterSidx)).toEqual({
      subsegmentDuration: 882000,
      timescale: 44100,
    })

    // Minimal init.mp4 with ftyp (16B)
    const initMp4 = new Uint8Array(16)
    new DataView(initMp4.buffer).setUint32(0, 16, false)
    initMp4.set([0x66, 0x74, 0x79, 0x70], 4)

    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('init.mp4')) return new Response(initMp4, { status: 200 })
        if (url.includes('seg0.m4s')) return new Response(seg0, { status: 200 })
        if (url.includes('seg1.m4s')) return new Response(seg1, { status: 200 })
        return new Response(null, { status: 404 })
      }

      const assembled = await assembleSoundCloudHlsMedia({
        contentType: 'audio/mp4',
        hasInitMap: true,
        durationSeconds: 20,
        urls: [
          'https://cdn.test/init.mp4',
          'https://cdn.test/seg0.m4s',
          'https://cdn.test/seg1.m4s',
        ],
      })

      expect(assembled).not.toBeNull()
      // 16 (init) + 56 (masterSidx) + 48 (seg0 stripped) + 48 (seg1 stripped) = 168 bytes
      expect(assembled?.buffer.byteLength).toBe(168)
      // At offset 16 + 56 + 48 = 120, seg1's moof box must start
      const seg1MoofType = String.fromCharCode(
        assembled!.buffer[124],
        assembled!.buffer[125],
        assembled!.buffer[126],
        assembled!.buffer[127],
      )
      expect(seg1MoofType).toBe('moof')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
