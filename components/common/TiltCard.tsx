'use client'

import React, { useRef, useCallback, useEffect, useSyncExternalStore } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion'
import { calculateTilt } from './tiltCardMath'

interface TiltCardProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  maxTilt?: number
}

const TILT_SPRING = { stiffness: 260, damping: 24, mass: 0.6 }

const getServerFalse = () => false

function subscribeHoverCapable(callback: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia('(hover: hover) and (pointer: fine)')
  mql.addEventListener?.('change', callback)
  return () => mql.removeEventListener?.('change', callback)
}

function getHoverCapableSnapshot() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

function subscribeMinimalFlat(callback: () => void) {
  if (typeof document === 'undefined') return () => {}
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme-style'],
  })
  return () => observer.disconnect()
}

function getMinimalFlatSnapshot() {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme-style') === 'minimal-flat'
  )
}

export function TiltCard({
  children,
  className = '',
  style = {},
  maxTilt = 7,
}: TiltCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const isHoveredRef = useRef(false)
  const isPressedRef = useRef(false)
  const reducedMotion = useReducedMotion()

  const isHoverCapable = useSyncExternalStore(
    subscribeHoverCapable,
    getHoverCapableSnapshot,
    getServerFalse
  )
  const isMinimalFlat = useSyncExternalStore(
    subscribeMinimalFlat,
    getMinimalFlatSnapshot,
    getServerFalse
  )

  const rotX = useMotionValue(0)
  const rotY = useMotionValue(0)
  const scaleMv = useMotionValue(1)
  const glowX = useMotionValue(0)
  const glowY = useMotionValue(0)

  const springRotX = useSpring(rotX, TILT_SPRING)
  const springRotY = useSpring(rotY, TILT_SPRING)
  const springScale = useSpring(scaleMv, TILT_SPRING)
  const springGlowX = useSpring(glowX, TILT_SPRING)
  const springGlowY = useSpring(glowY, TILT_SPRING)

  const cardTransform = useTransform(
    [springRotX, springRotY, springScale],
    ([rx, ry, s]: number[]) =>
      `perspective(1000px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale3d(${s.toFixed(4)}, ${s.toFixed(4)}, 1)`
  )

  const glowTransform = useTransform(
    [springGlowX, springGlowY],
    ([x, y]: number[]) => `translate3d(${x.toFixed(2)}%, ${y.toFixed(2)}%, 0)`
  )

  const tiltEnabled = isHoverCapable && !reducedMotion && !isMinimalFlat

  useEffect(() => {
    if (!tiltEnabled) {
      isHoveredRef.current = false
      isPressedRef.current = false
      rotX.jump(0)
      rotY.jump(0)
      scaleMv.jump(1)
      glowX.jump(0)
      glowY.jump(0)
    }
  }, [tiltEnabled, rotX, rotY, scaleMv, glowX, glowY])

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!tiltEnabled || e.pointerType !== 'mouse') return
      if (
        typeof document !== 'undefined' &&
        document.documentElement.getAttribute('data-theme-style') === 'minimal-flat'
      ) {
        return
      }
      const card = cardRef.current
      if (!card) return

      const rect = card.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      isHoveredRef.current = true
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top

      const { rotateX, rotateY } = calculateTilt(
        { x: localX, y: localY, width: rect.width, height: rect.height },
        maxTilt
      )

      rotX.set(rotateX)
      rotY.set(rotateY)
      if (!isPressedRef.current) {
        scaleMv.set(1.015)
      }
      glowX.set((localX / rect.width - 0.5) * 50)
      glowY.set((localY / rect.height - 0.5) * 50)
    },
    [tiltEnabled, maxTilt, rotX, rotY, scaleMv, glowX, glowY]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!tiltEnabled || e.pointerType !== 'mouse') return
      const target = e.target as HTMLElement | null
      if (target?.closest('button, [role="button"]')) return
      isPressedRef.current = true
      scaleMv.set(0.985)
    },
    [tiltEnabled, scaleMv]
  )

  const handlePointerUp = useCallback(() => {
    if (!tiltEnabled || !isPressedRef.current) return
    isPressedRef.current = false
    scaleMv.set(isHoveredRef.current ? 1.015 : 1)
  }, [tiltEnabled, scaleMv])

  const handlePointerLeave = useCallback(() => {
    isHoveredRef.current = false
    isPressedRef.current = false
    rotX.set(0)
    rotY.set(0)
    scaleMv.set(1)
    glowX.set(0)
    glowY.set(0)
  }, [rotX, rotY, scaleMv, glowX, glowY])

  return (
    <motion.div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
      className={`group relative rounded-2xl overflow-hidden motion-reduce:!transform-none tilt-card ${className}`}
      style={
        tiltEnabled
          ? {
              ...style,
              transform: cardTransform,
              transitionProperty: 'border-color, background-color, box-shadow',
            }
          : {
              ...style,
              transform: undefined,
            }
      }
    >
      {/* 2.5D Isolated Layers (Cover has 3D tilt, Text stays in crisp 2D) */}
      <div className="relative z-10 h-full w-full flex flex-col">
        {children}
      </div>

      {/* Subtle GPU-composited Specular Highlight behind text for glassy shine without blurring letters */}
      {tiltEnabled && (
        <motion.div
          aria-hidden="true"
          className="absolute -inset-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-[var(--ease-out)] motion-reduce:hidden z-0"
          style={{
            transform: glowTransform,
            background:
              'radial-gradient(circle at center, rgba(255,255,255,0.07) 0%, transparent 45%)',
          }}
        />
      )}
    </motion.div>
  )
}
