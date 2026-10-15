import type { Track } from '@/types'
import { queueTrackToTrack, type NextQueueResponse } from '@/types/queue'
import type { Cancel, PlaybackClock, PlaybackUserEffects } from '@/lib/playback/ports'

export interface BrowserUserEffectsDeps {
  fetch: typeof fetch
  clock: PlaybackClock
  resolveExternalTrack: (track: Track) => Promise<string | null>
  recommendFallback: (seed: Track, queue: Track[], count: number) => Promise<Track[]>
}

export function createBrowserUserEffects(deps: BrowserUserEffectsDeps): PlaybackUserEffects {
  let disposed = false
  let lastRecorded: { trackId: string; ts: number } | null = null
  const historyTimers = new Set<Cancel>()
  function ensureActive(signal?: AbortSignal) {
    if (disposed) throw new Error('Playback user effects disposed')
    if (signal?.aborted) throw Object.assign(new Error('Recommendation aborted'), { name: 'AbortError' })
  }
  return {
    recordHistory(track) {
      if (disposed || !track?.id) return
      const now = deps.clock.now()
      if (lastRecorded?.trackId === track.id && now - lastRecorded.ts < 3000) return
      lastRecorded = { trackId: track.id, ts: now }
      const cancel = deps.clock.after(100, () => {
        historyTimers.delete(cancel)
        if (disposed) return
        void deps.fetch('/api/history/record', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ track }),
        }).then(async res => {
          if (!res.ok) {
            const data = await res.json().catch(() => null)
            console.warn('[PlayerContext] History record failed:', res.status, data?.error)
          }
        }).catch(err => { console.warn('History tracking error:', err) })
      })
      historyTimers.add(cancel)
    },
    recordListen(track, completed, skipAtSeconds) {
      if (disposed || !track?.id) return
      void deps.fetch('/api/listen-events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: track.id, artist: track.artist || null, completed,
          skip_at_seconds: typeof skipAtSeconds === 'number' ? Math.round(skipAtSeconds) : null }),
      }).catch(() => {})
    },
    async setFavorite(track, nextValue) {
      ensureActive()
      let trackId = track.id
      if (track.source && track.source !== 'local') trackId = await deps.resolveExternalTrack(track) || trackId
      ensureActive()
      const res = await deps.fetch('/api/favorites/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId, nextValue }),
      })
      if (!res.ok) throw new Error('Favorite toggle failed')
    },
    async recommend(seed, queue, signal) {
      ensureActive()
      ensureActive(signal)
      const isrc = (seed as Track & { isrc?: string }).isrc || ''
      const historyIds = queue.slice(-50).map(track => track.id).join(',')
      let url = `/api/queue/next?current_track_id=${encodeURIComponent(seed.id)}&artist=${encodeURIComponent(seed.artist || '')}&title=${encodeURIComponent(seed.title || '')}&limit=12`
      if (isrc) url += `&isrc=${encodeURIComponent(isrc)}`
      if (historyIds) url += `&history_ids=${encodeURIComponent(historyIds)}`
      const res = await deps.fetch(url, { signal })
      ensureActive(signal)
      if (res.ok) {
        const data: NextQueueResponse = await res.json()
        ensureActive(signal)
        if (data.tracks?.length) return data.tracks.map(track => queueTrackToTrack(track))
      }
      return deps.recommendFallback(seed, queue, 8)
    },
    dispose() {
      disposed = true
      for (const cancel of historyTimers) cancel()
      historyTimers.clear()
    },
  }
}
