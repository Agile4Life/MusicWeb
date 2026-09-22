import { test, expect } from '@playwright/test'

function createWavBuffer(durationSeconds = 4, sampleRate = 44100): Buffer {
  const numSamples = durationSeconds * sampleRate
  const buffer = Buffer.alloc(44 + numSamples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + numSamples * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(numSamples * 2, 40)
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 10000
    buffer.writeInt16LE(Math.floor(sample), 44 + i * 2)
  }
  return buffer
}

const mockAudioBuffer = createWavBuffer(4)

test.describe('Playback Buffering Stability & Single-Cycle Transitions', () => {
  test.beforeEach(async ({ page }) => {
    // Disable announcement modal
    await page.route('**/api/announcement', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { is_enabled: false } }),
      })
    })

    // Pre-seed localStorage to dismiss all onboarding
    await page.addInitScript(() => {
      window.localStorage.setItem('has_seen_onboarding', 'true')
      window.localStorage.setItem('cookie_consent', 'true')
      window.localStorage.setItem('musicweb_hide_welcome_modal', 'true')
      window.localStorage.setItem('musicweb_announcement_dismissed_v', '1')
    })
  })

  async function attachAudioEventRecorder(page: any) {
    await page.evaluate(() => {
      (window as any).__audioTimeline = []
      const record = (event: string, detail?: any) => {
        const entry = {
          t: Date.now(),
          event,
          detail: detail || null,
        }
        ;(window as any).__audioTimeline.push(entry)
        console.log(`[AUDIO_TIMELINE] +${entry.t}ms: ${event}`, JSON.stringify(detail || ''))
      }

      const hookAudio = (audio: HTMLAudioElement) => {
        if ((audio as any).__hooked) return
        ;(audio as any).__hooked = true
        const events = [
          'loadstart',
          'loadedmetadata',
          'loadeddata',
          'canplay',
          'canplaythrough',
          'play',
          'pause',
          'waiting',
          'playing',
          'stalled',
          'emptied',
          'abort',
          'error',
        ]
        events.forEach((ev) => {
          audio.addEventListener(ev, () => {
            record(`audio:${ev}`, {
              src: audio.src ? audio.src.split('?')[0] : '',
              currentTime: Number(audio.currentTime.toFixed(3)),
              paused: audio.paused,
              readyState: audio.readyState,
            })
          })
        })
      }

      const observer = new MutationObserver(() => {
        document.querySelectorAll('audio').forEach(hookAudio)
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
      document.querySelectorAll('audio').forEach(hookAudio)

      const attrObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.attributeName === 'data-buffering') {
            const isBuffering = document.documentElement.hasAttribute('data-buffering')
            record(`dom:buffering_${isBuffering ? 'start' : 'stop'}`)
          }
        }
      })
      attrObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-buffering'] })
    })
  }

  test('Single-Cycle Buffering: Playback transitions smoothly without buffering flapping', async ({ page }) => {
    // Intercept audio stream requests and provide mock wav with realistic 150ms buffer time
    await page.route(/.*\/api\/drive-stream.*/, async (route) => {
      await new Promise((r) => setTimeout(r, 150))
      route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(mockAudioBuffer.length),
        },
        body: mockAudioBuffer,
      })
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await attachAudioEventRecorder(page)

    const driveTabBtn = page.getByRole('button', { name: /Google Drive \(/i })
    await expect(driveTabBtn).toBeVisible({ timeout: 10_000 })
    await driveTabBtn.click()

    const songRows = page.locator('.song-row')
    await expect(songRows.first()).toBeVisible({ timeout: 10_000 })

    const t0 = Date.now()
    await songRows.first().click()

    // Wait for audio element to start playing
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0
    }, { timeout: 15_000 })

    await page.waitForTimeout(1000)

    const timeline: any[] = await page.evaluate(() => (window as any).__audioTimeline || [])
    console.log('\n================ TIMELINE: SMOOTH SINGLE-CYCLE ================')
    timeline.forEach((item: any) => {
      const relTime = item.t - t0
      console.log(`[+${relTime.toString().padStart(5, ' ')}ms] ${item.event.padEnd(24, ' ')} ${JSON.stringify(item.detail || '')}`)
    })
    console.log('===============================================================\n')

    // Count transitions of buffering
    const bufferingStarts = timeline.filter((e) => e.event === 'dom:buffering_start').length
    const bufferingStops = timeline.filter((e) => e.event === 'dom:buffering_stop').length

    // Must be exactly 1 start and at most 1 stop (no flapping start -> stop -> start -> stop!)
    expect(bufferingStarts).toBe(1)
    expect(bufferingStops).toBeLessThanOrEqual(1)

    // Verify play is active
    const audioPlaying = timeline.some((e) => e.event === 'audio:playing')
    expect(audioPlaying).toBe(true)
  })

  test('Seamless Fallback: Buffering remains solid when stream recovers via fallback', async ({ page }) => {
    let driveStreamAttempts = 0

    // Primary stream fails (500), forcing fallback to search and recover via NCT stream
    await page.route(/.*\/api\/drive-stream.*/, (route) => {
      driveStreamAttempts++
      route.fulfill({ status: 500, body: 'Server Error' })
    })

    await page.route(/\/api\/search/, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nhaccuatui: [{
            id: 'nct-fallback-recover',
            nhaccuatui_id: 'nct-fallback-recover',
            title: 'Fallback Song',
            artist: 'MCK',
          }],
        }),
      })
    })

    await page.route(/\/api\/nhaccuatui\/stream/, async (route) => {
      await new Promise((r) => setTimeout(r, 100))
      route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(mockAudioBuffer.length),
        },
        body: mockAudioBuffer,
      })
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    await attachAudioEventRecorder(page)

    const driveTabBtn = page.getByRole('button', { name: /Google Drive \(/i })
    await expect(driveTabBtn).toBeVisible({ timeout: 10_000 })
    await driveTabBtn.click()

    const songRows = page.locator('.song-row')
    await expect(songRows.first()).toBeVisible({ timeout: 10_000 })

    const t0 = Date.now()
    await songRows.first().click()

    // Wait for audio to play via fallback
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0
    }, { timeout: 20_000 })

    await page.waitForTimeout(1000)

    const timeline: any[] = await page.evaluate(() => (window as any).__audioTimeline || [])
    console.log('\n================ TIMELINE: SEAMLESS FALLBACK ================')
    timeline.forEach((item: any) => {
      const relTime = item.t - t0
      console.log(`[+${relTime.toString().padStart(5, ' ')}ms] ${item.event.padEnd(24, ' ')} ${JSON.stringify(item.detail || '')}`)
    })
    console.log('=============================================================\n')

    // Buffering must start once and not flap prematurely before fallback starts playing
    const bufferingStarts = timeline.filter((e) => e.event === 'dom:buffering_start').length
    expect(bufferingStarts).toBe(1)
  })
})
