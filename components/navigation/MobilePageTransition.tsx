'use client'

import React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { usePathname } from 'next/navigation'

interface MobilePageTransitionProps {
  children: React.ReactNode
}

const EASE_OUT_STRONG: [number, number, number, number] = [0.23, 1, 0.32, 1]

const pageVariants = {
  initial: {
    opacity: 0,
    transform: 'translateY(6px)',
  },
  animate: {
    opacity: 1,
    transform: 'translateY(0px)',
  },
  exit: {
    opacity: 0,
  },
}

const reducedVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

/**
 * Wraps page content with a subtle fade + translateY entrance on route change.
 * Mobile only (rendered conditionally by parent). Desktop keeps instant transitions
 * since the sidebar provides spatial context.
 */
export function MobilePageTransition({ children }: MobilePageTransitionProps) {
  const pathname = usePathname()
  const prefersReduced = useReducedMotion()
  const variants = prefersReduced ? reducedVariants : pageVariants

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{
          duration: 0.2,
          ease: EASE_OUT_STRONG,
        }}
        className="flex-1 min-h-0 will-change-transform"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
