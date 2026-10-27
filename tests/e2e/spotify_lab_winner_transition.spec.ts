import { test, expect } from '@playwright/test'

test.use({ channel: 'chrome' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('has_seen_onboarding', 'true'))
  await page.route('**/api/auth/session', route => route.fulfill({ json: {} }))
  await page.route('**/api/song-battles*', route => route.fulfill({ json: { decks: [], total: 0 } }))
  await page.route('**/api/albums/transition-test', route => route.fulfill({ json: { tracks: [1, 2, 3, 4].map(id => ({
    id: `musicweb-${id}`, title: `Song ${id}`, artist: 'Artist', source: 'musicweb', stream_url: `/api/test-audio?id=${id}`,
  })) } }))
  await page.goto('/spotify-lab?album=transition-test', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await expect(page.locator('article')).toHaveCount(2)
  // Freeze the clock only after entry animations and fonts have settled;
  // otherwise the initial layout can remain partway through its entrance.
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})))
  })
})

test('keeps the chosen song centered without glow then advances after two seconds', async ({ page }) => {
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 100))
  const winner = page.locator('article').first()
  await winner.getByRole('button', { name: /^Chọn bài / }).click()
  await expect(page.getByRole('button', { name: 'Bỏ qua chuyển cảnh' })).toBeVisible()
  await expect.poll(() => winner.evaluate(element => {
    const box = element.getBoundingClientRect()
    return Math.abs(box.x + box.width / 2 - innerWidth / 2)
  })).toBeLessThan(3)
  expect(await winner.evaluate(element => getComputedStyle(element, '::after').boxShadow)).toBe('none')
  const layers = await winner.evaluate(element => {
    const backdrop = getComputedStyle(element.closest('section')!, '::before')
    return { blur: backdrop.backdropFilter, gridLayer: getComputedStyle(element.parentElement!).zIndex, backdropLayer: Number(backdrop.zIndex), winnerLayer: Number(getComputedStyle(element).zIndex) }
  })
  expect(layers.blur).toContain('blur(')
  // The grid must not trap the losing card above the full-screen blur.
  expect(layers.gridLayer).toBe('auto')
  expect(layers.winnerLayer).toBeGreaterThan(layers.backdropLayer)
  await page.clock.fastForward(1900)
  await expect(page.getByText('Trận 1 / 2', { exact: false })).toBeVisible()
  await page.clock.fastForward(100)
  await expect(page.getByText('Trận 2 / 2', { exact: false })).toBeVisible()
})

test('double click skips once and does not choose a song in the following match', async ({ page }) => {
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 100))
  await page.locator('article').last().getByRole('button', { name: /^Chọn bài / }).dblclick()
  await expect(page.getByText('Trận 2 / 2', { exact: false })).toBeVisible()
  await page.clock.fastForward(2100)
  await expect(page.getByText('Trận 2 / 2', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bỏ qua chuyển cảnh' })).toHaveCount(0)
})

test('reduced motion avoids translation and allows skipping with the keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 100))
  await page.locator('article').first().getByRole('button', { name: /^Chọn bài / }).click()
  expect(await page.locator('article').first().evaluate(element => getComputedStyle(element).transform)).toBe('none')
  const skip = page.getByRole('button', { name: 'Bỏ qua chuyển cảnh' })
  await skip.focus(); await skip.press('Enter')
  await expect(page.getByText('Trận 2 / 2', { exact: false })).toBeVisible()
})

test('centers the lower card on mobile and supports the skip button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 100))
  const winner = page.locator('article').last()
  await winner.getByRole('button', { name: /^Chọn bài / }).click()
  await expect.poll(() => winner.evaluate(element => {
    const box = element.getBoundingClientRect()
    return Math.max(Math.abs(box.x + box.width / 2 - innerWidth / 2), Math.abs(box.y + box.height / 2 - innerHeight / 2))
  })).toBeLessThan(3)
  await page.getByRole('button', { name: 'Bỏ qua chuyển cảnh' }).click()
  await expect(page.getByText('Trận 2 / 2', { exact: false })).toBeVisible()
})
