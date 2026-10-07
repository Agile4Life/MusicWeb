import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCatalogCandidates } from '../catalogResolutionRace'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('catalog candidates after the preference window', () => {
  afterEach(() => vi.useRealTimers())

  it('returns newly ready YouTube while SoundCloud is still pending', async () => {
    vi.useFakeTimers()
    const nct = deferred<string | null>()
    const sc = deferred<string | null>()
    const yt = deferred<string | null>()
    let winner: string | null | undefined
    const result = resolveCatalogCandidates(() => nct.promise, [() => sc.promise, () => yt.promise], 1000)
    void result.then((value) => { winner = value })
    await vi.advanceTimersByTimeAsync(1000)
    yt.resolve('youtube')
    await vi.advanceTimersByTimeAsync(0)
    expect(winner).toBe('youtube')
    sc.resolve(null)
    nct.resolve(null)
    await result
  })

  it('lets late NCT win while all fallbacks are pending without promoting it', async () => {
    vi.useFakeTimers()
    const nct = deferred<string | null>()
    const sc = deferred<string | null>()
    const onLate = vi.fn()
    let winner: string | null | undefined
    const result = resolveCatalogCandidates(() => nct.promise, [() => sc.promise], 1000, onLate)
    void result.then((value) => { winner = value })
    await vi.advanceTimersByTimeAsync(1000)
    nct.resolve('nhaccuatui')
    await vi.advanceTimersByTimeAsync(0)
    expect(winner).toBe('nhaccuatui')
    expect(onLate).not.toHaveBeenCalled()
    sc.resolve('soundcloud')
    await result
  })

  it('starts all providers immediately and promotes NCT only after a fallback wins', async () => {
    vi.useFakeTimers()
    const nct = deferred<string | null>()
    const sc = deferred<string | null>()
    const starts: string[] = []
    const onLate = vi.fn()
    const result = resolveCatalogCandidates(
      () => { starts.push('nct'); return nct.promise },
      [() => { starts.push('sc'); return sc.promise }], 1000, onLate,
    )
    expect(starts).toEqual(['nct', 'sc'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(onLate).not.toHaveBeenCalled()
    sc.resolve('soundcloud')
    await expect(result).resolves.toBe('soundcloud')
    nct.resolve('nhaccuatui')
    await vi.advanceTimersByTimeAsync(0)
    expect(onLate).toHaveBeenCalledExactlyOnceWith('nhaccuatui')
  })
})

describe('resolveCatalogCandidates Priority Race Engine', () => {
  it('returns preferred source (NCT) immediately when it resolves within head start window', async () => {
    const startedAt = Date.now()
    const result = await resolveCatalogCandidates(
      () => new Promise<{ source: string } | null>((resolve) => setTimeout(() => resolve({ source: 'nhaccuatui' }), 10)),
      [
        async () => ({ source: 'soundcloud' }),
        async () => ({ source: 'youtube' }),
      ],
      50,
    )

    expect(result).toEqual({ source: 'nhaccuatui' })
    expect(Date.now() - startedAt).toBeLessThan(45)
  })

  it('fails fast and returns first fallback immediately when preferred source returns null before deadline', async () => {
    const startedAt = Date.now()
    const result = await resolveCatalogCandidates(
      () => new Promise<{ source: string } | null>((resolve) => setTimeout(() => resolve(null), 10)),
      [
        async () => ({ source: 'soundcloud' }),
        async () => ({ source: 'youtube' }),
      ],
      200, // Long 200ms window, but should NOT wait 200ms
    )

    expect(result).toEqual({ source: 'soundcloud' })
    expect(Date.now() - startedAt).toBeLessThan(100)
  })

  it('prioritizes SoundCloud over YouTube when preferred source (NCT) times out past window', async () => {
    const startedAt = Date.now()
    const result = await resolveCatalogCandidates(
      // NCT is slow (> 200ms)
      () => new Promise<{ source: string } | null>((resolve) => setTimeout(() => resolve({ source: 'nhaccuatui' }), 200)),
      [
        // SoundCloud is ready
        async () => ({ source: 'soundcloud' }),
        // YouTube is ready
        async () => ({ source: 'youtube' }),
      ],
      30, // Window is 30ms
    )

    expect(result).toEqual({ source: 'soundcloud' })
    expect(Date.now() - startedAt).toBeLessThan(80)
  })

  it('falls back to YouTube when preferred times out and SoundCloud returns null', async () => {
    const result = await resolveCatalogCandidates(
      // NCT is slow (> 100ms)
      () => new Promise<{ source: string } | null>((resolve) => setTimeout(() => resolve({ source: 'nhaccuatui' }), 100)),
      [
        // SoundCloud not found
        async () => null,
        // YouTube found
        async () => ({ source: 'youtube' }),
      ],
      20,
    )

    expect(result).toEqual({ source: 'youtube' })
  })

  it('invokes onLatePreferredResult when preferred source finishes after window expired', async () => {
    const onLateMock = vi.fn()

    const result = await resolveCatalogCandidates(
      // NCT finishes after 60ms
      () => new Promise<{ source: string } | null>((resolve) => setTimeout(() => resolve({ source: 'nhaccuatui' }), 60)),
      [
        async () => ({ source: 'soundcloud' }),
      ],
      20, // Window is 20ms
      onLateMock,
    )

    // Current playback immediately received SoundCloud
    expect(result).toEqual({ source: 'soundcloud' })

    // Wait for the late NCT promise to settle
    await new Promise((r) => setTimeout(r, 70))

    // Background callback was called with the late NCT result for cache promotion
    expect(onLateMock).toHaveBeenCalledWith({ source: 'nhaccuatui' })
  })

  it('returns null when all sources are unavailable', async () => {
    const result = await resolveCatalogCandidates(
      async () => null,
      [
        async () => null,
        async () => { throw new Error('upstream down') },
      ],
      10,
    )

    expect(result).toBeNull()
  })
})
