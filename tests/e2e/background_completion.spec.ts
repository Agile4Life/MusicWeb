import { expect } from '@playwright/test'
import { test, setup, playRow, playing } from './helpers/playback_reliability'

test('advances a hidden track with delayed ended events and window timers', async ({ page }) => {
  test.setTimeout(45_000)
  await page.addInitScript(() => {
    const interval = window.setInterval.bind(window)
    Reflect.set(window, 'setInterval', (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      interval(delay === 1500 ? () => {} : handler, delay, ...args))
    // Simulate the missing EOF callbacks while retaining real browser audio,
    // network requests and the production worker's native timer.
    document.addEventListener('ended', event => {
      if (event.target instanceof HTMLAudioElement) event.stopImmediatePropagation()
    }, true)
    document.addEventListener('timeupdate', event => {
      const audio = event.target
      if (audio instanceof HTMLAudioElement && audio.duration - audio.currentTime <= 2) {
        event.stopImmediatePropagation()
      }
    }, true)
  })
  const { rows } = await setup(page, { seconds: 8 })
  await playRow(page, 'A'); await playing(page, 'A')
  const next = rows.filter({ hasText: 'Reliability B' }).first()
  await next.hover()
  await next.getByTitle('Thêm vào hàng đợi', { exact: true }).click()

  await page.evaluate(() => {
    // Headless tabs stay visible, so explicitly drive the visibility handler.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    const audio = document.querySelector('audio')!
    audio.currentTime = audio.duration - 0.6
  })
  await expect(page.locator('html')).toHaveAttribute('data-tab-hidden', 'true')
  await playing(page, 'B')
  // No foreground event was dispatched to trigger recovery.
  expect(await page.evaluate(() => document.hidden)).toBe(true)
})

test('Safari background transition: recovers from EOF pause without ended event and switches tracks synchronously without MediaSession dipping to paused', async ({ page }) => {
  test.setTimeout(45_000)
  await page.addInitScript(() => {
    // Drop native ended event to simulate iOS/macOS Safari firing pause at EOF while coalescing/delaying ended
    document.addEventListener('ended', event => {
      if (event.target instanceof HTMLAudioElement) event.stopImmediatePropagation()
    }, true)
  })

  const { rows } = await setup(page, { seconds: 8 })
  await playRow(page, 'A')
  await playing(page, 'A')

  const next = rows.filter({ hasText: 'Reliability B' }).first()
  await next.hover()
  await next.getByTitle('Thêm vào hàng đợi', { exact: true }).click()

  // Background the tab so triggerAdaptivePrewarm pre-resolves track B while hidden
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('html')).toHaveAttribute('data-tab-hidden', 'true')

  // Wait briefly for background adaptive prewarm of B to complete
  await page.waitForTimeout(400)

  // Simulate Safari reaching EOF in background and firing 'pause' before/instead of 'ended'
  const transitionTiming = await page.evaluate(() => {
    const audio = document.querySelector('audio')!
    const t0 = performance.now()
    audio.currentTime = audio.duration - 0.15
    audio.dispatchEvent(new Event('pause'))
    const t1 = performance.now()
    return {
      syncSwitchMs: t1 - t0,
      newSrc: audio.src,
      mediaSessionState: navigator.mediaSession?.playbackState,
    }
  })

  console.log(`[PERF][Safari Background EOF Transition] Synchronous switch latency: ${transitionTiming.syncSwitchMs.toFixed(2)}ms, mediaSessionState=${transitionTiming.mediaSessionState}`)
  expect(transitionTiming.newSrc).toContain('track=B')
  expect(transitionTiming.syncSwitchMs).toBeLessThan(50)
  expect(transitionTiming.mediaSessionState).toBe('playing')

  await playing(page, 'B')
  expect(await page.evaluate(() => document.hidden)).toBe(true)
})
