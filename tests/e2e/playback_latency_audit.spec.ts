import { test, expect, type Page } from '@playwright/test'

/**
 * Latency + error audit for: search -> results -> click -> source resolution -> audible playback.
 * Produces a timing table (cold vs warm) and a list of every console/page/network error seen.
 * Run: npx playwright test tests/e2e/playback_latency_audit.spec.ts --reporter=line
 */

interface Timeline {
  query: string
  searchMs?: number
  firstRowMs?: number
  resolveMs?: number
  resolveSource?: string
  clickToLoadstartMs?: number
  clickToCanplayMs?: number
  clickToPlayingMs?: number
  playbackLogTtfp?: string
  streamUrl?: string
  notes: string[]
}

const QUERIES = ['NewJeans', 'Imagine Dragons Believer', 'Sơn Tùng M-TP']
const WARMUP_QUERY = 'Taylor Swift' // untimed: forces Next dev to compile /api/search + /api/resolve-stream

const errors: string[] = []
const slowOrFailed: string[] = []
const timelines: Timeline[] = []

async function prime(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('has_seen_onboarding', 'true')
    localStorage.setItem('cookie_consent', 'true')
    localStorage.setItem('musicweb_hide_welcome_modal', 'true')
    localStorage.setItem('musicweb_announcement_dismissed_v', '99999')
    ;(window as any).__media = []
    document.addEventListener('pointerdown', () => ((window as any).__clickAt = Date.now()), true)
    for (const ev of ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'error']) {
      document.addEventListener(
        ev,
        (e) => {
          const el = e.target as HTMLMediaElement
          ;(window as any).__media.push({
            ev,
            t: Date.now(),
            src: (el.currentSrc || el.src || '').slice(0, 140),
            err: ev === 'error' ? el.error?.code : undefined,
          })
        },
        true
      )
    }
  })
  await page.route('**/api/announcement', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { is_enabled: false } }) })
  )
}

function attachErrorCapture(page: Page) {
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error] ${m.text().slice(0, 220)}`)
  })
  page.on('requestfailed', (r) => {
    const u = r.url()
    if (u.includes('/api/') || u.includes('stream')) errors.push(`[requestfailed] ${r.method()} ${u.slice(0, 120)} :: ${r.failure()?.errorText}`)
  })
  page.on('response', (res) => {
    const u = res.url()
    if (u.includes('/api/') && res.status() >= 400) errors.push(`[HTTP ${res.status()}] ${u.slice(0, 140)}`)
  })
}

test.describe.configure({ mode: 'serial' })

test('latency audit: search -> click -> source -> first audible sample', async ({ page }) => {
  test.setTimeout(8 * 60_000)
  page.setViewportSize({ width: 1440, height: 900 })
  await prime(page)
  attachErrorCapture(page)

  const apiTimings: { url: string; ms: number; status: number }[] = []
  const reqStart = new Map<string, number>()
  page.on('request', (r) => {
    if (r.url().includes('/api/search') || r.url().includes('/api/resolve-stream')) reqStart.set(r.url(), Date.now())
  })
  page.on('response', async (res) => {
    const u = res.url()
    const s = reqStart.get(u)
    if (s) apiTimings.push({ url: u.replace('http://localhost:3000', '').slice(0, 110), ms: Date.now() - s, status: res.status() })
  })

  const playbackLogs: { t: number; text: string }[] = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.includes('[Playback:')) playbackLogs.push({ t: Date.now(), text: t.slice(0, 200) })
  })

  const first = Date.now()
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  const searchInput = page.locator('input[placeholder*="Tìm bài hát"]:visible').first()
  const inputVisible = await searchInput.waitFor({ state: 'visible', timeout: 90_000 }).then(() => true).catch(() => false)
  console.log(`[AUDIT] app shell + search input ready in ${Date.now() - first}ms (visible=${inputVisible}) url=${page.url()}`)
  test.skip(!inputVisible, `Search input not visible — likely redirected to login (${page.url()})`)

  // dismiss the author announcement modal if it is covering the page
  const dismiss = page.getByRole('button', { name: /Đã hiểu/ })
  if (await dismiss.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)) await dismiss.click()

  // ---- untimed warm-up (route compilation / cold caches of the dev server) ----
  {
    await searchInput.fill(WARMUP_QUERY)
    await searchInput.press('Enter')
    const r = page.locator('.song-row')
    await r.first().waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {})
    await r.first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(8000)
    console.log('[AUDIT] warm-up done (excluded from table)')
    apiTimings.length = 0
    errors.length = 0
  }

  for (const query of QUERIES) {
    const tl: Timeline = { query, notes: [] }
    timelines.push(tl)
    await page.evaluate(() => ((window as any).__media.length = 0))
    playbackLogs.length = 0

    // ---- SEARCH ----
    await searchInput.fill('')
    await searchInput.fill(query)
    const searchStart = Date.now()
    await searchInput.press('Enter')
    const rows = page.locator('.song-row')
    const gotRows = await rows.first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false)
    tl.firstRowMs = Date.now() - searchStart
    if (!gotRows) {
      tl.notes.push('NO RESULTS within 30s')
      continue
    }
    await page.waitForResponse((r) => r.url().includes('/api/search'), { timeout: 15_000 }).catch(() => null)
    tl.searchMs = Date.now() - searchStart
    await page.waitForTimeout(1500)

    // ---- CLICK -> RESOLVE -> PLAY ----
    const rowTitle = ((await rows.first().textContent()) || '').replace(/\s+/g, ' ').trim().slice(0, 60)
    tl.notes.push(`row0="${rowTitle}"`)
    const resolveWait = page
      .waitForResponse((r) => r.url().includes('/api/resolve-stream'), { timeout: 20_000 })
      .catch(() => null)
    await rows.first().click({ force: true })
    const clickAt: number = await page.evaluate(() => (window as any).__clickAt)

    const res = await resolveWait
    if (res) {
      tl.resolveMs = Date.now() - clickAt
      try {
        const j = await res.json()
        tl.resolveSource = j.miss ? 'MISS' : `${j.source}`
      } catch {
        tl.resolveSource = `status ${res.status()}`
      }
    } else {
      tl.notes.push('no /api/resolve-stream call (direct-playable or cache hit)')
    }

    // wait for audible playback (HTML5 'playing') or YouTube iframe state
    const deadline = Date.now() + 25_000
    let media: any[] = []
    while (Date.now() < deadline) {
      media = await page.evaluate(() => (window as any).__media.slice())
      if (media.some((m) => m.ev === 'playing')) break
      await page.waitForTimeout(100)
    }
    const at = (ev: string) => media.find((m) => m.ev === ev && m.t >= clickAt)
    const ls = at('loadstart'), cp = at('canplay'), pl = at('playing')
    tl.clickToLoadstartMs = ls ? ls.t - clickAt : undefined
    tl.clickToCanplayMs = cp ? cp.t - clickAt : undefined
    tl.clickToPlayingMs = pl ? pl.t - clickAt : undefined
    tl.streamUrl = (pl || ls)?.src
    const err = media.find((m) => m.ev === 'error')
    if (err) tl.notes.push(`audio error code ${err.err} src=${err.src}`)
    const waits = media.filter((m) => m.ev === 'waiting' || m.ev === 'stalled').length
    if (waits) tl.notes.push(`${waits} waiting/stalled events`)
    if (!pl) {
      // YouTube iframe engine doesn't emit audio events: check app state instead
      const ytState = await page.evaluate(() => {
        const p = (window as any).YT
        return p ? 'YT API loaded' : 'no YT'
      })
      tl.notes.push(`no HTML5 'playing' within 25s (${ytState}) — may be YouTube iframe engine or a failure`)
    }
    const ttfp = playbackLogs.find((l) => l.text.includes('TTFP'))
    if (ttfp) tl.playbackLogTtfp = ttfp.text.replace(/.*in (\d+ms).*/, '$1')

    // ---- WARM: play same track again (cache hit path) ----
    if (pl) {
      await rows.nth(1).click({ force: true }).catch(() => {})
      await page.waitForTimeout(4000)
      await page.evaluate(() => ((window as any).__media.length = 0))
      await rows.first().click({ force: true })
      const warmClick: number = await page.evaluate(() => (window as any).__clickAt)
      let warm: any = null
      const wd = Date.now() + 15_000
      while (Date.now() < wd && !warm) {
        const m = await page.evaluate(() => (window as any).__media.slice())
        warm = m.find((x: any) => x.ev === 'playing' && x.t >= warmClick)
        if (!warm) await page.waitForTimeout(80)
      }
      tl.notes.push(`warm replay -> playing in ${warm ? warm.t - warmClick + 'ms' : 'N/A'}`)
    }
  }

  // ---- REPORT ----
  const fmt = (n?: number) => (n === undefined ? '  n/a' : String(n).padStart(5) + 'ms')
  console.log('\n================ LATENCY AUDIT ================')
  console.log('query                          | search→row | search(all) | click→resolve | source      | click→loadstart | →canplay | →PLAYING')
  for (const t of timelines) {
    console.log(
      `${t.query.padEnd(30)} | ${fmt(t.firstRowMs)} | ${fmt(t.searchMs)}  | ${fmt(t.resolveMs)}     | ${(t.resolveSource || '-').padEnd(11)} | ${fmt(t.clickToLoadstartMs)}       | ${fmt(t.clickToCanplayMs)} | ${fmt(t.clickToPlayingMs)}`
    )
    for (const n of t.notes) console.log(`    · ${n}`)
    if (t.playbackLogTtfp) console.log(`    · app-reported TTFP: ${t.playbackLogTtfp}`)
    if (t.streamUrl) console.log(`    · stream: ${t.streamUrl}`)
  }
  console.log('\n--- API timings (search / resolve-stream) ---')
  for (const a of apiTimings) console.log(`${String(a.ms).padStart(6)}ms  ${a.status}  ${a.url}`)
  console.log(`\n--- ERRORS (${errors.length}) ---`)
  const uniq = [...new Set(errors)]
  for (const e of uniq.slice(0, 60)) console.log(e)
  console.log('===============================================')

  expect(timelines.length).toBe(QUERIES.length)
})
