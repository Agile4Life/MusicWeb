import { describe, expect, it, vi } from 'vitest'
import { fetchWithRetry, isTransientError } from '../fetchWithRetry'

describe('fetchWithRetry', () => {
  it('retries a transient HTTP response before returning success', async () => {
    const operation = vi.fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const result = await fetchWithRetry(operation, {
      retries: 1,
      baseDelayMs: 0,
      retryOn: (outcome) => outcome instanceof Response && isTransientError(outcome),
    })

    expect(result.status).toBe(200)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('retries a classified timeout error before returning success', async () => {
    const timeout = new Error('request timeout')
    timeout.name = 'TimeoutError'
    const operation = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce('resolved')

    await expect(fetchWithRetry(operation, {
      retries: 1,
      baseDelayMs: 0,
      retryOn: (outcome) => outcome instanceof Error && outcome.name === 'TimeoutError',
    })).resolves.toBe('resolved')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('returns a non-transient HTTP response without retrying it', async () => {
    const operation = vi.fn<() => Promise<Response>>().mockResolvedValue(new Response(null, { status: 403 }))

    const result = await fetchWithRetry(operation, {
      retries: 2,
      baseDelayMs: 0,
      retryOn: (outcome) => outcome instanceof Response && isTransientError(outcome),
    })

    expect(result.status).toBe(403)
    expect(operation).toHaveBeenCalledOnce()
  })
})
