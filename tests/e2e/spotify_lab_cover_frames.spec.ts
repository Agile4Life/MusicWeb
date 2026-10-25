import { test, expect } from '@playwright/test'

test.use({ channel: 'chrome' })

for (const width of [1920, 390]) {
  test(`uses matching 16:9 cover frames up to 720px for stream, artwork and champion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => localStorage.setItem('has_seen_onboarding', 'true'))
    await page.route('**/api/auth/session', route => route.fulfill({ json: {} }))
    await page.route('**/api/song-battles*', route => route.fulfill({ json: { decks: [], total: 0 } }))
    await page.route('https://covers.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${route.request().url().includes('portrait') ? 200 : 1000}" height="600"><rect width="100%" height="100%" fill="#725447"/></svg>` }))
    await page.route('**/api/albums/cover-test', route => route.fulfill({ json: { tracks: [
      { id: 'musicweb-1', source: 'musicweb', title: 'Portrait', artist: 'Artist', stream_url: '/api/test-audio', cover_url: 'https://covers.test/portrait.svg' },
      { id: 'musicweb-2', source: 'musicweb', title: 'Landscape', artist: 'Artist', cover_url: 'https://covers.test/landscape.svg' },
    ] } }))
    await page.goto('/spotify-lab?album=cover-test', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
    await page.mouse.move(0, 0)
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
    })
    const covers = page.locator('article img').filter({ visible: true })
    await expect(covers).toHaveCount(4)
    const largeCovers = page.locator('article').locator('img').nth(1)
    await largeCovers.scrollIntoViewIfNeeded()
    const sizes = await page.locator('article').evaluateAll(cards => cards.map(card => {
      const img = card.querySelectorAll('img')[1]
      if (getComputedStyle(img).objectFit !== 'cover') throw new Error('Cover must crop instead of stretching')
      const box = img.getBoundingClientRect()
      return { width: box.width, height: box.height }
    }))
    for (const size of sizes) {
      expect(Math.abs(size.width - size.height * 16 / 9)).toBeLessThan(2)
      expect(size.width).toBeLessThanOrEqual(720)
      expect(size.width).toBeGreaterThan(250)
    }
    expect(Math.abs(sizes[0].width - sizes[1].width)).toBeLessThan(1)
    await page.locator('article').first().getByRole('button', { name: /^Chọn bài / }).click()
    await page.getByRole('button', { name: 'Bỏ qua chuyển cảnh' }).click()
    await expect(page.getByRole('heading', { name: 'Gu nhạc đã lên tiếng.' })).toBeVisible()
    await page.mouse.move(0, 0)
    const champion = page.locator('img').first()
    await expect.poll(async () => {
      const box = await champion.boundingBox()
      return Math.max(Math.abs(box!.width - sizes[0].width), Math.abs(box!.width - box!.height * 16 / 9))
    }).toBeLessThan(2)
  })
}
