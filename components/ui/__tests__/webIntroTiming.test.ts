import { describe, expect, test } from 'vitest'
import {
  INTRO_ENTER_DURATION_MS,
  INTRO_EXIT_DURATION_MS,
  INTRO_REDUCED_MOTION_DURATION_MS,
  getIntroSplashTimings,
  shouldBypassIntroSplash,
} from '../webIntroTiming'

describe('webIntroTiming', () => {
  test('bypasses intro splash when E2E onboarding flag or gaming mode is active', () => {
    expect(shouldBypassIntroSplash({ hasSeenOnboardingFlag: true, isGamingMode: false })).toBe(true)
    expect(shouldBypassIntroSplash({ hasSeenOnboardingFlag: false, isGamingMode: true })).toBe(true)
    expect(shouldBypassIntroSplash({ hasSeenOnboardingFlag: false, isGamingMode: false })).toBe(false)
  })

  test('returns standard choreography timings for normal motion', () => {
    const timings = getIntroSplashTimings({
      reducedMotion: false,
      skipIntro: false,
    })

    expect(timings.shouldSkip).toBe(false)
    expect(timings.holdDurationMs).toBe(INTRO_ENTER_DURATION_MS)
    expect(timings.exitDurationMs).toBe(INTRO_EXIT_DURATION_MS)
    expect(timings.totalDurationMs).toBe(INTRO_ENTER_DURATION_MS + INTRO_EXIT_DURATION_MS)
  })

  test('returns shortened gentle fade timings when prefers-reduced-motion is enabled', () => {
    const timings = getIntroSplashTimings({
      reducedMotion: true,
      skipIntro: false,
    })

    expect(timings.shouldSkip).toBe(false)
    expect(timings.holdDurationMs).toBe(INTRO_REDUCED_MOTION_DURATION_MS)
    expect(timings.exitDurationMs).toBe(INTRO_REDUCED_MOTION_DURATION_MS)
    expect(timings.totalDurationMs).toBe(INTRO_REDUCED_MOTION_DURATION_MS * 2)
  })

  test('returns zero timings when intro is skipped', () => {
    const timings = getIntroSplashTimings({
      reducedMotion: false,
      skipIntro: true,
    })

    expect(timings.shouldSkip).toBe(true)
    expect(timings.holdDurationMs).toBe(0)
    expect(timings.exitDurationMs).toBe(0)
    expect(timings.totalDurationMs).toBe(0)
  })

  test('keeps the complete reveal within a short startup budget', () => {
    const normal = getIntroSplashTimings({ reducedMotion: false, skipIntro: false })
    const reduced = getIntroSplashTimings({ reducedMotion: true, skipIntro: false })

    expect(normal.totalDurationMs).toBeLessThanOrEqual(2500)
    expect(normal.exitDurationMs).toBeLessThanOrEqual(300)
    expect(reduced.totalDurationMs).toBeLessThanOrEqual(400)
    expect(reduced.totalDurationMs).toBeLessThan(normal.totalDurationMs)
  })
})
