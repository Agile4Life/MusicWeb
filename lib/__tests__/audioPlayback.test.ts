import { describe, expect, it, vi } from 'vitest'
import { playAudioElement, shouldUseHtml5Audio } from '../audioPlayback'

describe('playAudioElement', () => {
  it('waits for a successful audio.play Promise', async () => {
    const play = vi.fn().mockResolvedValue(undefined)

    await expect(playAudioElement({ play })).resolves.toBeUndefined()
    expect(play).toHaveBeenCalledOnce()
  })

  it('propagates a rejected audio.play Promise', async () => {
    const error = new Error('NotAllowedError')
    const play = vi.fn().mockRejectedValue(error)

    await expect(playAudioElement({ play })).rejects.toBe(error)
  })

  it('does not route YouTube tracks to HTML5 audio', () => {
    expect(shouldUseHtml5Audio({ source: 'youtube', youtube_id: 'abc123' })).toBe(false)
    expect(shouldUseHtml5Audio({ source: 'local' })).toBe(true)
  })
})
