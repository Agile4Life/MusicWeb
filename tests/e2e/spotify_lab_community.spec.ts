import { test, expect, type Page } from '@playwright/test'

test.use({ channel: 'chrome' })
const ID = '4c8389a4-e335-4444-a6df-dad0a460958d'
const tracks = Array.from({ length: 4 }, (_, index) => ({ id: `spotify-song${index}`, spotify_id: `song${index}`, source: 'spotify', title: `Ca khúc ${index + 1}`, artist: 'Nghệ sĩ', album: '', duration: 180, cover_url: null, preview_url: null, source_url: null }))
const original = { id: ID, name: 'Những bài hát đi qua tuổi trẻ', description: 'Một bộ bài để nghe và chọn.', creator_name: 'Người yêu nhạc', tracks, track_count: 4, cover_url: null, created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-23T00:00:00Z', is_owner: false }

async function prepare(page: Page, owner = false) {
  await page.addInitScript(() => localStorage.setItem('has_seen_onboarding', 'true'))
  await page.route('**/api/auth/session', route => route.fulfill({ json: owner ? { user: { name: 'Tác giả', email: 'author@example.test' }, expires: '2099-01-01T00:00:00Z' } : {} }))
  await page.route('**/api/song-battles*', route => route.fulfill({ json: { decks: [{ ...original, is_owner: owner }], page: 1, pageSize: 12, total: 1 } }))
  await page.route(`**/api/song-battles/${ID}`, async route => {
    if (route.request().method() === 'DELETE') return route.fulfill({ json: { success: true } })
    return route.fulfill({ json: { deck: { ...original, is_owner: owner } } })
  })
  await page.route('**/api/spotify/search?**', route => route.fulfill({ json: { tracks } }))
  await page.route('https://open.spotify.com/**', route => route.abort())
}

test('guests browse a public deck, share it, and play independently in separate contexts', async ({ page, browser }) => {
  await prepare(page)
  await page.goto('/spotify-lab')
  await expect(page.getByRole('heading', { name: original.name, exact: true })).toBeVisible()
  await page.screenshot({ path: 'scratch/spotify-lab-community-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'scratch/spotify-lab-community-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: `Chơi ${original.name}`, exact: true }).click()
  await expect(page.getByText('4 bài đã chọn', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Chia sẻ bộ bài', exact: true }).click()
  await expect(page.getByLabel('Link chia sẻ bộ bài')).toHaveValue(new RegExp(`deck=${ID}`))
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await page.getByRole('button', { name: /Chọn bài/ }).first().click()

  const other = await browser.newContext({ baseURL: 'http://localhost:3000' })
  try {
    const second = await other.newPage()
    await prepare(second)
    await second.goto(`/spotify-lab?deck=${ID}`)
    await expect(second.getByText('4 bài đã chọn', { exact: true })).toBeVisible()
    await second.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
    await expect(second.getByText('Trận 1 / 2', { exact: false })).toBeVisible()
    await expect(page.getByText('Trận 2 / 2', { exact: false })).toBeVisible()
    await expect(second.getByRole('button', { name: 'Quay lại lựa chọn trước' })).toBeDisabled()
  } finally { await other.close() }
})

test('an authenticated creator can publish their selection and edit their own deck', async ({ page }) => {
  await prepare(page, true)
  let saved: Record<string, unknown> | null = null
  await page.route('**/api/song-battles', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    saved = route.request().postDataJSON()
    await route.fulfill({ status: 201, json: { deck: { ...original, ...saved, is_owner: true } } })
  })
  await page.goto('/spotify-lab')
  await page.getByRole('button', { name: 'Tạo cuộc đấu', exact: true }).click()
  await page.getByLabel('Tìm bài hát').fill('test')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm tất cả' }).click()
  await page.getByRole('button', { name: 'Đăng bộ bài', exact: true }).click()
  await page.getByLabel('Tên bộ bài').fill('Bộ bài của tôi')
  await page.getByLabel('Mô tả bộ bài').fill('Cùng chọn bài hay nhất nhé.')
  await page.screenshot({ path: 'scratch/spotify-lab-publish.png', fullPage: true })
  await page.getByRole('button', { name: 'Đăng công khai', exact: true }).click()
  await expect(page.getByText('Bộ bài đã được đăng công khai.')).toBeVisible()
  expect(saved).toMatchObject({ name: 'Bộ bài của tôi' })
  await page.getByRole('button', { name: 'Cập nhật bộ bài', exact: true }).click()
  await page.getByLabel('Tên bộ bài').fill('Tên mới')
  await page.route(`**/api/song-battles/${ID}`, async route => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    const body = route.request().postDataJSON()
    expect(body.expectedUpdatedAt).toBe(original.updated_at)
    await route.fulfill({ json: { deck: { ...original, ...body, is_owner: true } } })
  })
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await expect(page.getByText('Đã cập nhật bộ bài.')).toBeVisible()
})

test('guests can play but cannot publish, and missing database setup has a retry state', async ({ page }) => {
  await prepare(page)
  await page.route('**/api/song-battles*', route => route.fulfill({ status: 503, json: { error: 'Thư viện bộ bài chưa được thiết lập.' } }))
  await page.goto('/spotify-lab')
  await expect(page.getByText('Thư viện bộ bài chưa được thiết lập.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Thử lại', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tạo cuộc đấu', exact: true }).click()
  await page.getByLabel('Tìm bài hát').fill('test')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm tất cả' }).click()
  await page.getByRole('button', { name: 'Đăng bộ bài', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Đăng nhập để đăng bộ bài')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Đăng nhập' })).toBeVisible()
})

test('a late deck request cannot overwrite a newer local game', async ({ page }) => {
  await prepare(page)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/song-battles/${ID}`, async route => {
    await held
    await route.fulfill({ json: { deck: original } }).catch(() => {})
  })
  await page.goto('/spotify-lab')
  await Promise.all([page.waitForRequest(`**/api/song-battles/${ID}`), page.getByRole('button', { name: `Chơi ${original.name}`, exact: true }).click()])
  await page.getByRole('button', { name: 'Tạo cuộc đấu', exact: true }).click()
  await page.getByLabel('Tìm bài hát').fill('test')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm tất cả' }).click()
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  release()
  await expect(page.getByRole('heading', { name: 'Bán kết' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Bộ bài đang chơi' })).toHaveCount(0)
})

test('keeps a guest draft through sign-in and reopens the publishing form on return', async ({ page }) => {
  await prepare(page)
  await page.goto('/spotify-lab')
  await page.getByRole('button', { name: 'Tạo cuộc đấu', exact: true }).click()
  await page.getByLabel('Tìm bài hát').fill('test')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm tất cả' }).click()
  await page.getByRole('button', { name: 'Đăng bộ bài', exact: true }).click()
  const login = page.getByRole('dialog').getByRole('link', { name: 'Đăng nhập' })
  await expect(login).toHaveAttribute('href', '/login?returnTo=%2Fspotify-lab')
  await login.click()
  await expect(page).toHaveURL(/\/login\?returnTo=/)
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { name: 'Tác giả', email: 'author@example.test' }, expires: '2099-01-01T00:00:00Z' } }))
  // Authentication itself is covered by the existing auth tests; simulate its safe return.
  await page.goto('/spotify-lab')
  await expect(page.getByText('4 bài đã chọn', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').getByLabel('Tên bộ bài')).toBeVisible()
})

test('filters, paginates, and only offers deletion for the creator', async ({ page }) => {
  await prepare(page, true)
  let list = Array.from({ length: 25 }, (_, index) => ({ ...original, id: index === 0 ? ID : `${String(index).padStart(8, '0')}-e335-4444-a6df-dad0a460958d`, name: `Bộ bài số ${index + 1}`, is_owner: index === 0 }))
  await page.route('**/api/song-battles?**', async route => {
    const url = new URL(route.request().url())
    let filtered = list.filter(deck => deck.name.includes(url.searchParams.get('q') || ''))
    if (url.searchParams.get('mine') === '1') filtered = filtered.filter(deck => deck.is_owner)
    const page = Number(url.searchParams.get('page') || 1)
    await route.fulfill({ json: { decks: filtered.slice((page - 1) * 12, page * 12), total: filtered.length, page, pageSize: 12 } })
  })
  await page.route(`**/api/song-battles/${ID}`, async route => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    list = list.filter(deck => deck.id !== ID)
    await route.fulfill({ json: { success: true } })
  })
  await page.goto('/spotify-lab')
  await expect(page.getByRole('button', { name: /^Xóa bộ bài / })).toHaveCount(1)
  await page.getByRole('button', { name: 'Trang tiếp' }).click()
  await expect(page.getByRole('heading', { name: 'Bộ bài số 13', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Xóa bộ bài / })).toHaveCount(0)
  await page.getByRole('button', { name: 'Của tôi', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bộ bài số 1', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Xóa bộ bài Bộ bài số 1', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa bộ bài', exact: true }).click()
  await expect(page.getByText('Gu nhạc của bạn đang chờ được chia sẻ.')).toBeVisible()
})
