import { describe, expect, it } from 'vitest'
import { mergeResolvedIntoQueue } from '../queueSync'
import type { Track } from '@/types'

const t = (id: string, extra: Partial<Track> = {}) => ({ id, title: id, artist: 'a', ...extra }) as Track

describe('mergeResolvedIntoQueue', () => {
  it('merges resolved fields into the matching entry only', () => {
    const q = [t('a'), t('b'), t('c')]
    const out = mergeResolvedIntoQueue(q, t('b', { source: 'youtube', youtube_id: 'yt1' }))
    expect(out[1]).toMatchObject({ id: 'b', source: 'youtube', youtube_id: 'yt1' })
    expect(out[0]).toBe(q[0])
    expect(out[2]).toBe(q[2])
  })

  it('does not lose tracks appended after the snapshot was taken (smart-fill race)', () => {
    const snapshot = [t('a'), t('b')]
    // smart fill appended tracks while resolution was in flight
    const latest = [...snapshot, t('fill1'), t('fill2')]
    const out = mergeResolvedIntoQueue(latest, t('b', { youtube_id: 'yt' }))
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'fill1', 'fill2'])
    expect(out[1].youtube_id).toBe('yt')
  })

  it('follows the track by id when its index shifted', () => {
    const latest = [t('x'), t('a'), t('b')] // 'b' moved from index 1 to 2
    const out = mergeResolvedIntoQueue(latest, t('b', { youtube_id: 'yt' }))
    expect(out[2].youtube_id).toBe('yt')
    expect(out[1]).toBe(latest[1])
  })

  it('returns the same reference when the track is no longer in the queue', () => {
    const latest = [t('a')]
    expect(mergeResolvedIntoQueue(latest, t('gone'))).toBe(latest)
  })
})
