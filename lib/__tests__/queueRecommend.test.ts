import { describe, it, expect } from 'vitest'
import {
  normalizeString,
  getDedupKey,
  getTrackIdentityVariants,
  dedupCandidates,
  diversify,
  injectExplorationSlots,
} from '../queueRecommend'
import { QueueTrack } from '@/types/queue'

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

    it('returns identity variants for skipped track set comparison', () => {
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
      expect(variants).toContain('spotify-999')
      expect(variants).toContain('999')
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
