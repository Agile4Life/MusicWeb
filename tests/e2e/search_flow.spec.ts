import { test, expect } from '@playwright/test'

function createWavBuffer(seconds = 3, sampleRate = 44100): Buffer {
  const numSamples = seconds * sampleRate
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

const mockAudioBuffer = createWavBuffer(3)

test.describe('Search & Discovery Flow E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept announcement modal
    await page.route('**/api/announcement', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { is_enabled: false } }),
      })
    })

    // Pre-seed localStorage to bypass onboarding
    await page.addInitScript(() => {
      window.localStorage.setItem('has_seen_onboarding', 'true')
      window.localStorage.setItem('cookie_consent', 'true')
      window.localStorage.setItem('musicweb_hide_welcome_modal', 'true')
      window.localStorage.setItem('musicweb_announcement_dismissed_v', '99999')
    })

    // Mock stream endpoints
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
  })

  test('Search suggestions display correctly on input and direct play works', async ({ page }) => {
    // Mock unified search API
    await page.route(/\/api\/search\?q=/, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nhaccuatui: [
            {
              id: 'nct-see-tinh-01',
              nhaccuatui_id: 'nct-see-tinh-01',
              title: 'See Tình',
              artist: 'Hoàng Thùy Linh',
              cover_url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300',
              duration: 185,
              source: 'nhaccuatui',
            },
          ],
          youtube: [
            {
              id: 'yt-see-tinh-remix',
              title: 'See Tình (Cukak Remix)',
              artist: 'Hoàng Thùy Linh',
              cover_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300',
              duration: 210,
              source: 'youtube',
            },
          ],
          soundcloud: [],
          local: [],
          audius: [],
          itunes: [],
          spotify: [],
          deezer: [],
        }),
      })
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Find search input
    const searchInput = page.locator('input.search-input')
    await expect(searchInput).toBeVisible({ timeout: 10_000 })

    // Type search query
    await searchInput.fill('See Tình')

    // Suggestions dropdown should appear
    const dropdown = page.locator('.search-dropdown-glass')
    await expect(dropdown).toBeVisible({ timeout: 10_000 })
    await expect(dropdown).toContainText('Gợi ý nhanh')
    await expect(dropdown).toContainText('See Tình')

    // Click first suggestion
    const firstSuggestion = dropdown.locator('p').filter({ hasText: 'See Tình' }).first()
    await firstSuggestion.click()

    // Dropdown should close after selection
    await expect(dropdown).not.toBeVisible({ timeout: 5_000 })

    // Player bar should display the selected track
    const playerBar = page.locator('footer.player-bar, .player-bar:visible').filter({ hasText: 'See Tình' })
    await expect(playerBar.first()).toBeVisible({ timeout: 10_000 })

    // Audio element should attach
    const audio = page.locator('audio')
    await expect(audio).toBeAttached()
  })

  test('Global search commits on Enter and renders results list', async ({ page }) => {
    await page.route(/\/api\/search\?q=/, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nhaccuatui: [
            {
              id: 'nct-glob-01',
              nhaccuatui_id: 'nct-glob-01',
              title: 'Cắt Đôi Nỗi Sầu',
              artist: 'Tăng Duy Tân',
              cover_url: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300',
              duration: 175,
              source: 'nhaccuatui',
            },
          ],
          youtube: [],
          soundcloud: [],
          local: [],
          audius: [],
          itunes: [],
          spotify: [],
          deezer: [],
        }),
      })
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const searchInput = page.locator('input.search-input')
    await expect(searchInput).toBeVisible({ timeout: 10_000 })

    // Fill and press Enter
    await searchInput.fill('Cắt Đôi Nỗi Sầu')
    await searchInput.press('Enter')

    // Search header should appear
    const searchHeader = page.locator('h2').filter({ hasText: 'Kết Quả Tìm Kiếm Toàn Cầu' })
    await expect(searchHeader).toBeVisible({ timeout: 10_000 })

    // The searched track should appear in the results list
    const resultItem = page.locator('.song-row, tr, div').filter({ hasText: 'Cắt Đôi Nỗi Sầu' })
    await expect(resultItem.first()).toBeVisible({ timeout: 10_000 })

    // Escape clears search
    await searchInput.press('Escape')
    await expect(searchHeader).not.toBeVisible({ timeout: 5_000 })
  })
})
