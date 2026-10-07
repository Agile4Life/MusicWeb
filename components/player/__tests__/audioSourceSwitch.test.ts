import { describe, expect, it } from 'vitest'
import { isSameAudioSource, setAudioSourceForPlayback } from '../audioSourceSwitch'

describe('audioSourceSwitch', () => {
  describe('isSameAudioSource', () => {
    it('distinguishes identical paths and queries on different origins', () => {
      expect(isSameAudioSource('https://old.example/audio.mp3?id=1', 'https://new.example/audio.mp3?id=1')).toBe(false)
      expect(isSameAudioSource('http://example.com/audio.mp3', 'https://example.com/audio.mp3')).toBe(false)
      expect(isSameAudioSource('https://example.com:8443/audio.mp3', 'https://example.com/audio.mp3')).toBe(false)
    })

    it('ignores fragments and equates relative URLs with the current origin', () => {
      expect(isSameAudioSource('http://localhost/api/stream?id=1#old', '/api/stream?id=1#new')).toBe(true)
    })
    it('detects identical and equivalent relative/absolute URLs', () => {
      expect(isSameAudioSource('https://example.com/audio.mp3', 'https://example.com/audio.mp3')).toBe(true)
      expect(isSameAudioSource('/api/stream?id=123', '/api/stream?id=123')).toBe(true)
      expect(isSameAudioSource('/api/stream?id=123', '/api/stream?id=456')).toBe(false)
      expect(isSameAudioSource('', '/api/stream')).toBe(false)
    })
  })

  describe('setAudioSourceForPlayback', () => {
    it('switches origins even when path and query match', () => {
      const audio = { src: 'https://old.example/audio.mp3', volume: 1, currentTime: 8 }
      setAudioSourceForPlayback(audio, 'https://new.example/audio.mp3', 0.8)
      expect(audio.src).toBe('https://new.example/audio.mp3')
    })
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

    it('does not re-assign src if URL is unchanged', () => {
      const audio = {
        src: 'https://same.example/track.mp3',
        volume: 0.5,
        currentTime: 10,
      }

      setAudioSourceForPlayback(audio, 'https://same.example/track.mp3', 0.9, 0)

      expect(audio.src).toBe('https://same.example/track.mp3')
      expect(audio.volume).toBe(0.9)
    })
  })
})
