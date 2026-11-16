/**
 * Abuse guard for the public `invalidate=1` cache bust. A bust revokes the shared
 * resolution for every listener, so one key may be busted at most once per
 * window, and one client only a bounded number of times per minute. Refused
 * requests are still served as a normal resolve; nothing breaks, nothing is busted.
 */
const KEY_WINDOW_MS = 30_000
const CLIENT_WINDOW_MS = 60_000
const CLIENT_MAX_PER_WINDOW = 20
const MAX_TRACKED = 5000

export interface InvalidateGuard {
  allow(key: string, client: string, now?: number): boolean
}

function bound<V>(map: Map<string, V>): void {
  while (map.size > MAX_TRACKED) {
    const oldest = map.keys().next().value
    if (oldest === undefined) return
    map.delete(oldest)
  }
}

export function createInvalidateGuard(): InvalidateGuard {
  const lastByKey = new Map<string, number>()
  const byClient = new Map<string, { windowStart: number; count: number }>()
  return {
    allow(key, client, now = Date.now()) {
      const last = lastByKey.get(key)
      if (last !== undefined && now - last < KEY_WINDOW_MS) return false
      const entry = byClient.get(client)
      if (entry && now - entry.windowStart < CLIENT_WINDOW_MS) {
        if (entry.count >= CLIENT_MAX_PER_WINDOW) return false
        entry.count += 1
      } else {
        byClient.set(client, { windowStart: now, count: 1 })
      }
      lastByKey.delete(key)
      lastByKey.set(key, now)
      bound(lastByKey)
      bound(byClient)
      return true
    },
  }
}
