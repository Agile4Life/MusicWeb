import { test, expect } from '@playwright/test'

test.use({ channel: 'chrome' })

const tracks = Array.from({ length: 8 }, (_, i) => ({
  id: `spotify-song${i}`, spotify_id: `song${i}`, title: `Bài hát ${i + 1}`,
  artist: `Nghệ sĩ ${i + 1}`, album: 'Album thử nghiệm', cover_url: null,
  duration: 180, preview_url: null, source: 'spotify',
}))

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('has_seen_onboarding', 'true'))
  await page.route('**/api/auth/session', route => route.fulfill({ json: {} }))
  await page.route('**/api/song-battles*', route => route.fulfill({ json: { decks: [], total: 0, page: 1, pageSize: 12 } }))
  await page.route('**/api/search?**', route => route.fulfill({ json: { tracks } }))
  await page.route('**/api/spotify/playlist?**', route => route.fulfill({ json: tracks.slice(0, 4) }))
  await page.route('**/api/youtube/playlist?**', route => route.fulfill({ json: { tracks: [
    { id: 'yt-video1', youtube_id: 'video1', source: 'youtube', title: 'YouTube Song', artist: 'YT Artist' },
  ] } }))
  await page.route('**/api/soundcloud/playlists?**', route => route.fulfill({ json: { tracks: [
    { id: 'sc-123', soundcloud_id: 123, source: 'soundcloud', title: 'SoundCloud Song', artist: 'SC Artist' },
  ] } }))
  // Keep unrelated third-party requests out of these controlled UI checks.
  await page.route('https://open.spotify.com/**', route => route.abort())
  await page.goto('/spotify-lab')
  await expect(page.locator('.intro-splash-backdrop')).toHaveCount(0)
  await page.getByRole('button', { name: 'Tạo cuộc đấu', exact: true }).click()
})

test('imports a main-site album, publishes its native audio and keeps portrait and landscape covers square', async ({ page }) => {
  const albumTracks = [0, 1].map(i => ({ id: `itunes-${i + 123}`, source: 'itunes', title: `Album song ${i}`, artist: 'Artist', file_path: `https://audio.test/${i}.m4a`, cover_url: `https://covers.test/${i}.svg` }))
  await page.route('**/api/albums/new-releases', route => route.fulfill({ json: [{ id: 'itunes-42', name: 'Main album', artist: 'Artist', cover_url: null }] }))
  await page.route('**/api/albums/itunes-42', route => route.fulfill({ json: { tracks: albumTracks } }))
  await page.route('**/api/playlists', route => route.fulfill({ json: { playlists: [] } }))
  await page.route('https://covers.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${route.request().url().includes('0.svg') ? 800 : 200}" height="400"><rect width="100%" height="100%" fill="red"/></svg>` }))
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 'owner', name: 'Album owner' }, expires: '2099-01-01' } }))
  await page.reload()
  await page.getByRole('button', { name: 'Tạo cuộc đấu', exact: true }).click()
  await page.getByRole('button', { name: 'Từ MusicWeb', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm album Main album' }).click()
  await expect(page.getByText('2 bài đã chọn', { exact: true })).toBeVisible()
  let published: { tracks: { source: string; stream_url: string }[] } | undefined
  await page.route('**/api/song-battles', async route => {
    published = route.request().postDataJSON()
    await route.fulfill({ status: 201, json: { deck: { ...published, id: '123e4567-e89b-42d3-a456-426614174000', is_owner: true, track_count: 2 } } })
  })
  await page.getByRole('button', { name: 'Đăng bộ bài', exact: true }).click()
  await page.getByLabel('Tên bộ bài', { exact: true }).fill('Album battle')
  await page.getByRole('button', { name: 'Đăng công khai', exact: true }).click()
  await expect(page.getByText('Bộ bài đã được đăng công khai.', { exact: true })).toBeVisible()
  expect(published?.tracks.map(track => track.source)).toEqual(['musicweb', 'musicweb'])
  expect(published?.tracks[0].stream_url).toBe('https://audio.test/0.m4a')
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const covers = page.locator('article audio').locator('..').locator('img')
    await expect(covers).toHaveCount(2)
    const sizes = await covers.evaluateAll(images => images.map(img => { const box = img.getBoundingClientRect(); return { width: box.width, height: box.height } }))
    for (const size of sizes) {
      expect(size.width).toBeGreaterThan(100)
      expect(Math.abs(size.width - size.height)).toBeLessThan(1)
    }
    expect(sizes[0].width).toBe(sizes[1].width)
  }
})

test('opens the builder with an album linked from the main site', async ({ page }) => {
  await page.route('**/api/albums/itunes-42', route => route.fulfill({ json: { tracks: tracks.slice(0, 2) } }))
  await page.goto('/spotify-lab?album=itunes-42')
  await expect(page.getByText('2 bài đã chọn', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Đăng bộ bài', exact: true })).toBeEnabled()
})

test('imports a playlist, completes a bracket, undoes the final and plays again', async ({ page }) => {
  await page.screenshot({ path: 'scratch/spotify-lab-desktop.png', fullPage: true })
  await expect(page.getByRole('button', { name: 'Bắt đầu đọ nhạc' })).toBeDisabled()
  await page.getByRole('button', { name: 'Nhập playlist', exact: true }).click()
  await page.getByLabel('Link playlist').fill('https://open.spotify.com/playlist/abc123')
  await page.getByRole('button', { name: 'Thêm playlist' }).click()
  await expect(page.getByText('Đã thêm 4 bài mới')).toBeVisible()
  await page.getByRole('button', { name: '4 bài', exact: true }).click()
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await expect(page.getByRole('heading', { name: 'Bán kết' })).toBeVisible()
  await page.screenshot({ path: 'scratch/spotify-lab-battle.png', fullPage: true })
  await page.getByRole('button', { name: /Chọn bài/ }).first().click()
  await page.getByRole('button', { name: /Chọn bài/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Chung kết' })).toBeVisible()
  await page.getByRole('button', { name: /Chọn bài/ }).last().click()
  await expect(page.getByText('BÀI HÁT VÔ ĐỊCH', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'scratch/spotify-lab-champion.png', fullPage: true })
  await page.getByRole('button', { name: 'Quay lại lựa chọn trước' }).click()
  await expect(page.getByRole('heading', { name: 'Chung kết' })).toBeVisible()
  await page.getByRole('button', { name: /Chọn bài/ }).first().click()
  await page.getByRole('button', { name: 'Chơi lại', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bán kết' })).toBeVisible()
})

test('searches, adds unique songs and imports multiple sources', async ({ page }) => {
  await page.getByLabel('Tìm bài hát').fill('test')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm Bài hát 1', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Đã thêm Bài hát 1' })).toBeDisabled()
  await page.getByRole('button', { name: 'Nhập playlist', exact: true }).click()
  for (const url of ['https://open.spotify.com/playlist/abc123', 'https://www.youtube.com/playlist?list=PL123', 'https://soundcloud.com/artist/sets/playlist']) {
    await page.getByLabel('Link playlist').fill(url)
    await page.getByRole('button', { name: 'Thêm playlist' }).click()
    await expect(page.getByRole('button', { name: 'Thêm playlist', exact: true })).toBeEnabled()
  }
  await expect(page.getByText('6 bài đã chọn', { exact: true })).toBeVisible()
  await page.getByLabel('Link playlist').fill('https://example.com/not-supported')
  await page.getByRole('button', { name: 'Thêm playlist' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Hỗ trợ playlist' })).toBeVisible()
})

test('fits a mobile screen and offers a two-song quick battle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Tìm bài hát').fill('test')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm Bài hát 1', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm Bài hát 2', exact: true }).click()
  await page.getByRole('button', { name: '2 bài', exact: true }).click()
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await expect(page.getByRole('heading', { name: 'Chung kết' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: /Chọn bài/ })).toHaveCount(2)
  await page.screenshot({ path: 'scratch/spotify-lab-mobile.png', fullPage: true })
})

test('destroys Spotify previews on switch, close, match choice and undo', async ({ page }) => {
  await page.route('https://open.spotify.com/embed/iframe-api/v1', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.spotifyCalls = [];
    window.onSpotifyIframeApiReady({ createController(element, options, callback) {
      const iframe = document.createElement('iframe'); iframe.title = 'Spotify test preview'; element.replaceWith(iframe);
      const record = type => window.spotifyCalls.push(type + ':' + options.uri);
      record('create');
      callback({ play() { record('play'); }, pause() { record('pause'); }, destroy() { record('destroy'); iframe.remove(); }, addListener(event, listener) { if (event === 'ready') queueMicrotask(listener); } });
    } });
  ` }))
  await page.getByLabel('Tìm bài hát').fill('test')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByRole('button', { name: 'Nghe thử Bài hát 1', exact: true }).click()
  await expect(page.locator('iframe[title^="Spotify:"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Nghe thử Bài hát 2', exact: true }).click()
  await expect(page.locator('iframe[title^="Spotify:"]')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => (window as unknown as { spotifyCalls: string[] }).spotifyCalls)).toContain('destroy:spotify:track:song0')
  await page.getByRole('button', { name: 'Đóng trình nghe thử' }).click()
  await expect(page.locator('iframe[title^="Spotify:"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Thêm tất cả' }).click()
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await expect(page.locator('iframe[title^="Spotify:"]')).toHaveCount(2)
  await page.getByRole('button', { name: /Chọn bài/ }).first().click()
  await expect(page.getByText('Trận 2 / 2', { exact: false })).toBeVisible()
  await expect(page.locator('iframe[title^="Spotify:"]')).toHaveCount(2)
  await page.getByRole('button', { name: 'Quay lại lựa chọn trước' }).click()
  await expect(page.getByText('Trận 1 / 2', { exact: false })).toBeVisible()
  await expect(page.locator('iframe[title^="Spotify:"]')).toHaveCount(2)
})

test('handles playlist failure, empty results and confirms leaving a game', async ({ page }) => {
  await page.route('**/api/spotify/playlist?**', route => route.fulfill({ status: 404, json: { error: 'Playlist đang riêng tư' } }))
  await page.getByRole('button', { name: 'Nhập playlist', exact: true }).click()
  await page.getByLabel('Link playlist').fill('https://open.spotify.com/playlist/private')
  await page.getByRole('button', { name: 'Thêm playlist' }).click()
  await expect(page.getByText('Playlist đang riêng tư')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Thêm playlist' })).toBeEnabled()
  await page.route('**/api/search?**', route => route.fulfill({ json: { tracks: [] } }))
  await page.getByRole('button', { name: 'Tìm bài hát', exact: true }).click()
  await page.getByLabel('Tìm bài hát').fill('empty')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await expect(page.getByText('Không tìm thấy bài hát.', { exact: false })).toBeVisible()
  await page.route('**/api/search?**', route => route.fulfill({ json: { tracks } }))
  await page.getByLabel('Tìm bài hát').fill('test')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByRole('button', { name: 'Thêm tất cả' }).click()
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await page.getByRole('button', { name: /Chọn bài/ }).first().click()
  await expect(page.getByText('Trận 2 / 2', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Về danh sách', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Chơi tiếp' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Về danh sách', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Về danh sách' }).click()
  await expect(page.getByText('8 bài đã chọn', { exact: true })).toBeVisible()
})

test('plays native previews and stops the previous audio when switching and closing', async ({ page }) => {
  const samples = 8000 * 30
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
  await page.route('https://audio.test/**', route => route.fulfill({ contentType: 'audio/wav', body: wav }))
  await page.route('**/api/search?**', route => route.fulfill({ json: { tracks: tracks.slice(0, 2).map(track => ({ ...track, preview_url: `https://audio.test/${track.id}.wav` })) } }))
  await page.getByLabel('Tìm bài hát').fill('preview')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByRole('button', { name: 'Nghe thử Bài hát 1', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(audio => !(audio as HTMLAudioElement).paused && (audio as HTMLAudioElement).currentTime > 0)).toBe(true)
  await page.locator('audio').evaluate(audio => { (window as unknown as { previousAudio: HTMLAudioElement }).previousAudio = audio as HTMLAudioElement })
  await page.getByRole('button', { name: 'Nghe thử Bài hát 2', exact: true }).click()
  await expect(page.locator('audio')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { previousAudio: HTMLAudioElement }).previousAudio.paused)).toBe(true)
  await expect.poll(() => page.locator('audio').evaluate(audio => !(audio as HTMLAudioElement).paused && (audio as HTMLAudioElement).currentTime > 0)).toBe(true)
  await page.getByRole('button', { name: 'Đóng trình nghe thử' }).click()
  await expect(page.locator('audio')).toHaveCount(0)
})

test('keeps imported YouTube and SoundCloud previews in their original source', async ({ page }) => {
  await page.route('https://www.youtube.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<p>YouTube fixture</p>' }))
  await page.route('https://w.soundcloud.com/player/**', route => route.fulfill({ contentType: 'text/html', body: '<p>SoundCloud fixture</p>' }))
  await page.getByRole('button', { name: 'Nhập playlist', exact: true }).click()
  for (const url of ['https://www.youtube.com/playlist?list=PL123', 'https://soundcloud.com/artist/sets/playlist']) {
    await page.getByLabel('Link playlist').fill(url)
    await page.getByRole('button', { name: 'Thêm playlist' }).click()
    await expect(page.getByRole('button', { name: 'Thêm playlist', exact: true })).toBeEnabled()
  }
  await page.getByRole('button', { name: '2 bài', exact: true }).click()
  await page.getByRole('button', { name: 'Bắt đầu đọ nhạc' }).click()
  await expect(page.getByTitle('YouTube: YouTube Song')).toBeVisible()
  await page.getByRole('button', { name: 'Nghe thử SoundCloud Song' }).click()
  await expect(page.getByTitle('YouTube: YouTube Song')).toHaveCount(1)
  await expect(page.getByTitle('SoundCloud: SoundCloud Song')).toBeVisible()
  await page.getByRole('button', { name: 'Chọn bài YouTube Song', exact: true }).click()
  await expect(page.getByTitle('SoundCloud: SoundCloud Song')).toHaveCount(0)
})

test('waits for Spotify readiness and falls back when a controller never becomes ready', async ({ page }) => {
  await page.route('https://open.spotify.com/embed/iframe-api/v1', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.spotifyPlays = 0; window.spotifyDestroys = 0;
    window.onSpotifyIframeApiReady({ createController(element, options, callback) {
      const iframe = document.createElement('iframe'); element.replaceWith(iframe);
      callback({ play() { window.spotifyPlays++; }, pause() {}, destroy() { window.spotifyDestroys++; iframe.remove(); }, addListener(event, listener) { if (event === 'ready') window.spotifyReady = listener; } });
    } });
  ` }))
  await page.getByLabel('Tìm bài hát').fill('test')
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await page.getByRole('button', { name: 'Nghe thử Bài hát 1', exact: true }).click()
  await expect(page.getByText('Đang tải trình nghe Spotify…')).toBeVisible()
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { spotifyReady: unknown }).spotifyReady)).toBe('function')
  expect(await page.evaluate(() => (window as unknown as { spotifyPlays: number }).spotifyPlays)).toBe(0)
  await page.evaluate(() => (window as unknown as { spotifyReady: () => void }).spotifyReady())
  await expect(page.getByText('Đang tải trình nghe Spotify…')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { spotifyPlays: number }).spotifyPlays)).toBe(1)
  await page.getByRole('button', { name: 'Đóng trình nghe thử' }).click()
  await page.clock.install()
  await page.getByRole('button', { name: 'Nghe thử Bài hát 2', exact: true }).click()
  await expect(page.locator('iframe[title="Spotify: Bài hát 2"]')).toHaveCount(1)
  await page.clock.fastForward(15001)
  await expect(page.locator('iframe[src*="open.spotify.com/embed/track/song1"]')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { spotifyDestroys: number }).spotifyDestroys)).toBe(2)
})
