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
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = () => setCanUse3D(check())
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return canUse3D
}
