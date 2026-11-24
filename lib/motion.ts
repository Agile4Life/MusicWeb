// Shared motion curves, spring configs, and GPU-composited Framer Motion helpers.
// Curves follow Emil Kowalski's animation vocabulary and Apple's Designing Fluid Interfaces.

export const EASE_OUT = [0.23, 1, 0.32, 1] as const
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const

export const DURATION = {
  press: 0.14,
  fast: 0.16,
  base: 0.22,
  modal: 0.24,
  drawer: 0.32,
  toast: 0.38,
} as const

/** Critically damped UI spring for sliding tabs, nav pills, and indicators (no bounce). */
export const SPRING_UI = {
  type: 'spring' as const,
  duration: 0.3,
  bounce: 0,
}

/** Tactile spring for switches, segmented controls, and subtle settles. */
export const SPRING_TACTILE = {
  type: 'spring' as const,
  duration: 0.34,
  bounce: 0.14,
}

/** Gesture release spring carrying pointer momentum. */
export const SPRING_GESTURE = {
  type: 'spring' as const,
  duration: 0.42,
  bounce: 0.12,
}

/** Delight spring reserved for rare celebrations and favorite toggles. */
export const SPRING_DELIGHT = {
  type: 'spring' as const,
  duration: 0.4,
  bounce: 0.28,
}

export function modalBackdropProps(reduced: boolean | null) {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: reduced ? 0.14 : 0.2, ease: EASE_OUT },
  }
}

export function modalPanelProps(reduced: boolean | null) {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.16, ease: 'easeOut' as const },
    }
  }
  return {
    initial: { opacity: 0, transform: 'translate3d(0, 6px, 0) scale(0.96)' },
    animate: { opacity: 1, transform: 'translate3d(0, 0px, 0) scale(1)' },
    exit: { opacity: 0, transform: 'translate3d(0, 4px, 0) scale(0.97)' },
    transition: { duration: 0.22, ease: EASE_OUT },
  }
}

export function popoverPanelProps(
  reduced: boolean | null,
  direction: 'down' | 'up' = 'down'
) {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.14, ease: 'easeOut' as const },
    }
  }
  const offset = direction === 'up' ? '4px' : '-4px'
  return {
    initial: { opacity: 0, transform: `translate3d(0, ${offset}, 0) scale(0.95)` },
    animate: { opacity: 1, transform: 'translate3d(0, 0px, 0) scale(1)' },
    exit: { opacity: 0, transform: `translate3d(0, ${offset}, 0) scale(0.96)` },
    transition: { duration: 0.18, ease: EASE_OUT },
  }
}

export function drawerSheetProps(
  reduced: boolean | null,
  edge: 'bottom' | 'right' | 'left' = 'bottom'
) {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.18, ease: 'easeOut' as const },
    }
  }
  const closed =
    edge === 'right'
      ? 'translate3d(100%, 0, 0)'
      : edge === 'left'
        ? 'translate3d(-100%, 0, 0)'
        : 'translate3d(0, 100%, 0)'
  return {
    initial: { opacity: 0.96, transform: closed },
    animate: { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    exit: { opacity: 0.96, transform: closed },
    transition: { duration: 0.3, ease: EASE_DRAWER },
  }
}

export function stepSwapProps(reduced: boolean | null) {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.14, ease: 'easeOut' as const },
    }
  }
  return {
    initial: { opacity: 0, transform: 'translate3d(0, 6px, 0)' },
    animate: { opacity: 1, transform: 'translate3d(0, 0px, 0)' },
    exit: { opacity: 0, transform: 'translate3d(0, -4px, 0)' },
    transition: { duration: 0.18, ease: EASE_OUT },
  }
}

/** Apple WWDC 2018 rubber-banding resistance curve for over-drag boundaries. */
export function appleRubberband(
  overshoot: number,
  dimension: number,
  constant = 0.55
): number {
  if (dimension <= 0) return 0
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

/** Apple WWDC 2018 exponential momentum projection (velocity in px/s). */
export function projectMomentum(
  initialVelocityPxPerSec: number,
  decelerationRate = 0.995
): number {
  return ((initialVelocityPxPerSec / 1000) * decelerationRate) / (1 - decelerationRate)
}
