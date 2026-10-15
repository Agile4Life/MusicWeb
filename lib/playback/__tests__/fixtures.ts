import type { Track } from '@/types'

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export function makeTrack(id: string, patch: Partial<Track> = {}): Track {
  return {
    id, user_id: 'fixture-user', title: id, artist: 'Fixture Artist',
    duration: 180, file_path: `/fixtures/${id}.wav`, cover_url: null,
    created_at: '2026-10-15T00:00:00.000Z', source: 'local', ...patch,
  }
}
