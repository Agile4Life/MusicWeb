import type { Track } from '@/types'

/**
 * Checks if the user's current connection is fast enough for speculative prewarming.
 * Returns false if:
 * 1. navigator.connection.saveData is true (Data Saver mode enabled).
 * 2. navigator.connection.effectiveType is 'slow-2g', '2g', or '3g'.
 * Defaults to true if Network Information API is unavailable or connection is '4g' / fast.
 */
export function isFastConnection(nav?: Navigator): boolean {
  try {
    const n = nav !== undefined ? nav : (typeof navigator !== 'undefined' ? navigator : undefined)
    if (!n) return true

    const conn = (n as any).connection || (n as any).mozConnection || (n as any).webkitConnection
    if (!conn) return true

    if (conn.saveData === true) return false

    if (conn.effectiveType) {
      const type = String(conn.effectiveType).toLowerCase()
      if (type === 'slow-2g' || type === '2g' || type === '3g') {
        return false
      }
    }

    return true
  } catch {
    return true
  }
}
