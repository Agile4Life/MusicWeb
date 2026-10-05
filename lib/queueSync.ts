import type { Track } from '@/types'

/**
 * Merge a resolved track into the queue entry with the same id.
 * Operates on the LATEST queue (pass the functional-update `prev`) so that
 * entries appended while resolution was in flight (smart queue fill, add to
 * queue) are never lost. Returns the same array reference if nothing matched,
 * so React can bail out of a re-render.
 */
export function mergeResolvedIntoQueue(queue: Track[], resolved: Track): Track[] {
  let changed = false
  const next = queue.map((entry) => {
    if (entry.id !== resolved.id) return entry
    changed = true
    return { ...entry, ...resolved }
  })
  return changed ? next : queue
}
