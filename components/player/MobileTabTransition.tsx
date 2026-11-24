'use client'

import React, { useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT } from '@/lib/motion'

type FullviewTab = 'cover' | 'lyrics' | 'queue'

interface MobileTabTransitionProps {
  activeTab: FullviewTab
  direction: number // 1 = forward (right), -1 = backward (left)
  children: React.ReactNode
}

const tabVariants = {
  enter: (direction: number) => ({
    transform: `translate3d(${direction * 8}%, 0, 0)`,
    opacity: 0,
  }),
  center: {
    transform: 'translate3d(0%, 0, 0)',
    opacity: 1,
  },
  exit: (direction: number) => ({
    transform: `translate3d(${direction * -8}%, 0, 0)`,
    opacity: 0,
  }),
}

const reducedVariants = {
  enter: {
    opacity: 0,
  },
  center: {
    opacity: 1,
  },
  exit: {
    opacity: 0,
  },
}

export function MobileTabTransition({
  activeTab,
  direction,
  children,
}: MobileTabTransitionProps) {
  const prefersReduced = useReducedMotion()
  const dirRef = useRef(direction)
  dirRef.current = direction

  const variants = prefersReduced ? reducedVariants : tabVariants

  return (
    <AnimatePresence
      initial={false}
      mode="popLayout"
      custom={dirRef.current}
    >
      <motion.div
        key={activeTab}
        custom={dirRef.current}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={
          prefersReduced
            ? { duration: 0.16, ease: 'easeOut' }
            : { duration: 0.22, ease: EASE_OUT }
        }
        className="flex-1 flex flex-col min-h-0 overflow-hidden"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
