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
})
