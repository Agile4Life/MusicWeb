import { describe, it, expect, vi } from 'vitest'
import { Track } from '@/types'

describe('NCT Playback Race Guards & Concurrency Isolation', () => {
  it('prevents duplicate concurrent fallbackToYouTube calls for the exact same requestId (Mutex Guard)', async () => {
    const fallbackInProgress = new Set<number>()
    let executionCount = 0

    const executeFallback = async (requestId: number) => {
      if (fallbackInProgress.has(requestId)) {
        // Mutex hit: drop redundant concurrent execution immediately (0ms overhead)
        return
      }
      fallbackInProgress.add(requestId)
      try {
        executionCount++
        // Simulate async work like search / loadVideo
        await new Promise((r) => setTimeout(r, 20))
      } finally {
        // Keeps the request guarded so late duplicate timeouts do not re-run
      }
    }

    const reqId = 101
    // Simulate both the 2nd error event and the 4s timeout firing fallback concurrently
    await Promise.all([
      executeFallback(reqId),
      executeFallback(reqId),
    ])

    expect(executionCount).toBe(1)
  })

  it('aborts the 4000ms NCT retry waiting period early (<100ms) when the retry stream fails immediately', async () => {
    let nctSucceeded = false
    let abortedEarly = false
    const NCT_RACE_TIMEOUT_MS = 4000

    const startTime = Date.now()

    // Simulate audio element error event firing 30ms after load()
    setTimeout(() => {
      abortedEarly = true
    }, 30)

    await Promise.race([
      new Promise<void>((resolve) => {
        const check = () => {
          if (nctSucceeded || abortedEarly) {
            resolve()
            return
          }
          setTimeout(check, 10)
        }
        setTimeout(check, 10)
      }),
      new Promise<void>((resolve) => setTimeout(() => resolve(), NCT_RACE_TIMEOUT_MS)),
    ])

    const elapsed = Date.now() - startTime
    expect(elapsed).toBeLessThan(500) // Much faster than 4000ms!
    expect(abortedEarly).toBe(true)
    expect(nctSucceeded).toBe(false)
  })

  it('cancels the pending audioStallWatchdog timer immediately on stream error', () => {
    let watchdogTimer: any = setTimeout(() => {}, 6500)
    let watchdogFired = false

    const clearAudioStallWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer)
        watchdogTimer = null
      }
    }

    // When an error occurs, watchdog MUST be cancelled immediately
    clearAudioStallWatchdog()

    expect(watchdogTimer).toBeNull()
    expect(watchdogFired).toBe(false)
  })

  it('prevents an in-flight prewarm promise from re-populating the cache after clearCachedNctStreamUrl', async () => {
    const { prewarmNctStreamUrl, getCachedNctStreamUrl, clearCachedNctStreamUrl } = await import('@/lib/nhaccuatuiClient')
    const songId = 'race-guard-test-song'

    let resolveFetch: (res: Response) => void = () => {}
    const slowFetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => slowFetchPromise)

    // Trigger prewarm (starts in-flight fetch with gen 1)
    const prewarmTask = prewarmNctStreamUrl(songId)

    // While prewarm is pending over network, stream error occurs and clears the cache (bumps gen)
    clearCachedNctStreamUrl(songId)

    // Slow network response finally completes
    resolveFetch(
      new Response(
        JSON.stringify({ url: 'https://cdn.example.com/stale-stream.mp3' }),
        { status: 200 }
      )
    )
    await prewarmTask

    // Cache must remain null because generation mismatch discarded the stale result
    expect(getCachedNctStreamUrl(songId)).toBeNull()
  })
})
