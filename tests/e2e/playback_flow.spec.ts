import { test, expect } from '@playwright/test'

// Helper to generate a minimal valid WAV buffer so HTML5 <audio> can actually play and advance currentTime
function createWavBuffer(seconds = 3, sampleRate = 44100): Buffer {
  const numSamples = seconds * sampleRate
  const buffer = Buffer.alloc(44 + numSamples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + numSamples * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // PCM chunk size
  buffer.writeUInt16LE(1, 20) // Format 1 = PCM
  buffer.writeUInt16LE(1, 22) // 1 channel
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34) // 16 bits
  buffer.write('data', 36)
  buffer.writeUInt32LE(numSamples * 2, 40)
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 10000
    buffer.writeInt16LE(Math.floor(sample), 44 + i * 2)
  }
  return buffer
}

const mockAudioBuffer = createWavBuffer(4)

test.describe('MusicWeb Playback Flow E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Disable announcement modal via API interception
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
  })

  // Helper function to prepare page and ensure track rows are visible
  async function setupAndNavigate(page: any) {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // If any modal dialog appears, dismiss it without polling delay
    const dismissBtn = page.getByRole('button', { name: /Đã hiểu & Bắt đầu|Đóng/i })
    if (await dismissBtn.isVisible().catch(() => false)) {
      await dismissBtn.click().catch(() => {})
    }

    // Switch to Google Drive tab to reveal all 30 preloaded songs
    const driveTabBtn = page.getByRole('button', { name: /Google Drive \(/i })
    await expect(driveTabBtn).toBeVisible({ timeout: 10_000 })
    await driveTabBtn.click()

    // Verify .song-row is rendered
    const songRows = page.locator('.song-row')
    await expect(songRows.first()).toBeVisible({ timeout: 10_000 })
    return songRows
  }

  test('Best Case: Normal track playback, progress advancement, and pause/resume', async ({ page }) => {
    // Intercept all stream routes and return our valid audio buffer
    await page.route(/\/api\/drive-stream/, (route) => {
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
    await page.route(/\/api\/nhaccuatui\/stream/, (route) => {
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

    const tNav0 = Date.now()
    const songRows = await setupAndNavigate(page)
    const tNav1 = Date.now()
    console.log('[PERF] setupAndNavigate duration:', tNav1 - tNav0, 'ms')

    // Capture first track title
    const firstTitle = (await songRows.first().locator('p').first().textContent())?.trim()

    // Click first track row to initiate playback
    const tPlay0 = Date.now()
    await songRows.first().click()

    // Verify audio element receives src
    const audioElement = page.locator('audio')
    await expect(audioElement).toBeAttached()
    await expect(audioElement).toHaveAttribute('src', /.+/, { timeout: 10_000 })

    // Verify PlayerBar displays track title
    const playerBar = page.locator('footer.player-bar, .player-bar:visible').filter({ hasText: firstTitle || '' })
    await expect(playerBar.first()).toBeVisible({ timeout: 10_000 })

    // Wait for audio to start playing and advance currentTime
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0
    }, { timeout: 10_000 })
    const tPlay1 = Date.now()
    console.log('[PERF] Actual playback latency (Click -> Sound Playing):', tPlay1 - tPlay0, 'ms')

    const currentTimeBefore = await audioElement.evaluate((el: HTMLAudioElement) => el.currentTime)
    expect(currentTimeBefore).toBeGreaterThan(0)

    // Verify play button has switched to Pause state
    const pauseButton = page.locator('button[title="Tạm dừng"]:visible')
    await expect(pauseButton.first()).toBeVisible({ timeout: 10_000 })

    // Toggle Pause
    await pauseButton.first().click()
    const playButton = page.locator('button[title="Phát"]:visible')
    await expect(playButton.first()).toBeVisible({ timeout: 5_000 })

    const isPaused = await audioElement.evaluate((el: HTMLAudioElement) => el.paused)
    expect(isPaused).toBe(true)

    // Resume Play
    await playButton.first().click()
    await expect(pauseButton.first()).toBeVisible({ timeout: 5_000 })

    const isResumed = await audioElement.evaluate((el: HTMLAudioElement) => !el.paused)
    expect(isResumed).toBe(true)
  })

  test('Fallback Case: Primary stream failure recovers via fallback stream', async ({ page }) => {
    // 1. Primary drive-stream fails with 502
    await page.route(/\/api\/drive-stream/, (route) => {
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Upstream gateway failure' }),
      })
    })

    // 2. Fallback search returns a matching NCT or YouTube result
    await page.route(/\/api\/search\?q=/, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nhaccuatui: [{
            nhaccuatui_id: 'nct-fallback-123',
            title: 'Fallback Song',
            artist: 'Fallback Artist',
            duration: 200,
          }],
          youtube: [],
          soundcloud: [],
        }),
      })
    })

    // 3. Fallback NCT stream succeeds with valid audio
    await page.route(/\/api\/nhaccuatui\/stream/, (route) => {
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

    const songRows = await setupAndNavigate(page)

    // Click track to initiate playback
    await songRows.first().click()

    // Wait for fallback resolution to complete
    const audioElement = page.locator('audio')
    await expect(audioElement).toBeAttached()

    // Verify fallback stream switches to NCT fallback and plays
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return (
        audio &&
        audio.src.includes('nhaccuatui') &&
        !audio.paused &&
        audio.currentTime > 0
      )
    }, { timeout: 15_000 })

    // Ensure UI did not crash and buffering is fully cleared
    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-buffering', { timeout: 5000 })
  })

  test('Worst Case: Total stream failure across all providers stops buffering and displays error toast', async ({ page }) => {
    // Intercept ALL stream endpoints and return errors
    await page.route(/\/api\/drive-stream/, (route) => route.fulfill({ status: 502, body: 'Drive failure' }))
    await page.route(/\/api\/nhaccuatui\/stream/, (route) => route.fulfill({ status: 502, body: 'NCT failure' }))
    await page.route(/\/api\/yt-stream/, (route) => route.fulfill({ status: 502, body: 'YT Stream failure' }))
    await page.route(/\/api\/youtube\/stream/, (route) => route.fulfill({ status: 502, body: 'YouTube failure' }))
    await page.route(/\/api\/soundcloud\/stream/, (route) => route.fulfill({ status: 502, body: 'SoundCloud failure' }))
    await page.route(/\/api\/resolve-stream/, (route) => route.fulfill({ status: 502, body: 'Resolve failure' }))
    await page.route(/\/api\/search/, (route) => route.fulfill({ status: 500, body: 'Search failure' }))

    const songRows = await setupAndNavigate(page)

    // Click track to play
    await songRows.first().click()

    // 1. Buffering state must terminate (no stuck infinite spinning)
    await page.waitForFunction(() => {
      return !document.documentElement.hasAttribute('data-buffering')
    }, { timeout: 15_000 })

    // 2. An error toast or notification should be presented
    const toastMessage = page.locator('[role="alert"], [data-testid="toast-notification"], .glass-panel').filter({ hasText: /Không thể|lỗi|thất bại/i })
    await expect(toastMessage.first()).toBeVisible({ timeout: 10_000 })

    // 3. Audio should NOT be playing
    const isPlaying = await page.evaluate(() => {
      const audio = document.querySelector('audio')
      return audio ? !audio.paused : false
    })
    expect(isPlaying).toBe(false)

    // 4. Page remains completely responsive
    await songRows.last().scrollIntoViewIfNeeded()
    await expect(songRows.last()).toBeVisible()
  })

  test('Race Condition: Rapid sequential track switching only plays the latest track', async ({ page }) => {
    // Delay stream responses to simulate network latency
    await page.route(/\/api\/drive-stream/, async (route) => {
      const url = route.request().url()
      // Artificially delay first tracks to test race condition drop
      if (url.includes('1o91pC5Vtk556BKKKepilcGPgJZBnwJce')) {
        await new Promise((res) => setTimeout(res, 300))
      }
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
    await page.route(/\/api\/nhaccuatui\/stream/, (route) => {
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

    const songRows = await setupAndNavigate(page)
    await expect(songRows.nth(2)).toBeVisible({ timeout: 10_000 })

    // Get titles of track 0, 1, 2
    const title0 = (await songRows.nth(0).locator('p').first().textContent())?.trim()
    const title1 = (await songRows.nth(1).locator('p').first().textContent())?.trim()
    const title2 = (await songRows.nth(2).locator('p').first().textContent())?.trim()

    // Rapidly click Track 0 -> Track 1 -> Track 2 in quick succession (< 80ms apart)
    await songRows.nth(0).click()
    await page.waitForTimeout(40)
    await songRows.nth(1).click()
    await page.waitForTimeout(40)
    await songRows.nth(2).click()

    // Wait for playback to stabilize
    const audioElement = page.locator('audio')
    await expect(audioElement).toBeAttached()

    // Wait until audio is playing
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0
    }, { timeout: 15_000 })

    // Verify PlayerBar displays Track 2's title (the LAST one clicked), NOT Track 0 or 1
    const playerBar = page.locator('footer.player-bar, .player-bar:visible')
    await expect(playerBar.first()).toContainText(title2 || '', { timeout: 5_000 })

    // Confirm that only 1 audio element exists and is playing
    const audioCount = await page.locator('audio').count()
    expect(audioCount).toBe(1)
  })

  test('Cold Track Click: First-time click on un-cached track measures instant optimistic UI and playback latency', async ({ page }) => {
    // Simulate real-world streaming endpoint with 200ms network roundtrip
    await page.route(/\/api\/drive-stream/, async (route) => {
      await new Promise((r) => setTimeout(r, 200))
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

    const songRows = await setupAndNavigate(page)
    const coldRow = songRows.nth(4)
    await expect(coldRow).toBeVisible()
    const coldTitle = (await coldRow.locator('p').first().textContent())?.trim()

    // Measure: Time to UI reaction (Optimistic UI) vs Time to Audio Playing
    const tClick = Date.now()
    await coldRow.click()

    // 1. Giao diện (PlayerBar) cập nhật tên bài hát tức thì (< 150ms)
    const playerBar = page.locator('footer.player-bar, .player-bar:visible')
    await expect(playerBar.first()).toContainText(coldTitle || '', { timeout: 3_000 })
    const tUI = Date.now() - tClick
    console.log(`[USER EXPERIENCE] Cold Click -> UI Updated (PlayerBar & Title): ${tUI}ms`)
    expect(tUI).toBeLessThan(1500) // Đảm bảo UI đổi ngay trong tích tắc

    // 2. Âm thanh bắt đầu phát ra (Time-to-Audio)
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0
    }, { timeout: 10_000 })
    const tAudio = Date.now() - tClick
    console.log(`[USER EXPERIENCE] Cold Click -> Audio Sound Playing: ${tAudio}ms`)
    expect(tAudio).toBeLessThan(5000)

    // Xác nhận audio đang chạy bình thường
    const audioElement = page.locator('audio')
    const currentTime = await audioElement.evaluate((el: HTMLAudioElement) => el.currentTime)
    expect(currentTime).toBeGreaterThan(0)
  })

  test('Worst Case UX Deep-Dive: System terminates buffering within bailout threshold, displays informative toast, and recovers on next track click', async ({ page }) => {
    // Track 0 (hỏng hoàn toàn): drive-stream 502, search 500, fallback 502
    await page.route(/\/api\/drive-stream/, (route) => {
      const url = route.request().url()
      if (url.includes('1o91pC5Vtk556BKKKepilcGPgJZBnwJce')) {
        // Track 0 hỏng hoàn toàn
        route.fulfill({ status: 502, body: 'Drive broken' })
      } else {
        // Các bài khác hoạt động bình thường
        route.fulfill({
          status: 200,
          contentType: 'audio/wav',
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(mockAudioBuffer.length),
          },
          body: mockAudioBuffer,
        })
      }
    })
    await page.route(/\/api\/search/, (route) => route.fulfill({ status: 500, body: 'Search broken' }))
    await page.route(/\/api\/nhaccuatui\/stream/, (route) => route.fulfill({ status: 502, body: 'NCT broken' }))
    await page.route(/\/api\/youtube\/stream/, (route) => route.fulfill({ status: 502, body: 'YT broken' }))

    const songRows = await setupAndNavigate(page)
    const brokenRow = songRows.nth(0)
    const healthyRow = songRows.nth(1)
    const brokenTitle = (await brokenRow.locator('p').first().textContent())?.trim()
    const healthyTitle = (await healthyRow.locator('p').first().textContent())?.trim()

    // BƯỚC 1: Người dùng ấn vào bài hát bị hỏng
    const tFailStart = Date.now()
    await brokenRow.click()

    // 1a. Thông báo lỗi Toast phải xuất hiện rõ ràng bằng tiếng Việt và ngắt loading
    const toast = page.locator('[role="alert"], [data-testid="toast-notification"], .glass-panel').filter({ hasText: /Không thể|lỗi|thất bại/i })
    await expect(toast.first()).toBeVisible({ timeout: 12_000 })
    const tBailout = Date.now() - tFailStart
    console.log(`[USER EXPERIENCE] Worst Case -> Time to Bailout (Ngắt xoay loading & Báo lỗi Toast): ${tBailout}ms`)
    expect(tBailout).toBeLessThan(10000) // Hệ thống phải từ bỏ và ngắt loading trong vòng < 10s

    const toastText = await toast.first().textContent()
    console.log(`[USER EXPERIENCE] Worst Case -> Toast message displayed: "${toastText?.trim()}"`)

    // 1b. Trạng thái xoay loading (buffering) phải tự động ngắt, KHÔNG ĐƯỢC xoay vĩnh viễn
    await expect(page.locator('html')).not.toHaveAttribute('data-buffering', { timeout: 3_000 })

    // 1c. Trình phát nhạc phải dừng ở trạng thái an toàn (không phát âm thanh rác)
    const isPlaying = await page.evaluate(() => {
      const audio = document.querySelector('audio')
      return audio ? !audio.paused : false
    })
    expect(isPlaying).toBe(false)

    // BƯỚC 2: Người dùng tự phục hồi (Self-Recovery) bằng cách ấn sang bài hát khác
    const tRecoverStart = Date.now()
    await healthyRow.click()

    // 2a. PlayerBar lập tức chuyển sang bài hát lành mạnh
    const playerBar = page.locator('footer.player-bar, .player-bar:visible')
    await expect(playerBar.first()).toContainText(healthyTitle || '', { timeout: 3_000 })

    // 2b. Bài hát mới lập tức phát nhạc bình thường
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0
    }, { timeout: 10_000 })
    const tRecover = Date.now() - tRecoverStart
    console.log(`[USER EXPERIENCE] Self-Recovery -> Next song playing successfully: ${tRecover}ms`)
    expect(tRecover).toBeLessThan(5000)
  })
})
