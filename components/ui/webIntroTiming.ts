export const INTRO_ENTER_DURATION_MS = 1200
export const INTRO_EXIT_DURATION_MS = 380
export const INTRO_REDUCED_MOTION_DURATION_MS = 220

export interface IntroBypassInput {
  hasSeenOnboardingFlag: boolean
  isGamingMode: boolean
}

export interface IntroTimingInput {
  reducedMotion: boolean
  skipIntro: boolean
}

export interface IntroSplashTimings {
  shouldSkip: boolean
  holdDurationMs: number
  exitDurationMs: number
  totalDurationMs: number
}

export function shouldBypassIntroSplash({
  hasSeenOnboardingFlag,
  isGamingMode,
}: IntroBypassInput): boolean {
  return Boolean(hasSeenOnboardingFlag || isGamingMode)
}

export function getIntroSplashTimings({
  reducedMotion,
  skipIntro,
}: IntroTimingInput): IntroSplashTimings {
  if (skipIntro) {
    return {
      shouldSkip: true,
      holdDurationMs: 0,
      exitDurationMs: 0,
      totalDurationMs: 0,
    }
  }

  if (reducedMotion) {
    return {
      shouldSkip: false,
      holdDurationMs: INTRO_REDUCED_MOTION_DURATION_MS,
      exitDurationMs: INTRO_REDUCED_MOTION_DURATION_MS,
      totalDurationMs: INTRO_REDUCED_MOTION_DURATION_MS * 2,
    }
  }

  return {
    shouldSkip: false,
    holdDurationMs: INTRO_ENTER_DURATION_MS,
    exitDurationMs: INTRO_EXIT_DURATION_MS,
    totalDurationMs: INTRO_ENTER_DURATION_MS + INTRO_EXIT_DURATION_MS,
  }
}
