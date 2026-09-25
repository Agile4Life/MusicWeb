const DEFAULT_PREFERRED_HEAD_START_MS = 1000

/**
 * Resolves catalog candidates in parallel from t=0.
 * Gives the preferred source (e.g. NhacCuaTui) a priority grace window (default 1000ms).
 *
 * Rules:
 * 1. All tasks (preferred and fallbacks) start immediately at t=0.
 * 2. If the preferred source resolves to a non-null result within the grace window,
 *    it wins immediately (preferred priority).
 * 3. If the preferred source returns null (e.g. 404/not found) before the window expires,
 *    the window is cancelled early and fallbacks are evaluated immediately.
 * 4. If the preferred source exceeds the window:
 *    - Fallbacks are evaluated in order of preference (e.g. SoundCloud -> YouTube).
 *    - If a fallback already completed with a valid result, it is returned immediately.
 *    - Otherwise, fallbacks are awaited in order of priority.
 *    - If fallbacks all fail, the preferred source is awaited as a last resort.
 * 5. Anti-Race / Late Preferred Result:
 *    If the preferred source finishes after the window and a fallback was chosen,
 *    onLatePreferredResult(result) is invoked in the background to allow populating
 *    L2/DB cache for future plays without causing audio glitches or race conditions in current playback.
 */
export async function resolveCatalogCandidates<T>(
  preferred: () => Promise<T | null>,
  fallbacks: Array<() => Promise<T | null>>,
  preferredHeadStartMs = DEFAULT_PREFERRED_HEAD_START_MS,
  onLatePreferredResult?: (result: T) => void,
): Promise<T | null> {
  const preferredPromise = preferred().catch(() => null)
  const fallbackPromises = fallbacks.map((task) => task().catch(() => null))

  // Track settled fallback results in real time
  const settledFallbacks: Array<T | null | undefined> = new Array(fallbacks.length).fill(undefined)
  fallbackPromises.forEach((promise, index) => {
    promise.then((res) => {
      settledFallbacks[index] = res
    })
  })

  let isWindowExpired = false
  let timerId: ReturnType<typeof setTimeout> | undefined

  const timeoutSymbol = Symbol('timeout')
  const deadlinePromise = new Promise<typeof timeoutSymbol>((resolve) => {
    timerId = setTimeout(() => {
      isWindowExpired = true
      resolve(timeoutSymbol)
    }, preferredHeadStartMs)
  })

  // Race preferred against deadline
  const preferredResult = await Promise.race([
    preferredPromise,
    deadlinePromise,
  ])

  // Clear timer if preferred finished before deadline
  if (timerId) clearTimeout(timerId)

  // Case 1: Preferred succeeded within the window
  if (preferredResult !== timeoutSymbol && preferredResult !== null) {
    return preferredResult
  }

  // If preferred is still running past the deadline, hook background cache promotion
  if (isWindowExpired && onLatePreferredResult) {
    preferredPromise.then((lateRes) => {
      if (lateRes !== null) {
        try {
          onLatePreferredResult(lateRes)
        } catch {}
      }
    })
  }

  // Case 2: Preferred timed out or returned null. Check fallbacks in priority order.
  // First, check if any higher-priority fallback has ALREADY settled with a valid result
  for (let i = 0; i < fallbacks.length; i++) {
    if (settledFallbacks[i] !== undefined && settledFallbacks[i] !== null) {
      return settledFallbacks[i]!
    }
  }

  // Second, await remaining fallbacks in priority order (e.g. SoundCloud first, then YouTube)
  for (let i = 0; i < fallbacks.length; i++) {
    const res = await fallbackPromises[i]
    if (res !== null) return res
  }

  // Third, as a last resort, check if preferred finally produced a valid result
  const finalPreferred = await preferredPromise
  if (finalPreferred !== null) return finalPreferred

  return null
}
