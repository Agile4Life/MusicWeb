'use client'

import { useEffect, useState } from 'react'

export function useCanUse3D() {
  const [canUse3D, setCanUse3D] = useState(false)

  useEffect(() => {
    const check = () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 1024px)').matches &&
      window.matchMedia('(pointer: fine)').matches &&
      (navigator.hardwareConcurrency ? navigator.hardwareConcurrency > 2 : true) &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches

    setCanUse3D(check())
    const mqWidth = window.matchMedia('(min-width: 1024px)')
    const mqPointer = window.matchMedia('(pointer: fine)')
    const mqReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => setCanUse3D(check())

    mqWidth.addEventListener('change', handler)
    mqPointer.addEventListener('change', handler)
    mqReducedMotion.addEventListener('change', handler)
    return () => {
      mqWidth.removeEventListener('change', handler)
      mqPointer.removeEventListener('change', handler)
      mqReducedMotion.removeEventListener('change', handler)
    }
  }, [])

  return canUse3D
}
