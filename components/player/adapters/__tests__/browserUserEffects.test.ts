import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserUserEffects } from '../browserUserEffects'
import type { Track } from '@/types'
const track = { id: 'a', title: 'A', artist: 'Artist', source: 'youtube' } as Track
function setup() {
  vi.useFakeTimers()
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tracks: [] }) })
  const resolveExternalTrack = vi.fn().mockResolvedValue('database-a')
  const recommendFallback = vi.fn().mockResolvedValue([{ ...track, id: 'fallback' }])
  const effects = createBrowserUserEffects({ fetch, resolveExternalTrack, recommendFallback, clock: { now: () => Date.now(), after: (ms, fn) => { const id = setTimeout(fn, ms); return () => clearTimeout(id) }, every: () => () => {} } })
  return { effects, fetch, resolveExternalTrack, recommendFallback }
}
afterEach(() => vi.useRealTimers())
describe('browser user effects', () => {
  it('delays history 100ms, deduplicates 3s, and cancels unsent history', async () => {
    const { effects, fetch } = setup()
    effects.recordHistory(track); effects.recordHistory(track)
    await vi.advanceTimersByTimeAsync(99); expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ track })
    effects.recordHistory(track); await vi.advanceTimersByTimeAsync(2900)
    expect(fetch).toHaveBeenCalledTimes(1)
    effects.recordHistory(track); await vi.advanceTimersByTimeAsync(100)
    expect(fetch).toHaveBeenCalledTimes(2)
    effects.recordHistory({ ...track, id: 'b' }); effects.dispose(); await vi.advanceTimersByTimeAsync(100)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('keeps listen fields and rounding, and swallows analytics network errors', async () => {
    const { effects, fetch } = setup()
    effects.recordListen(track, false, 4.7)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ track_id: 'a', artist: 'Artist', completed: false, skip_at_seconds: 5 })
    fetch.mockRejectedValue(new Error('offline')); effects.recordListen(track, true)
    await Promise.resolve()
  })
  it('resolves external IDs for favorites and rejects HTTP or network failure', async () => {
    const { effects, fetch, resolveExternalTrack } = setup()
    await effects.setFavorite(track, true)
    expect(resolveExternalTrack).toHaveBeenCalledWith(track)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ trackId: 'database-a', nextValue: true })
    fetch.mockResolvedValue({ ok: false }); await expect(effects.setFavorite(track, false)).rejects.toThrow()
    fetch.mockRejectedValue(new Error('offline')); await expect(effects.setFavorite(track, false)).rejects.toThrow('offline')
  })
  it('does not begin favorite HTTP or recommendation fallback after disposal', async () => {
    const { effects, fetch, resolveExternalTrack, recommendFallback } = setup()
    let resolved!: (id: string) => void
    resolveExternalTrack.mockImplementationOnce(() => new Promise<string>(resolve => { resolved = resolve }))
    const favorite = effects.setFavorite(track, true)
    effects.dispose(); resolved('database-a')
    await expect(favorite).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled(); expect(recommendFallback).not.toHaveBeenCalled()
  })
  it('does not start fallback after abort while reading an empty API response', async () => {
    const { effects, fetch, recommendFallback } = setup()
    let finish!: (value: { tracks: never[] }) => void
    fetch.mockResolvedValue({ ok: true, json: () => new Promise(resolve => { finish = resolve }) })
    const controller = new AbortController()
    const pending = effects.recommend(track, [], controller.signal)
    await Promise.resolve(); controller.abort(); finish({ tracks: [] })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(recommendFallback).not.toHaveBeenCalled()
  })
  it('returns mapped API candidates without fallback and preserves default user IDs', async () => {
    const { effects, fetch, recommendFallback } = setup()
    fetch.mockResolvedValue({ ok: true, json: async () => ({ tracks: [{ id: 'nct-123', title: 'Song', artist: 'Singer', source: 'nhaccuatui', source_id: '123', duration: 10, cover_url: null }] }) })
    const result = await effects.recommend(track, [], new AbortController().signal)
    expect(result).toEqual([expect.objectContaining({ id: 'nct-123', source: 'nhaccuatui', nhaccuatui_id: '123', user_id: '00000000-0000-4000-a000-000000000001' })])
    expect(recommendFallback).not.toHaveBeenCalled()
    fetch.mockResolvedValue({ ok: false })
    expect(await effects.recommend(track, [], new AbortController().signal)).toEqual([expect.objectContaining({ id: 'fallback' })])
    expect(recommendFallback).toHaveBeenCalledTimes(1)
  })
  it('uses queue API parameters and falls back only after an empty or HTTP failure response', async () => {
    const { effects, fetch, recommendFallback } = setup()
    const signal = new AbortController().signal
    expect(await effects.recommend(track, [track], signal)).toEqual([expect.objectContaining({ id: 'fallback' })])
    expect(fetch.mock.calls[0][0]).toBe('/api/queue/next?current_track_id=a&artist=Artist&title=A&limit=12&history_ids=a')
    expect(fetch.mock.calls[0][1].signal).toBe(signal)
    expect(recommendFallback).toHaveBeenCalledWith(track, [track], 8)
    fetch.mockRejectedValue(new Error('network')); await expect(effects.recommend(track, [], signal)).rejects.toThrow('network')
    expect(recommendFallback).toHaveBeenCalledTimes(1)
  })
})
