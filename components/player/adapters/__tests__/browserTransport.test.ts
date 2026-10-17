import { describe, it, expect, vi } from 'vitest'
import { createBrowserTransport } from '../browserTransport'
import { Html5AudioEngine } from '../../engines/Html5AudioEngine'
import { YouTubeIframeEngine } from '../../engines/YouTubeIframeEngine'
import type { PlaybackEvent, PlaybackOwner, PreparedPlayback } from '@/lib/playback/ports'
import type { Track } from '@/types'
class FakeAudio extends EventTarget {
 src = ''; currentSrc = ''; currentTime = 0; duration = 60; volume = .8; muted = false; paused = true; ended = false; readyState = 4; error: MediaError | null = null
 play = vi.fn(() => { this.paused = false; return Promise.resolve() })
 pause = vi.fn(() => { this.paused = true })
 removeAttribute() { this.src = '' }
}
const owner = (id = 'a', generation = 1): PlaybackOwner => ({ requestId: generation, generation, trackId: id })
const target = (id = 'a', engine: 'html5' | 'youtube' = 'html5'): PreparedPlayback => ({ track: { id } as Track, engine, target: engine === 'html5' ? `https://media.test/${id}.mp3` : id, initialTime: 0 })
function setup() {
 const audio = new FakeAudio()
 const player = { loadVideoById: vi.fn(), cueVideoById: vi.fn(), playVideo: vi.fn(), pauseVideo: vi.fn(), stopVideo: vi.fn(), mute: vi.fn(), unMute: vi.fn(), setVolume: vi.fn(), seekTo: vi.fn(), getCurrentTime: () => 7, getDuration: () => 100, getPlayerState: () => 1, getVideoData: () => ({ video_id: 'b' }) }
 const html5 = new Html5AudioEngine(audio as unknown as HTMLAudioElement), youtube = new YouTubeIframeEngine(player)
 const transport = createBrowserTransport({ audio: audio as unknown as HTMLAudioElement, html5, youtube })
 return { audio, player, transport }
}
describe('browser transport', () => {
 it('calls native play synchronously before start yields and switches engines exclusively', async () => {
  const { audio, player, transport } = setup()
  const pending = transport.start(target(), owner(), .4, 'play')
  expect(audio.play).toHaveBeenCalledTimes(1); expect(audio.volume).toBe(.4)
  await pending
  expect(player.stopVideo).toHaveBeenCalled()
  await transport.start(target('b', 'youtube'), owner('b', 2), .6, 'play')
  expect(audio.paused).toBe(true); expect(audio.src).toBe(''); expect(player.playVideo).toHaveBeenCalledTimes(1)
  transport.seek(12); transport.setVolume(.3)
  expect(player.seekTo).toHaveBeenCalledWith(12, true); expect(player.setVolume).toHaveBeenLastCalledWith(30)
  expect(transport.read()).toEqual({ time: 7, duration: 100, playing: true })
 })
 it('preserves an already selected audio URL on the synchronous play path without calling pause', async () => {
  const { audio, transport } = setup()
  audio.src = target().target; audio.currentSrc = audio.src
  const remove = vi.spyOn(audio, 'removeAttribute')
  const pending = transport.start(target(), owner(), .8, 'play')
  expect(audio.pause).not.toHaveBeenCalled()
  expect(audio.play).toHaveBeenCalledTimes(1)
  expect(remove).not.toHaveBeenCalled()
  await pending
 })
 it('loads paused audio and YouTube without invoking play and restores seek after metadata', async () => {
  const { audio, player, transport } = setup()
  await transport.start({ ...target(), initialTime: 14 }, owner(), .2, 'paused')
  expect(audio.play).not.toHaveBeenCalled(); expect(audio.paused).toBe(true)
  audio.currentSrc = audio.src; audio.dispatchEvent(new Event('loadedmetadata'))
  expect(audio.currentTime).toBe(14)
  await transport.resume(); expect(audio.play).toHaveBeenCalledTimes(1)
  transport.pause(); expect(audio.paused).toBe(true)
  await transport.start({ ...target('b', 'youtube'), initialTime: 8 }, owner('b', 2), .7, 'paused')
  expect(player.cueVideoById).toHaveBeenCalledWith({ videoId: 'b', startSeconds: 8 })
  expect(player.playVideo).not.toHaveBeenCalled(); expect(player.loadVideoById).not.toHaveBeenCalled()
 })
 it('retains captured owners, rejects stale completion, and rejects queued old events after source switches', async () => {
  const { audio, transport } = setup()
  const events: PlaybackEvent[] = []
  transport.subscribe(event => events.push(event))
  let complete!: () => void
  audio.play.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve }))
  const a = transport.start(target(), owner(), .8, 'play')
  const stale = expect(a).rejects.toMatchObject({ name: 'AbortError' })
  const oldPlaying = new Event('playing'), oldEnded = new Event('ended'), oldError = new Event('error')
  await transport.start(target('b'), owner('b', 2), .8, 'play')
  audio.currentSrc = audio.src
  audio.dispatchEvent(oldPlaying); audio.dispatchEvent(oldEnded); audio.dispatchEvent(oldError)
  complete(); await stale
  expect(events).toEqual([])
  audio.dispatchEvent(new Event('playing'))
  audio.currentTime = 9; audio.dispatchEvent(new Event('timeupdate'))
  expect(events).toEqual([{ type: 'playing', owner: owner('b', 2) }, { type: 'time', owner: owner('b', 2), time: 9, duration: 60 }])
 })
 it('does not relabel queued audio events when repeating the same URL and owner', async () => {
  const { audio, transport } = setup(), events: PlaybackEvent[] = []
  transport.subscribe(event => events.push(event))
  await transport.start(target(), owner(), .8, 'play')
  const late = ['playing', 'ended', 'error'].map(name => new Event(name))
  await transport.start(target(), owner(), .8, 'play')
  audio.currentSrc = audio.src
  late.forEach(event => audio.dispatchEvent(event))
  expect(events).toEqual([])
  audio.dispatchEvent(new Event('playing'))
  expect(events).toEqual([{ type: 'playing', owner: owner() }])
 })
 it('rejects events whose actual audio source has not caught up to the binding', async () => {
  const { audio, transport } = setup(), events: PlaybackEvent[] = []
  transport.subscribe(event => events.push(event))
  await transport.start(target(), owner(), .8, 'play'); audio.currentSrc = audio.src
  await transport.start(target('b'), owner('b', 2), .8, 'play')
  audio.dispatchEvent(new Event('ended')); audio.dispatchEvent(new Event('playing')); audio.dispatchEvent(new Event('error'))
  expect(events).toEqual([])
  audio.currentSrc = audio.src; audio.dispatchEvent(new Event('playing'))
  expect(events).toEqual([{ type: 'playing', owner: owner('b', 2) }])
 })
 it('checks native state before relaying late events created after a same-URL repeat', async () => {
  const { audio, transport } = setup(), events: PlaybackEvent[] = []
  transport.subscribe(event => events.push(event))
  await transport.start(target(), owner(), .8, 'play')
  await transport.start(target(), owner('a', 2), .8, 'play'); audio.currentSrc = audio.src
  audio.dispatchEvent(new Event('ended')); audio.dispatchEvent(new Event('error')); audio.dispatchEvent(new Event('pause'))
  expect(events).toEqual([])
  transport.pause(); audio.dispatchEvent(new Event('playing'))
  expect(events).toEqual([])
  audio.dispatchEvent(new Event('pause'))
  audio.ended = true; audio.dispatchEvent(new Event('ended'))
  audio.error = { code: 2, message: 'network' } as MediaError; audio.dispatchEvent(new Event('error'))
  expect(events).toEqual([
   { type: 'paused', owner: owner('a', 2) }, { type: 'ended', owner: owner('a', 2) },
   { type: 'error', owner: owner('a', 2), error: audio.error },
  ])
 })
 it('validates YouTube owners/video identity and supports unsubscribe', async () => {
  const { transport, player } = setup(), events: PlaybackEvent[] = []
  const off = transport.subscribe(event => events.push(event))
  await transport.start(target('b', 'youtube'), owner('b', 2), .8, 'play')
  transport.handleYouTubeEvent({ type: 'ended', owner: owner() })
  player.getVideoData = () => ({ video_id: 'a' })
  transport.handleYouTubeEvent({ type: 'playing', owner: owner('b', 2) })
  expect(events).toEqual([])
  player.getVideoData = () => ({ video_id: 'b' })
  transport.handleYouTubeEvent({ type: 'playing', owner: owner('b', 2) })
  expect(events).toHaveLength(1)
  off(); transport.handleYouTubeEvent({ type: 'ended', owner: owner('b', 2) }); expect(events).toHaveLength(1)
 })
 it('disposes idempotently, removes listeners and rejects in-flight play immediately', async () => {
  const { audio, transport } = setup(), events: PlaybackEvent[] = []
  transport.subscribe(event => events.push(event))
  audio.play.mockImplementationOnce(() => new Promise<void>(() => {}))
  const pending = transport.start(target(), owner(), .8, 'play')
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  transport.dispose(); transport.dispose(); await rejected
  audio.dispatchEvent(new Event('playing')); expect(events).toEqual([])
  expect(audio.src).toBe(''); expect(transport.read()).toEqual({ time: 0, duration: 0, playing: false })
  await expect(transport.start(target(), owner(), .8, 'play')).rejects.toThrow()
 })
 it('emits buffering=true on stalled HTML5 audio events', async () => {
  const { audio, transport } = setup(), events: PlaybackEvent[] = []
  transport.subscribe(event => events.push(event))
  await transport.start(target(), owner(), .8, 'play'); audio.currentSrc = audio.src
  audio.dispatchEvent(new Event('stalled'))
  audio.dispatchEvent(new Event('canplay'))
  expect(events).toEqual([
   { type: 'buffering', owner: owner(), value: true },
   { type: 'buffering', owner: owner(), value: false },
  ])
 })
 it('does not emit time=0 on early durationchange before loadedmetadata during reload, and updates pending initialTime on seek', async () => {
  const { audio, player, transport } = setup(), events: PlaybackEvent[] = []
  transport.subscribe(event => events.push(event))
  await transport.start({ ...target(), initialTime: 85 }, owner(), .6, 'paused')
  audio.currentSrc = audio.src
  // Browser fires durationchange while currentTime is still 0 before loadedmetadata
  audio.currentTime = 0; audio.duration = 210
  audio.dispatchEvent(new Event('durationchange'))
  expect(transport.read().time).toBe(85)
  expect(events).toEqual([{ type: 'time', owner: owner(), time: 85, duration: 210 }])
  // User seeks to 42s before loadedmetadata fires
  transport.seek(42)
  expect(transport.read().time).toBe(42)
  audio.dispatchEvent(new Event('loadedmetadata'))
  expect(audio.currentTime).toBe(42)
  // YouTube loadPaused also ensures player is unmuted
  await transport.start({ ...target('b', 'youtube'), initialTime: 30 }, owner('b', 2), .5, 'paused')
  expect(player.unMute).toHaveBeenCalled()
 })
})
