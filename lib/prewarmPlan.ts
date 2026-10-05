import type { Track } from '@/types'

/**
 * Which upcoming tracks should be speculatively prewarmed after a track starts.
 * Excludes the current track and anything already known, and never goes past the
 * end of the queue.
 */
export function planUpcomingPrewarm(
  queue: Track[],
  currentIndex: number,
  options: { count?: number; fastConnection?: boolean } = {}
): Track[] {
  const { count = 3, fastConnection = true } = options
  if (!fastConnection) return []
  if (!queue || queue.length === 0) return []
  if (currentIndex < 0 || currentIndex >= queue.length - 1) return []

  const currentId = queue[currentIndex]?.id
  const seen = new Set<string>()
  const out: Track[] = []
  for (const t of queue.slice(currentIndex + 1, currentIndex + 1 + count)) {
    if (!t?.id || t.id === currentId || seen.has(t.id)) continue
    seen.add(t.id)
    out.push(t)
  }
  return out
}

/**
 * Tracks the AbortController of the in-flight fallback search so a newer playback
 * request can cancel it instead of letting a skipped track keep consuming bandwidth.
 */
export class SupersedableRequest {
  private controller: AbortController | null = null

  /** Cancel any previous request and return a fresh signal for the new one. */
  begin(): AbortSignal {
    this.abort()
    this.controller = new AbortController()
    return this.controller.signal
  }

  abort(): void {
    if (this.controller) {
      this.controller.abort()
      this.controller = null
    }
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    ((err as { name?: string }).name === 'AbortError' ||
      String((err as { message?: string }).message || '').toLowerCase().includes('aborted'))
  )
}
