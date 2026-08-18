'use client'

import { useState, useEffect } from 'react'
import { useTheme } from './ThemeContext'

/**
 * Hook that determines if Gaming Mode is currently active.
 *
 * Gaming Mode activates when:
 * - The user has enabled "Gaming Mode" in Settings AND the browser tab is hidden
 *
 * When active, heavy UI components should be unmounted to free RAM,
 * leaving only the audio engine + Media Session for background playback.
 */
export function useGamingMode(): boolean {
  const { gamingMode: gamingEnabled } = useTheme()
  const [isTabHidden, setIsTabHidden] = useState(false)

  useEffect(() => {
    if (!gamingEnabled) return

    const handleVisibility = () => {
      setIsTabHidden(document.hidden)
    }

    // Sync initial state
    setIsTabHidden(document.hidden)

    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [gamingEnabled])

  // Active only when setting is ON and tab is actually hidden
  return gamingEnabled && isTabHidden
}
