import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchWithConnectTimeout } from '../fetchWithConnectTimeout'

describe('fetchWithConnectTimeout', () => {
  let server: Server | undefined
  afterEach(async () => {
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((done) => server!.close(() => done()))
    server = undefined
  })

  async function listen(handler: Parameters<typeof createServer>[1]) {
    server = createServer(handler)
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/audio`
  }

  it('keeps streaming a body that outlasts the connect timeout', async () => {
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Length': '6' })
      res.flushHeaders()
      let n = 0
      const t = setInterval(() => {
        res.write(Buffer.from([++n]))
        if (n === 6) { clearInterval(t); res.end() }
      }, 20)
      res.on('close', () => clearInterval(t))
    })
    // Body takes ~120ms, timeout is 40ms: only header wait may be timed.
    const res = await fetchWithConnectTimeout(url, {}, 40)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
  })

  it('aborts when headers never arrive', async () => {
    const url = await listen(() => { /* never responds */ })
    await expect(fetchWithConnectTimeout(url, {}, 40)).rejects.toBeTruthy()
  })
})
