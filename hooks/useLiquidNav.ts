'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ─── SDF Math ───

function smoothstep(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function length2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}

function roundedRectSDF(
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  radius: number
): number {
  const qx = Math.abs(x) - halfW + radius
  const qy = Math.abs(y) - halfH + radius
  return (
    Math.min(Math.max(qx, qy), 0) +
    length2(Math.max(qx, 0), Math.max(qy, 0)) -
    radius
  )
}

// ─── Canvas 2D Displacement Generator ───

function generateDisplacementMap(
  width: number,
  height: number,
  halfW: number,
  halfH: number,
  radius: number
): string {
  if (typeof window === 'undefined') return ''
  const canvas = document.createElement('canvas')
  const dpr = 1
  canvas.width = width * dpr
  canvas.height = height * dpr
  canvas.style.display = 'none'
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const w = width * dpr
  const h = height * dpr
  const imageData = ctx.createImageData(w, h)
  const data = imageData.data

  let maxScale = 0
  const rawValues: number[] = []

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const uvx = px / w
      const uvy = py / h
      const ix = uvx - 0.5
      const iy = uvy - 0.5

      const d = roundedRectSDF(ix, iy, halfW, halfH, radius)
      const disp = smoothstep(0.8, 0, d - 0.15)
      const scaled = smoothstep(0, 1, disp)

      const nx = ix * scaled + 0.5
      const ny = iy * scaled + 0.5

      const dx = nx * w - px
      const dy = ny * h - py
      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy))
      rawValues.push(dx, dy)
    }
  }

  maxScale = Math.max(maxScale, 1)

  let rawIdx = 0
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = rawValues[rawIdx++]
      const dy = rawValues[rawIdx++]
      const edgeDist = Math.min(px, py, w - px - 1, h - py - 1)
      const edgeFactor = Math.min(1, edgeDist / 2)
      const r = (dx * edgeFactor) / maxScale + 0.5
      const g = (dy * edgeFactor) / maxScale + 0.5
      const pi = (py * w + px) * 4
      data[pi] = Math.round(Math.max(0, Math.min(255, r * 255)))
      data[pi + 1] = Math.round(Math.max(0, Math.min(255, g * 255)))
      data[pi + 2] = Math.round(Math.max(0, Math.min(255, g * 255)))
      data[pi + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL()
}

// ─── Hook Types ───

export interface LiquidNavTab {
  id: string
  label: string
  icon: React.ReactNode
}

export interface UseLiquidNavOptions {
  tabs: LiquidNavTab[]
  defaultIndex?: number
  displacementScale?: number
  blurAmount?: number
  saturation?: number
  aberrationIntensity?: number
  elasticity?: number
  refractionMode?: 'standard' | 'polar' | 'prominent' | 'shader'
}

export interface UseLiquidNavReturn {
  activeIndex: number
  setActiveIndex: (index: number) => void
  displacementMapUrl: string
  navRef: React.RefObject<HTMLDivElement | null>
  tabRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>
  mouseOffset: { x: number; y: number }
  isDragging: boolean
  blobStyle: React.CSSProperties
}

// ─── Hook ───

export function useLiquidNav({
  tabs,
  defaultIndex = 0,
  displacementScale = 45,
  blurAmount = 0.0625,
  saturation = 140,
  aberrationIntensity = 2,
  elasticity = 0.15,
  refractionMode = 'shader',
}: UseLiquidNavOptions): UseLiquidNavReturn {
  const [activeIndex, setActiveIndex] = useState(defaultIndex)
  const [displacementMapUrl, setDisplacementMapUrl] = useState('')
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)

  // Blob position state
  const [blobLeft, setBlobLeft] = useState(0)
  const [blobWidth, setBlobWidth] = useState(0)
  const [blobScaleX, setBlobScaleX] = useState(1)
  const [blobScaleY, setBlobScaleY] = useState(1)

  const navRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const generatorRef = useRef<HTMLCanvasElement | null>(null)

  // Drag state
  const dragRef = useRef({
    active: false,
    startX: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    smoothVelocity: 0,
    animating: false,
  })

  // ─── Generate displacement map on mount ───
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return

    const w = nav.offsetWidth || 320
    const h = nav.offsetHeight || 68

    const mapUrl = generateDisplacementMap(w, h, 0.35, 0.25, 0.6)
    setDisplacementMapUrl(mapUrl)

    // Init blob position
    const tab = tabRefs.current[defaultIndex]
    if (tab) {
      const tabLeft = tab.offsetLeft
      const tabWidth = tab.offsetWidth
      setBlobLeft(tabLeft - 4)
      setBlobWidth(tabWidth + 8)
    }
  }, [defaultIndex, tabs.length])

  // ─── Snap blob to tab ───
  const snapToTab = useCallback(
    (index: number) => {
      const tab = tabRefs.current[index]
      if (!tab) return
      const nav = navRef.current
      if (!nav) return

      const navRect = nav.getBoundingClientRect()
      const tabRect = tab.getBoundingClientRect()
      const newLeft = tabRect.left - navRect.left - 4
      const newWidth = tabRect.width + 8

      // Spring animation with overshoot
      setBlobLeft(newLeft)
      setBlobWidth(newWidth)
      setActiveIndex(index)
    },
    []
  )

  // ─── Tab metrics ───
  const getTabMetrics = useCallback(() => {
    return tabs.map((_, i) => {
      const tab = tabRefs.current[i]
      if (!tab || !navRef.current) return { left: 0, width: 60, center: 30 }
      const navRect = navRef.current.getBoundingClientRect()
      const tabRect = tab.getBoundingClientRect()
      return {
        left: tabRect.left - navRect.left,
        width: tabRect.width,
        center: tabRect.left - navRect.left + tabRect.width / 2,
      }
    })
  }, [tabs.length])

  // ─── Drag handlers ───
  const getPointerX = (e: PointerEvent | React.PointerEvent) => e.clientX

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = {
        active: true,
        startX: getPointerX(e),
        lastX: getPointerX(e),
        lastTime: performance.now(),
        velocity: 0,
        smoothVelocity: 0,
        animating: false,
      }
      setIsDragging(true)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    []
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current.active) return

      const nav = navRef.current
      if (!nav) return

      const now = performance.now()
      const px = getPointerX(e)
      const dt = now - dragRef.current.lastTime
      if (dt > 0) {
        const vel = (px - dragRef.current.lastX) / dt * 1000
        dragRef.current.velocity = vel
        dragRef.current.smoothVelocity =
          dragRef.current.smoothVelocity * 0.7 + vel * 0.3
      }
      dragRef.current.lastX = px
      dragRef.current.lastTime = now

      // Clamp pointer
      const navRect = nav.getBoundingClientRect()
      const clampedX = Math.max(20, Math.min(navRect.width - 20, px - navRect.left))

      // Nearest tab
      const metrics = getTabMetrics()
      let nearest = 0
      let minDist = Infinity
      metrics.forEach((m, i) => {
        const d = Math.abs(m.center - clampedX)
        if (d < minDist) {
          minDist = d
          nearest = i
        }
      })

      const target = metrics[nearest]
      const speedFactor = Math.min(Math.abs(dragRef.current.smoothVelocity) / 600, 1)
      const stretchFactor = 1 + speedFactor * 0.25
      const extraWidth = (target.width + 8) * stretchFactor - (target.width + 8)

      // Elastic lag
      const blobCenter = blobLeft + blobWidth / 2
      const newBlobCenter =
        blobCenter + (clampedX - blobCenter) * 0.35
      const newWidth = target.width + 8 + extraWidth
      let newLeft = newBlobCenter - newWidth / 2

      newLeft = Math.max(-4, Math.min(navRect.width - target.width - 4, newLeft))

      setBlobLeft(newLeft)
      setBlobWidth(newWidth)
      setActiveIndex(nearest)
    },
    [blobLeft, blobWidth, getTabMetrics]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current.active) return
      dragRef.current.active = false
      setIsDragging(false)

      const nav = navRef.current
      if (!nav) return

      const px = getPointerX(e)
      const navRect = nav.getBoundingClientRect()
      const clampedX = Math.max(20, Math.min(navRect.width - 20, px - navRect.left))

      // Snap to nearest
      const metrics = getTabMetrics()
      let nearest = 0
      let minDist = Infinity
      metrics.forEach((m, i) => {
        const d = Math.abs(m.center - clampedX)
        if (d < minDist) {
          minDist = d
          nearest = i
        }
      })

      const target = metrics[nearest]
      // Momentum overshoot
      const overshoot = dragRef.current.smoothVelocity * 0.015
      const finalLeft = Math.max(
        -4,
        Math.min(
          navRect.width - target.width - 4,
          target.left - 4 + overshoot
        )
      )

      setBlobLeft(finalLeft)
      setBlobWidth(target.width + 8)
      setActiveIndex(nearest)
    },
    [getTabMetrics]
  )

  // ─── Mouse hover for elastic transform ───
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const nav = navRef.current
      if (!nav) return
      const rect = nav.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2

      const offsetX = ((e.clientX - cx) / rect.width) * 100
      const offsetY = ((e.clientY - cy) / rect.height) * 100
      setMouseOffset({ x: offsetX, y: offsetY })

      // Calculate elastic scale
      if (!dragRef.current.active) {
        const dx = e.clientX - cx
        const dy = e.clientY - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        const maxDist = Math.sqrt(rect.width * rect.width + rect.height * rect.height) / 2
        const factor = Math.min(dist / maxDist, 1) * elasticity

        const speedX = Math.abs(dx) / maxDist
        const speedY = Math.abs(dy) / maxDist

        const sX = Math.max(0.85, 1 + speedX * factor * 0.3 - speedY * factor * 0.15)
        const sY = Math.max(0.85, 1 + speedY * factor * 0.3 - speedX * factor * 0.15)

        setBlobScaleX(sX)
        setBlobScaleY(sY)
      }
    },
    [elasticity]
  )

  const onMouseLeave = useCallback(() => {
    setMouseOffset({ x: 0, y: 0 })
    if (!dragRef.current.active) {
      setBlobScaleX(1)
      setBlobScaleY(1)
    }
  }, [])

  // ─── Tab click ───
  const onTabClick = useCallback(
    (index: number) => {
      snapToTab(index)
    },
    [snapToTab]
  )

  // ─── Blob style ───
  const blobStyle: React.CSSProperties = {
    position: 'absolute',
    top: 6,
    bottom: 6,
    left: blobLeft,
    width: blobWidth,
    borderRadius: 31,
    pointerEvents: 'none',
    zIndex: 1,
    transform: `scaleX(${blobScaleX}) scaleY(${blobScaleY})`,
    // Spring snap transition when not dragging
    transition: isDragging
      ? 'none'
      : 'left 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.3s ease-out',
    // Refraction backdrop
    backdropFilter: `url(#liquidNavDisplacement) blur(${blurAmount * 32 + 16}px) saturate(${saturation}%)`,
    WebkitBackdropFilter: `url(#liquidNavDisplacement) blur(${blurAmount * 32 + 16}px) saturate(${saturation}%)`,
    // Subtle glass tint
    background: 'rgba(34, 211, 238, 0.06)',
    // Edge glow
    boxShadow:
      '0 0 0 1px rgba(34, 211, 238, 0.2), 0 4px 16px rgba(34, 211, 238, 0.1), inset 0 1px 0 rgba(255,255,255,0.15)',
  }

  return {
    activeIndex,
    setActiveIndex,
    displacementMapUrl,
    navRef,
    tabRefs,
    mouseOffset,
    isDragging,
    blobStyle,
  }
}
