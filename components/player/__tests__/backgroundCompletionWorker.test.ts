import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

describe('background completion worker protocol', () => {
  it('ticks only while hidden, avoids duplicate timers, and restarts after becoming hidden again', () => {
    const timers = new Map<number, () => void>()
    let id = 0
    const self: { onmessage?: (event: { data: string }) => void; postMessage: ReturnType<typeof vi.fn> } = { postMessage: vi.fn() }
    runInNewContext(readFileSync('public/backgroundCompletionWorker.js', 'utf8'), {
      self,
      setInterval: (fn: () => void) => { timers.set(++id, fn); return id },
      clearInterval: (timer: number) => timers.delete(timer),
    })
    self.onmessage?.({ data: 'stop' })
    expect(timers.size).toBe(0)
    self.onmessage?.({ data: 'start' })
    self.onmessage?.({ data: 'start' })
    expect(timers.size).toBe(1)
    timers.forEach(fn => fn())
    expect(self.postMessage).toHaveBeenCalledWith('tick')
    self.onmessage?.({ data: 'stop' })
    expect(timers.size).toBe(0)
    self.onmessage?.({ data: 'start' })
    timers.forEach(fn => fn())
    expect(self.postMessage).toHaveBeenCalledTimes(2)
  })
})
