'use client'

import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { usePathname } from 'next/navigation'

interface MobilePageTransitionProps {
  children: React.ReactNode
}

const EASE_OUT_STRONG: [number, number, number, number] = [0.23, 1, 0.32, 1]

/**
 * Wraps page content with a subtle fade + translateY entrance on route change.
 * Respects prefers-reduced-motion.
 */
export function MobilePageTransition({ children }: MobilePageTransitionProps) {
  const pathname = usePathname()
  const prefersReduced = useReducedMotion()

  return (
    <motion.div
      key={pathname}
      initial={prefersReduced ? { opacity: 0 } : { opacity: 0, transform: 'translateY(6px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      transition={{
        duration: 0.22,
        ease: EASE_OUT_STRONG,
      }}
      className="flex-1 min-h-0 will-change-transform"
    >
      {children}
    </motion.div>
  )
}

