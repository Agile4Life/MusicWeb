'use client'

import React from 'react'
import { MotionConfig } from 'framer-motion'
import { EASE_OUT } from '@/lib/motion'

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ ease: EASE_OUT, duration: 0.2 }}>
      {children}
    </MotionConfig>
  )
}
