/**
 * fetch() whose timeout covers only the wait for response headers.
 * AbortSignal.timeout() on fetch also aborts the body mid-stream, which cuts long
 * audio downloads on slow clients; this clears the timer once headers arrive.
 * The client signal still aborts the body (listener lives for the request's lifetime).
 */
export async function fetchWithConnectTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  clientSignal?: AbortSignal | null
): Promise<Response> {
  const controller = new AbortController()
  if (clientSignal) {
    if (clientSignal.aborted) controller.abort(clientSignal.reason)
    else clientSignal.addEventListener('abort', () => controller.abort(clientSignal.reason), { once: true })
  }
  const timer = setTimeout(() => controller.abort(new Error('Connection timeout')), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
