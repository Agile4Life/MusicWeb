'use client'

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Home,
  DiscAlbum,
  Heart,
  ListMusic,
  History,
  Cloud,
  Music,
} from 'lucide-react'
import { useLiquidNav, LiquidNavTab } from '@/hooks/useLiquidNav'

// ─── SDF Math (same as hook) ───

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
  return Math.min(Math.max(qx, qy), 0) + length2(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

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

// ─── SVG Filter ───

interface NavSVGFilterProps {
  id: string
  displacementSrc: string
  aberrationIntensity: number
  scale: number
}

function NavSVGFilter({ id, displacementSrc, aberrationIntensity, scale }: NavSVGFilterProps) {
  const blurStdDev = Math.max(0.1, 0.5 - aberrationIntensity * 0.1)
  const edgeStart = Math.max(30, 80 - aberrationIntensity * 2)
  const tableVal = aberrationIntensity * 0.05

  return (
    <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-edge`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="black" stopOpacity="0" />
          <stop offset={`${edgeStart}%`} stopColor="black" stopOpacity="0" />
          <stop offset="100%" stopColor="white" stopOpacity="1" />
        </radialGradient>
        <filter id={id} x="-80%" y="-80%" width="260%" height="260%" colorInterpolationFilters="sRGB">
          <feImage x="0" y="0" width="100%" height="100%" result="DMAP" href={displacementSrc} preserveAspectRatio="xMidYMid slice" />
          <feColorMatrix in="DMAP" type="matrix" values="0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0.3 0.3 0.3 0 0 0 0 0 1 0" result="EDGE_INTENSITY" />
          <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK">
            <feFuncA type="discrete" tableValues={`0 ${tableVal} 1`} />
          </feComponentTransfer>
          <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL" />

          <feDisplacementMap in="SourceGraphic" in2="DMAP" scale={scale} xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED" />
          <feColorMatrix in="RED_DISPLACED" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="RED_CHANNEL" />

          <feDisplacementMap in="SourceGraphic" in2="DMAP" scale={scale * (1 - aberrationIntensity * 0.05)} xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED" />
          <feColorMatrix in="GREEN_DISPLACED" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="GREEN_CHANNEL" />

          <feDisplacementMap in="SourceGraphic" in2="DMAP" scale={scale * (1 - aberrationIntensity * 0.1)} xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED" />
          <feColorMatrix in="BLUE_DISPLACED" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="BLUE_CHANNEL" />

          <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB" />
          <feBlend in="RED_CHANNEL" in2="GB" mode="screen" result="RGB" />
          <feGaussianBlur in="RGB" stdDeviation={blurStdDev} result="BLURRED" />
          <feComposite in="BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION" />
          <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK">
            <feFuncA type="table" tableValues="1 0" />
          </feComponentTransfer>
          <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN" />
          <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over" />
        </filter>
      </defs>
    </svg>
  )
}

// ─── Icon Components ───

const icons = {
  Home: (p: React.SVGProps<SVGSVGElement>) => <Home {...p} />,
  DiscAlbum: (p: React.SVGProps<SVGSVGElement>) => <DiscAlbum {...p} />,
  Heart: (p: React.SVGProps<SVGSVGElement>) => <Heart {...p} />,
  ListMusic: (p: React.SVGProps<SVGSVGElement>) => <ListMusic {...p} />,
  History: (p: React.SVGProps<SVGSVGElement>) => <History {...p} />,
  Cloud: (p: React.SVGProps<SVGSVGElement>) => <Cloud {...p} />,
  Music: (p: React.SVGProps<SVGSVGElement>) => <Music {...p} />,
}

type IconName = keyof typeof icons

// ─── Props ───

export interface LiquidNavBarProps {
  tabs: Array<{
    id: string
    label: string
    icon: IconName
    href?: string
    onClick?: () => void
  }>
  displacementScale?: number
  blurAmount?: number
  saturation?: number
  aberrationIntensity?: number
  elasticity?: number
  onTabChange?: (index: number) => void
  className?: string
  style?: React.CSSProperties
}

// ─── Default tabs ───

const DEFAULT_TABS: LiquidNavBarProps['tabs'] = [
  { id: 'home', label: 'Trang chủ', icon: 'Home', href: '/' },
  { id: 'albums', label: 'Albums', icon: 'DiscAlbum', href: '/albums' },
  { id: 'favorites', label: 'Yêu thích', icon: 'Heart', href: '/favorites' },
  { id: 'playlist', label: 'Playlist', icon: 'ListMusic' },
  { id: 'history', label: 'Lịch sử', icon: 'History', href: '/history' },
]

// ─── Component ───

export function LiquidNavBar({
  tabs = DEFAULT_TABS,
  displacementScale = 35,
  blurAmount = 0.0625,
  saturation = 160,
  aberrationIntensity = 1.5,
  elasticity = 0.15,
  onTabChange,
  className = '',
  style,
}: LiquidNavBarProps) {
  const pathname = usePathname()
  const filterId = useId()

  // Blob state
  const [blobLeft, setBlobLeft] = useState(0)
  const [blobWidth, setBlobWidth] = useState(0)
  const [blobScaleX, setBlobScaleX] = useState(1)
  const [blobScaleY, setBlobScaleY] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [isNavExpanded, setIsNavExpanded] = useState(false)
  const [displacementMapUrl, setDisplacementMapUrl] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const navRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const dragRef = useRef({
    active: false,
    lastX: 0,
    lastTime: 0,
    smoothVelocity: 0,
    baseWidth: 0,
  })

  // Determine default active tab from pathname
  useEffect(() => {
    const idx = tabs.findIndex((t) => {
      if (!t.href) return false
      if (t.href === '/') return pathname === '/'
      return pathname.startsWith(t.href)
    })
    if (idx >= 0 && idx !== activeIndex) {
      setActiveIndex(idx)
      // Defer to next frame so DOM has updated
      requestAnimationFrame(() => {
        const tab = tabRefs.current[idx]
        if (tab) {
          setBlobLeft(tab.offsetLeft)
          setBlobWidth(tab.offsetWidth)
        }
      })
    }
  }, [pathname, tabs]) // eslint-disable-line

  // Generate displacement map
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const w = nav.offsetWidth || 320
    const h = nav.offsetHeight || 68
    const url = generateDisplacementMap(w, h, 0.35, 0.25, 0.6)
    setDisplacementMapUrl(url)
  }, [])

  // Init blob position — use offsetLeft/offsetWidth (relative to offset parent)
  // Dùng useLayoutEffect để đo DOM chính xác ngay sau render, tránh blob bị lệch
  useLayoutEffect(() => {
    const tab = tabRefs.current[activeIndex]
    if (tab && tab.offsetWidth > 0) {
      setBlobLeft(tab.offsetLeft)
      setBlobWidth(tab.offsetWidth)
    }
  }, [activeIndex])

  // Recompute on resize
  useEffect(() => {
    const handler = () => {
      const tab = tabRefs.current[activeIndex]
      if (tab) {
        setBlobLeft(tab.offsetLeft)
        setBlobWidth(tab.offsetWidth)
      }
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [activeIndex])

  // Recompute after mount to handle late layout (fonts, images)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const tab = tabRefs.current[activeIndex]
      if (tab) {
        setBlobLeft(tab.offsetLeft)
        setBlobWidth(tab.offsetWidth)
        dragRef.current.baseWidth = tab.offsetWidth
      }
    })
    return () => cancelAnimationFrame(id)
  }, [])

  // Get tab metrics — use offsetLeft (relative to offsetParent)
  const getTabMetrics = useCallback(() => {
    return tabs.map((_, i) => {
      const tab = tabRefs.current[i]
      if (!tab) return { left: 0, width: 60, center: 30 }
      const left = tab.offsetLeft
      const width = tab.offsetWidth
      return { left, width, center: left + width / 2 }
    })
  }, [tabs.length])

  const getPointerX = (e: PointerEvent | React.PointerEvent) => e.clientX

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = {
      active: true,
      lastX: getPointerX(e),
      lastTime: performance.now(),
      smoothVelocity: 0,
      baseWidth: blobWidth,
    }
    setIsDragging(true)
    setIsNavExpanded(true)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }, [blobWidth])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active || !navRef.current) return

    const now = performance.now()
    const px = getPointerX(e)
    const dt = now - dragRef.current.lastTime
    if (dt > 0) {
      const vel = (px - dragRef.current.lastX) / dt * 1000
      dragRef.current.smoothVelocity = dragRef.current.smoothVelocity * 0.7 + vel * 0.3
    }
    dragRef.current.lastX = px
    dragRef.current.lastTime = now

    const navRect = navRef.current.getBoundingClientRect()
    const clampedX = Math.max(24, Math.min(navRect.width - 24, px - navRect.left))

    // Blob center follows pointer freely with elastic lag
    const blobCenter = blobLeft + blobWidth / 2
    const newBlobCenter = blobCenter + (clampedX - blobCenter) * 0.4
    let newWidth = dragRef.current.baseWidth > 0 ? dragRef.current.baseWidth : blobWidth
    let newLeft = newBlobCenter - newWidth / 2

    // Clamp blob within nav with 6px margin
    newLeft = Math.max(6, Math.min(navRect.width - newWidth - 6, newLeft))

    // Velocity-based perpendicular stretch (liquid feel)
    const speedFactor = Math.min(Math.abs(dragRef.current.smoothVelocity) / 400, 1)
    const stretchFactor = 1 + speedFactor * 0.25
    const stretchedWidth = newWidth * stretchFactor
    newLeft -= (stretchedWidth - newWidth) / 2
    newWidth = stretchedWidth

    // Re-clamp after stretch
    newLeft = Math.max(6, Math.min(navRect.width - newWidth - 6, newLeft))

    setBlobLeft(newLeft)
    setBlobWidth(newWidth)
  }, [blobLeft, blobWidth])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return
    dragRef.current.active = false
    setIsDragging(false)
    setIsNavExpanded(false)

    if (!navRef.current) return
    const px = getPointerX(e)
    const navRect = navRef.current.getBoundingClientRect()
    const clampedX = Math.max(20, Math.min(navRect.width - 20, px - navRect.left))

    const metrics = getTabMetrics()
    let nearest = 0
    let minDist = Infinity
    metrics.forEach((m, i) => {
      const d = Math.abs(m.center - clampedX)
      if (d < minDist) { minDist = d; nearest = i }
    })

    const target = metrics[nearest]
    const overshoot = dragRef.current.smoothVelocity * 0.015
    const finalLeft = Math.max(6, Math.min(navRect.width - target.width - 6, target.left + overshoot))

    setBlobLeft(finalLeft)
    setBlobWidth(target.width)
    setActiveIndex(nearest)
    onTabChange?.(nearest)
  }, [getTabMetrics, onTabChange])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const nav = navRef.current
    if (!nav || dragRef.current.active) return
    const rect = nav.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    const maxDist = Math.sqrt(rect.width * rect.width + rect.height * rect.height) / 2
    const dist = Math.sqrt(dx * dx + dy * dy)
    const factor = Math.min(dist / maxDist, 1) * elasticity
    const sX = Math.max(0.88, 1 + (Math.abs(dx) / maxDist) * factor * 0.3 - (Math.abs(dy) / maxDist) * factor * 0.15)
    const sY = Math.max(0.88, 1 + (Math.abs(dy) / maxDist) * factor * 0.3 - (Math.abs(dx) / maxDist) * factor * 0.15)
    setBlobScaleX(sX)
    setBlobScaleY(sY)
  }, [elasticity])

  const onMouseLeave = useCallback(() => {
    if (!dragRef.current.active) {
      setBlobScaleX(1)
      setBlobScaleY(1)
    }
  }, [])

  const handleTabClick = useCallback((index: number) => {
    if (index === activeIndex) return
    const tab = tabRefs.current[index]
    if (!tab || !navRef.current) return
    setBlobLeft(tab.offsetLeft)
    setBlobWidth(tab.offsetWidth)
    setActiveIndex(index)
    onTabChange?.(index)
  }, [activeIndex, onTabChange])

  // ─── Render ───

  return (
    <>
      {/* SVG Filter */}
      {displacementMapUrl && (
        <NavSVGFilter
          id="liquidNavDisplacement"
          displacementSrc={displacementMapUrl}
          aberrationIntensity={aberrationIntensity}
          scale={displacementScale}
        />
      )}

      <div
        className={`liquid-nav-container lg:hidden fixed bottom-0 left-0 right-0 z-40 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] select-none ${className}`}
        style={style}
      >
        {/* Main liquid glass bar */}
        <div
          ref={navRef}
          className={`liquid-nav relative h-[68px] rounded-[37px] ${isNavExpanded ? 'scale-[1.01]' : ''}`}
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.18)',
            backdropFilter: 'blur(22px) saturate(160%)',
            WebkitBackdropFilter: 'blur(22px) saturate(160%)',
            transformOrigin: 'center bottom',
            transition: isDragging ? 'transform 0.08s ease-out' : 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={(e) => { if (dragRef.current.active) onPointerUp(e as unknown as React.PointerEvent) }}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        >
          {/* Inner glass gradient */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 37,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 40%)',
              pointerEvents: 'none',
            }}
          />

          {/* Liquid blob indicator */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 6,
              bottom: 6,
              left: blobLeft,
              width: blobWidth,
              borderRadius: 28,
              pointerEvents: 'none',
              zIndex: 1,
              transformOrigin: 'center center',
              transform: isDragging
                ? `scaleX(${blobScaleX * 1.30}) scaleY(${blobScaleY * 1.45})`
                : `scaleX(${blobScaleX}) scaleY(${blobScaleY})`,
              transition: isDragging
                ? 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, background 0.2s ease'
                : 'left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease, background 0.3s ease',
              backdropFilter: `url(#liquidNavDisplacement) blur(${blurAmount * 32 + (isDragging ? 22 : 16)}px) saturate(${isDragging ? 220 : saturation}%) brightness(${isDragging ? 1.15 : 1})`,
              WebkitBackdropFilter: `url(#liquidNavDisplacement) blur(${blurAmount * 32 + (isDragging ? 22 : 16)}px) saturate(${isDragging ? 220 : saturation}%) brightness(${isDragging ? 1.15 : 1})`,
              background: isDragging
                ? 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 18%, rgba(255,255,255,0.12))'
                : 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 12%, rgba(255,255,255,0.06))',
              boxShadow: isDragging
                ? '0 0 0 1.5px color-mix(in srgb, var(--spotify-glow, #22d3ee) 65%, rgba(255,255,255,0.7)), 0 18px 44px rgba(0,0,0,0.7), 0 6px 18px rgba(0,0,0,0.4), inset 0 2px 4px rgba(255,255,255,0.6), inset 0 -2px 4px rgba(0,0,0,0.3), 0 0 28px color-mix(in srgb, var(--spotify-glow, #22d3ee) 45%, transparent)'
                : '0 0 0 1px color-mix(in srgb, var(--spotify-glow, #22d3ee) 30%, transparent), 0 4px 16px color-mix(in srgb, var(--spotify-glow, #22d3ee) 20%, transparent), inset 0 1px 0 rgba(255,255,255,0.2)',
            }}
          >
            {/* Chromatic aberration rainbow rim on holding */}
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: -1,
                borderRadius: 28,
                pointerEvents: 'none',
                background: 'linear-gradient(135deg, rgba(34,211,238,0.7) 0%, rgba(255,255,255,0.9) 30%, rgba(236,72,153,0.7) 70%, rgba(59,130,246,0.7) 100%)',
                mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                maskComposite: 'exclude',
                WebkitMaskComposite: 'xor',
                padding: '1.5px',
                opacity: isDragging ? 1 : 0,
                transition: 'opacity 0.2s ease',
                zIndex: 3,
              }}
            />
          </span>

          {/* Tabs grid */}
          <div className="relative grid grid-cols-5 h-full items-stretch z-[2] px-1.5">
            {tabs.map((tab, i) => {
              const isActive = i === activeIndex
              const IconComp = icons[tab.icon]

              const content = (
                <button
                  key={tab.id}
                  ref={(el) => { tabRefs.current[i] = el }}
                  type="button"
                  onPointerDown={(e) => onPointerDown(e)}
                  onClick={() => {
                    if (!dragRef.current.active) {
                      handleTabClick(i)
                      tab.onClick?.()
                    }
                  }}
                  className={[
                    'h-full w-full flex flex-col items-center justify-center gap-[2px] cursor-pointer',
                    'transition-colors duration-200 select-none',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-glow,#22d3ee)]/50 focus-visible:ring-offset-1',
                    isActive ? 'text-[var(--spotify-glow,#22d3ee)]' : 'text-slate-400 hover:text-slate-200',
                  ].join(' ')}
                  style={{ position: 'relative', zIndex: 3 }}
                >
                  <span
                    style={{
                      transform: isActive
                        ? isDragging
                          ? 'scale(1.36)'
                          : 'scale(1.12)'
                        : 'scale(1)',
                      transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  >
                    {IconComp && (
                      <IconComp
                        className={`w-5 h-5 transition-all duration-200 ${
                          isActive
                            ? 'text-[var(--spotify-glow,#22d3ee)] drop-shadow-[0_0_12px_var(--spotify-glow,#22d3ee)]'
                            : 'text-slate-400'
                        }`}
                        strokeWidth={isActive ? (isDragging ? 2.85 : 2.5) : 2}
                      />
                    )}
                  </span>
                  <span
                    style={{
                      transform: isActive && isDragging ? 'scale(1.16)' : 'scale(1)',
                      transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                    className={`text-[10px] leading-none transition-all duration-200 ${
                      isActive
                        ? 'text-[var(--spotify-glow,#22d3ee)] font-bold drop-shadow-[0_0_8px_var(--spotify-glow,#22d3ee)]'
                        : 'text-slate-400 font-medium'
                    }`}
                  >
                    {tab.label}
                  </span>
                </button>
              )

              if (tab.href) {
                return (
                  <Link
                    key={tab.id}
                    href={tab.href}
                    onClick={() => {
                      // Don't navigate if dragging — use the click to set active
                      if (dragRef.current.active) return
                      handleTabClick(i)
                    }}
                    className="contents"
                  >
                    {content}
                  </Link>
                )
              }

              return (
                <div key={tab.id} className="contents">
                  {content}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
