'use client'

import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { EASE_OUT } from '@/lib/motion'

interface MobilePageTransitionProps {
  children: React.ReactNode
}

/**
 * Wraps page content with a subtle fade + GPU translate3d entrance on route change.
 * Respects prefers-reduced-motion.
 */
export function MobilePageTransition({ children }: MobilePageTransitionProps) {
  const pathname = usePathname()
  const prefersReduced = useReducedMotion()

  return (
    <motion.div
      key={pathname}
      initial={
        prefersReduced
          ? { opacity: 0 }
          : { opacity: 0, transform: 'translate3d(0, 6px, 0)' }
      }
      animate={
        prefersReduced
          ? { opacity: 1 }
          : {
              opacity: 1,
              transform: 'translate3d(0, 0, 0)',
              transitionEnd: { transform: 'none' },
            }
      }
      transition={
        prefersReduced
          ? { duration: 0.14, ease: 'easeOut' }
          : { duration: 0.18, ease: EASE_OUT }
      }
      className="flex-1 min-h-full flex flex-col"
    >
      {children}
    </motion.div>
  )
}

