import { describe, expect, it, vi } from 'vitest'
import type { ListeningHistoryItem, Track } from '@/types'
import { aggregateTopTracks, fetchTopListeningHistory } from '../listeningHistory'

describe('aggregateTopTracks', () => {
  const trackA: Track = {
    id: 'track-a',
    user_id: 'user-1',
    title: 'Song A',
    artist: 'Artist A',
    duration: 180,
    file_path: '',
    cover_url: null,
    created_at: '2026-01-01T00:00:00Z',
  }

  const trackB: Track = {
    id: 'track-b',
    user_id: 'user-1',
    title: 'Song B',
    artist: 'Artist B',
    duration: 200,
    file_path: '',
    cover_url: null,
    created_at: '2026-01-01T00:00:00Z',
  }

  const trackC: Track = {
    id: 'track-c',
    user_id: 'user-1',
    title: 'Song C',
    artist: 'Artist C',
    duration: 220,
    file_path: '',
    cover_url: null,
    created_at: '2026-01-01T00:00:00Z',
  }

  it('aggregates play counts and sorts tracks descending by play count', () => {
    const items: ListeningHistoryItem[] = [
      { id: '1', user_id: 'user-1', track_id: 'track-a', played_at: '2026-08-10T10:00:00Z', track: trackA },
      { id: '2', user_id: 'user-1', track_id: 'track-b', played_at: '2026-08-10T11:00:00Z', track: trackB },
      { id: '3', user_id: 'user-1', track_id: 'track-a', played_at: '2026-08-11T12:00:00Z', track: trackA },
      { id: '4', user_id: 'user-1', track_id: 'track-a', played_at: '2026-08-12T13:00:00Z', track: trackA },
      { id: '5', user_id: 'user-1', track_id: 'track-b', played_at: '2026-08-12T14:00:00Z', track: trackB },
      { id: '6', user_id: 'user-1', track_id: 'track-c', played_at: '2026-08-12T15:00:00Z', track: trackC },
    ]

    const result = aggregateTopTracks(items, 10)

    expect(result).toHaveLength(3)
    // Track A has 3 plays -> Rank 1
    expect(result[0].track.id).toBe('track-a')
    expect(result[0].playCount).toBe(3)
    expect(result[0].lastPlayedAt).toBe('2026-08-12T13:00:00Z')

    // Track B has 2 plays -> Rank 2
    expect(result[1].track.id).toBe('track-b')
    expect(result[1].playCount).toBe(2)
    expect(result[1].lastPlayedAt).toBe('2026-08-12T14:00:00Z')

    // Track C has 1 play -> Rank 3
    expect(result[2].track.id).toBe('track-c')
    expect(result[2].playCount).toBe(1)
  })

  it('uses lastPlayedAt as tie breaker when play counts are equal', () => {
    const items: ListeningHistoryItem[] = [
      { id: '1', user_id: 'user-1', track_id: 'track-a', played_at: '2026-08-10T10:00:00Z', track: trackA },
      { id: '2', user_id: 'user-1', track_id: 'track-b', played_at: '2026-08-12T10:00:00Z', track: trackB },
    ]

    const result = aggregateTopTracks(items, 10)

    expect(result).toHaveLength(2)
    // Track B was played more recently, so it should be first among equal counts
    expect(result[0].track.id).toBe('track-b')
    expect(result[1].track.id).toBe('track-a')
  })

  it('respects limit parameter', () => {
    const items: ListeningHistoryItem[] = [
      { id: '1', user_id: 'user-1', track_id: 'track-a', played_at: '2026-08-10T10:00:00Z', track: trackA },
      { id: '2', user_id: 'user-1', track_id: 'track-b', played_at: '2026-08-11T10:00:00Z', track: trackB },
      { id: '3', user_id: 'user-1', track_id: 'track-c', played_at: '2026-08-12T10:00:00Z', track: trackC },
    ]

    const result = aggregateTopTracks(items, 2)
    expect(result).toHaveLength(2)
  })
})
