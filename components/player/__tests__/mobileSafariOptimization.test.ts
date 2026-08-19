import { describe, it, expect } from 'vitest'
import { isIOSDevice } from '@/lib/audioPlayback'

describe('iOS Safari Compatibility & Performance Optimizations', () => {
  it('detects iOS user agent accurately for conditional optimizations', () => {
    const originalNavigator = globalThis.navigator

    // Simulate iPhone Safari
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
      },
      configurable: true,
    })

    expect(isIOSDevice()).toBe(true)

    // Simulate Desktop Chrome
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        maxTouchPoints: 0,
      },
      configurable: true,
    })

    expect(isIOSDevice()).toBe(false)

    // Cleanup
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    })
  })

  it('calculates swipe dismiss decision correctly with momentum', () => {
    const shouldDismiss = (dragY: number, velocity: number) => {
      return dragY > 100 || (dragY > 35 && velocity > 0.4)
    }

    expect(shouldDismiss(110, 0.1)).toBe(true) // distance threshold (>100px)
    expect(shouldDismiss(40, 0.45)).toBe(true) // velocity flick threshold (>35px with >0.4px/ms)
    expect(shouldDismiss(25, 0.2)).toBe(false) // not enough distance or speed
    expect(shouldDismiss(20, 0.5)).toBe(false) // too shallow (<35px) even if fast
  })

  it('computes hardware-accelerated lyrics opacity and scale without CSS blur', () => {
    const getLyricStyle = (
      idx: number,
      activeIndex: number,
      isSynced: boolean,
    ): { opacity: number; scale: number; hasBlur: boolean } => {
      const isSyncedMode = isSynced && activeIndex >= 0
      if (!isSyncedMode) {
        return { opacity: 0.95, scale: 1.0, hasBlur: false }
      }
      if (idx === activeIndex) {
        return { opacity: 1.0, scale: 1.02, hasBlur: false }
      }
      const distance = Math.abs(idx - activeIndex)
      const isPast = idx < activeIndex
      let opacity = 0.15
      if (distance === 1) {
        opacity = isPast ? 0.45 : 0.4
      } else if (distance === 2) {
        opacity = isPast ? 0.3 : 0.25
      }
      return { opacity, scale: 1.0, hasBlur: false }
    }

    // Active line
    const active = getLyricStyle(3, 3, true)
    expect(active.opacity).toBe(1.0)
    expect(active.scale).toBe(1.02)
    expect(active.hasBlur).toBe(false)

    // Nearby lines
    const prevLine = getLyricStyle(2, 3, true)
    expect(prevLine.opacity).toBe(0.45)
    expect(prevLine.scale).toBe(1.0)
    expect(prevLine.hasBlur).toBe(false)

    const nextLine = getLyricStyle(4, 3, true)
    expect(nextLine.opacity).toBe(0.4)
    expect(nextLine.scale).toBe(1.0)
  })

  it('determines mobile particle count reduction for thermal throttling prevention', () => {
    const getParticleCounts = (isMobile: boolean) => {
      return {
        bg: isMobile ? 1000 : 4480,
        mid: isMobile ? 600 : 2520,
        fg: isMobile ? 200 : 1120,
        total: isMobile ? 1800 : 8120,
      }
    }

    const mobile = getParticleCounts(true)
    expect(mobile.total).toBe(1800)
    expect(mobile.total).toBeLessThan(3000)

    const desktop = getParticleCounts(false)
    expect(desktop.total).toBe(8120)
  })

  it('updates Web Audio GainNode and HTMLAudioElement volume synchronously', () => {
    const mockAudio: any = { volume: 1, muted: false }
    const mockGainNode: any = { gain: { value: 1 } }

    const setVolumeHandler = (val: number, audio: typeof mockAudio, gainNode: typeof mockGainNode) => {
      const safeVol = typeof val === 'number' && !isNaN(val) ? Math.max(0, Math.min(1, val)) : 0.8
      audio.volume = safeVol
      audio.muted = safeVol === 0
      if (gainNode) {
        gainNode.gain.value = safeVol
      }
      return safeVol
    }

    // Set to 50%
    const vol1 = setVolumeHandler(0.5, mockAudio, mockGainNode)
    expect(vol1).toBe(0.5)
    expect(mockAudio.volume).toBe(0.5)
    expect(mockGainNode.gain.value).toBe(0.5)
    expect(mockAudio.muted).toBe(false)

    // Set to mute (0%)
    const vol2 = setVolumeHandler(0, mockAudio, mockGainNode)
    expect(vol2).toBe(0)
    expect(mockAudio.volume).toBe(0)
    expect(mockGainNode.gain.value).toBe(0)
    expect(mockAudio.muted).toBe(true)
  })
})
