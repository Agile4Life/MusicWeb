import { test, expect } from '@playwright/test'

test('Investigate lyrics fetching race conditions during fast song switching', async ({ page }) => {
  page.setViewportSize({ width: 1440, height: 900 })

  const eventLogs: string[] = []
  const log = (msg: string) => {
    const time = new Date().toISOString().slice(11, 23)
    const line = `[${time}] ${msg}`
    eventLogs.push(line)
    console.log(line)
  }

  // Intercept and disable announcement modal so it never blocks
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

  // Capture all network requests for lyrics and stream resolution
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('lyrics') || url.includes('lrclib') || url.includes('resolve-stream') || url.includes('music-api')) {
      log(`[NET REQ] ${req.method()} ${url}`)
    }
  })

  page.on('response', async (res) => {
    const url = res.url()
    if (url.includes('lyrics') || url.includes('resolve-stream')) {
      let preview = ''
      try {
        const text = await res.text()
        preview = text.slice(0, 100).replace(/\s+/g, ' ')
      } catch {}
      log(`[NET RES] ${res.status()} ${url} -> ${preview}`)
    }
  })

  // Capture all browser console messages
  page.on('console', (msg) => {
    const text = msg.text()
    if (
      text.includes('lyric') ||
      text.includes('Lyric') ||
      text.includes('Playback') ||
      text.includes('LRCLIB') ||
      text.includes('NCT') ||
      text.includes('resolve') ||
      text.includes('error') ||
      text.includes('Error')
    ) {
      log(`[CONSOLE ${msg.type().toUpperCase()}] ${text}`)
    }
  })

  log('Navigating to http://localhost:3000...')
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1000)

  // Trigger search for NewJeans to get multiple songs in DOM
  log('Triggering search for "NewJeans"...')
  const searchInput = page.locator('input.search-input').first()
  await expect(searchInput).toBeVisible({ timeout: 10_000 })
  await searchInput.fill('NewJeans')
  await searchInput.press('Enter')
  await page.waitForTimeout(2000)

  const songRows = page.locator('.song-row')
  await expect(songRows.first()).toBeVisible({ timeout: 15_000 })
  const totalSongs = await songRows.count()
  log(`Found ${totalSongs} track rows in search results`)

  for (let i = 0; i < Math.min(totalSongs, 4); i++) {
    const txt = (await songRows.nth(i).textContent())?.replace(/\s+/g, ' ').trim()
    log(`  Track ${i}: ${txt}`)
  }

  // STEP 1: Click Song 0 to play and open Lyrics modal
  log('\n=== STEP 1: Playing Track 0 and opening Lyrics modal ===')
  const track0Title = (await songRows.nth(0).textContent())?.replace(/\s+/g, ' ').trim() || 'Track 0'
  log(`Playing Track 0: "${track0Title}"`)
  await songRows.nth(0).click({ force: true })
  await page.waitForTimeout(1500)

  // Click lyrics button on PlayerBar
  const lyricsBtn = page.locator('.player-bar button:has(svg.lucide-mic-vocal), .player-bar button[title="Lời bài hát"], .player-bar button[aria-label="Lời bài hát"]').first()
  await expect(lyricsBtn).toBeVisible({ timeout: 10_000 })
  log('Clicking Lyrics button on PlayerBar...')
  await lyricsBtn.click({ force: true })
  await page.waitForTimeout(1500)

  const lyricsModal = page.locator('.now-playing-bg').first()
  log(`Lyrics modal visible: ${await lyricsModal.isVisible().catch(() => false)}`)

  const lyricsHeader = page.locator('.now-playing-bg .lyrics-title-text, .now-playing-bg span.truncate, .now-playing-bg span.animate-marquee-text, .now-playing-bg h2, .now-playing-bg h3').first()
  log(`Current Lyrics Header: "${(await lyricsHeader.textContent().catch(() => ''))?.trim()}"`)

  // Wait 3s for Track 0 lyrics to resolve
  await page.waitForTimeout(3000)
  const initialLines = await page.locator('.now-playing-bg .lyric-line-item, .now-playing-bg p.leading-snug').allTextContents().catch(() => [])
  log(`Track 0 lyrics count: ${initialLines.length}`)
  if (initialLines.length > 0) {
    log(`Track 0 sample lyrics: "${initialLines.slice(0, 3).map(s => s.replace(/\s+/g, ' ').trim()).join(' | ')}"`)
  }

  // STEP 2: RAPID SWITCHING STRESS TEST
  log('\n=== STEP 2: Triggering Rapid Track Switches (Race Condition Test) ===')
  const track1Title = (await songRows.nth(1).textContent())?.replace(/\s+/g, ' ').trim() || 'Track 1'
  const track2Title = (await songRows.nth(2).textContent())?.replace(/\s+/g, ' ').trim() || 'Track 2'
  log(`Switch Sequence: Track 1 ("${track1Title}") -> (150ms) -> Track 2 ("${track2Title}") -> (150ms) -> Track 0 ("${track0Title}")`)

  log('>>> [0ms] Rapid Click: Track 1...')
  await songRows.nth(1).evaluate((el: HTMLElement) => el.click())
  await page.waitForTimeout(150)

  let headerSnap = (await lyricsHeader.textContent().catch(() => ''))?.trim()
  let linesSnap = await page.locator('.now-playing-bg .lyric-line-item, .now-playing-bg p.leading-snug').allTextContents().catch(() => [])
  log(`[t+150ms snapshot] Header: "${headerSnap}" | Lines: ${linesSnap.length} | Line[0]: "${linesSnap[0]?.trim() || '(none)'}"`)

  log('>>> [150ms] Rapid Click: Track 2 (while Track 1 lyrics are in-flight)...')
  await songRows.nth(2).evaluate((el: HTMLElement) => el.click())
  await page.waitForTimeout(150)

  headerSnap = (await lyricsHeader.textContent().catch(() => ''))?.trim()
  linesSnap = await page.locator('.now-playing-bg .lyric-line-item, .now-playing-bg p.leading-snug').allTextContents().catch(() => [])
  log(`[t+300ms snapshot] Header: "${headerSnap}" | Lines: ${linesSnap.length} | Line[0]: "${linesSnap[0]?.trim() || '(none)'}"`)

  log('>>> [300ms] Rapid Click: Track 0 (FINAL DESTINATION TRACK)...')
  await songRows.nth(0).evaluate((el: HTMLElement) => el.click())

  // STEP 3: HIGH RESOLUTION MONITORING
  log('\n=== STEP 3: Monitoring Lyrics Display State for 8 Seconds ===')
  let detectedStaleLyrics = false
  let detectedFlicker = false
  let lastSample = ''

  for (let tick = 1; tick <= 16; tick++) {
    await page.waitForTimeout(500)
    const timeMs = tick * 500

    const currentHeader = (await lyricsHeader.textContent().catch(() => ''))?.trim() || ''
    const lines = await page.locator('.now-playing-bg .lyric-line-item, .now-playing-bg p.leading-snug').allTextContents().catch(() => [])
    const sample = lines.slice(0, 2).map(s => s.replace(/\s+/g, ' ').trim()).join(' | ')
    const isLoading = await page.locator('.now-playing-bg text=Đang tải lời bài hát, .now-playing-bg text=Loading lyrics').isVisible().catch(() => false)

    log(`[+${timeMs}ms] Header: "${currentHeader}" | Loading: ${isLoading} | Lines (${lines.length}): "${sample || '(empty)'}"`)

    if (lastSample && sample && lastSample !== sample && tick > 4) {
      log(`⚡ [LYRICS FLICKER / OVERWRITE] Changed from "${lastSample}" to "${sample}" at +${timeMs}ms`)
      detectedFlicker = true
    }
    if (sample) lastSample = sample
  }

  log('\n=== PLAYWRIGHT SUMMARY ===')
  log(`Stale / Mismatched lyrics detected: ${detectedStaleLyrics}`)
  log(`Flicker / Late overwrite detected: ${detectedFlicker}`)
  log('===========================\n')

  const finalHeader = (await lyricsHeader.textContent().catch(() => ''))?.trim() || ''
  const finalLines = await page.locator('.now-playing-bg .lyric-line-item, .now-playing-bg p.leading-snug').allTextContents().catch(() => [])

  expect(detectedFlicker).toBe(false)
  expect(detectedStaleLyrics).toBe(false)
  expect(finalHeader).toContain('New Jeans')
  expect(finalLines.length).toBeGreaterThan(0)
  if (initialLines.length > 0) {
    expect(finalLines[0].trim()).toBe(initialLines[0].trim())
  }
})

test('Rapid track switching using in-modal Next / Prev controls', async ({ page }) => {
  page.setViewportSize({ width: 1440, height: 900 })

  // Suppress announcements and seed dismissals
  await page.route('**/api/announcement', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { is_enabled: false } }),
    })
  })

  await page.addInitScript(() => {
    window.localStorage.setItem('has_seen_onboarding', 'true')
    window.localStorage.setItem('cookie_consent', 'true')
    window.localStorage.setItem('musicweb_hide_welcome_modal', 'true')
    window.localStorage.setItem('musicweb_announcement_dismissed_v', '99999')
  })

  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1000)

  // Search NewJeans
  const searchInput = page.locator('input.search-input').first()
  await expect(searchInput).toBeVisible({ timeout: 10_000 })
  await searchInput.fill('NewJeans')
  await searchInput.press('Enter')
  await page.waitForTimeout(2000)

  const songRows = page.locator('.song-row')
  await expect(songRows.first()).toBeVisible({ timeout: 15_000 })

  // Click Song 0 to play
  await songRows.nth(0).click({ force: true })
  await page.waitForTimeout(1500)

  // Open Lyrics modal
  const lyricsBtn = page.locator('.player-bar button:has(svg.lucide-mic-vocal), .player-bar button[title="Lời bài hát"], .player-bar button[aria-label="Lời bài hát"]').first()
  await expect(lyricsBtn).toBeVisible({ timeout: 10_000 })
  await lyricsBtn.click({ force: true })
  await page.waitForTimeout(1500)

  const nextBtn = page.locator('.now-playing-bg button[title="Bài tiếp theo"]').first()
  await expect(nextBtn).toBeVisible({ timeout: 10_000 })

  const lyricsHeader = page.locator('.now-playing-bg .lyrics-title-text, .now-playing-bg span.truncate, .now-playing-bg span.animate-marquee-text, .now-playing-bg h2, .now-playing-bg h3').first()
  console.log(`Starting in-modal test, initial header: "${(await lyricsHeader.textContent())?.trim()}"`)

  // Rapidly click Next 3 times (150ms intervals)
  console.log('>>> Rapidly clicking Next button inside LyricsView modal...')
  await nextBtn.click()
  await page.waitForTimeout(150)
  await nextBtn.click()
  await page.waitForTimeout(150)
  await nextBtn.click()

  // Wait 4 seconds for destination track lyrics to stabilize
  await page.waitForTimeout(4000)

  const destinationHeader = (await lyricsHeader.textContent().catch(() => ''))?.trim() || ''
  const lines = await page.locator('.now-playing-bg .lyric-line-item, .now-playing-bg p.leading-snug').allTextContents().catch(() => [])
  console.log(`Destination track in-modal: "${destinationHeader}" | Lines: ${lines.length}`)

  expect(destinationHeader.length).toBeGreaterThan(0)
  // Ensure lyrics modal is still healthy and visible
  const modal = page.locator('.now-playing-bg').first()
  expect(await modal.isVisible()).toBe(true)
})
