import { expect, test as base, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

interface NativeAudioFixture { origin: string; data: Buffer }
const nativeAudioFixtures = new WeakMap<Page, NativeAudioFixture>()

// WebKit's native media loader needs a real HTTP response. Each test gets a
// loopback-only server on an OS-assigned port, with no account/provider traffic.
export const test = base.extend<{ nativeAudio: NativeAudioFixture }>({
  nativeAudio: [async ({ page }, provideFixture) => {
    const fixture = { origin: '', data: wav() }
    const server = createServer((request, response) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range' }
      if (request.method === 'OPTIONS') { response.writeHead(204, cors); response.end(); return }
      if (!request.url?.startsWith('/fixture.wav?')) { response.writeHead(404, cors); response.end(); return }
      const data = fixture.data
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1
      if (start >= data.length || end < start) {
        response.writeHead(416, { ...cors, 'Content-Range': `bytes */${data.length}` }); response.end(); return
      }
      response.writeHead(range ? 206 : 200, { ...cors, 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1, 'Cache-Control': 'no-store',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) })
      response.end(data.subarray(start, end + 1))
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    fixture.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    nativeAudioFixtures.set(page, fixture)
    try { await provideFixture(fixture) } finally {
      nativeAudioFixtures.delete(page)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, { auto: true }],
})

interface PlaybackProbe {
  events: { name: string; src: string; time: number; paused: boolean }[]
  handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>>
  gains: { gain: GainNode; analyser: AnalyserNode; context: AudioContext }[]
}

declare global {
  interface Window {
    __playbackProbe: PlaybackProbe
    webkitAudioContext?: typeof AudioContext
  }
}

export function wav(seconds = 12, frequency = 440): Buffer {
  const rate = 22050
  const count = Math.round(seconds * rate)
  const data = Buffer.alloc(44 + count * 2)
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28)
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36)
  data.writeUInt32LE(count * 2, 40)
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * frequency / rate) * 12000), 44 + i * 2)
  return data
}

export const tracks = ['A', 'B'].map((letter) => ({
  id: `reliability-${letter}`, title: `Reliability ${letter}`, artist: 'Fixture Artist',
  album: 'Browser Fixtures', source: 'spotify', duration: 12, file_path: '',
  cover_url: null, created_at: '2026-01-01T00:00:00Z',
}))

export function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

// Observe native audio and registered production handlers; no playback method is replaced.
export async function installObservers(page: Page, repeat = 'off') {
  await page.addInitScript(({ repeat }) => {
    const w = window
    w.__playbackProbe = { events: [], handlers: {}, gains: [] }
    for (const [key, value] of Object.entries({ has_seen_onboarding: 'true', cookie_consent: 'true',
      musicweb_hide_welcome_modal: 'true', musicweb_announcement_dismissed_v: '99999',
      musicweb_language: 'en', musicweb_repeat_mode: repeat, musicweb_show_romaji: 'false' })) localStorage.setItem(key, value)
    for (const name of ['playing', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'error']) {
      document.addEventListener(name, (event) => {
        const audio = event.target
        if (audio instanceof HTMLAudioElement) w.__playbackProbe.events.push({ name, src: audio.currentSrc, time: audio.currentTime, paused: audio.paused })
      }, true)
    }
    if (navigator.mediaSession) {
      const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
      navigator.mediaSession.setActionHandler = (action, handler) => {
        w.__playbackProbe.handlers[action] = handler
        return original(action, handler)
      }
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (AudioCtx) {
      const original = AudioCtx.prototype.createGain
      AudioCtx.prototype.createGain = function (this: AudioContext) {
        const gain = original.call(this)
        const analyser = this.createAnalyser()
        gain.connect(analyser)
        w.__playbackProbe.gains.push({ gain, analyser, context: this })
        return gain
      }
    }
  }, { repeat })
}

export async function setup(page: Page, options: { repeat?: string; resolveA?: ReturnType<typeof deferred>; lyricsA?: ReturnType<typeof deferred>; seconds?: number } = {}) {
  const nativeAudio = nativeAudioFixtures.get(page)
  if (!nativeAudio) throw new Error('Use the playback test fixture to start native HTTP audio')
  nativeAudio.data = wav(options.seconds || 12)
  const requested: string[] = []
  page.once('close', () => { options.resolveA?.release(); options.lyricsA?.release() })
  await installObservers(page, options.repeat)
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === nativeAudio.origin) return route.continue()
    if (url.pathname === '/api/resolve-stream') {
      const title = url.searchParams.get('title') || ''
      requested.push(title)
      if (title === tracks[0].title && options.resolveA) await options.resolveA.promise
      const letter = title.endsWith('B') ? 'B' : 'A'
      const streamUrl = `${nativeAudio.origin}/fixture.wav?track=${letter}`
      return route.fulfill({ json: { source: 'drive', id: streamUrl, title, artist: 'Fixture Artist', duration: 12, streamUrl } })
    }
    if (url.hostname === 'lrclib.net') {
      const title = url.searchParams.get('track_name') || url.searchParams.get('q') || ''
      if (title.includes('Reliability A') && options.lyricsA) await options.lyricsA.promise
      const letter = title.includes('Reliability B') ? 'B' : 'A'
      const lyric = { id: letter === 'A' ? 1 : 2, trackName: `Reliability ${letter}`, artistName: 'Fixture Artist', duration: 12, instrumental: false,
        syncedLyrics: `[00:00.00]${letter} first fixture line\n[00:01.00]${letter} second fixture line\n[00:02.00]${letter} third fixture line`, plainLyrics: null }
      return route.fulfill({ json: url.pathname.endsWith('/search') ? [lyric] : lyric })
    }
    if (url.pathname === '/api/search') return route.fulfill({ json: { spotify: url.searchParams.has('q') ? tracks : [], nhaccuatui: [], youtube: [], soundcloud: [], local: [], deezer: [], itunes: [], audius: [] } })
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: {
      user: { id: '00000000-0000-4000-8000-000000000001', name: 'Playback Fixture', email: 'playback-fixture@example.test' }, expires: '2099-01-01T00:00:00Z',
    } })
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, data: { is_enabled: false }, items: [], trackIds: [], albums: [], playlists: [] } })
    if (url.origin === 'http://127.0.0.1:9' || url.hostname.endsWith('.supabase.co')) return route.fulfill({ json: [] })
    if (url.hostname === 'soundcloud.com') return route.fulfill({ contentType: 'text/html', body: '<html></html>' })
    if (url.hostname === 'api-v2.soundcloud.com') return route.fulfill({ json: { collection: [], next_href: null } })
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort()
    return route.continue()
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const mobile = (page.viewportSize()?.width || 1440) < 1024
  if (mobile) await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  const input = mobile ? page.getByPlaceholder('Tìm bài hát, nghệ sĩ, lời bài hát...') : page.locator('input.search-input:visible').first()
  await expect(input).toBeVisible()
  await input.fill('Reliability')
  await input.press('Enter')
  const rows = page.locator('.song-row')
  await expect(rows.filter({ hasText: tracks[0].title }).first()).toBeVisible()
  return { rows, requested }
}

export async function playRow(page: Page, letter: 'A' | 'B') {
  const row = page.locator('.song-row').filter({ hasText: `Reliability ${letter}` }).first()
  await row.hover()
  const playButton = row.getByRole('button', { name: 'Phát', exact: true })
  if (await playButton.isVisible()) {
    await playButton.click()
  } else {
    await row.getByText(`Reliability ${letter}`, { exact: true }).click()
  }
}

export async function playing(page: Page, letter: 'A' | 'B') {
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, time: audio.currentTime, src: audio.currentSrc }))).toMatchObject({ paused: false, src: expect.stringContaining(`track=${letter}`), time: expect.any(Number) })
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.1)
}
