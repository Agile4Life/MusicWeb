import { test, expect } from '@playwright/test'

test('Test Timeless track playback latency and behavior', async ({ page }) => {
  page.setViewportSize({ width: 1280, height: 800 })

  const logs: Array<{ time: number; type: string; message: string }> = []
  const startTime = Date.now()

  const logEvent = (type: string, msg: string) => {
    const elapsed = Date.now() - startTime
    logs.push({ time: elapsed, type, message: msg })
    console.log(`[+${String(elapsed).padStart(5, ' ')}ms][${type}] ${msg}`)
  }

  // Capture all console logs
  page.on('console', (msg) => {
    logEvent(`CONSOLE_${msg.type().toUpperCase()}`, msg.text())
  })
  page.on('pageerror', (err) => {
    logEvent('PAGE_ERROR', String(err))
  })

  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('/api/') || url.includes('youtube') || url.includes('workers.dev')) {
      logEvent('NET_REQ', `${req.method()} ${url.slice(0, 100)}`)
    }
  })

  page.on('response', (res) => {
    const url = res.url()
    if (url.includes('/api/') || url.includes('youtube') || url.includes('workers.dev')) {
      logEvent('NET_RES', `${res.status()} ${url.slice(0, 100)}`)
    }
  })

  console.log('\n--- Step 1: Navigating to home page ---')
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')

  // Dismiss modal if open
  await page.waitForTimeout(1000)
  const ctaBtn = page.getByRole('button', { name: /Đã hiểu & Bắt đầu|Đóng/i }).first()
  if (await ctaBtn.isVisible().catch(() => false)) {
    console.log('Dismissing welcome modal...')
    await ctaBtn.click().catch(() => {})
  }

  // Hook DOM data-buffering mutations
  await page.evaluate(() => {
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

  // Search for Timeless
  const searchInput = page.locator('input.search-input').first()
  await expect(searchInput).toBeVisible({ timeout: 10_000 })
  console.log('Searching for "Timeless"...')
  await searchInput.fill('Timeless')
  await searchInput.press('Enter')
  await page.waitForTimeout(1500)

  // Double check modal
  if (await ctaBtn.isVisible().catch(() => false)) {
    await ctaBtn.click().catch(() => {})
  }

  // Look for the song row
  const timelessRow = page.locator('.song-row').filter({ hasText: /Timeless/i }).first()
  await expect(timelessRow).toBeVisible({ timeout: 10_000 })

  const titleText = await timelessRow.locator('p').first().textContent()
  console.log(`Found track row: "${titleText?.trim()}"`)

  const startClickTime = Date.now()
  console.log('\n▶ Step 2: Clicking "Timeless" track row (force: true)...')
  const rowHtml = await timelessRow.evaluate(el => el.outerHTML)
  console.log('Row HTML prefix:', rowHtml.slice(0, 200))

  await timelessRow.click({ force: true })

  let playStarted = false

  // Log intermediate states
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1500)
    const audioState = await page.evaluate(() => {
      const a = document.querySelector('audio')
      const p = document.documentElement.getAttribute('data-playing')
      const b = document.documentElement.hasAttribute('data-buffering')
      const currentTrackEl = document.querySelector('.player-track-title, [data-testid="player-title"]')
      const yt = (window as any).YT?.get?.('yt-player-container')?.getPlayerState?.()
      const isHtml5Playing = Boolean(a && !a.paused && a.currentTime > 0)
      const isYtPlaying = yt === 1
      return {
        playing: isHtml5Playing || isYtPlaying || (p === 'true' && !b),
        hasAudio: Boolean(a),
        audioSrc: a?.src,
        paused: a?.paused,
        currentTime: a?.currentTime,
        readyState: a?.readyState,
        error: a?.error ? { code: a.error.code, message: a.error.message } : null,
        dataPlaying: p,
        dataBuffering: b,
        ytState: yt,
        playerTrackTitle: currentTrackEl?.textContent?.trim()
      }
    })
    console.log(`[STATE @ +${(i + 1) * 1.5}s]`, JSON.stringify(audioState))
    if (audioState.playing && (audioState.currentTime || 0) > 0) {
      console.log('Playback detected actively running!')
      playStarted = true
      break
    }
    if (audioState.ytState === 1) {
      console.log('YouTube iframe playback detected actively running!')
      playStarted = true
      break
    }
  }

  const isBuffering = await page.evaluate(() => document.documentElement.hasAttribute('data-buffering'))
  const isPlaying = await page.evaluate(() => document.documentElement.getAttribute('data-playing') === 'true')
  console.log(`Final state: isPlaying=${isPlaying}, isBuffering=${isBuffering}`)

  // Wait 2 seconds to verify continuous playback
  await page.waitForTimeout(2000)

  expect(playStarted).toBe(true)
})
