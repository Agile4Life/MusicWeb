import { describe, it, expect } from 'vitest'
import {
  normalizeString,
  getDedupKey,
  getTrackIdentityVariants,
  dedupCandidates,
  diversify,
  injectExplorationSlots,
} from '../queueRecommend'
import { isOriginalTrackOnly } from '../youtube'
import { QueueTrack, trackToQueueTrack, queueTrackToTrack } from '@/types/queue'

describe('queueRecommend logic unit tests', () => {
  describe('normalizeString', () => {
    it('normalizes Vietnamese diacritics and bracketed metadata', () => {
      const input = 'Chúng Ta Của Tương Lai (Official Music Video)'
      const normalized = normalizeString(input)
      expect(normalized).not.toContain('official')
      expect(normalized).not.toContain('video')
      expect(normalized).toBe('chungtacuatuonglai')
    })

    it('normalizes remix and audio suffixes', () => {
      const norm1 = normalizeString('Nơi Này Có Anh - Official Audio')
      const norm2 = normalizeString('Nơi Này Có Anh')
      expect(norm1).toBe(norm2)
    })
  })

  describe('getDedupKey & getTrackIdentityVariants', () => {
    it('prefers ISRC key when present', () => {
      const track: QueueTrack = {
        id: 'spotify-123',
        title: 'Song',
        artist: 'Artist',
        cover_url: null,
        duration: 180,
        isrc: 'US1234567890',
        source: 'spotify',
        source_id: '123',
        score: 1.0,
        score_reasons: [],
      }
      expect(getDedupKey(track)).toBe('isrc:US1234567890')
    })

    it('falls back to metadata key when ISRC is missing', () => {
      const track: QueueTrack = {
        id: 'deezer-456',
        title: 'Song Title',
        artist: 'Artist Name',
        cover_url: null,
        duration: 180,
        source: 'deezer',
        source_id: '456',
        score: 1.0,
        score_reasons: [],
      }
      expect(getDedupKey(track)).toContain('meta:')
    })

    it('returns only source-matched prefixed variants for spotify track', () => {
      const track: QueueTrack = {
        id: 'spotify-999',
        title: 'Track',
        artist: 'Artist',
        cover_url: null,
        duration: 200,
        source: 'spotify',
        source_id: '999',
        score: 1.0,
        score_reasons: [],
      }
      const variants = getTrackIdentityVariants(track)
      expect(variants).toContain('spotify-999') // prefixed id
      expect(variants).toContain('999')           // raw source_id
      // must NOT include cross-source prefixes to prevent false skip-collisions
      expect(variants).not.toContain('nct-999')
      expect(variants).not.toContain('sc-999')
      expect(variants).not.toContain('deezer-999')
    })

    it('returns nct- prefix only for nhaccuatui source', () => {
      const track: QueueTrack = {
        id: 'nct-abc',
        title: 'Bai Hat NCT',
        artist: 'Ca Si',
        cover_url: null,
        duration: 200,
        source: 'nhaccuatui',
        source_id: 'abc',
        score: 1.0,
        score_reasons: [],
      }
      const variants = getTrackIdentityVariants(track)
      expect(variants).toContain('nct-abc')
      expect(variants).toContain('abc')
      expect(variants).not.toContain('sc-abc')
      expect(variants).not.toContain('spotify-abc')
    })

    it('returns sc- prefix only for soundcloud source', () => {
      const track: QueueTrack = {
        id: 'sc-77',
        title: 'SC Track',
        artist: 'Creator',
        cover_url: null,
        duration: 200,
        source: 'soundcloud',
        source_id: '77',
        score: 1.0,
        score_reasons: [],
      }
      const variants = getTrackIdentityVariants(track)
      expect(variants).toContain('sc-77')
      expect(variants).not.toContain('nct-77')
      expect(variants).not.toContain('deezer-77')
    })
  })

  describe('QueueTrack converters', () => {
    it('correctly maps NhacCuaTui Track to QueueTrack and back', () => {
      const nctTrack = {
        id: 'nct-song123',
        user_id: 'user1',
        title: 'Bản Nhạc NCT',
        artist: 'Ca sĩ Việt',
        duration: 210,
        file_path: '',
        cover_url: 'https://avatar.nct.vn/cover.jpg',
        created_at: new Date().toISOString(),
        source: 'nhaccuatui' as const,
        nhaccuatui_id: 'song123',
      }

      const queueTrack = trackToQueueTrack(nctTrack)
      expect(queueTrack.source).toBe('nhaccuatui')
      expect(queueTrack.source_id).toBe('song123')

      const restoredTrack = queueTrackToTrack(queueTrack)
      expect(restoredTrack.source).toBe('nhaccuatui')
      expect(restoredTrack.nhaccuatui_id).toBe('song123')
      expect(restoredTrack.title).toBe('Bản Nhạc NCT')
    })

    it('correctly maps SoundCloud Track to QueueTrack and back', () => {
      const scTrack = {
        id: 'sc-88888',
        user_id: 'user1',
        title: 'SoundCloud Hit',
        artist: 'Indie Creator',
        duration: 195,
        file_path: '',
        cover_url: 'https://i1.sndcdn.com/art.jpg',
        created_at: new Date().toISOString(),
        source: 'soundcloud' as const,
        soundcloud_id: 88888,
      }

      const queueTrack = trackToQueueTrack(scTrack)
      expect(queueTrack.source).toBe('soundcloud')
      expect(queueTrack.source_id).toBe('88888')

      const restoredTrack = queueTrackToTrack(queueTrack)
      expect(restoredTrack.source).toBe('soundcloud')
      expect(restoredTrack.soundcloud_id).toBe(88888)
      expect(restoredTrack.audio_url).toContain('88888')
    })

    it('correctly maps Deezer QueueTrack back preserving source=deezer', () => {
      const deezerQueueTrack: QueueTrack = {
        id: 'deezer-999',
        title: 'Deezer Song',
        artist: 'Deezer Artist',
        cover_url: null,
        duration: 200,
        source: 'deezer',
        source_id: '999',
        preview_url: 'https://preview.deezer.com/999.mp3',
        score: 1.0,
        score_reasons: ['deezer_radio'],
      }
      const track = queueTrackToTrack(deezerQueueTrack)
      // Source must remain 'deezer' so downstream label/analytics logic works
      expect(track.source).toBe('deezer')
      // playback_engine tells the audio engine to use the Spotify-compatible preview protocol
      expect(track.playback_engine).toBe('spotify')
      expect(track.audio_url).toContain('preview.deezer.com')
    })
  })

  describe('isOriginalTrackOnly - word boundary matching', () => {
    it('does NOT reject words that merely contain a negative keyword substring', () => {
      // False-positives that .includes() would generate but \b regex should not
      expect(isOriginalTrackOnly('Discover Music')).toBe(true)    // 'cover' inside 'discover'
      expect(isOriginalTrackOnly('Liverpool FC')).toBe(true)      // 'live' inside 'Liverpool'
      expect(isOriginalTrackOnly('recover from love')).toBe(true) // 'cover' inside 'recover'
      expect(isOriginalTrackOnly('Loophole')).toBe(true)          // 'loop' inside 'loophole'
    })

    it('rejects exact negative keyword matches', () => {
      expect(isOriginalTrackOnly('Song Cover')).toBe(false)
      expect(isOriginalTrackOnly('Song (Live)')).toBe(false)
      expect(isOriginalTrackOnly('Remix Version')).toBe(false)
      expect(isOriginalTrackOnly('Karaoke Version')).toBe(false)
    })

    it('allows genre keywords when passed as allowedKeywords', () => {
      // When seed genre is 'remix', remix candidates should NOT be filtered
      expect(isOriginalTrackOnly('Party Remix', ['remix', 'mashup'])).toBe(true)
      expect(isOriginalTrackOnly('DJ Mashup Mix', ['remix', 'mashup'])).toBe(true)
    })

    it('still rejects other negative keywords even with allowedKeywords', () => {
      // Only the explicitly allowed keyword is whitelisted, not all
      expect(isOriginalTrackOnly('Remix Karaoke Version', ['remix'])).toBe(false)
    })
  })

  describe('dedupCandidates', () => {
    it('deduplicates identical tracks and merges score_reasons', () => {
      const tracks: QueueTrack[] = [
        {
          id: 'spotify-1',
          title: 'Shape of You',
          artist: 'Ed Sheeran',
          cover_url: 'cover1.jpg',
          duration: 235,
          source: 'spotify',
          source_id: '1',
          score: 1.0,
          score_reasons: ['deezer_radio'],
        },
        {
          id: 'deezer-1',
          title: 'Shape of You (Official Video)',
          artist: 'Ed Sheeran',
          cover_url: null,
          duration: 235,
          source: 'deezer',
          source_id: '1',
          score: 0.8,
          score_reasons: ['internal_cf'],
        },
      ]

      const deduped = dedupCandidates(tracks)
      expect(deduped).toHaveLength(1)
      expect(deduped[0].id).toBe('spotify-1')
      expect(deduped[0].score_reasons).toContain('deezer_radio')
      expect(deduped[0].score_reasons).toContain('internal_cf')
    })
  })

  describe('diversify', () => {
    it('limits candidates per artist to maxPerArtist', () => {
      const tracks: QueueTrack[] = [
        { id: '1', title: 'Song 1', artist: 'Artist A', cover_url: null, duration: 180, source: 'spotify', source_id: '1', score: 1.5, score_reasons: [] },
        { id: '2', title: 'Song 2', artist: 'Artist A', cover_url: null, duration: 180, source: 'spotify', source_id: '2', score: 1.4, score_reasons: [] },
        { id: '3', title: 'Song 3', artist: 'Artist A', cover_url: null, duration: 180, source: 'spotify', source_id: '3', score: 1.3, score_reasons: [] },
        { id: '4', title: 'Song 4', artist: 'Artist B', cover_url: null, duration: 180, source: 'spotify', source_id: '4', score: 1.2, score_reasons: [] },
      ]

      const diversified = diversify(tracks, { maxPerArtist: 2 })
      expect(diversified).toHaveLength(3)
      expect(diversified.filter((t) => t.artist === 'Artist A')).toHaveLength(2)
      expect(diversified.filter((t) => t.artist === 'Artist B')).toHaveLength(1)
    })
  })

  describe('injectExplorationSlots', () => {
    it('interleaves exploration items into ranked pool', () => {
      const tracks: QueueTrack[] = Array.from({ length: 10 }, (_, i) => ({
        id: `tr-${i}`,
        title: `Title ${i}`,
        artist: `Artist ${i}`,
        cover_url: null,
        duration: 180,
        source: 'spotify',
        source_id: `${i}`,
        score: 2.0 - i * 0.1,
        score_reasons: [],
      }))

      const result = injectExplorationSlots(tracks, { exploreRatio: 0.2 })
      expect(result).toHaveLength(10)
      const explorationItems = result.filter((t) => t.score_reasons.includes('exploration_slot_injection'))
      expect(explorationItems.length).toBeGreaterThan(0)
    })
  })
})
