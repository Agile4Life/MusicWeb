import { expect, test } from '@playwright/test'

test.use({ channel: 'chrome' })

const retiredTracks = [
  { id: 'saved-apple', source: 'itunes', title: 'Saved Apple Song', artist: 'Saved Artist', stream_url: 'https://audio-ssl.itunes.apple.com/preview.m4a' },
  { id: '123e4567-e89b-42d3-a456-426614174000', source: 'musicweb', title: 'Saved Audius Song', artist: 'Saved Artist', stream_url: 'https://discovery-provider.example/v1/tracks/old/stream?app_name=MUSICWEB_PRO' },
  { id: 'itunes-other', source: 'itunes', title: 'Other Saved Song', artist: 'Saved Artist' },
  { id: 'audius-other', source: 'audius', title: 'Last Saved Song', artist: 'Saved Artist' },
]

test('resolves only the visible saved battle candidates and preserves their titles', async ({ page }) => {
  const requestedTitles: string[] = []
  await page.addInitScript(() => localStorage.setItem('has_seen_onboarding', 'true'))
  await page.route('**/api/auth/session', route => route.fulfill({ json: {} }))
  await page.route('**/api/song-battles*', route => route.fulfill({ json: { decks: [], total: 0 } }))
  await page.route('**/api/albums/retired-playback', route => route.fulfill({ json: { tracks: retiredTracks } }))
  await page.route('**/api/resolve-stream?*', async route => {
    const title = new URL(route.request().url()).searchParams.get('title')!
    requestedTitles.push(title)
    await route.fulfill({ json: title === 'Saved Audius Song'
      ? { source: 'youtube', id: 'supported-video', title: 'Replacement title' }
      : { source: 'drive', id: 'supported-file', title: 'Replacement title' } })
  })
  await page.route('https://www.youtube.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Supported video</p>' }))
  await page.goto('/spotify-lab?album=retired-playback', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('ol li')).toHaveCount(4)
  expect(requestedTitles).toEqual([])
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()

  for (let match = 0; match < 2; match++) {
    const titles = await page.locator('article h3').allTextContents()
    await expect.poll(() => requestedTitles.length).toBe((match + 1) * 2)
    for (const title of titles) {
      expect(requestedTitles).toContain(title)
      const card = page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
      if (title === 'Saved Audius Song') {
        await expect(card.locator('iframe')).toHaveAttribute('src', /youtube\.com\/embed\/supported-video/)
      } else {
        await expect(card.locator('audio')).toHaveAttribute('src', /\/api\/drive-stream\?fileId=supported-file/)
      }
    }
    await page.locator('article').first().getByRole('button', { name: /^Chọn bài / }).click()
    await page.getByRole('button', { name: 'Bỏ qua chuyển cảnh' }).click()
  }
  await expect(page.locator('article h3')).toHaveCount(2)
  await expect.poll(() => page.locator('article audio, article iframe').count()).toBe(2)
  expect(requestedTitles).toHaveLength(4)
  expect(new Set(requestedTitles).size).toBe(4)
})

test('resolves a selected saved preview without looking up supported battle tracks', async ({ page }) => {
  const requestedTitles: string[] = []
  const supported = { id: 'supported-track', source: 'musicweb', title: 'Supported Song', artist: 'Artist', stream_url: '/api/drive-stream?fileId=existing-file' }
  await page.addInitScript(() => localStorage.setItem('has_seen_onboarding', 'true'))
  await page.route('**/api/auth/session', route => route.fulfill({ json: {} }))
  await page.route('**/api/song-battles*', route => route.fulfill({ json: { decks: [], total: 0 } }))
  await page.route('**/api/albums/retired-preview', route => route.fulfill({ json: { tracks: [retiredTracks[0], supported] } }))
  await page.route('**/api/resolve-stream?*', async route => {
    requestedTitles.push(new URL(route.request().url()).searchParams.get('title')!)
    await route.fulfill({ json: { source: 'nhaccuatui', id: 'supported-song', title: 'Replacement title' } })
  })
  await page.route('**/api/nhaccuatui/stream?*', route => route.fulfill({ status: 404, body: '' }))
  await page.goto('/spotify-lab?album=retired-preview', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Nghe bài đã chọn Saved Apple Song' }).click()
  await expect(page.locator('aside audio')).toHaveAttribute('src', /\/api\/nhaccuatui\/stream\?id=supported-song/)
  await expect(page.locator('aside[aria-label="Trình nghe thử"]')).toContainText('Saved Apple Song')
  expect(requestedTitles).toEqual(['Saved Apple Song'])
  await page.getByRole('button', { name: 'Đóng trình nghe thử' }).click()
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await expect(page.locator('article audio')).toHaveCount(2)
  expect(requestedTitles).toEqual(['Saved Apple Song'])
})
