import { describe, expect, it } from 'vitest'

import { setAudioSourceForPlayback } from '../audioSourceSwitch'

describe('setAudioSourceForPlayback', () => {
  it('replaces the previous source before playback starts', () => {
    const audio = {
      src: 'https://old.example/track.mp3',
      volume: 0.2,
      currentTime: 5,
    }

    setAudioSourceForPlayback(audio, 'https://new.example/preview.mp3', 0.8, 0)

    expect(audio.src).toBe('https://new.example/preview.mp3')
    expect(audio.volume).toBe(0.8)
    expect(audio.currentTime).toBe(0)
  })
})
