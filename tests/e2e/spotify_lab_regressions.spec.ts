import { test, expect } from '@playwright/test'

test.use({ channel: 'chrome' })
const tracks = [1, 2].map(i => ({ id: `db-${i}`, spotify_id: `song${i}`, title: `Song ${i}`, source: 'spotify', artist: 'Artist' }))

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('has_seen_onboarding', 'true'))
  await page.route('**/api/auth/session', route => route.fulfill({ json: {} }))
  await page.route('**/api/song-battles?**', route => route.fulfill({ json: { decks: [], total: 0, page: 1, pageSize: 12 } }))
  await page.route('**/api/search?**', route => route.fulfill({ json: { tracks } }))
  await page.route('https://open.spotify.com/**', route => route.abort())
  await page.route('**/api/drive-stream?**', route => route.fulfill({ status: 404 }))
  await page.goto('/spotify-lab')
  await page.getByRole('button', { name: 'Tạo cuộc đấu', exact: true }).click()
})

test('two tracks can start immediately and the champion can be previewed', async ({ page }) => {
  await page.getByLabel('Tìm bài hát').fill('song')
  await page.getByRole('button', { name: 'Thêm tất cả' }).click()
  await expect(page.getByRole('button', { name: 'Bắt đầu đọ nhạc' })).toBeEnabled()
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await page.getByRole('button', { name: /Chọn bài/ }).first().click()
  await page.getByRole('button', { name: 'Nghe lại bài thắng' }).click()
  await expect(page.getByRole('complementary', { name: 'Trình nghe thử' })).toBeVisible()
})

test('explicitly creating a new deck clears the previous selection', async ({ page }) => {
  await page.getByLabel('Tìm bài hát').fill('song')
  await page.getByRole('button', { name: 'Thêm tất cả' }).click()
  await page.getByRole('button', { name: 'Bộ bài cộng đồng', exact: true }).click()
  await page.getByRole('button', { name: 'Tạo bộ bài', exact: true }).click()
  await expect(page.getByText('0 bài đã chọn', { exact: true })).toBeVisible()
})

test('import feedback counts unique source identities rather than database IDs', async ({ page }) => {
  await page.getByLabel('Tìm bài hát').fill('song')
  await page.getByRole('button', { name: 'Thêm tất cả' }).click()
  await page.route('**/api/spotify/playlist?**', route => route.fulfill({ json: tracks.map(t => ({ ...t, id: `external-${t.id}` })) }))
  await page.getByRole('button', { name: 'Nhập playlist', exact: true }).click()
  await page.getByLabel('Link playlist').fill('https://open.spotify.com/playlist/test')
  await page.getByRole('button', { name: 'Thêm playlist', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Các bài trong playlist này đã có trong danh sách.')
  await expect(page.getByText('2 bài đã chọn', { exact: true })).toBeVisible()
})

test('MusicWeb audio does not autoplay both contestants', async ({ page }) => {
  await page.route('**/api/playlists', route => route.fulfill({ json: { playlists: [{ id: 'local', name: 'Local songs', is_public: true }] } }))
  await page.route('**/api/playlists/local', route => route.fulfill({ json: { tracks: tracks.map((t, i) => ({ ...t, spotify_id: undefined, source: 'local', drive_file_id: `drive${i}` })) } }))
  await page.getByRole('button', { name: 'Từ MusicWeb' }).click()
  await page.getByRole('button', { name: 'Thêm playlist Local songs' }).click()
  await expect(page.getByText('2 bài đã chọn', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '2 bài', exact: true }).click()
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await expect(page.locator('audio')).toHaveCount(2)
  await expect(page.locator('audio[autoplay]')).toHaveCount(0)
})

test('leaving the MusicWeb tab cancels a pending import', async ({ page }) => {
  await page.route('**/api/playlists', route => route.fulfill({ json: { playlists: [{ id: 'slow', name: 'Slow playlist', is_public: true }] } }))
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/playlists/slow', async route => {
    await held
    await route.fulfill({ json: { tracks } }).catch(() => {})
  })
  await page.getByRole('button', { name: 'Từ MusicWeb' }).click()
  await Promise.all([
    page.waitForRequest('**/api/playlists/slow'),
    page.getByRole('button', { name: 'Thêm playlist Slow playlist' }).click(),
  ])
  await page.getByRole('button', { name: 'Tìm bài hát', exact: true }).click()
  release()
  await page.getByLabel('Tìm bài hát').fill('song')
  await expect(page.getByRole('button', { name: 'Thêm Song 1', exact: true })).toBeEnabled()
  await expect(page.getByText('0 bài đã chọn', { exact: true })).toBeVisible()
})

test('playlist errors offer retry without claiming the library is empty', async ({ page }) => {
  await page.route('**/api/playlists', route => route.fulfill({ status: 500, json: { error: 'Không tải được playlist.' } }))
  await page.getByRole('button', { name: 'Từ MusicWeb' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Không tải được playlist.' })).toBeVisible()
  await expect(page.getByText('Chưa có playlist nào.')).toHaveCount(0)
  await page.route('**/api/playlists', route => route.fulfill({ json: { playlists: [] } }))
  await page.getByRole('button', { name: 'Thử tải lại playlist' }).click()
  await expect(page.getByText('Chưa có playlist nào.')).toBeVisible()
})

test('adding reports feedback and clearing can be undone on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Tìm bài hát').fill('song')
  await page.getByRole('button', { name: 'Thêm tất cả' }).click()
  await expect(page.getByText('Đã thêm 2 bài vào danh sách thi đấu.')).toBeVisible()
  await page.getByRole('button', { name: 'Nghe bài đã chọn Song 1', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Trình nghe thử' })).toBeVisible()
  await page.getByRole('button', { name: 'Xóa tất cả', exact: true }).click()
  await expect(page.getByText('0 bài đã chọn', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click()
  await expect(page.getByText('2 bài đã chọn', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('publish form allows MusicWeb tracks with valid stream URLs', async ({ page }) => {
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { name: 'Author', email: 'author@example.test' }, expires: '2099-01-01T00:00:00Z' } }))
  await page.reload()
  await page.getByRole('button', { name: 'Tạo cuộc đấu', exact: true }).click()
  await page.route('**/api/playlists', route => route.fulfill({ json: { playlists: [{ id: 'local', name: 'Local songs', is_public: true }] } }))
  await page.route('**/api/playlists/local', route => route.fulfill({ json: { tracks: tracks.map((t, i) => ({ ...t, spotify_id: undefined, source: 'local', drive_file_id: `drive${i}` })) } }))
  await page.getByRole('button', { name: 'Từ MusicWeb' }).click()
  await page.getByRole('button', { name: 'Thêm playlist Local songs' }).click()
  await page.getByRole('button', { name: 'Đăng bộ bài', exact: true }).click()
  await page.getByLabel('Tên bộ bài').fill('My deck')
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Đăng công khai', exact: true })).toBeEnabled()
})
