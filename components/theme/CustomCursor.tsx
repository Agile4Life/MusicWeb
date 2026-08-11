'use client'

import React, { useEffect, useRef, useState } from 'react'
import lottie, { type AnimationItem } from 'lottie-web'
import { createCursorAnimationOptions, getCursorTransform, restartCursorAnimation } from './customCursorBehavior'
import { useTheme } from './ThemeContext'

import virtualSingerManifest from '../../public/cursors/virtual-singer/manifest.json'

type CursorState = 'Normal' | 'Link' | 'Text' | 'Working' | 'Help' | 'Busy' | 'Unavailable'

export function CustomCursor() {
  const { cursorStyle } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)

  const [vsState, setVsState] = useState<CursorState>('Normal')
  const [vsFrame, setVsFrame] = useState(0)

  // 1. Handle Lottie Cursor mode
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

    window.addEventListener('mousemove', onMouseMove, { passive: true })
    window.addEventListener('mousedown', onMouseDown, { passive: true })
    document.addEventListener('mouseleave', onMouseLeave)
    frameId = requestAnimationFrame(renderLoop)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseleave', onMouseLeave)
      cancelAnimationFrame(frameId)
      anim.removeEventListener('complete', onComplete)
      anim.destroy()
      animRef.current = null
    }
  }, [cursorStyle])

  // 2. Handle VirtualSinger Cursor mode
  useEffect(() => {
    if (cursorStyle !== 'virtual-singer') return
    if (!window.matchMedia('(pointer: fine)').matches) return

    const container = containerRef.current
    if (!container) return

    let mouseX = window.innerWidth / 2
    let mouseY = window.innerHeight / 2
    let frameId = 0

    const checkInteractiveTarget = (target: HTMLElement | null): CursorState => {
      if (!target) return 'Normal'
      const interactive = target.closest('a, button, input[type="button"], input[type="submit"], [role="button"], label, select')
      if (interactive) return 'Link'
      const textInput = target.closest('input[type="text"], input[type="search"], input[type="email"], input[type="password"], textarea')
      if (textInput) return 'Text'
      return 'Normal'
    }

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX
      mouseY = e.clientY
      container.style.opacity = '1'

      const newState = checkInteractiveTarget(e.target as HTMLElement)
      setVsState((prev) => (prev !== newState ? newState : prev))
    }

    const onMouseLeave = () => {
      container.style.opacity = '0'
      container.style.transform = 'translate(-9999px, -9999px)'
    }

    const renderLoop = () => {
      if (container) {
        const currentManifest = (virtualSingerManifest as any)[vsState] || virtualSingerManifest.Normal
        const hs = currentManifest?.hotspot || { x: 0, y: 0 }
        container.style.transform = `translate(${mouseX - hs.x}px, ${mouseY - hs.y}px)`
      }
      frameId = requestAnimationFrame(renderLoop)
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true })
    document.addEventListener('mouseleave', onMouseLeave)
    frameId = requestAnimationFrame(renderLoop)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseleave', onMouseLeave)
      cancelAnimationFrame(frameId)
    }
  }, [cursorStyle, vsState])

  // 3. VirtualSinger Frame Animation Interval
  useEffect(() => {
    if (cursorStyle !== 'virtual-singer') return
    const currentManifest = (virtualSingerManifest as any)[vsState] || virtualSingerManifest.Normal
    const framesCount = currentManifest?.frames?.length || 1
    const rate = currentManifest?.rateMs || 167

    const interval = setInterval(() => {
      setVsFrame((prev) => (prev + 1) % framesCount)
    }, rate)

    return () => clearInterval(interval)
  }, [cursorStyle, vsState])

  if (cursorStyle === 'default') return null

  if (cursorStyle === 'virtual-singer') {
    const currentManifest = (virtualSingerManifest as any)[vsState] || virtualSingerManifest.Normal
    const frameSrc = currentManifest?.frames?.[vsFrame] || currentManifest?.frames?.[0]

    return (
      <div
        ref={containerRef}
        id="custom-cursor"
        className="pointer-events-none fixed top-0 left-0 z-[9999] transition-opacity duration-150"
        style={{ width: 32, height: 32 }}
      >
        {frameSrc && (
          <img
            src={frameSrc}
            alt="VirtualSinger Cursor"
            className="w-8 h-8 pointer-events-none select-none"
            style={{ imageRendering: 'pixelated' }}
          />
        )}
      </div>
    )
  }

  return <div ref={containerRef} id="custom-cursor" />
}
