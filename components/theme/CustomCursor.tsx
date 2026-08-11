'use client'

import React, { useEffect, useRef } from 'react'
import lottie, { type AnimationItem } from 'lottie-web'

export function CustomCursor() {
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return

    const container = containerRef.current
    if (!container) return

    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path: '/icons8-cursor.json',
    })
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
      anim.goToAndPlay(0, true)
    }

    const renderLoop = () => {
      if (container) {
        container.style.transform = `translate(${mouseX - 4}px, ${mouseY - 4}px)`
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