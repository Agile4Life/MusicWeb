const DEFAULT_PREFERRED_HEAD_START_MS = 1000

/** Start every candidate immediately, reserving a grace window for the preferred
 * source. After that window, prefer an already-ready fallback in list order,
 * then accept the first valid remaining candidate (including the preferred).
 * A late preferred result is promoted only if a fallback actually won.
 */
export async function resolveCatalogCandidates<T>(
  preferred: () => Promise<T | null>,
  fallbacks: Array<() => Promise<T | null>>,
  preferredHeadStartMs = DEFAULT_PREFERRED_HEAD_START_MS,
  onLatePreferredResult?: (result: T) => void,
): Promise<T | null> {
  const preferredPromise = preferred().catch(() => null)
  const settledFallbacks: Array<T | null | undefined> = new Array(fallbacks.length).fill(undefined)
  const fallbackPromises = fallbacks.map((task, index) => task().catch(() => null).then((value) => {
    settledFallbacks[index] = value
    return value
  }))

  const timeout = Symbol('timeout')
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<typeof timeout>((resolve) => {
    timer = setTimeout(() => resolve(timeout), preferredHeadStartMs)
  })
  const earlyPreferred = await Promise.race([preferredPromise, deadline])
  if (timer !== undefined) clearTimeout(timer)
  if (earlyPreferred !== timeout && earlyPreferred !== null) return earlyPreferred

  const promoteAfterFallback = () => {
    if (earlyPreferred !== timeout || !onLatePreferredResult) return
    void preferredPromise.then((value) => {
      if (value !== null) {
        try { onLatePreferredResult(value) } catch {}
      }
    })
  }

  for (const value of settledFallbacks) {
    if (value !== undefined && value !== null) {
      promoteAfterFallback()
      return value
    }
  }

  // Null results retire only their own candidate, never block another source.
  const pending = new Map<number, Promise<{ index: number; value: T | null }>>()
  const candidates = [preferredPromise, ...fallbackPromises]
  candidates.forEach((promise, index) => {
    pending.set(index, promise.then((value) => ({ index, value })))
  })
  while (pending.size) {
    const { index, value } = await Promise.race(pending.values())
    pending.delete(index)
    if (value !== null) {
      if (index !== 0) promoteAfterFallback()
      return value
    }
  }
  return null
}
