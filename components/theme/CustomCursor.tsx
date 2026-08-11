'use client'

import React, { useEffect, useRef } from 'react'
import lottie, { type AnimationItem } from 'lottie-web'
import { createCursorAnimationOptions, getCursorTransform, restartCursorAnimation } from './customCursorBehavior'

export function CustomCursor() {
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)

  useEffect(() => {
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
    }

    const onMouseDown = () => {
      restartCursorAnimation(anim)
    }

    const renderLoop = () => {
      if (container) {
        container.style.transform = getCursorTransform(mouseX, mouseY)
      }
      frameId = requestAnimationFrame(renderLoop)
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true })
    window.addEventListener('mousedown', onMouseDown, { passive: true })
    frameId = requestAnimationFrame(renderLoop)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mousedown', onMouseDown)
      cancelAnimationFrame(frameId)
      anim.removeEventListener('complete', onComplete)
      anim.destroy()
      animRef.current = null
    }
  }, [])

  return <div ref={containerRef} id="custom-cursor" />
}
