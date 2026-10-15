import type { Cancel, PlaybackEvent, PlaybackOwner, PlaybackTransport, PreparedPlayback } from '@/lib/playback/ports'
import type { Html5AudioEngine } from '../engines/Html5AudioEngine'
import type { YouTubeIframeEngine } from '../engines/YouTubeIframeEngine'
import { isSameAudioSource } from '../audioSourceSwitch'

export interface BrowserTransportDeps {
  audio: HTMLAudioElement
  html5: Html5AudioEngine
  youtube: YouTubeIframeEngine
}
export type BrowserTransport = PlaybackTransport & { handleYouTubeEvent(event: PlaybackEvent): void }
interface Binding {
  owner: PlaybackOwner
  target: PreparedPlayback
  cancelListeners: Cancel
  cancelPromises: Set<Cancel>
}
const aborted = () => Object.assign(new Error('Playback ownership changed'), { name: 'AbortError' })
const sameOwner = (a: PlaybackOwner, b: PlaybackOwner) => a.requestId === b.requestId && a.generation === b.generation && a.trackId === b.trackId

export function createBrowserTransport({ audio, html5, youtube }: BrowserTransportDeps): BrowserTransport {
  let disposed = false
  let binding: Binding | null = null
  const listeners = new Set<(event: PlaybackEvent) => void>()
  const emit = (event: PlaybackEvent) => { for (const listener of listeners) listener(event) }
  const engine = () => binding?.target.engine === 'html5' ? html5 : youtube
  function detach() {
    const old = binding
    binding = null
    if (!old) return
    old.cancelListeners()
    for (const cancel of old.cancelPromises) cancel()
    old.cancelPromises.clear()
  }
  function guard(promise: Promise<void>, captured: Binding): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cancel = () => reject(aborted())
      captured.cancelPromises.add(cancel)
      promise.then(() => {
        captured.cancelPromises.delete(cancel)
        if (binding !== captured || disposed) reject(aborted())
        else resolve()
      }, error => {
        captured.cancelPromises.delete(cancel)
        reject(binding !== captured || disposed ? aborted() : error)
      })
      if (binding !== captured || disposed) cancel()
    })
  }
  function bindAudio(captured: Binding) {
    const boundAt = performance.now()
    const handlers: Array<[string, EventListener]> = []
    function on(name: string, callback: (event: Event) => void) {
      const handler: EventListener = event => {
        // Event.timeStamp records creation/queue time. A queued event from an old
        // resource must not acquire the new listener's owner after a source swap.
        if (binding !== captured || disposed || event.timeStamp < boundAt) return
        if (!isSameAudioSource(audio.currentSrc || audio.src, captured.target.target)) return
        callback(event)
      }
      audio.addEventListener(name, handler)
      handlers.push([name, handler])
    }
    const owner = captured.owner
    for (const type of ['playing', 'paused', 'ended'] as const) {
      on(type === 'paused' ? 'pause' : type, () => {
        if (type === 'playing' && (audio.paused || audio.ended)) return
        if (type === 'paused' && !audio.paused) return
        if (type === 'ended' && !audio.ended) return
        emit({ type, owner })
      })
    }
    const time = () => emit({ type: 'time', owner, time: html5.getCurrentTime(), duration: html5.getDuration() })
    on('timeupdate', time); on('durationchange', time)
    on('waiting', () => emit({ type: 'buffering', owner, value: true }))
    on('canplay', () => emit({ type: 'buffering', owner, value: false }))
    on('error', () => { if (audio.error) emit({ type: 'error', owner, error: audio.error }) })
    let initialTimePending = captured.target.initialTime > 0
    on('loadedmetadata', () => {
      if (initialTimePending) { initialTimePending = false; html5.seek(captured.target.initialTime) }
    })
    captured.cancelListeners = () => { for (const [name, handler] of handlers) audio.removeEventListener(name, handler) }
  }
  return {
    start(target, owner, volume, mode) {
      if (disposed) return Promise.reject(new Error('Playback transport disposed'))
      detach()
      // Silence the previous session before binding. Retain a selected HTML5
      // resource so ready-URL playback keeps its existing native fast path.
      if (target.engine === 'html5') { html5.pause(); youtube.stop() }
      else { html5.stop(); youtube.pause() }
      const captured: Binding = { owner: { ...owner }, target: { ...target }, cancelListeners: () => {}, cancelPromises: new Set() }
      binding = captured
      try {
        if (target.engine === 'html5') {
          bindAudio(captured)
          if (mode === 'paused') { html5.loadPaused(target.target, target.initialTime, volume); return Promise.resolve() }
          // Do not await before this call: native play needs the user's activation.
          return guard(html5.loadAndPlay(target.target, target.initialTime, volume), captured)
        }
        if (mode === 'paused') {
          youtube.loadPaused(target.target, target.initialTime, volume)
          return Promise.resolve()
        }
        return guard(youtube.loadAndPlay(target.target, target.initialTime, volume), captured)
      } catch (error) { return Promise.reject(error) }
    },
    pause() { if (binding && !disposed) engine().pause() },
    resume() {
      if (!binding || disposed) return Promise.reject(new Error('No active playback'))
      const captured = binding
      return guard(engine().resume(), captured)
    },
    stop() { detach(); html5.stop(); youtube.stop() },
    seek(time) { if (binding && !disposed) engine().seek(time) },
    setVolume(volume) { if (binding && !disposed) engine().setVolume(volume) },
    read() {
      if (!binding || disposed) return { time: 0, duration: 0, playing: false }
      const current = engine()
      return { time: current.getCurrentTime(), duration: current.getDuration(), playing: current.isPlaying() }
    },
    subscribe(listener) {
      if (!disposed) listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    handleYouTubeEvent(event) {
      if (!binding || disposed || binding.target.engine !== 'youtube' || !sameOwner(event.owner, binding.owner)) return
      // An actual video ID takes precedence over the engine's requested ID.
      const actual = youtube.getVideoDataId()
      if (actual ? actual !== binding.target.target : !youtube.matchesVideo(binding.target.target)) return
      emit({ ...event, owner: binding.owner })
    },
    dispose() {
      if (disposed) return
      disposed = true
      detach(); html5.stop(); youtube.stop(); listeners.clear()
    },
  }
}
