import { describe, expect, it, vi } from 'vitest'
import { playAudioElement, redactAudioSource, shouldUseHtml5Audio, toPersistedTrack } from '../audioPlayback'

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
    expect(shouldUseHtml5Audio({ source: 'nhaccuatui', audio_url: 'https://stream.nct.vn/song.mp3' })).toBe(true)
    expect(shouldUseHtml5Audio({ source: 'local' })).toBe(true)
  })

  it('does not persist signed NhacCuaTui URLs', () => {
    const track = {
      id: 'spotify-1',
      source: 'nhaccuatui' as const,
      nhaccuatui_id: 'nct-1',
      audio_url: 'https://stream.nct.vn/song.mp3?expires=123',
      file_path: 'https://stream.nct.vn/song.mp3?expires=123',
    }

    expect(toPersistedTrack(track)).toEqual({
      id: 'spotify-1',
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-1',
      audio_url: undefined,
      file_path: '',
    })
  })

  it('redacts query tokens from audio diagnostics', () => {
    expect(redactAudioSource('https://stream.nct.vn/song.mp3?expires=123&token=secret')).toBe(
      'https://stream.nct.vn/song.mp3?[redacted]',
    )
    expect(redactAudioSource('')).toBe('')
  })
})
