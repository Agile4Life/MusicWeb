/**
 * Pure decision helpers for playback side-effects, extracted so the rules can be unit tested.
 */

/**
 * Smart queue fill de-duplication.
 * - Same seed already in flight  -> 'skip' (don't spam the API).
 * - Different seed in flight      -> 'start' (the user moved on; supersede the stale request,
 *                                    otherwise the queue is never refilled for the new track).
 * - Repeat mode active            -> 'skip' (queue must stay as-is).
 */
export function decideSmartFill(input: {
  inflightSeedId: string | null
  seedId: string
  repeatMode: 'off' | 'all' | 'one'
}): 'skip' | 'start' {
  if (input.repeatMode !== 'off') return 'skip'
  if (input.inflightSeedId === input.seedId) return 'skip'
  return 'start'
}

/**
 * A "skip" is a listen that ended early: past the first 2s (ignore accidental taps)
 * and not within the last 5s (that is effectively a completed track).
 */
export function shouldRecordSkip(input: { activeTime: number; duration?: number | null }): boolean {
  const { activeTime } = input
  const dur = input.duration || 0
  if (!Number.isFinite(activeTime)) return false
  return activeTime > 2 && (dur === 0 || activeTime < dur - 5)
}
