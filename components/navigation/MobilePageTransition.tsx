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
      initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: 'none' } }}
      transition={{
        duration: 0.22,
        ease: EASE_OUT_STRONG,
      }}
      className="flex-1 min-h-full flex flex-col will-change-transform lg:will-change-auto"
    >
      {children}
    </motion.div>
  )
}

