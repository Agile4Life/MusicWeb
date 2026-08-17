/**
 * Retry a fetch (or any function returning a Promise<Response>) with
 * exponential backoff on transient failures.
 *
 * Only retries on: network errors, HTTP 502/503/504, and timeout.
 * Does NOT retry on: 4xx client errors (400, 401, 403, 404), 2xx success.
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number       // total attempts (default: 2)
    baseDelayMs?: number  // delay before first retry (default: 200)
    maxDelayMs?: number   // cap on delay (default: 1000)
    retryOn?: (err: unknown, attempt: number) => boolean
  } = {}
): Promise<T> {
  const {
    retries = 2,
    baseDelayMs = 200,
    maxDelayMs = 1000,
    retryOn,
  } = options

  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      // Last attempt — give up
      if (attempt === retries) break

      // Check if error is retryable
      if (retryOn && !retryOn(err, attempt)) break

      // Calculate delay: 200, 400, 800… capped at maxDelayMs
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Check if a fetch Response represents a transient server error worth retrying.
 */
export function isTransientError(res: Response): boolean {
  return res.status === 502 || res.status === 503 || res.status === 504 || res.status === 500
}

/**
 * Check if an error is a network/timeout error worth retrying.
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false // Don't retry aborted
  if (err instanceof Error) {
    // Timeout, fetch failure, network errors
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) return true
    if (err.message?.includes('fetch') || err.message?.includes('network')) return true
  }
  return false
}
