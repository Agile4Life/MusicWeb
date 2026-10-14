import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const { setup, callback, track, ref, audioEffect } = createRequire(import.meta.url)('./helpers/productionCallbacks.cjs')

describe('background end-of-track recovery', () => {
  function playback(workerSupport: 'working' | 'missing' | 'throws' = 'working') {
    const e = setup()
    const workers: Array<{ onmessage: ((event: { data: string }) => void) | null; onerror: (() => void) | null; postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }> = []
    e.Worker = class {
      onmessage = null
      onerror = null
      postMessage = vi.fn()
      terminate = vi.fn()
      constructor() {
        if (workerSupport === 'throws') throw new Error('Worker unavailable')
        workers.push(this)
      }
    }
    if (workerSupport === 'missing') e.Worker = undefined
    e.currentTrackRef.current = track('A')
    e.playRequestRef.current = 1
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: 'A' }
    Object.assign(e.audioRef.current, { currentTime: 179.4, duration: 180, ended: false, paused: false })
    e.desiredPlayStateRef.current = 'playing'
    e.isTabHiddenRef = ref(true)
    e.document = { hidden: true, documentElement: { setAttribute() {}, removeAttribute() {} }, addEventListener() {}, removeEventListener() {} }
    e.window.addEventListener = () => {}
    e.window.removeEventListener = () => {}
    e.html5EngineRef = ref({ setAudioElement() {} })
    // Model a hidden tab whose main-thread timers are not delivered.
    let timerTick = () => {}
    e.setInterval = (fn: () => void) => { timerTick = fn; return 1 }
    e.clearInterval = () => {}
    e.persistenceScheduler = { flushPending() {} }
    e.queueRef.current = [track('A'), track('B')]
    e.currentIndexRef.current = 0
    e.autoPlayNextRef.current = true
    e.nextTrackRef.current = vi.fn()
    e.triggerTrackCompletion = callback('triggerTrackCompletion', e)
    const cleanup = audioEffect(e)
    return { e, workers, cleanup, timerTick }
  }

  it('advances at EOF through worker messages even when window timers and ended are delayed', () => {
    const { e, workers, cleanup } = playback()
    expect(workers).toHaveLength(1)
    workers[0].onmessage?.({ data: 'tick' })
    workers[0].onmessage?.({ data: 'tick' })
    expect(e.nextTrackRef.current).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it.each(['pause', 'foreground', 'stale-owner', 'middle-of-track'])
    ('does not advance after %s', (change) => {
      const { e, workers, cleanup } = playback()
      expect(workers).toHaveLength(1)
      if (change === 'pause') e.desiredPlayStateRef.current = 'paused'
      if (change === 'foreground') e.isTabHiddenRef.current = false
      if (change === 'stale-owner') e.playRequestRef.current = 2
      if (change === 'middle-of-track') e.audioRef.current.currentTime = 80
      workers[0].onmessage?.({ data: 'tick' })
      expect(e.nextTrackRef.current).not.toHaveBeenCalled()
      cleanup()
    })

  it('stops worker ticking when the tab becomes visible and terminates on cleanup', () => {
    const { e, workers, cleanup } = playback()
    expect(workers).toHaveLength(1)
    expect(workers[0].postMessage).toHaveBeenCalledWith('start')
    e.audioRef.current.currentTime = 80
    e.document.hidden = false
    callback('handleVisibilityChange', e)()
    expect(workers[0].postMessage).toHaveBeenCalledWith('stop')
    cleanup()
    expect(workers[0].terminate).toHaveBeenCalledTimes(1)
  })

  it.each(['missing', 'throws'] as const)('retains timer recovery when worker support is %s', (support) => {
    const { e, cleanup, timerTick } = playback(support)
    timerTick()
    expect(e.nextTrackRef.current).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('retains timer recovery after the worker fails to load', () => {
    const { e, workers, cleanup, timerTick } = playback()
    workers[0].onerror?.()
    expect(workers[0].terminate).toHaveBeenCalledTimes(1)
    timerTick()
    expect(e.nextTrackRef.current).toHaveBeenCalledTimes(1)
    cleanup()
    expect(workers[0].terminate).toHaveBeenCalledTimes(1)
  })

  it('checks the new track after a late tick rather than completing the previous owner', () => {
    const { e, workers, cleanup } = playback()
    e.currentTrackRef.current = track('B')
    e.playRequestRef.current = 2
    e.audioOwnershipRef.current = { generation: 0, requestId: 2, trackId: 'B' }
    e.audioRef.current.currentTime = 10
    workers[0].onmessage?.({ data: 'tick' })
    expect(e.nextTrackRef.current).not.toHaveBeenCalled()
    cleanup()
  })

  it('does not let a stale YouTube iframe complete the active HTML5 track', () => {
    const { e, workers, cleanup } = playback()
    e.audioRef.current.currentTime = 10
    e.isCurrentYouTubeVideo = () => true
    e.ytPlayerRef.current = { getCurrentTime: () => 179.4, getDuration: () => 180 }
    workers[0].onmessage?.({ data: 'tick' })
    expect(e.nextTrackRef.current).not.toHaveBeenCalled()
    cleanup()
  })

  it('advances the active YouTube iframe at EOF', () => {
    const { e, workers, cleanup } = playback()
    e.isYtIframeEngine = () => true
    e.isCurrentYouTubeVideo = () => true
    e.ytPlayerRef.current = { getCurrentTime: () => 179.4, getDuration: () => 180 }
    workers[0].onmessage?.({ data: 'tick' })
    expect(e.nextTrackRef.current).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('repeats the current track once when duplicate EOF ticks arrive together', async () => {
    const { e, workers, cleanup } = playback()
    e.repeatModeRef.current = 'one'
    workers[0].onmessage?.({ data: 'tick' })
    workers[0].onmessage?.({ data: 'tick' })
    await new Promise(setImmediate)
    expect(e.audioRef.current.playCalls).toBe(1)
    expect(e.audioRef.current.currentTime).toBe(0)
    expect(e.nextTrackRef.current).not.toHaveBeenCalled()
    cleanup()
  })
})
