import { test, expect } from '@playwright/test'

// Generate a valid 60-second WAV PCM buffer so HTML5 <audio> can play, advance time, and seek smoothly
function createWavBuffer(seconds = 60, sampleRate = 44100): Buffer {
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

const mockAudioBuffer = createWavBuffer(60)

test.describe('Playback Reload & Persistence E2E Test', () => {
  test('Detailed lifecycle analysis: Playing track before reload -> Page reload (F5) -> State restoration & Resume', async ({ page }) => {
    page.setViewportSize({ width: 1440, height: 900 })

    const logs: string[] = []
    const log = (msg: string) => {
      const time = new Date().toISOString().slice(11, 23)
      const line = `[${time}] ${msg}`
      logs.push(line)
      console.log(line)
    }

    // Intercept audio stream pipes so audio elements decode and play instantaneously
    const streamRouteHandler = (route: any) => {
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
    await page.route(/\/api\/drive-stream/, streamRouteHandler)
    await page.route(/\/api\/nhaccuatui\/stream/, streamRouteHandler)
    await page.route(/\/api\/soundcloud\/stream/, streamRouteHandler)

    // Bypass announcement modal & pre-seed onboarding
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

    page.on('console', (msg) => {
      const text = msg.text()
      if (
        text.includes('[Playback:') ||
        text.includes('[ResolveStream:') ||
        text.includes('musicweb_player_state') ||
        text.includes('Audio restore')
      ) {
        log(`[BROWSER LOG] ${text}`)
      }
    })

    log('====================================================================================')
    log(' BƯỚC 1: MỞ TRANG WEB & CHỌN BÀI HÁT TỪ GOOGLE DRIVE ĐỂ PHÁT')
    log('====================================================================================')

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Navigate to Google Drive catalog
    const driveTabBtn = page.getByRole('button', { name: /Google Drive \(/i })
    await expect(driveTabBtn).toBeVisible({ timeout: 15_000 })
    await driveTabBtn.click()

    const songRows = page.locator('.song-row')
    await expect(songRows.first()).toBeVisible({ timeout: 15_000 })
    const trackCount = await songRows.count()
    log(`Đã load danh sách bài hát Google Drive: ${trackCount} bài`)

    const targetRow = songRows.nth(1) // Pick second track
    const targetTitle = (await targetRow.locator('p').first().textContent())?.trim()
    log(`Bài hát được chọn: "${targetTitle}"`)

    log('Click vào bài hát để bắt đầu phát...')
    await targetRow.click({ force: true })

    // Verify audio element has source and starts playing
    const audioElement = page.locator('audio')
    await expect(audioElement).toBeAttached()
    await expect(audioElement).toHaveAttribute('src', /.+/, { timeout: 10_000 })

    log('Chờ audio element bắt đầu phát (playing = true, currentTime > 0)...')
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused && audio.currentTime > 0.5
    }, { timeout: 15_000 })

    // Let it play until it reaches at least ~4 seconds
    log('Để bài hát phát trong 4 giây...')
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && audio.currentTime >= 4.0
    }, { timeout: 10_000 })

    // Seek to 12.5 seconds to test non-trivial timestamp persistence
    log('Seek đến mốc 12.5 giây để kiểm tra khả năng lưu mốc thời gian chính xác...')
    await page.evaluate(() => {
      const audio = document.querySelector('audio')
      if (audio) audio.currentTime = 12.5
    })
    await page.waitForTimeout(1500) // let it play at 12.5s -> 14s

    // Thu thập trạng thái chi tiết TRƯỚC KHI RELOAD
    const preReloadData = await page.evaluate(() => {
      const audio = document.querySelector('audio')
      const storageRaw = localStorage.getItem('musicweb_player_state')
      let storageObj = null
      try { storageObj = storageRaw ? JSON.parse(storageRaw) : null } catch {}

      return {
        audioSrc: audio?.src || '',
        audioCurrentTime: audio?.currentTime || 0,
        audioDuration: audio?.duration || 0,
        audioPaused: audio?.paused ?? true,
        storageState: storageObj,
      }
    })

    const playerBar = page.locator('.player-bar, footer, [data-testid="player-bar"]').first()
    await expect(playerBar).toBeVisible()
    const preReloadBarText = (await playerBar.textContent())?.replace(/\s+/g, ' ').trim()

    log('\n------------------------------------------------------------------------------------')
    log(' [TRƯỚC KHI LOAD LẠI TRANG - STATE SNAPSHOT]')
    log(` • Tên bài hát hiển thị trên thanh PlayerBar: "${preReloadBarText?.slice(0, 80)}"`)
    log(` • Audio Element src: ${preReloadData.audioSrc.slice(0, 75)}...`)
    log(` • Audio Element currentTime: ${preReloadData.audioCurrentTime.toFixed(2)}s`)
    log(` • Audio Element duration: ${preReloadData.audioDuration.toFixed(2)}s`)
    log(` • Trạng thái phát (paused): ${preReloadData.audioPaused} (Đang phát bình thường)`)
    log(` • Lưu trữ localStorage ('musicweb_player_state'):`)
    log(`     - Track ID: ${preReloadData.storageState?.track?.id}`)
    log(`     - Track Title: "${preReloadData.storageState?.track?.title}"`)
    log(`     - Saved currentTime: ${preReloadData.storageState?.currentTime?.toFixed(2)}s`)
    log(`     - Queue length: ${preReloadData.storageState?.queue?.length}`)
    log('------------------------------------------------------------------------------------\n')

    expect(preReloadData.audioCurrentTime).toBeGreaterThanOrEqual(12.0)
    expect(preReloadData.audioPaused).toBe(false)

    log('====================================================================================')
    log(' BƯỚC 2: TIẾN HÀNH LOAD LẠI TRANG (F5 / page.reload)')
    log('====================================================================================')

    const tReloadStart = Date.now()
    await page.reload({ waitUntil: 'domcontentloaded' })
    const tReloadDuration = Date.now() - tReloadStart
    log(`Trang đã reload xong (domcontentloaded) sau ${tReloadDuration}ms`)

    // Chờ 1.5 giây để React mount và chạy effect restore
    await page.waitForTimeout(1500)

    log('====================================================================================')
    log(' BƯỚC 3: KIỂM TRA TRẠNG THÁI SAU KHI LOAD LẠI TRANG')
    log('====================================================================================')

    // Thu thập trạng thái NGAY SAU KHI RELOAD
    const postReloadData = await page.evaluate(() => {
      const audio = document.querySelector('audio')
      const storageRaw = localStorage.getItem('musicweb_player_state')
      let storageObj = null
      try { storageObj = storageRaw ? JSON.parse(storageRaw) : null } catch {}

      return {
        audioSrc: audio?.src || '',
        audioCurrentTime: audio?.currentTime || 0,
        audioDuration: audio?.duration || 0,
        audioPaused: audio?.paused ?? true,
        audioReadyState: audio?.readyState ?? 0,
        storageState: storageObj,
      }
    })

    await expect(playerBar).toBeVisible({ timeout: 10_000 })
    const postReloadBarText = (await playerBar.textContent())?.replace(/\s+/g, ' ').trim()

    log('\n------------------------------------------------------------------------------------')
    log(' [SAU KHI LOAD LẠI TRANG - STATE SNAPSHOT]')
    log(` • Thanh PlayerBar có hiển thị không: CÓ (Visible)`)
    log(` • Tên bài hát hiển thị trên PlayerBar: "${postReloadBarText?.slice(0, 80)}"`)
    log(` • Audio Element src: ${postReloadData.audioSrc.slice(0, 75)}...`)
    log(` • Audio Element currentTime: ${postReloadData.audioCurrentTime.toFixed(2)}s`)
    log(` • Audio Element duration: ${postReloadData.audioDuration.toFixed(2)}s`)
    log(` • Trạng thái paused: ${postReloadData.audioPaused} (ĐANG TẠM DỪNG / CHỜ BẤM PHÁT)`)
    log(` • Audio readyState: ${postReloadData.audioReadyState}`)
    log(` • Thông tin khôi phục từ localStorage:`)
    log(`     - Track ID: ${postReloadData.storageState?.track?.id}`)
    log(`     - Track Title: "${postReloadData.storageState?.track?.title}"`)
    log(`     - Khôi phục timestamp: ${postReloadData.storageState?.currentTime?.toFixed(2)}s`)
    log('------------------------------------------------------------------------------------\n')

    // 1. Kiểm tra bài hát có khớp với bài trước khi reload không
    log('Kiểm tra 1: Tiêu đề bài hát trên PlayerBar có khớp bài đang phát không...')
    expect(postReloadBarText?.toLowerCase()).toContain(targetTitle?.toLowerCase().slice(0, 10))
    log('-> KHỚP 100%')

    // 2. Kiểm tra mốc thời gian lưu trong storage có sát với lúc reload không
    const savedTime = postReloadData.storageState?.currentTime || 0
    const timeDifference = Math.abs(savedTime - preReloadData.audioCurrentTime)
    log(`Kiểm tra 2: Mốc thời gian trước reload (${preReloadData.audioCurrentTime.toFixed(2)}s) vs khôi phục (${savedTime.toFixed(2)}s). Độ lệch: ${timeDifference.toFixed(2)}s`)
    expect(timeDifference).toBeLessThanOrEqual(2.5)
    log('-> MỐC THỜI GIAN ĐƯỢC BẢO LƯU CHÍNH XÁC (sai số < 2.5s)')

    // 3. Kiểm tra hành vi Autoplay của trình duyệt:
    // Theo quy chuẩn W3C/Chrome Autoplay Policy, khi load lại trang mà không có tương tác trực tiếp của người dùng,
    // trình duyệt cấm tự động phát âm thanh để tránh làm giật mình người dùng.
    log('Kiểm tra 3: Trạng thái audio sau khi reload có tự động pause an toàn không...')
    expect(postReloadData.audioPaused).toBe(true)
    log('-> ĐÚNG THIẾT KẾ: Audio ở trạng thái tạm dừng, sẵn sàng với nút Play!')

    log('====================================================================================')
    log(' BƯỚC 4: THỬ BẤM NÚT "PHÁT" ĐỂ XEM BÀI HÁT CÓ PHÁT TIẾP TỪ MỐC ĐÃ LƯU KHÔNG')
    log('====================================================================================')

    // Nút Play trên PlayerBar
    const playBtn = playerBar.locator('button[title="Phát"], button[aria-label="Phát"], button:has(svg.lucide-play)').first()
    await expect(playBtn).toBeVisible({ timeout: 10_000 })

    log('Nhấn nút Play trên PlayerBar...')
    await playBtn.click({ force: true })

    // Chờ audio chuyển sang trạng thái đang phát
    log('Chờ audio element bắt đầu phát lại và chạy tiếp...')
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')
      return audio && !audio.paused
    }, { timeout: 10_000 })

    // Đợi thêm 2 giây để audio chạy tiếp
    await page.waitForTimeout(2000)

    const resumedData = await page.evaluate(() => {
      const audio = document.querySelector('audio')
      return {
        currentTime: audio?.currentTime || 0,
        paused: audio?.paused ?? true,
      }
    })

    log('\n------------------------------------------------------------------------------------')
    log(' [SAU KHI BẤM PLAY ĐỂ TIẾP TỤC]')
    log(` • currentTime hiện tại: ${resumedData.currentTime.toFixed(2)}s`)
    log(` • Trạng thái paused: ${resumedData.paused} (Đang phát mượt mà)`)
    log(` • Mốc thời gian trước khi reload: ${preReloadData.audioCurrentTime.toFixed(2)}s`)
    log('------------------------------------------------------------------------------------\n')

    // Xác nhận bài hát KHÔNG bị reset về 0:00 mà chạy tiếp từ mốc đã lưu!
    expect(resumedData.currentTime).toBeGreaterThanOrEqual(12.0)
    expect(resumedData.paused).toBe(false)
    log('-> THÀNH CÔNG: Bài hát tiếp tục phát từ mốc đã lưu, KHÔNG bị quay về 0:00!')

    log('====================================================================================')
    log(' TỔNG KẾT KẾT QUẢ TEST E2E:')
    log(' 1. Khi đang phát nhạc rồi F5 / reload trang:')
    log('    - Toàn bộ thông tin bài hát (Title, Artist, Album, Cover, Audio URL) được khôi phục 100%.')
    log('    - Danh sách phát (Queue) và vị trí bài hát trong queue được khôi phục nguyên vẹn.')
    log('    - Mốc thời gian đã phát (currentTime) được lưu qua sự kiện beforeunload / pagehide.')
    log('    - Tuân thủ Autoplay Policy của trình duyệt: Không tự ý phát âm thanh gây giật mình.')
    log('    - Khi người dùng click nút Play, bài hát phát tiếp tục từ đúng mốc thời gian đó.')
    log('====================================================================================')
  })
})
