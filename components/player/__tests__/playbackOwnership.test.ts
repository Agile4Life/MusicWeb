import { createRequire } from 'node:module'
import { describe, it, expect } from 'vitest'

// Execute the actual callback bodies with fake refs/media, without a DOM or providers.
const { setup, callback, track, deferred, ref, mediaHandler, iframeHandler } = createRequire(import.meta.url)('./helpers/productionCallbacks.cjs')

describe('production playback ownership', () => {
  it('keeps paused state and source if the pending play rejects', async () => {
    for (const name of ['NotAllowedError', 'NetworkError']) {
      const e = setup()
      let reject!: (reason: Error) => void
      e.audioRef.current.play = () => new Promise((_resolve, fail) => { reject = fail })
      e.audioUrlCacheRef.current.set('A', { url: 'https://audio.test/A', ts: Date.now() })
      const pending = e.playTrack(track('A')); await e.togglePlay()
      const error = new Error(name); error.name = name; reject(error); await pending
      expect(e.isBuffering).toBe(false)
      expect(e.pendingResumeRef.current).toBe(false)
      expect(e.audioRef.current.src).toBe('https://audio.test/A')
    }
  })
  it('does not restart a paused iframe on a late buffering event', () => {
    const e = setup(), timers: Array<() => void> = [], t = { ...track('A'), source: 'youtube', youtube_id: 'abcdefghijk' }
    e.currentTrackRef.current = t; e.playRequestRef.current = 1
    e.ytStuckTimerRef = ref(null); e.isCurrentYouTubeVideo = () => true
    e.setTimeout = (fn: () => void) => { timers.push(fn); return timers.length }; e.clearTimeout = () => {}
    let plays = 0; e.ytPlayerRef.current = { playVideo: () => plays++ }
    e.desiredPlayStateRef.current = 'paused'
    iframeHandler('onStateChange', e)({ data: 3 })
    timers.forEach(fn => fn())
    expect(plays).toBe(0)
    expect(e.isBuffering).toBe(false)
  })

  it('does not reload an iframe after Pause during error invalidation', async () => {
    const e = setup(), invalid = deferred(), t = { ...track('A'), source: 'youtube', youtube_id: 'abcdefghijk' }
    e.currentTrackRef.current = t; e.playRequestRef.current = 1; e.desiredPlayStateRef.current = 'playing'
    e.ytRetriedRef = ref(new Set()); e.getActualYouTubeVideoId = () => t.youtube_id
    e.invalidateCurrentResolution = () => invalid.promise
    e.fetchUnifiedSearch = async () => ({ youtube: [{ ...t, youtube_id: 'newvideo123' }] })
    e.findBestYouTubeMatch = (c: unknown[]) => c[0]
    let loads = 0; e.ytPlayerRef.current = { loadVideoById: () => loads++ }
    const pending = iframeHandler('onError', e)({ data: 150 })
    e.desiredPlayStateRef.current = 'paused'; invalid.resolve(); await pending
    expect(loads).toBe(0)
    expect(e.isPlaying).toBe(false)
  })
  it('can complete another repeat loop after pausing an in-flight replay', async () => {
    const e = setup(), replay = deferred(), t = track('repeat')
    e.currentTrackRef.current = t; e.playRequestRef.current = 1; e.desiredPlayStateRef.current = 'playing'
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: t.id }; e.repeatModeRef.current = 'one'
    e.audioRef.current.src = 'https://audio.test/repeat'
    let calls = 0
    e.audioRef.current.play = () => { calls++; return calls === 1 ? replay.promise : Promise.resolve() }
    e.isIOSYouTubeHtml5Mode = () => false; e.isYouTubeIframeActive = () => false
    const complete = callback('triggerTrackCompletion', e)
    complete('ended', false); mediaHandler('pause', e)()
    replay.resolve(); await new Promise(setImmediate)
    mediaHandler('play', e)(); await new Promise(setImmediate)
    e.audioRef.current.currentTime = 180; e.audioRef.current.ended = true
    complete('ended', false); await new Promise(setImmediate)
    expect(calls).toBe(3)
  })
  it('keeps OS pause when a previous OS play promise finishes', async () => {
    const e = setup(), play = deferred(), t = track('A')
    e.currentTrackRef.current = t; e.playRequestRef.current = 1
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: t.id }
    e.isIOSYouTubeHtml5Mode = () => false; e.isYouTubeIframeActive = () => false
    e.audioRef.current.src = 'https://audio.test/A'; e.audioRef.current.play = () => play.promise
    mediaHandler('play', e)(); mediaHandler('pause', e)()
    play.resolve(); await new Promise(setImmediate)
    expect(e.isPlaying).toBe(false)
    expect(e.pendingResumeRef.current).toBe(false)
  })

  it('keeps a recovered stream paused if Pause arrives during fallback', async () => {
    const e = setup(), invalid = deferred(), t = track('A')
    e.currentTrackRef.current = t; e.playRequestRef.current = 1; e.desiredPlayStateRef.current = 'playing'
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: t.id }
    e.getCachedYouTubeId = () => null; e.saveTrackResolution = () => {}
    e.invalidateCurrentResolution = () => invalid.promise; e.setBounded = (m: Map<string, unknown>, k: string, v: unknown) => m.set(k, v)
    e.buildYouTubeStreamUrl = (id: string) => '/api/youtube/stream?id=' + id; e.isIOSDevice = () => true
    const pending = callback('fallbackToYouTube', e)(t, 1, { youtube_id: 'oldVideoId1', duration: 180 })
    await e.togglePlay(); invalid.resolve(); await pending
    expect(e.audioRef.current.playCalls).toBe(0)
    expect(e.audioRef.current.paused).toBe(true)
    expect(e.isBuffering).toBe(false)
    expect(e.fallbackInProgressRef.current.size).toBe(0)
  })

  it('never pauses a new owner when quick-play finishes late', async () => {
    const e = setup(), a = deferred(), b = deferred()
    let n = 0
    e.audioRef.current.play = function () { this.paused = false; return n++ === 0 ? a.promise : b.promise }
    for (const id of ['A', 'B']) e.audioUrlCacheRef.current.set(id, { url: 'https://audio.test/' + id, ts: Date.now() })
    const quick = callback('tryQuickPlayFromCache', e)
    quick(track('A')); quick(track('B'))
    b.resolve(); await new Promise(setImmediate); a.resolve(); await new Promise(setImmediate)
    expect(e.audioRef.current.paused).toBe(false)
  })
  it('never pauses B when A play resolves after B', async () => {
    const e = setup(), a = deferred(), b = deferred()
    let n = 0
    e.audioRef.current.play = function () { this.paused = false; return n++ === 0 ? a.promise : b.promise }
    for (const id of ['A', 'B']) e.audioUrlCacheRef.current.set(id, { url: 'https://audio.test/' + id, ts: Date.now() })
    const pa = e.playTrack(track('A')), pb = e.playTrack(track('B'))
    b.resolve(); await pb
    a.resolve(); await pa
    expect(e.audioRef.current.paused).toBe(false)
    expect(e.audioRef.current.src).toBe('https://audio.test/B')
  })

  it('drops fallback after invalidation yields ownership to B', async () => {
    const e = setup(), invalid = deferred(), a = track('A')
    e.currentTrackRef.current = a; e.playRequestRef.current = 1
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: 'A' }
    e.getCachedYouTubeId = () => null; e.saveTrackResolution = () => {}
    e.invalidateCurrentResolution = () => invalid.promise; e.setBounded = (m: Map<string, unknown>, k: string, v: unknown) => m.set(k, v)
    e.buildYouTubeStreamUrl = (id: string) => '/api/youtube/stream?id=' + id; e.isIOSDevice = () => true
    const pending = callback('fallbackToYouTube', e)(a, 1, { youtube_id: 'oldVideoId1', duration: 180 })
    e.audioUrlCacheRef.current.set('B', { url: 'https://audio.test/B', ts: Date.now() })
    await e.playTrack(track('B'))
    invalid.resolve(); await pending
    expect(e.currentTrackRef.current.id).toBe('B')
    expect(e.audioRef.current.src).toBe('https://audio.test/B')
  })

  it('does not carry a resolving A seek into B', async () => {
    const e = setup(), a = deferred(), b = deferred()
    e.getAudioUrlCached = (t: { id: string }) => t.id === 'A' ? a.promise : b.promise
    const pa = e.playTrack(track('A')); e.seek(90)
    const pb = e.playTrack(track('B')); b.resolve('https://audio.test/B'); await pb
    a.resolve(null); await pa
    expect(e.audioRef.current.currentTime).toBe(0)
  })

  it('honors pause while resolving the main stream', async () => {
    const e = setup(), url = deferred()
    e.getAudioUrlCached = () => url.promise
    const pending = e.playTrack(track('A')); await e.togglePlay()
    url.resolve('https://audio.test/A'); await pending
    expect(e.audioRef.current.paused).toBe(true)
    expect(e.isPlaying).toBe(false)
  })

  it('replays repeat-one for successive actual endings', async () => {
    const e = setup(), t = track('repeat')
    e.currentTrackRef.current = t; e.playRequestRef.current = 1; e.desiredPlayStateRef.current = 'playing'
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: t.id }; e.repeatModeRef.current = 'one'
    const complete = callback('triggerTrackCompletion', e)
    complete('ended', false); await new Promise(setImmediate)
    e.audioRef.current.currentTime = 180; e.audioRef.current.ended = true
    complete('ended', false); await new Promise(setImmediate)
    expect(e.audioRef.current.playCalls).toBe(2)
  })

  it('does not advance intentionally paused audio near EOF on foreground', () => {
    const e = setup(), t = track('paused')
    e.currentTrackRef.current = t; e.playRequestRef.current = 1
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: t.id }
    Object.assign(e.audioRef.current, { src: 'https://audio.test/A', duration: 180, currentTime: 179.5, paused: true })
    e.desiredPlayStateRef.current = 'paused'; e.isTabHiddenRef = ref(false)
    e.document = { hidden: false, documentElement: { setAttribute() {}, removeAttribute() {} } }
    let completions = 0; e.triggerTrackCompletion = () => completions++
    callback('handleVisibilityChange', e)()
    expect(completions).toBe(0)
  })

  it('does not resume pending audio after pause on foreground/canplay/activation', async () => {
    for (const name of ['handleVisibilityChange', 'handleCanPlay', 'handleUserActivation']) {
      const e = setup(), t = track('A')
      e.currentTrackRef.current = t; e.playRequestRef.current = 1
      e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: t.id }
      Object.assign(e.audioRef.current, { src: 'https://audio.test/A', duration: 180, currentTime: 10, paused: true })
      e.pendingResumeRef.current = true; e.desiredPlayStateRef.current = 'paused'; e.isTabHiddenRef = ref(false)
      e.document = { hidden: false, documentElement: { setAttribute() {}, removeAttribute() {} } }
      e.clearAudioStallWatchdog = () => {}
      callback(name, e)(); await Promise.resolve()
      expect(e.audioRef.current.playCalls, name).toBe(0)
    }
  })

  it('applies volume once after connecting Web Audio', () => {
    const e = setup(), gain = { gain: { value: 1 }, connect() {} }
    e.gainNodeRef = ref(null); e.isWebAudioConnectedRef = ref(false); e.volumeRef.current = .5
    e.audioRef.current.volume = .5
    e.window.AudioContext = function () { return { state: 'running', createGain: () => gain, createMediaElementSource: () => ({ connect() {} }), destination: {} } }
    callback('ensureWebAudioGain', e)()
    expect(e.audioRef.current.volume * gain.gain.value).toBe(.5)
  })
})
