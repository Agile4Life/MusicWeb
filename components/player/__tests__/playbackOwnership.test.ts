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

  it('preserves playback position on fallback only when candidate duration matches within 8s', async () => {
    const e = setup(), t = { ...track('A'), duration: 200 }
    e.currentTrackRef.current = t; e.playRequestRef.current = 1; e.desiredPlayStateRef.current = 'playing'
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: t.id }
    e.currentTimeRef.current = 72
    e.getCachedYouTubeId = () => null; e.saveTrackResolution = () => {}
    e.setBounded = (m: Map<string, unknown>, k: string, v: unknown) => m.set(k, v)
    e.buildYouTubeStreamUrl = (id: string) => '/api/youtube/stream?id=' + id; e.isIOSDevice = () => false
    let loadedArgs: unknown = null
    e.ytPlayerRef.current = {
      loadVideoById: (args: unknown) => { loadedArgs = args },
      playVideo: () => {},
      unMute: () => {},
      setVolume: () => {},
    }

    await callback('fallbackToYouTube', e)(t, 1, { youtube_id: 'matchDur123', duration: 203 })
    expect(loadedArgs).toEqual({ videoId: 'matchDur123', startSeconds: 72 })

    e.fallbackInProgressRef.current.clear()
    await callback('fallbackToYouTube', e)(t, 1, { youtube_id: 'longMvId123', duration: 260 })
    expect(loadedArgs).toEqual({ videoId: 'longMvId123' })
  })

  it('skips redundant 4s NCT local-proxy retry when audio.src is already on local proxy', async () => {
    const e = setup()
    const t = { ...track('nct1'), source: 'nhaccuatui', nhaccuatui_id: 'nct123' }
    e.currentTrackRef.current = t; e.playRequestRef.current = 1; e.desiredPlayStateRef.current = 'playing'
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: t.id }
    e.audioRef.current.src = 'https://app.test/api/nhaccuatui/stream?id=nct123'
    let fallbackCalled = 0
    e.fallbackToYouTube = async () => { fallbackCalled++ }

    await callback('handleError', e)()
    expect(fallbackCalled).toBe(1)
    expect(e.nctRetriedRef.current.has(1)).toBe(true)
    expect(e.nctRetryAbortedRef.current.has(1)).toBe(true)
  })

  it('preserves consecutiveSkipRef across error auto-skip while resetting on manual navigation', () => {
    const e = setup()
    e.queueRef.current = [track('A'), track('B')]
    e.currentIndexRef.current = 0
    e.playResolvedTrack = () => {}
    const nextTrack = callback('nextTrack', e)

    e.consecutiveSkipRef.current = 2
    e.isErrorAutoSkipRef.current = true
    nextTrack()
    expect(e.consecutiveSkipRef.current).toBe(2)

    e.isErrorAutoSkipRef.current = false
    nextTrack()
    expect(e.consecutiveSkipRef.current).toBe(0)
  })

  it('caches SoundCloud catalog resolution and warms audioUrlCacheRef in triggerAdaptivePrewarm', async () => {
    const e = setup()
    e.isFastConnection = () => true
    const catalogNext = {
      id: 'spotify-track-2',
      title: 'Midnight City',
      artist: 'M83',
      duration: 243,
      source: 'spotify',
      file_path: '',
    }
    let warmedTrack: unknown = null
    e.resolveStreamCached = async () => ({
      source: 'soundcloud',
      id: 'sc-998877',
      title: 'Midnight City',
      artist: 'M83',
      duration: 243,
    })
    e.getAudioUrlCached = async (t: { id: string; soundcloud_id?: string }) => {
      warmedTrack = t
      const url = `/api/soundcloud/stream?id=${t.soundcloud_id}`
      e.audioUrlCacheRef.current.set(t.id, { url, ts: Date.now() })
      return url
    }

    callback('triggerAdaptivePrewarm', e)([track('A'), catalogNext], 0)
    await new Promise(setImmediate)

    const cachedRes = e.trackResolutionCacheRef.current.get('spotify-track-2')
    expect(cachedRes?.activeTrack).toMatchObject({
      id: 'spotify-track-2',
      source: 'soundcloud',
      soundcloud_id: 'sc-998877',
    })
    expect(warmedTrack).toMatchObject({
      id: 'spotify-track-2',
      source: 'soundcloud',
      soundcloud_id: 'sc-998877',
    })
    expect(e.audioUrlCacheRef.current.get('spotify-track-2')?.url).toBe(
      '/api/soundcloud/stream?id=sc-998877',
    )
  })

  it('pre-resolves iTunes 30s preview tracks in triggerAdaptivePrewarm instead of treating apple.com preview URL as direct playable', async () => {
    const e = setup()
    e.isFastConnection = () => true
    e.isPreviewUrl = (u: string) => Boolean(u && (u.includes('apple.com') || u.includes('preview')))
    const itunesPreviewNext = {
      id: 'itunes-track-2',
      title: 'Love Story',
      artist: 'Taylor Swift',
      duration: 235,
      source: 'itunes',
      itunes_id: 'it-111',
      file_path: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/mzaf_123.plus.aac.p.m4a',
    }
    let resolveCalled = 0
    e.resolveStreamCached = async () => {
      resolveCalled++
      return {
        source: 'nhaccuatui',
        id: 'nct-love-story',
        title: 'Love Story',
        artist: 'Taylor Swift',
        duration: 235,
      }
    }
    e.getAudioUrlCached = async (t: { id: string; nhaccuatui_id?: string }) => {
      const url = `/api/nhaccuatui/stream?id=${t.nhaccuatui_id}`
      e.audioUrlCacheRef.current.set(t.id, { url, ts: Date.now() })
      return url
    }

    callback('triggerAdaptivePrewarm', e)([track('A'), itunesPreviewNext], 0)
    await new Promise(setImmediate)

    expect(resolveCalled).toBe(1)
    const cachedRes = e.trackResolutionCacheRef.current.get('itunes-track-2')
    expect(cachedRes?.activeTrack).toMatchObject({
      id: 'itunes-track-2',
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-love-story',
      file_path: '',
    })
    expect(e.audioUrlCacheRef.current.get('itunes-track-2')?.url).toBe(
      '/api/nhaccuatui/stream?id=nct-love-story',
    )
  })

  it('synchronously quick-plays pre-resolved tracks in background/iOS when audioUrlCacheRef misses, resets nextTrackEndPrewarmedRef, and chains triggerAdaptivePrewarm', async () => {
    const e = setup()
    e.isIOSDevice = () => true
    e.isTabHiddenRef.current = true
    e.nextTrackEndPrewarmedRef.current = true
    const t1 = track('song-1')
    const t2 = {
      id: 'song-2',
      title: 'Song 2',
      artist: 'Artist 2',
      duration: 200,
      source: 'itunes',
      itunes_id: 'it-2',
      file_path: 'https://audio-ssl.itunes.apple.com/preview.m4a',
    }
    const t3 = track('song-3')
    e.queueRef.current = [t1, t2, t3]
    e.currentTrackRef.current = t1
    e.currentIndexRef.current = 0

    // Pre-resolved in trackResolutionCacheRef (e.g. to NCT), but audioUrlCacheRef is empty/cold
    e.trackResolutionCacheRef.current.set('song-2', {
      activeTrack: {
        ...t2,
        source: 'nhaccuatui',
        nhaccuatui_id: 'nct-song-2',
        file_path: '',
      },
      resolvedAt: Date.now(),
    })

    let adaptivePrewarmIndex = -1
    e.triggerAdaptivePrewarm = (_q: unknown, idx: number) => {
      adaptivePrewarmIndex = idx
    }

    const tryQuickPlay = callback('tryQuickPlayFromCache', e)
    const ok = tryQuickPlay(t2, 1, [t1, t2, t3])

    expect(ok).toBe(true)
    expect(e.nextTrackEndPrewarmedRef.current).toBe(false)
    expect(e.audioRef.current.src).toBe('/api/nhaccuatui/stream?id=nct-song-2')
    expect(e.audioRef.current.playCalls).toBe(1)

    await Promise.resolve()
    expect(adaptivePrewarmIndex).toBe(1)
  })

  it('resumes WebKit interrupted AudioContext state in ensureWebAudioGain', () => {
    const e = setup()
    let resumeCalls = 0
    e.audioContextRef.current = {
      state: 'interrupted',
      resume() {
        resumeCalls++
        this.state = 'running'
        return Promise.resolve()
      },
    }
    e.gainNodeRef = ref({ gain: { value: 0.8 } })
    e.isWebAudioConnectedRef = ref(true)

    callback('ensureWebAudioGain', e)()
    expect(resumeCalls).toBe(1)
  })

  it('advances track when Safari fires pause at EOF before or instead of ended in background', () => {
    const e = setup()
    const t = track('safari-eof')
    e.currentTrackRef.current = t
    e.playRequestRef.current = 1
    e.desiredPlayStateRef.current = 'playing'
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: t.id }
    Object.assign(e.audioRef.current, {
      src: 'https://app.test/song.mp3',
      duration: 200,
      currentTime: 199.8,
      ended: false,
      paused: true,
    })

    let completionReason = ''
    e.triggerTrackCompletion = (reason: string) => {
      completionReason = reason
    }

    callback('handlePause', e)()
    expect(completionReason).toBe('html5-pause-at-eof')
  })

  it('does not trigger a premature 1200ms auto-skip in handleError when playTrack catch has already started fallbackToYouTube', async () => {
    const e = setup()
    const invalid = deferred()
    const search = deferred()
    const t1 = { ...track('ditto'), source: 'nhaccuatui', nhaccuatui_id: 'nct-ditto' }
    const t2 = track('next-song')
    e.queueRef.current = [t1, t2]
    e.currentIndexRef.current = 0
    e.autoPlayNextRef.current = true
    e.invalidateCurrentResolution = () => invalid.promise
    e.getCachedYouTubeId = () => null
    e.saveTrackResolution = () => {}
    e.fetchUnifiedSearch = () => search.promise
    e.fallbackToYouTube = callback('fallbackToYouTube', e)

    let nextTrackCalled = 0
    e.nextTrackRef.current = () => { nextTrackCalled++ }
    const scheduledTimers: Array<() => void> = []
    e.setTimeout = (fn: () => void) => {
      scheduledTimers.push(fn)
      return scheduledTimers.length
    }

    // Simulate audio.play() rejecting AND <audio> dispatching handleError concurrently
    e.getAudioUrlCached = async () => 'https://nct-stream-cache.test/stream?id=nct-ditto'
    e.audioRef.current.play = () => Promise.reject(new Error('502 Bad Gateway'))

    const playPromise = e.playTrack(t1, [t1, t2], 0)
    await new Promise(setImmediate)

    // handleError fires right as playTrack catch triggers fallbackToYouTube
    const errPromise = callback('handleError', e)()
    invalid.resolve()
    await errPromise
    await playPromise

    // Flush any timers scheduled during handleError (e.g. the old 1200ms auto-skip timer)
    scheduledTimers.forEach((fn) => fn())

    // Must NOT have auto-skipped while fallbackToYouTube search is still in-flight!
    expect(nextTrackCalled).toBe(0)
    expect(e.consecutiveSkipRef.current).toBe(0)
    expect(e.fallbackInProgressRef.current.has(e.playRequestRef.current)).toBe(true)

    // Now let fallbackToYouTube finish and load the YouTube IFrame Player
    let loadedYtId: unknown = null
    e.ytPlayerRef.current = {
      loadVideoById: (arg: { videoId: string }) => { loadedYtId = arg.videoId },
      playVideo: () => {},
      unMute: () => {},
      setVolume: () => {},
    }
    search.resolve({ youtube: [{ ...t1, youtube_id: 'pSUydWEqKwE', duration: 185 }] })
    await new Promise(setImmediate)

    expect(loadedYtId).toBe('pSUydWEqKwE')
    expect(e.isPlaying).toBe(true)
    expect(nextTrackCalled).toBe(0)
  })

  it('falls through to YouTube IFrame Player on iOS when /api/yt-stream fails in fallbackToYouTube and clears stale provider IDs', async () => {
    const e = setup()
    e.isIOSDevice = () => true
    const t = {
      ...track('birds'),
      source: 'soundcloud',
      soundcloud_id: '1822834458',
      nhaccuatui_id: 'stale-nct',
    }
    e.currentTrackRef.current = t
    e.playRequestRef.current = 1
    e.desiredPlayStateRef.current = 'playing'
    e.audioOwnershipRef.current = { generation: 0, requestId: 1, trackId: t.id }
    e.getCachedYouTubeId = () => 'V9PVRfjEBTI'
    e.saveTrackResolution = () => {}
    e.audioRef.current.play = () => Promise.reject(new Error('502 Bad Gateway from /api/yt-stream'))

    let loadedVideoId: string | null = null
    e.ytPlayerRef.current = {
      loadVideoById: (arg: { videoId: string }) => { loadedVideoId = arg.videoId },
      playVideo: () => {},
      unMute: () => {},
      setVolume: () => {},
    }

    await callback('fallbackToYouTube', e)(t, 1)

    expect(loadedVideoId).toBe('V9PVRfjEBTI')
    expect(e.ytHtml5ModeRef.current).toBe(false)
    expect(e.isPlaying).toBe(true)
    expect(e.isBuffering).toBe(false)
    expect(e.currentTrackRef.current.source).toBe('youtube')
    expect(e.currentTrackRef.current.youtube_id).toBe('V9PVRfjEBTI')
    expect(e.currentTrackRef.current.soundcloud_id).toBeUndefined()
    expect(e.currentTrackRef.current.nhaccuatui_id).toBeUndefined()
  })

  it('falls through to YouTube IFrame Player in playTrack on iOS when direct YouTube HTML5 stream proxy fails', async () => {
    const e = setup()
    e.isIOSDevice = () => true
    const ytTrack = {
      ...track('yt-direct'),
      source: 'youtube',
      youtube_id: 'dQw4w9WgXcQ',
      file_path: '',
    }
    e.getAudioUrlCached = async () => '/api/yt-stream?id=dQw4w9WgXcQ'
    e.audioRef.current.play = () => Promise.reject(new Error('502 Bad Gateway'))

    let loadedVideoId: string | null = null
    e.ytPlayerRef.current = {
      loadVideoById: (arg: { videoId: string }) => { loadedVideoId = arg.videoId },
      playVideo: () => {},
      unMute: () => {},
      setVolume: () => {},
    }

    await e.playTrack(ytTrack, [ytTrack], 0)

    expect(loadedVideoId).toBe('dQw4w9WgXcQ')
    expect(e.ytHtml5ModeRef.current).toBe(false)
    expect(e.isPlaying).toBe(true)
    expect(e.isBuffering).toBe(false)
  })
})
