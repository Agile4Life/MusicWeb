import { firstValidResult } from './firstValidResult'

const DEFAULT_PREFERRED_HEAD_START_MS = 250

/**
 * Gives the preferred catalog source a brief head start, then returns the
 * first available result without waiting for unrelated slow providers.
 */
export async function resolveCatalogCandidates<T>(
  preferred: () => Promise<T | null>,
  fallbacks: Array<() => Promise<T | null>>,
  preferredHeadStartMs = DEFAULT_PREFERRED_HEAD_START_MS,
): Promise<T | null> {
  const preferredPromise = preferred().catch(() => null)
  const pending = Symbol('pending')

  const earlyResult = await Promise.race([
    preferredPromise,
    new Promise<typeof pending>((resolve) => {
      setTimeout(() => resolve(pending), preferredHeadStartMs)
    }),
  ])

  if (earlyResult !== pending && earlyResult !== null) return earlyResult

  return firstValidResult([
    () => preferredPromise,
    ...fallbacks,
  ])
}
