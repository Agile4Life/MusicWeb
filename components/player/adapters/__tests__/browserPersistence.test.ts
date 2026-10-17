import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserPersistence } from '../browserPersistence'
import type { Track } from '@/types'
const track = { id: 'yt-abcdefghijk', title: 'Song', youtube_id: 'abcdefghijk', duration: 20, file_path: '', cover_url: null } as Track
function storage(value: string | null = null) {
 const values = new Map<string, string>(value === null ? [] : [['musicweb_player_state', value]])
 vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
 return values
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('browser persistence', () => {
 it('restores the existing schema, infers source and preserves repeat separately', () => {
  const values = storage(JSON.stringify({ track, currentTime: 7, queue: [track, track], currentIndex: 0, volume: .4, savedAt: 1 }))
  values.set('musicweb_repeat_mode', 'one')
  const persistence = createBrowserPersistence()
  expect(persistence.restore()).toEqual({ track: expect.objectContaining({ id: track.id, source: 'youtube' }), currentTime: 7, queue: [expect.objectContaining({ id: track.id })], currentIndex: 0, volume: .4 })
  expect(persistence.getRepeat()).toBe('one'); persistence.setRepeat('all')
  expect(values.get('musicweb_repeat_mode')).toBe('all')
 })
 it('does not hydrate malformed queue entries and tolerates corrupt or blocked storage', () => {
  storage(JSON.stringify({ track, queue: [null, { id: 4 }, { id: 'bad', file_path: 3 }, track] }))
  const persistence = createBrowserPersistence()
  expect(persistence.restore()?.queue.map(t => t.id)).toEqual([track.id])
  storage('{'); expect(persistence.restore()).toBeNull()
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } })
  expect(persistence.restore()).toBeNull(); expect(persistence.getRepeat()).toBe('off')
  expect(() => { persistence.setRepeat('one'); persistence.save({ track, queue: [track], currentIndex: 0, currentTime: 0, volume: .8 }, true) }).not.toThrow()
 })
 it('owns its scheduler, supports time/flush, and discards pending work on dispose', () => {
  vi.useFakeTimers(); const values = storage()
  const a = createBrowserPersistence(), b = createBrowserPersistence()
  const payload = { track, queue: [track], currentIndex: 0, currentTime: 1, volume: .8 }
  a.save(payload); a.updateTime(9); b.save({ ...payload, currentTime: 3 }); b.dispose()
  a.flush(); expect(JSON.parse(values.get('musicweb_player_state')!).currentTime).toBe(9)
  vi.advanceTimersByTime(30000); expect(JSON.parse(values.get('musicweb_player_state')!).currentTime).toBe(9)
 })
 it('reconciles currentIndex after queue deduplication and preserves extended track metadata on reload', () => {
  const values = storage()
  const persistence = createBrowserPersistence()
  const dup1 = { ...track, id: 'dup-1', title: 'Same Song', artist: 'Same Artist', source: 'spotify' } as Track
  const dup2 = { ...track, id: 'dup-2', title: 'Same Song (Official Video)', artist: 'Same Artist', source: 'nhaccuatui', nhaccuatui_id: 'nct-1' } as Track
  const active = {
   ...track,
   id: 'active-3',
   title: 'Active Song',
   artist: 'Active Artist',
   spotify_album_id: 'alb-99',
   view_count: 123456,
   source_url: 'https://open.spotify.com/track/active-3',
   soundcloud_permalink_url: 'https://soundcloud.com/artist/active-3',
   file_ext: 'flac',
  } as Track
  // Queue has duplicate before active track (saved currentIndex is 2, but after dedupe active track is at index 1)
  persistence.save({ track: active, queue: [dup1, dup2, active], currentIndex: 2, currentTime: 55, volume: .75 }, true)
  const restored = persistence.restore()
  expect(restored).not.toBeNull()
  expect(restored!.queue).toHaveLength(2)
  expect(restored!.currentIndex).toBe(1)
  expect(restored!.queue[restored!.currentIndex].id).toBe('active-3')
  expect(restored!.track).toMatchObject({
   id: 'active-3',
   spotify_album_id: 'alb-99',
   view_count: 123456,
   source_url: 'https://open.spotify.com/track/active-3',
   soundcloud_permalink_url: 'https://soundcloud.com/artist/active-3',
   file_ext: 'flac',
  })
 })
})
