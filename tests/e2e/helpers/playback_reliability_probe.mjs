import { webkit, devices } from 'playwright'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { Mp3Encoder } from '@breezystack/lamejs'

async function main() {
  const rate = 22050
  const data = Buffer.alloc(44 + rate * 2 * 2)
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28)
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36)
  data.writeUInt32LE(data.length - 44, 40)
  for (let i = 0; i < rate * 2; i++) data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 12000), 44 + i * 2)
  const encoder = new Mp3Encoder(1, rate, 128)
  const samples = new Int16Array(rate * 2)
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(44 + i * 2)
  const mp3Chunks = []
  for (let i = 0; i < samples.length; i += 1152) mp3Chunks.push(Buffer.from(encoder.encodeBuffer(samples.subarray(i, i + 1152))))
  mp3Chunks.push(Buffer.from(encoder.flush()))
  const mp3 = Buffer.concat(mp3Chunks)
  const requests = []
  const server = createServer((request, response) => {
    requests.push(request.url)
    if (request.url === '/fixture.wav' || request.url === '/fixture.mp3') {
      const body = request.url.endsWith('.wav') ? data : mp3
      const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/)
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
      response.writeHead(range ? 206 : 200, { 'Content-Type': request.url.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg',
        'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}) })
      response.end(body.subarray(start, end + 1))
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<button>Native audio</button><audio></audio>')
    }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${server.address().port}`
  let browser
  try {
    browser = await webkit.launch({ executablePath: resolve('scratch/playwright-browsers/webkit-2359/Playwright.exe') })
    const results = []
    for (const format of ['wav', 'mp3']) {
      const context = await browser.newContext(devices['iPhone 13'])
      const page = await context.newPage()
      await page.goto(origin)
      await page.evaluate((format) => {
      const audio = document.querySelector('audio')
      window.nativeProbe = { canPlayType: audio.canPlayType(format === 'wav' ? 'audio/wav' : 'audio/mpeg'), events: [] }
      for (const name of ['error', 'loadedmetadata', 'playing', 'timeupdate']) audio.addEventListener(name, () => {
        window.nativeProbe.events.push({ name, error: audio.error?.code, message: audio.error?.message, time: audio.currentTime })
      })
      audio.src = `/fixture.${format}`
      document.querySelector('button').onclick = () => {
        audio.play().catch((error) => { window.nativeProbe.playError = { name: error.name, message: error.message } })
      }
      }, format)
    await page.getByRole('button').click()
    let timeout = false
    try {
      await page.waitForFunction(() => window.nativeProbe.playError || window.nativeProbe.events.some((event) => event.name === 'error' || event.time > 0.1), undefined, { timeout: 10000 })
    } catch { timeout = true }
      results.push({ format, timeout, ...(await page.evaluate(() => ({ ...window.nativeProbe, readyState: document.querySelector('audio').readyState, paused: document.querySelector('audio').paused, currentTime: document.querySelector('audio').currentTime }))) })
      await context.close()
    }
    const report = { browserVersion: browser.version(), platform: process.platform, requests, results }
    writeFileSync(resolve('scratch/playback-browser/webkit-native-codec-probe.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  } finally {
    try { await browser?.close() } finally {
      server.closeAllConnections()
      await new Promise((done) => server.close(done))
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
