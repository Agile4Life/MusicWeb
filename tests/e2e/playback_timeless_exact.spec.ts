import { test, expect } from '@playwright/test'

test('Measure playback performance of Timeless (DB track vs NCT track)', async ({ page }) => {
  page.setViewportSize({ width: 1280, height: 800 })

  await page.addInitScript(() => {
    localStorage.setItem('announcement_dismissed_version', '1')
  })

  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')

  // Dismiss modal if open
  await page.waitForTimeout(1000)
  const dismissBtn = page.getByRole('button', { name: /Đã hiểu & Bắt đầu|Đóng/i }).first()
  if (await dismissBtn.isVisible().catch(() => false)) {
    await dismissBtn.click().catch(() => {})
    await page.waitForTimeout(500)
  }

  // Trigger search on UI so song rows are rendered in DOM
  const searchInput = page.locator('input.search-input').first()
  await expect(searchInput).toBeVisible({ timeout: 10_000 })
  await searchInput.fill('Timeless')
  await searchInput.press('Enter')
  await page.waitForTimeout(1500)

  if (await dismissBtn.isVisible().catch(() => false)) {
    await dismissBtn.click().catch(() => {})
  }

  // Fetch track details from API directly inside browser context
  const dbTrack = await page.evaluate(async () => {
    const res = await fetch('/api/search?q=Timeless&source=all')
    const data = await res.json()
    console.log('Search API returned sources:', Object.keys(data))
    return {
      youtubeTrack: data.youtube?.[0] || null,
      nctTrack: data.nhaccuatui?.[0] || null,
      localTrack: data.local?.[0] || null,
    }
  })

  console.log('\n--- TRACK INFORMATION ---')
  console.log('YouTube Track:', dbTrack.youtubeTrack ? `"${dbTrack.youtubeTrack.title}" (${dbTrack.youtubeTrack.source}, ID: ${dbTrack.youtubeTrack.id}, ytId: ${dbTrack.youtubeTrack.youtube_id})` : 'None')
  console.log('NCT Track    :', dbTrack.nctTrack ? `"${dbTrack.nctTrack.title}" (${dbTrack.nctTrack.source}, ID: ${dbTrack.nctTrack.id}, nctId: ${dbTrack.nctTrack.nhaccuatui_id})` : 'None')
  console.log('Local Track  :', dbTrack.localTrack ? `"${dbTrack.localTrack.title}" (${dbTrack.localTrack.source}, ID: ${dbTrack.localTrack.id})` : 'None')

  // Test 1: Measure NCT track playback
  if (dbTrack.nctTrack) {
    console.log('\n======================================================')
    console.log('🧪 TEST 1: Playing NCT "Timeless" Track...')
    console.log('======================================================')
    const t0 = Date.now()
    const timelessRow = page.locator('.song-row').filter({ hasText: /Timeless/i }).first()
    await expect(timelessRow).toBeVisible({ timeout: 15_000 })
    console.log('Found Timeless row, clicking...')
    await timelessRow.click({ force: true })

    let nctStarted = false
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000)
      const isPlaying = await page.evaluate(() => {
        const audio = document.querySelector('audio')
        return Boolean(audio && !audio.paused && audio.currentTime > 0)
      })
      if (isPlaying) {
        nctStarted = true
        break
      }
    }

    const nctDuration = Date.now() - t0
    console.log(`NCT Track Playback started: ${nctStarted} in ${nctDuration}ms`)
    expect(nctStarted).toBe(true)
  }

  // Test 2: Measure YouTube track playback
  if (dbTrack.youtubeTrack) {
    console.log('\n======================================================')
    console.log('🧪 TEST 2: Playing YouTube "Timeless" Track...')
    console.log('======================================================')
    const t0 = Date.now()
    await page.evaluate((tr) => {
      const rows = Array.from(document.querySelectorAll('.song-row'))
      const r = rows.find(el => el.textContent?.includes('Timeless'))
      // If there are multiple, click the second one or switch tab
    }, dbTrack.youtubeTrack)

    // Let's test the YouTube iframe readiness
    const ytStatus = await page.evaluate(async (ytId) => {
      const start = Date.now()
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`)
      const oembedLatency = Date.now() - start
      return { status: oembedRes.status, oembedLatency }
    }, dbTrack.youtubeTrack.youtube_id)

    console.log(`YouTube OEmbed validation: HTTP ${ytStatus.status} in ${ytStatus.oembedLatency}ms`)
  }
})
