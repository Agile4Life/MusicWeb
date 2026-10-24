import { test, expect } from '@playwright/test'

test.use({ channel: 'chrome' })

// A real, decodable 12-second PCM file keeps playback tests independent of SC.
function audioFixture() {
  const rate = 8000
  const samples = rate * 12
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * .15) * (1000 + 8000 * i / samples)), 44 + i * 2)
  return wav
}

for (const source of ['soundcloud', 'musicweb'] as const) {
test(`${source} cover players play, decode, seek, pause each other and unmount with the match`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('has_seen_onboarding', 'true'))
  await page.route('**/api/auth/session', route => route.fulfill({ json: {} }))
  await page.route('**/api/song-battles*', route => route.fulfill({ json: { decks: [], total: 0 } }))
  await page.route('**/api/albums/wave-test', route => route.fulfill({ json: { tracks: [1, 2].map(id => ({
    id: `${source}-${id}`, soundcloud_id: source === 'soundcloud' ? `${id}` : undefined,
    stream_url: source === 'musicweb' ? `/api/test-audio?id=${id}` : undefined,
    title: `Wave ${id}`, artist: 'Test', duration: 12, source,
  })) } }))
  await page.route('**/api/soundcloud/stream?**', route => route.fulfill({ contentType: 'audio/wav', body: audioFixture() }))
  await page.route('**/api/test-audio?**', route => route.fulfill({ contentType: 'audio/wav', body: audioFixture() }))
  await page.goto('/spotify-lab?album=wave-test')
  await page.getByRole('button', { name: 'Nghe bài đã chọn Wave 1', exact: true }).click()
  const preview = page.getByRole('complementary', { name: 'Trình nghe thử' })
  await expect(preview.getByRole('slider', { name: 'Tua Wave 1' })).toBeVisible()
  await expect(page.locator('iframe[src*="soundcloud"]')).toHaveCount(0)
  await preview.getByRole('button', { name: 'Đóng trình nghe thử' }).click()
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await expect(page.locator('article audio')).toHaveCount(2)
  await expect(page.locator('article audio[controls]')).toHaveCount(0)
  await expect(page.getByRole('group', { name: `Trình nghe ${source === 'soundcloud' ? 'SoundCloud' : 'MusicWeb · Stream'}: Wave 1`, exact: true })).toBeVisible()
  const first = page.locator('article').first()
  const second = page.locator('article').nth(1)
  await first.getByRole('button', { name: /^Phát / }).click()
  await expect(first.getByRole('button', { name: /^Tạm dừng / })).toBeVisible()
  await expect.poll(() => first.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0)
  await expect.poll(() => first.locator('svg g').first().locator('rect').first().getAttribute('height')).not.toBe('4')
  const slider = first.getByRole('slider')
  await slider.fill('6')
  await expect.poll(() => first.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(6)
  await slider.focus(); await slider.press('ArrowRight')
  await second.getByRole('button', { name: /^Phát / }).click()
  await expect.poll(() => first.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
  await expect(second.getByRole('button', { name: /^Tạm dừng / })).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(slider).toBeVisible()
    const box = await slider.boundingBox()
    expect(box!.width).toBeGreaterThan(150)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await first.getByRole('button', { name: /^Chọn bài / }).click()
  await expect(page.locator('audio')).toHaveCount(0)
})
}
