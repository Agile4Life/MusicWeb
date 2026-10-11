import { expect } from '@playwright/test'
import { test, deferred, setup, playRow, playing } from './helpers/playback_reliability'

test('late A resolution cannot steal audio from B', async ({ page }) => {
  const gate = deferred()
  const { requested } = await setup(page, { resolveA: gate })
  await playRow(page, 'A')
  await expect.poll(() => requested).toContain('Reliability A')
  await playRow(page, 'B')
  await playing(page, 'B')
  const response = page.waitForResponse((r) => r.url().includes('/api/resolve-stream') && new URL(r.url()).searchParams.get('title') === 'Reliability A')
  gate.release()
  await response
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page.locator('audio')).toHaveAttribute('src', /track=B/)
  expect(await page.evaluate(() => window.__playbackProbe.events.filter((e) => e.name === 'playing' && e.src.includes('track=A')))).toEqual([])
})

test('pause while resolving remains paused after the URL arrives', async ({ page }) => {
  const gate = deferred()
  const { requested } = await setup(page, { resolveA: gate })
  await playRow(page, 'A')
  await expect.poll(() => requested).toContain('Reliability A')
  await page.locator('button[title="Loading audio stream..."]:visible').first().click()
  const response = page.waitForResponse((r) => r.url().includes('/api/resolve-stream'))
  gate.release(); await response
  await expect(page.locator('audio')).toHaveAttribute('src', /track=A/)
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.readyState)).toBeGreaterThan(0)
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  expect(await page.evaluate(() => window.__playbackProbe.events.filter((e) => e.name === 'playing'))).toEqual([])
  await page.locator('button[title="Play"]:visible').first().click()
  await playing(page, 'A')
})

test('repeat one survives three real audio endings', async ({ page }) => {
  await setup(page, { repeat: 'one', seconds: 1.5 })
  await playRow(page, 'A'); await playing(page, 'A')
  await expect.poll(() => page.evaluate(() => window.__playbackProbe.events.filter((e) => e.name === 'ended').length), { timeout: 15_000 }).toBeGreaterThanOrEqual(3)
  await playing(page, 'A')
  await expect(page.locator('audio')).toHaveAttribute('src', /track=A/)
})

test('MediaSession pause survives foreground and lifecycle callbacks', async ({ page }) => {
  await setup(page)
  const capability = await page.evaluate(() => ({
    mediaSession: 'mediaSession' in navigator,
    setActionHandler: typeof navigator.mediaSession?.setActionHandler === 'function',
    secureContext: isSecureContext,
  }))
  await test.info().attach('native-media-session-capability.json', { body: JSON.stringify(capability), contentType: 'application/json' })
  test.skip(!capability.mediaSession || !capability.setActionHandler, 'This native browser does not expose the MediaSession action API.')
  await playRow(page, 'A'); await playing(page, 'A')
  await page.waitForFunction(() => typeof window.__playbackProbe.handlers.pause === 'function')
  await page.evaluate(() => window.__playbackProbe.handlers.pause?.({ action: 'pause' }))
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  const starts = await page.evaluate(() => window.__playbackProbe.events.filter((e) => e.name === 'playing').length)
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    window.dispatchEvent(new Event('focus'))
  })
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  expect(await page.evaluate(() => window.__playbackProbe.events.filter((e) => e.name === 'playing').length)).toBe(starts)
  await page.evaluate(() => window.__playbackProbe.handlers.play?.({ action: 'play' }))
  await playing(page, 'A')
})

test('native output amplitude applies volume once', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop volume slider; native mobile volume belongs to the physical OS.')
  await setup(page)
  await playRow(page, 'A'); await playing(page, 'A')
  const slider = page.locator('footer.player-bar input[type="range"]').last()
  const sample = async (value: string) => {
    await slider.fill(value)
    await expect.poll(() => page.evaluate((volume) => {
      const probe = window.__playbackProbe
      return probe.gains.some((g) => Math.abs(g.gain.gain.value - volume) < 0.001)
    }, Number(value))).toBe(true)
    return page.evaluate(async () => {
      const entry = window.__playbackProbe.gains.at(-1)
      if (!entry) throw new Error('Production Web Audio gain was not connected')
      const { analyser, context } = entry
      const values: number[] = []
      // Sample native analyser frames after its FFT window has filled at the new gain.
      const start = context.currentTime
      while (context.currentTime - start < 0.25) await new Promise(requestAnimationFrame)
      for (let frame = 0; frame < 6; frame++) {
        await new Promise(requestAnimationFrame)
        const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data)
        values.push(Math.sqrt(data.reduce((sum: number, x: number) => sum + x * x, 0) / data.length))
      }
      return values.reduce((sum, value) => sum + value, 0) / values.length
    })
  }
  const full = await sample('1'); const half = await sample('0.5')
  await test.info().attach('native-volume-amplitude.json', { body: JSON.stringify({ full, half, ratio: half / full }), contentType: 'application/json' })
  expect(full).toBeGreaterThan(0.05)
  expect(half / full).toBeGreaterThan(0.43)
  expect(half / full).toBeLessThan(0.57)
  expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.volume)).toBe(1)
})

test('mobile cached B lyrics reject a late A result and follow audio time', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'MobileFullviewPlayer regression.')
  const lyricsGate = deferred()
  const overlay = page.locator('.mobile-fullview-overlay')
  await setup(page, { lyricsA: lyricsGate })
  await playRow(page, 'B'); await playing(page, 'B')
  await page.locator('.mini-player:visible').first().click()
  await page.getByRole('button', { name: 'Lời bài hát', exact: true }).click()
  await expect(overlay.getByText('B first fixture line', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Đóng trình phát toàn màn hình', exact: true }).click()
  await playRow(page, 'A'); await playing(page, 'A')
  await page.locator('.mini-player:visible').first().click()
  await page.getByRole('button', { name: 'Lời bài hát', exact: true }).click()
  await page.getByRole('button', { name: 'Bài tiếp theo', exact: true }).last().click()
  await playing(page, 'B')
  await expect(overlay.getByText('B first fixture line', { exact: true })).toBeVisible()
  const response = page.waitForResponse((r) => r.url().includes('lrclib.net/api/get') && new URL(r.url()).searchParams.get('track_name') === 'Reliability A')
  lyricsGate.release(); await response
  await expect(overlay.getByText('A first fixture line', { exact: true })).toHaveCount(0)
  await page.waitForFunction(() => (document.querySelector('audio')?.currentTime || 0) >= 2.1)
  await expect(overlay.getByText('B third fixture line', { exact: true })).toHaveClass(/font-black/)
  await page.screenshot({ path: test.info().outputPath('mobile-lyrics-success.png') })
})
