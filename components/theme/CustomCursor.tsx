'use client'

import React, { useEffect, useRef } from 'react'
import lottie, { type AnimationItem } from 'lottie-web'
import { createCursorAnimationOptions, getCursorTransform, restartCursorAnimation } from './customCursorBehavior'
import { useTheme } from './ThemeContext'

export function CustomCursor() {
  const { cursorStyle } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)

  useEffect(() => {
    if (cursorStyle !== 'lottie') return
    if (!window.matchMedia('(pointer: fine)').matches) return

    const container = containerRef.current
    if (!container) return

    const anim = lottie.loadAnimation(createCursorAnimationOptions(container))
    animRef.current = anim
    anim.goToAndStop(0, true)

    const onComplete = () => anim.goToAndStop(0, true)
    anim.addEventListener('complete', onComplete)

    let mouseX = window.innerWidth / 2
    let mouseY = window.innerHeight / 2
    let frameId = 0

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX
      mouseY = e.clientY
      container.style.opacity = '1'
    }

    const onMouseDown = () => {
      restartCursorAnimation(anim)
    }

    const onMouseLeave = () => {
      container.style.opacity = '0'
      container.style.transform = 'translate(-9999px, -9999px)'
    }

    const renderLoop = () => {
      if (container) {
        container.style.transform = getCursorTransform(mouseX, mouseY)
      }
      frameId = requestAnimationFrame(renderLoop)
    }

    const handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frameId)
        if (anim) anim.pause()
      } else {
        cancelAnimationFrame(frameId)
        frameId = requestAnimationFrame(renderLoop)
      }
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true })
    window.addEventListener('mousedown', onMouseDown, { passive: true })
    document.addEventListener('mouseleave', onMouseLeave)
    document.addEventListener('visibilitychange', handleVisibility)
    if (!document.hidden) {
      frameId = requestAnimationFrame(renderLoop)
    }

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseleave', onMouseLeave)
      document.removeEventListener('visibilitychange', handleVisibility)
      cancelAnimationFrame(frameId)
      anim.removeEventListener('complete', onComplete)
      anim.destroy()
      animRef.current = null
    }
  }, [cursorStyle])

  if (cursorStyle !== 'lottie') return null

  return <div ref={containerRef} id="custom-cursor" />
}
