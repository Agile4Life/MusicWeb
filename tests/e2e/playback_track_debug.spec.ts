import { test, expect } from '@playwright/test'

interface EventLog {
  time: number
  type: 'console' | 'network_req' | 'network_res' | 'network_fail' | 'audio_event' | 'dom_event'
  category?: string
  message: string
  details?: any
}

test.describe('Playback Single Track & Race Condition Diagnostic Suite', () => {
  let logs: EventLog[] = []
  let testStartTime = 0

  const logEvent = (
    type: EventLog['type'],
    message: string,
    details?: any,
    category?: string
  ) => {
    const elapsed = Date.now() - testStartTime
    const entry: EventLog = {
      time: elapsed,
      type,
      category,
      message,
      details,
    }
    logs.push(entry)
    const catStr = category ? `[${category}] ` : ''
    console.log(`[+${elapsed.toString().padStart(6, ' ')}ms][${type.toUpperCase().padEnd(12, ' ')}] ${catStr}${message}`)
  }

  test.beforeEach(async ({ page }) => {
    logs = []
    testStartTime = Date.now()

    // Disable announcement modal
    await page.route('**/api/announcement', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { is_enabled: false } }),
      })
    })

    // Pre-seed localStorage to dismiss all modals & onboarding
    await page.addInitScript(() => {
      window.localStorage.setItem('has_seen_onboarding', 'true')
      window.localStorage.setItem('cookie_consent', 'true')
      window.localStorage.setItem('musicweb_hide_welcome_modal', 'true')
      window.localStorage.setItem('musicweb_announcement_dismissed_v', '99999')
    })

    // Intercept console logs
    page.on('console', (msg) => {
      const text = msg.text()
      const type = msg.type()
      logEvent('console', `[${type}] ${text}`, undefined, 'BROWSER')
    })

    // Intercept network requests
    page.on('request', (req) => {
      const url = req.url()
      if (
        url.includes('/api/nhaccuatui') ||
        url.includes('/api/drive-stream') ||
        url.includes('/api/resolve-stream') ||
        url.includes('/api/search') ||
        url.includes('/api/tracks')
      ) {
        logEvent('network_req', `${req.method()} ${url}`, undefined, 'NET_REQ')
      }
    })

    page.on('response', (res) => {
      const url = res.url()
      if (
        url.includes('/api/nhaccuatui') ||
        url.includes('/api/drive-stream') ||
        url.includes('/api/resolve-stream') ||
        url.includes('/api/search') ||
        url.includes('/api/tracks')
      ) {
        logEvent('network_res', `${res.status()} ${res.statusText()} - ${url}`, undefined, 'NET_RES')
      }
    })

    page.on('requestfailed', (req) => {
      const url = req.url()
      if (
        url.includes('/api/nhaccuatui') ||
        url.includes('/api/drive-stream') ||
        url.includes('/api/resolve-stream') ||
        url.includes('/api/search')
      ) {
        logEvent('network_fail', `FAILED ${req.method()} ${url}: ${req.failure()?.errorText}`, undefined, 'NET_FAIL')
      }
    })
  })

  test.afterEach(async ({}, testInfo) => {
    console.log(`\n=== SUMMARY FOR TEST: ${testInfo.title} ===`)
    console.log(`Total events captured: ${logs.length}`)
    const errors = logs.filter(l => l.type === 'console' && l.message.includes('[error]'))
    const netFails = logs.filter(l => l.type === 'network_fail' || (l.type === 'network_res' && (l.message.startsWith('5') || l.message.startsWith('4'))))
    const audioEvents = logs.filter(l => l.type === 'audio_event')
    console.log(`Console errors: ${errors.length}`)
    console.log(`Network failures/errors: ${netFails.length}`)
    console.log(`Audio events: ${audioEvents.length}`)
    console.log(`===========================================\n`)
  })

  async function attachAudioInstrumentation(page: any) {
    await page.evaluate(() => {
      const record = (event: string, detail?: any) => {
        const detailStr = detail ? JSON.stringify(detail) : ''
        console.log(`[AUDIO_EVENT] ${event} ${detailStr}`)
      }

      const hookAudio = (audio: HTMLAudioElement) => {
        if ((audio as any).__hookedDebug) return
        ;(audio as any).__hookedDebug = true
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
          'ended',
          'seeking',
          'seeked',
        ]
        events.forEach((ev) => {
          audio.addEventListener(ev, () => {
            const mediaErr = audio.error ? `code=${audio.error.code} msg=${audio.error.message}` : null
            record(ev, {
              src: audio.src ? audio.src.split('?')[0] + '?' + (audio.src.split('?')[1]?.slice(0, 35) || '') : '',
              currentTime: Number(audio.currentTime.toFixed(3)),
              paused: audio.paused,
              readyState: audio.readyState,
              error: mediaErr,
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
            console.log(`[DOM_STATE] data-buffering=${isBuffering}`)
          }
        }
      })
      attrObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-buffering'] })
    })
  }

  async function setupAndNavigateToTab(page: any, tab: 'drive' | 'all') {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const dismissBtn = page.getByRole('button', { name: /Đã hiểu & Bắt đầu|Đóng/i })
    if (await dismissBtn.isVisible().catch(() => false)) {
      await dismissBtn.click().catch(() => {})
    }

    await attachAudioInstrumentation(page)

    if (tab === 'drive') {
      const driveTabBtn = page.getByRole('button', { name: /Google Drive \(/i })
      await expect(driveTabBtn).toBeVisible({ timeout: 10_000 })
      await driveTabBtn.click()
    } else {
      const allTabBtn = page.getByRole('button', { name: /Tất Cả Bài Hát \(/i })
      await expect(allTabBtn).toBeVisible({ timeout: 10_000 })
      await allTabBtn.click()
    }

    const songRows = page.locator('.song-row')
    await expect(songRows.first()).toBeVisible({ timeout: 10_000 })
    return songRows
  }

  test('Test 1: Single Track Playback - click track, verify play, check if reloads occur', async ({ page }) => {
    const songRows = await setupAndNavigateToTab(page, 'drive')

    const firstRow = songRows.first()
    const firstTitle = (await firstRow.locator('p').first().textContent())?.trim()
    console.log(`\n▶ Clicking first track: "${firstTitle}"`)

    await firstRow.click()

    // Verify audio element is attached
    const audioElement = page.locator('audio')
    await expect(audioElement).toBeAttached({ timeout: 5_000 })

    // Wait for playback to start or fail
    const playStarted = await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0
    }, undefined, { timeout: 20_000 }).catch(() => false)

    console.log(`Play started result: ${Boolean(playStarted)}`)
    expect(Boolean(playStarted)).toBe(true)

    // Let it play for 2 seconds
    await page.waitForTimeout(2000)

    const ct = await audioElement.evaluate((el: HTMLAudioElement) => el.currentTime)
    console.log(`Current time after 2s: ${ct}`)
    expect(ct).toBeGreaterThan(1.0)
  })

  test('Test 2: Pause and Resume - check whether it seamlessly resumes or re-fetches / reloads the track', async ({ page }) => {
    const songRows = await setupAndNavigateToTab(page, 'drive')
    await songRows.first().click()

    const audioElement = page.locator('audio')
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0.5
    }, undefined, { timeout: 20_000 })

    const pauseBtn = page.locator('button[title="Tạm dừng"]:visible').first()
    await expect(pauseBtn).toBeVisible({ timeout: 5_000 })

    console.log('\n⏸ Clicking PAUSE button...')
    const eventsBeforePause = logs.length
    await pauseBtn.click()

    await page.waitForTimeout(500)

    const isPaused = await audioElement.evaluate((el: HTMLAudioElement) => el.paused)
    const timeAtPause = await audioElement.evaluate((el: HTMLAudioElement) => el.currentTime)
    console.log(`Is paused: ${isPaused}, time at pause: ${timeAtPause}`)
    expect(isPaused).toBe(true)

    const playBtn = page.locator('button[title="Phát"]:visible').first()
    await expect(playBtn).toBeVisible({ timeout: 5_000 })

    console.log('\n▶ Clicking PLAY (Resume) button...')
    const requestsBeforeResume = logs.filter(l => l.type === 'network_req').length
    await playBtn.click()

    await page.waitForTimeout(1000)

    const isResumed = await audioElement.evaluate((el: HTMLAudioElement) => !el.paused)
    const timeAfterResume = await audioElement.evaluate((el: HTMLAudioElement) => el.currentTime)
    const requestsAfterResume = logs.filter(l => l.type === 'network_req').length

    console.log(`Is resumed: ${isResumed}, time after resume: ${timeAfterResume}`)
    console.log(`New network requests during resume: ${requestsAfterResume - requestsBeforeResume}`)

    expect(isResumed).toBe(true)
    // Resuming an existing audio element should NOT fire new network stream requests!
    expect(requestsAfterResume - requestsBeforeResume).toBe(0)
  })

  test('Test 3: Click on Currently Playing Track Row - does it toggle play/pause or does it re-load from scratch?', async ({ page }) => {
    const songRows = await setupAndNavigateToTab(page, 'drive')
    const firstRow = songRows.first()

    console.log('\n▶ Step 1: Click first track to play')
    await firstRow.click()

    const audioElement = page.locator('audio')
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 1.0
    }, undefined, { timeout: 20_000 })

    const initialSrc = await audioElement.evaluate((el: HTMLAudioElement) => el.src)
    const timeBeforeClick = await audioElement.evaluate((el: HTMLAudioElement) => el.currentTime)
    console.log(`Track is playing at ${timeBeforeClick}s, src: ${initialSrc.slice(0, 60)}...`)

    console.log('\n🔄 Step 2: Click the SAME track row while it is playing...')
    await firstRow.click()
    await page.waitForTimeout(500)

    const isPausedAfterClick = await audioElement.evaluate((el: HTMLAudioElement) => el.paused)
    console.log(`Audio state after clicking current row: paused=${isPausedAfterClick}`)

    console.log('\n🔄 Step 3: Click the SAME track row again while paused...')
    await firstRow.click()
    await page.waitForTimeout(1000)

    const isPlayingAfterSecondClick = await audioElement.evaluate((el: HTMLAudioElement) => !el.paused)
    const timeAfterSecondClick = await audioElement.evaluate((el: HTMLAudioElement) => el.currentTime)
    const srcAfterSecondClick = await audioElement.evaluate((el: HTMLAudioElement) => el.src)

    console.log(`Audio state after 2nd click: playing=${isPlayingAfterSecondClick}, time=${timeAfterSecondClick}s`)
    console.log(`Src unchanged: ${initialSrc === srcAfterSecondClick}`)

    // Check if it restarted from 0 (reload bug) or resumed from paused position
    console.log(`Did it restart from 0? ${timeAfterSecondClick < 0.5 ? 'YES (RELOAD BUG!)' : 'NO (RESUMED SMOOTHLY)'}`)
  })

  test('Test 4: Click row while it is STILL BUFFERING / RESOLVING (Double-click / Impatient Click)', async ({ page }) => {
    const songRows = await setupAndNavigateToTab(page, 'drive')
    const firstRow = songRows.first()

    console.log('\n⚡ Step 1: Click first track row')
    await firstRow.click()

    // Wait very brief moment (50ms - while resolving URL before audio starts playing)
    await page.waitForTimeout(60)

    console.log('\n⚡ Step 2: Click same track row AGAIN while still buffering/resolving!')
    await firstRow.click()

    // Now monitor: Does audio start playing? Or does it get stuck in paused/buffering?
    console.log('\n👀 Monitoring playback state for next 8 seconds...')
    const playStarted = await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0
    }, undefined, { timeout: 15_000 }).catch(() => false)

    console.log(`Did playback start despite impatient double click? ${Boolean(playStarted)}`)
    const isBuffering = await page.evaluate(() => document.documentElement.hasAttribute('data-buffering'))
    const isPlaying = await page.evaluate(() => {
      const audio = document.querySelector('audio')
      return audio ? !audio.paused : false
    })
    console.log(`Final state: isPlaying=${isPlaying}, isBuffering=${isBuffering}`)

    // Look for error toast
    const toast = page.locator('[role="alert"], [data-testid="toast-notification"], .glass-panel').filter({ hasText: /Không thể|lỗi|thất bại/i })
    const hasToast = await toast.isVisible().catch(() => false)
    console.log(`Error toast visible: ${hasToast}`)

    expect(hasToast).toBe(false)
    // Audio either started playing or clean UI state (not stuck in buffering)
    expect(Boolean(playStarted) || !isBuffering).toBe(true)
  })

  test('Test 5: Rapid Sequential Switching between 3 different tracks (Race Condition Check)', async ({ page }) => {
    const songRows = await setupAndNavigateToTab(page, 'drive')
    await expect(songRows.nth(2)).toBeVisible({ timeout: 10_000 })

    const title0 = (await songRows.nth(0).locator('p').first().textContent())?.trim()
    const title1 = (await songRows.nth(1).locator('p').first().textContent())?.trim()
    const title2 = (await songRows.nth(2).locator('p').first().textContent())?.trim()

    console.log(`Track 0: "${title0}"`)
    console.log(`Track 1: "${title1}"`)
    console.log(`Track 2: "${title2}"`)

    console.log('\n⚡ Rapidly clicking Track 0 -> Track 1 -> Track 2 (80ms interval)...')
    await songRows.nth(0).click()
    await page.waitForTimeout(80)
    await songRows.nth(1).click()
    await page.waitForTimeout(80)
    await songRows.nth(2).click()

    console.log('\n👀 Waiting for Track 2 to play...')
    const playStarted = await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0
    }, undefined, { timeout: 15_000 }).catch(() => false)

    console.log(`Track 2 playback started: ${Boolean(playStarted)}`)

    const playerBar = page.locator('footer.player-bar, .player-bar:visible')
    const barText = await playerBar.first().textContent().catch(() => '')
    console.log(`PlayerBar text: "${barText?.slice(0, 100)}"`)
    console.log(`Does PlayerBar contain Track 2 ("${title2}")? ${barText?.includes(title2 || '')}`)
    console.log(`Does PlayerBar contain Track 0 ("${title0}")? ${barText?.includes(title0 || '')}`)

    expect(barText).toContain(title2 || '')
  })

  test('Test 6: Normal Sequential Playback (Track 1 for 3s -> Track 2 for 3s -> Track 3 for 3s)', async ({ page }) => {
    const songRows = await setupAndNavigateToTab(page, 'drive')

    for (let i = 0; i < 3; i++) {
      const row = songRows.nth(i)
      const title = (await row.locator('p').first().textContent())?.trim()
      console.log(`\n▶ [Step ${i + 1}/3] Playing Track ${i}: "${title}"`)

      await row.click()

      const playStarted = await page.waitForFunction(() => {
        const audio = document.querySelector('audio')
        return audio && !audio.paused && audio.currentTime > 0.3
      }, undefined, { timeout: 15_000 }).catch(() => false)

      console.log(`Track ${i} playing: ${Boolean(playStarted)}`)
      expect(Boolean(playStarted)).toBe(true)

      // Let it play for 2.5 seconds
      await page.waitForTimeout(2500)

      const ct = await page.evaluate(() => document.querySelector('audio')?.currentTime || 0)
      console.log(`Track ${i} reached currentTime: ${ct}s`)
    }
  })

  test('Test 7: Stream Continuity - verify track plays uninterrupted past the 8-second mark without timeout cutoffs', async ({ page }) => {
    const songRows = await setupAndNavigateToTab(page, 'drive')
    const firstRow = songRows.first()
    await firstRow.click()

    const audioElement = page.locator('audio')
    const playStarted = await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0.5
    }, undefined, { timeout: 20_000 }).catch(() => false)

    expect(Boolean(playStarted)).toBe(true)

    console.log('\n⏱ Monitoring playback continuity beyond 9 seconds (testing timeout bug fix)...')
    // Wait until audio currentTime passes 9 seconds
    const reached9s = await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime >= 9.0
    }, undefined, { timeout: 20_000 }).catch(() => false)

    const ct = await audioElement.evaluate((el: HTMLAudioElement) => el.currentTime)
    const isPaused = await audioElement.evaluate((el: HTMLAudioElement) => el.paused)
    console.log(`Continuous playback check at 9s: reached=${Boolean(reached9s)}, currentTime=${ct}s, isPaused=${isPaused}`)

    expect(Boolean(reached9s)).toBe(true)
    expect(isPaused).toBe(false)
    expect(ct).toBeGreaterThanOrEqual(9.0)
  })
})
