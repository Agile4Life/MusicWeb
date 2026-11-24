'use client'

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Track, Playlist } from '@/types'
import { useTheme } from '@/components/theme/ThemeContext'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
import { EASE_OUT, EASE_DRAWER, appleRubberband } from '@/lib/motion'
import {
  Heart,
  ListMusic,
  DiscAlbum,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'

export interface TrackContextMenuProps {
  track: Track
  isOpen: boolean
  onClose: () => void
  menuPos: { top?: number; bottom?: number; right: number } | null
  isFavorite: boolean
  onToggleFavorite: (e: React.MouseEvent) => void
  onAddToQueue?: () => void
  onOpenAlbum: (e: React.MouseEvent) => void
  isResolvingAlbum: boolean
  currentAlbumDisplay?: string | null
  hasRealAlbumDisplay: boolean
  isAdmin: boolean
  onEditMode: () => void
  userPlaylists?: Playlist[]
  onAddToPlaylist?: (playlistId: string, track: Track) => void
  onDeleteTrack?: (trackId: string) => void
  onDeleteTrackPermanently?: (trackId: string) => void
  triggerRef?: React.RefObject<HTMLButtonElement | null>
}

export function TrackContextMenu({
  track,
  isOpen,
  onClose,
  menuPos,
  isFavorite,
  onToggleFavorite,
  onAddToQueue,
  onOpenAlbum,
  isResolvingAlbum,
  currentAlbumDisplay,
  hasRealAlbumDisplay,
  isAdmin,
  onEditMode,
  userPlaylists = [],
  onAddToPlaylist,
  onDeleteTrack,
  onDeleteTrackPermanently,
  triggerRef,
}: TrackContextMenuProps) {
  const { themeStyle } = useTheme()
  const prefersReducedMotion = useReducedMotion()
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [clampedPos, setClampedPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const [computedOrigin, setComputedOrigin] = useState<string>('top right')
  const menuRef = useRef<HTMLDivElement>(null)
  const mobileBackdropRef = useRef<HTMLDivElement>(null)
  const mobileListRef = useRef<HTMLDivElement>(null)
  const snapBackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sheetDragRef = useRef({
    tracking: false,
    active: false,
    startedInList: false,
    startY: 0,
    startTime: 0,
    dy: 0,
    height: 400,
  })

  // Ensure portal mounts on client only
  useEffect(() => {
    setMounted(true)
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => {
      window.removeEventListener('resize', checkMobile)
      if (snapBackTimeoutRef.current) clearTimeout(snapBackTimeoutRef.current)
    }
  }, [])

  // Clamp desktop context menu inside viewport and compute trigger-anchored transformOrigin
  // using unscaled offsetWidth/offsetHeight so initial scale never distorts measurements.
  useLayoutEffect(() => {
    if (!isOpen || isMobile || !menuPos || !menuRef.current) {
      setClampedPos(menuPos)
      setComputedOrigin(menuPos?.bottom !== undefined ? 'bottom right' : 'top right')
      return
    }
    const el = menuRef.current
    const menuWidth = el.offsetWidth || 240
    const menuHeight = el.offsetHeight || 260
    const vw = window.innerWidth
    const vh = window.innerHeight
    const right = Math.min(Math.max(12, menuPos.right), Math.max(12, vw - menuWidth - 12))

    let nextPos: { top?: number; bottom?: number; right: number }
    let menuTop: number

    if (menuPos.bottom !== undefined) {
      const bottom = Math.min(Math.max(12, menuPos.bottom), Math.max(12, vh - menuHeight - 12))
      nextPos = { bottom, right }
      menuTop = vh - bottom - menuHeight
    } else {
      const rawTop = menuPos.top ?? 12
      const maxBottom = vh - 112
      const top = Math.min(Math.max(12, rawTop), Math.max(12, maxBottom - menuHeight))
      nextPos = { top, right }
      menuTop = top
    }

    setClampedPos(nextPos)

    if (triggerRef?.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect()
      const menuLeft = vw - right - menuWidth
      const triggerCenterX = triggerRect.left + triggerRect.width / 2
      const triggerCenterY = triggerRect.top + triggerRect.height / 2
      const originX = Math.max(0, Math.min(menuWidth, triggerCenterX - menuLeft))
      let originY: number
      if (triggerRect.bottom <= menuTop + 4) {
        originY = 0
      } else if (triggerRect.top >= menuTop + menuHeight - 4) {
        originY = menuHeight
      } else {
        originY = Math.max(0, Math.min(menuHeight, triggerCenterY - menuTop))
      }
      setComputedOrigin(`${Math.round(originX)}px ${Math.round(originY)}px`)
    } else {
      setComputedOrigin(nextPos.bottom !== undefined ? 'bottom right' : 'top right')
    }
  }, [isOpen, isMobile, menuPos, triggerRef])

  // Handle outside click, scroll, and escape dismissals
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        (!triggerRef?.current || !triggerRef.current.contains(target))
      ) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    const handleScrollOrResize = (event: Event) => {
      if (
        event.type === 'scroll' &&
        menuRef.current &&
        event.target instanceof Node &&
        menuRef.current.contains(event.target)
      ) {
        return
      }
      onClose()
    }

    if (isMobile) {
      document.body.style.overflow = 'hidden'
    }

    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', handlePointerDownOutside)
      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('resize', handleScrollOrResize)
      if (!isMobile) {
        window.addEventListener('scroll', handleScrollOrResize, true)
      }
    }, 0)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', handlePointerDownOutside)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleScrollOrResize)
      if (!isMobile) {
        window.removeEventListener('scroll', handleScrollOrResize, true)
      }
      if (isMobile) {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen, isMobile, onClose, triggerRef])

  // Velocity-based swipe-to-dismiss on mobile bottom sheet (with upward rubber-banding)
  const handleSheetTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.targetTouches[0]
    if (!touch) return
    const target = e.target as Node | null
    const listEl = mobileListRef.current
    const startedInList = Boolean(listEl && target && listEl.contains(target))

    // Let user scroll list normally when already scrolled down
    if (startedInList && listEl && listEl.scrollTop > 0) {
      sheetDragRef.current.tracking = false
      return
    }

    if (snapBackTimeoutRef.current) {
      clearTimeout(snapBackTimeoutRef.current)
      snapBackTimeoutRef.current = null
    }

    sheetDragRef.current = {
      tracking: true,
      active: false,
      startedInList,
      startY: touch.clientY,
      startTime: performance.now(),
      dy: 0,
      height: menuRef.current?.offsetHeight || 400,
    }
  }

  const handleSheetTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current
    if (!drag.tracking) return
    const touch = e.targetTouches[0]
    if (!touch) return

    const rawDy = touch.clientY - drag.startY

    if (!drag.active) {
      if (Math.abs(rawDy) < 6) return
      const listEl = mobileListRef.current
      if (
        drag.startedInList &&
        rawDy < 0 &&
        listEl &&
        listEl.scrollHeight > listEl.clientHeight
      ) {
        drag.tracking = false
        return
      }
      drag.active = true
      if (menuRef.current) menuRef.current.style.transition = 'none'
      if (mobileBackdropRef.current) mobileBackdropRef.current.style.transition = 'none'
    }

    const dy =
      rawDy >= 0
        ? rawDy
        : -appleRubberband(-rawDy, drag.height, 0.55)
    drag.dy = dy

    if (menuRef.current && !prefersReducedMotion) {
      menuRef.current.style.transform = `translate3d(0, ${dy}px, 0)`
    }
    if (mobileBackdropRef.current && dy > 0) {
      const progress = Math.max(0, Math.min(1, 1 - dy / drag.height))
      mobileBackdropRef.current.style.opacity = String(progress)
    }
  }

  const handleSheetTouchEnd = () => {
    const drag = sheetDragRef.current
    if (!drag.tracking && !drag.active) return

    const { active, dy, startTime, height } = drag
    drag.tracking = false
    drag.active = false
    drag.dy = 0

    if (!active) return

    const elapsedMs = Math.max(1, performance.now() - startTime)
    const shouldDismiss =
      dy > 0 &&
      (dy > Math.min(110, height * 0.3) || (dy > 20 && Math.abs(dy) / elapsedMs > 0.11))

    if (shouldDismiss) {
      if (menuRef.current) menuRef.current.style.transition = ''
      if (mobileBackdropRef.current) {
        mobileBackdropRef.current.style.transition = ''
        mobileBackdropRef.current.style.opacity = ''
      }
      onClose()
      return
    }

    if (menuRef.current) {
      menuRef.current.style.transition = prefersReducedMotion
        ? 'none'
        : 'transform 260ms var(--ease-drawer, cubic-bezier(0.32, 0.72, 0, 1))'
      menuRef.current.style.transform = 'translate3d(0, 0, 0)'
    }
    if (mobileBackdropRef.current) {
      mobileBackdropRef.current.style.transition =
        'opacity 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1))'
      mobileBackdropRef.current.style.opacity = '1'
    }
    snapBackTimeoutRef.current = setTimeout(() => {
      if (menuRef.current) menuRef.current.style.transition = ''
      if (mobileBackdropRef.current) mobileBackdropRef.current.style.transition = ''
      snapBackTimeoutRef.current = null
    }, 260)
  }

  if (!mounted || typeof window === 'undefined') return null

  const isLiquid = themeStyle === 'liquid-glass'
  const isMinimal = themeStyle === 'minimal-flat'
  const activeMenuPos = clampedPos ?? menuPos
  const opensUpward = activeMenuPos?.bottom !== undefined

  // -------------------------------------------------------------
  // Dynamic Styling Tokens per Theme
  // -------------------------------------------------------------
  const desktopContainerStyle: React.CSSProperties = {
    position: 'fixed',
    top: activeMenuPos?.top !== undefined ? `${activeMenuPos.top}px` : undefined,
    bottom: activeMenuPos?.bottom !== undefined ? `${activeMenuPos.bottom}px` : undefined,
    right: activeMenuPos?.right !== undefined ? `${activeMenuPos.right}px` : 16,
    transformOrigin: computedOrigin,
    ...(isLiquid
      ? {
          background:
            'linear-gradient(145deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.04) 55%, color-mix(in srgb, var(--primary-spotify, #06b6d4) 12%, rgba(10, 14, 26, 0.75)) 100%)',
          backdropFilter: 'blur(32px) saturate(190%) brightness(1.04)',
          WebkitBackdropFilter: 'blur(32px) saturate(190%) brightness(1.04)',
          border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.22))',
          boxShadow:
            '0 24px 60px rgba(0, 0, 0, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.35), inset 0 -1px 1px rgba(0, 0, 0, 0.25), 0 0 32px color-mix(in srgb, var(--spotify-glow, #22d3ee) 20%, transparent)',
          borderRadius: '22px',
        }
      : isMinimal
      ? {
          background: 'var(--surface-2, #251E29)',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          border: '1px solid var(--hair-strong, rgba(244, 236, 230, 0.16))',
          boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55)',
          borderRadius: 'var(--radius-card, 14px)',
        }
      : {
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--bg-space, #07090E) 90%, #151f30) 0%, color-mix(in srgb, var(--bg-space, #07090E) 96%, #0d131f) 100%)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          boxShadow:
            '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 24px var(--theme-glow-shadow, rgba(0, 0, 0, 0.25))',
          borderRadius: '16px',
        }),
  }

  const mobileSheetStyle: React.CSSProperties = isLiquid
    ? {
        background:
          'linear-gradient(170deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.05) 40%, color-mix(in srgb, var(--primary-spotify, #06b6d4) 14%, rgba(8, 12, 22, 0.88)) 100%)',
        backdropFilter: 'blur(36px) saturate(190%) brightness(1.05)',
        WebkitBackdropFilter: 'blur(36px) saturate(190%) brightness(1.05)',
        borderTop: '1px solid var(--glass-border, rgba(255, 255, 255, 0.28))',
        boxShadow:
          '0 -10px 50px rgba(0, 0, 0, 0.7), inset 0 1.5px 0.5px rgba(255, 255, 255, 0.4), 0 0 45px color-mix(in srgb, var(--spotify-glow, #22d3ee) 25%, transparent)',
        borderTopLeftRadius: '32px',
        borderTopRightRadius: '32px',
      }
    : isMinimal
    ? {
        background: 'var(--surface-2, #251E29)',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        borderTop: '1px solid var(--hair-strong, rgba(244, 236, 230, 0.16))',
        boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.6)',
        borderTopLeftRadius: '20px',
        borderTopRightRadius: '20px',
      }
    : {
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--bg-space, #07090E) 92%, #182234) 0%, color-mix(in srgb, var(--bg-space, #07090E) 98%, #090e18) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(255, 255, 255, 0.15)',
        boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.65)',
        borderTopLeftRadius: '28px',
        borderTopRightRadius: '28px',
      }

  // Common interactive item classes (include transform so active:scale eases cleanly)
  const itemBaseClass = isLiquid
    ? 'w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-white/[0.12] active:bg-white/[0.2] flex items-center gap-3 transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-[var(--ease-out)] cursor-pointer text-white/90 hover:text-white group border border-transparent hover:border-white/10 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] active:scale-[0.98]'
    : isMinimal
    ? 'w-full text-left px-3.5 py-2.5 rounded-lg hover:bg-[var(--hair-strong,rgba(244,236,230,0.08))] active:bg-[var(--hair-strong,rgba(244,236,230,0.14))] flex items-center gap-3 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] cursor-pointer text-[var(--paper,#F4ECE1)] hover:text-white active:scale-[0.98]'
    : 'w-full text-left px-3.5 py-2 rounded-xl hover:bg-white/10 active:bg-white/15 flex items-center gap-2.5 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] cursor-pointer text-slate-200 hover:text-white active:scale-[0.98]'

  const sectionDividerClass = isLiquid
    ? 'border-t border-white/15 my-1'
    : isMinimal
    ? 'border-t border-[var(--hair,rgba(244,236,230,0.08))] my-1'
    : 'border-t border-white/10 my-1'

  const sectionHeaderClass = isLiquid
    ? 'px-3.5 py-1 text-white/60 font-semibold text-[10px] uppercase tracking-wider'
    : isMinimal
    ? 'px-3.5 py-1 text-[var(--muted,#8B8090)] font-serif uppercase tracking-[0.15em] text-[10px] font-semibold'
    : 'px-3 py-1 text-slate-400 font-semibold text-[10px] uppercase tracking-wider'

  const desktopOffsetY = opensUpward ? '4px' : '-4px'

  return createPortal(
    <AnimatePresence>
      {/* ========================================================================= */}
      {/* 💻 DESKTOP DROPDOWN (>= 768px)                                            */}
      {/* ========================================================================= */}
      {isOpen && !isMobile && (
        <motion.div
          key="track-context-menu-desktop"
          ref={menuRef}
          role="menu"
          style={desktopContainerStyle}
          initial={
            prefersReducedMotion
              ? { opacity: 0 }
              : {
                  opacity: 0,
                  transform: `translate3d(0, ${desktopOffsetY}, 0) scale(0.95)`,
                }
          }
          animate={
            prefersReducedMotion
              ? { opacity: 1 }
              : {
                  opacity: 1,
                  transform: 'translate3d(0, 0px, 0) scale(1)',
                }
          }
          exit={
            prefersReducedMotion
              ? { opacity: 0, transition: { duration: 0.12, ease: 'easeOut' } }
              : {
                  opacity: 0,
                  transform: `translate3d(0, ${desktopOffsetY}, 0) scale(0.95)`,
                  transition: { duration: 0.13, ease: EASE_OUT },
                }
          }
          transition={
            prefersReducedMotion
              ? { duration: 0.14, ease: 'easeOut' }
              : { duration: 0.18, ease: EASE_OUT }
          }
          className="hidden md:block select-none py-1.5 w-60 z-[90] text-xs shadow-2xl max-h-[calc(100vh-128px)] overflow-y-auto custom-slim-scrollbar"
          onClick={(e) => e.stopPropagation()}
        >
              {/* Specular Top Sheen Highlight for Liquid Glass */}
              {isLiquid && (
                <span
                  className="pointer-events-none absolute inset-x-4 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/70 to-transparent"
                  aria-hidden="true"
                />
              )}

              {/* Toggle Favorite */}
              <button
                onClick={(e) => {
                  onToggleFavorite(e)
                  onClose()
                }}
                className={itemBaseClass}
              >
                <div
                  className={`p-1 rounded-md flex items-center justify-center shrink-0 ${
                    isLiquid
                      ? 'bg-rose-500/10 border border-rose-500/20'
                      : isMinimal
                      ? 'bg-[var(--wine)]/10'
                      : ''
                  }`}
                >
                  <Heart
                    className={`w-3.5 h-3.5 ${
                      isFavorite
                        ? isMinimal
                          ? 'fill-[var(--wine,#A24B3D)] text-[var(--wine,#A24B3D)]'
                          : 'fill-rose-500 text-rose-500 drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]'
                        : isMinimal
                        ? 'text-[var(--wine,#A24B3D)]'
                        : 'text-rose-400'
                    }`}
                  />
                </div>
                <span
                  className={
                    isFavorite
                      ? isMinimal
                        ? 'text-[var(--wine,#A24B3D)] font-medium'
                        : 'text-rose-300 font-medium'
                      : ''
                  }
                >
                  {isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'}
                </span>
              </button>

              {/* Add to Queue */}
              {onAddToQueue && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose()
                    onAddToQueue()
                  }}
                  className={itemBaseClass}
                >
                  <div
                    className={`p-1 rounded-md flex items-center justify-center shrink-0 ${
                      isLiquid
                        ? 'bg-[var(--primary-spotify)]/15 border border-[var(--primary-spotify)]/30'
                        : isMinimal
                        ? 'bg-[var(--accent)]/10'
                        : ''
                    }`}
                  >
                    <ListMusic
                      className={`w-3.5 h-3.5 ${
                        isMinimal
                          ? 'text-[var(--accent,#C98A3D)]'
                          : 'text-[var(--spotify-glow,#22d3ee)] drop-shadow-[0_0_6px_var(--spotify-glow)]'
                      }`}
                    />
                  </div>
                  <span
                    className={
                      isMinimal
                        ? 'text-[var(--accent,#C98A3D)] font-medium'
                        : 'text-[var(--spotify-glow,#22d3ee)] font-medium'
                    }
                  >
                    Thêm vào hàng đợi
                  </span>
                </button>
              )}

              {/* Go to Album */}
              <button
                onClick={(e) => {
                  onClose()
                  onOpenAlbum(e)
                }}
                disabled={isResolvingAlbum}
                className={`${itemBaseClass} disabled:opacity-50`}
              >
                <div
                  className={`p-1 rounded-md flex items-center justify-center shrink-0 ${
                    isLiquid
                      ? 'bg-[var(--theme-secondary,#818cf8)]/15 border border-[var(--theme-secondary,#818cf8)]/30'
                      : isMinimal
                      ? 'bg-[var(--surface-3)]'
                      : ''
                  }`}
                >
                  {isResolvingAlbum ? (
                    <Loader2 className="w-3.5 h-3.5 text-[var(--theme-secondary,#818cf8)] animate-spin" />
                  ) : (
                    <DiscAlbum
                      className={`w-3.5 h-3.5 ${
                        isMinimal
                          ? 'text-[var(--paper-dim,#B9AC9C)]'
                          : 'text-[var(--theme-secondary,#818cf8)]'
                      }`}
                    />
                  )}
                </div>
                <span>
                  {hasRealAlbumDisplay && currentAlbumDisplay
                    ? `Album: ${currentAlbumDisplay}`
                    : 'Vào Album bài hát'}
                </span>
              </button>

              {/* Admin Edit */}
              {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditMode()
                    onClose()
                  }}
                  className={itemBaseClass}
                >
                  <div
                    className={`p-1 rounded-md flex items-center justify-center shrink-0 ${
                      isLiquid
                        ? 'bg-[var(--primary-spotify,#06b6d4)]/15 border border-[var(--primary-spotify,#06b6d4)]/30'
                        : isMinimal
                        ? 'bg-[var(--accent-strong)]/10'
                        : ''
                    }`}
                  >
                    <Pencil
                      className={`w-3.5 h-3.5 ${
                        isMinimal ? 'text-[var(--accent-strong,#E8A94F)]' : 'text-[var(--spotify-glow,#22d3ee)]'
                      }`}
                    />
                  </div>
                  <span
                    className={
                      isMinimal ? 'text-[var(--accent-strong,#E8A94F)]' : 'text-[var(--spotify-glow,#22d3ee)]'
                    }
                  >
                    Sửa Tên / Nghệ sĩ / Album
                  </span>
                </button>
              )}

              {/* Add to Playlist Section */}
              {onAddToPlaylist && userPlaylists.length > 0 && (
                <>
                  <div className={sectionDividerClass} />
                  <div className={sectionHeaderClass}>Thêm vào Playlist</div>
                  <div className="max-h-36 overflow-y-auto no-scrollbar flex flex-col py-0.5">
                    {userPlaylists.map((pl) => (
                      <button
                        key={pl.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          onAddToPlaylist?.(pl.id, track)
                          onClose()
                        }}
                        className={itemBaseClass}
                      >
                        <Plus
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isMinimal
                              ? 'text-[var(--sage,#7C9070)]'
                              : 'text-[var(--primary-spotify,#06b6d4)]'
                          }`}
                        />
                        <span className="truncate">{pl.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Remove from Playlist */}
              {onDeleteTrack && (
                <>
                  <div className={sectionDividerClass} />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteTrack(track.id)
                      onClose()
                    }}
                    className={`${itemBaseClass} hover:bg-red-500/15 text-red-300 hover:text-red-200`}
                  >
                    <Trash2
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isMinimal ? 'text-[var(--wine,#A24B3D)]' : 'text-red-400'
                      }`}
                    />
                    <span>Bỏ khỏi Playlist này</span>
                  </button>
                </>
              )}

              {/* Delete Permanently (Admin) */}
              {isAdmin && onDeleteTrackPermanently && (
                <>
                  <div className={sectionDividerClass} />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteTrackPermanently(track.id)
                      onClose()
                    }}
                    className={`${itemBaseClass} hover:bg-red-500/25 text-red-400 hover:text-red-300 font-semibold`}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span>Xóa vĩnh viễn khỏi Thư viện</span>
                  </button>
                </>
              )}
        </motion.div>
      )}

      {/* ========================================================================= */}
      {/* 📱 MOBILE ACTION SHEET DRAWER (< 768px)                                   */}
      {/* ========================================================================= */}
      {isOpen && isMobile && (
        <motion.div
          key="track-context-menu-mobile"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 1, transition: { duration: prefersReducedMotion ? 0.16 : 0.32 } }}
          className="fixed inset-0 z-[99999] md:hidden select-none"
        >
          {/* Backdrop */}
          <motion.div
            ref={mobileBackdropRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0.14 : 0.22, ease: EASE_OUT }}
            className={`fixed inset-0 ${
              isLiquid
                ? 'bg-black/60 backdrop-blur-xl'
                : isMinimal
                ? 'bg-black/75 backdrop-blur-none'
                : 'bg-black/80 backdrop-blur-md'
            }`}
            onClick={onClose}
          />

          {/* Bottom Sheet Drawer */}
          <motion.div
            ref={menuRef}
            style={mobileSheetStyle}
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 1, transform: 'translate3d(0, 100%, 0)' }
            }
            animate={
              prefersReducedMotion
                ? { opacity: 1 }
                : { opacity: 1, transform: 'translate3d(0, 0%, 0)' }
            }
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 1, transform: 'translate3d(0, 100%, 0)' }
            }
            transition={
              prefersReducedMotion
                ? { duration: 0.16, ease: 'easeOut' }
                : { duration: 0.32, ease: EASE_DRAWER }
            }
            className="fixed inset-x-0 bottom-0 z-10 flex flex-col max-h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
            onTouchCancel={handleSheetTouchEnd}
          >
            {/* Specular highlight on top edge for Liquid Glass */}
            {isLiquid && (
              <span
                className="pointer-events-none absolute inset-x-8 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 to-transparent"
                aria-hidden="true"
              />
            )}

            {/* Drag handle pill */}
            <div className="pt-3 pb-1 flex justify-center shrink-0">
              <div
                className={`w-10 h-1.5 rounded-full ${
                  isLiquid
                    ? 'bg-white/35 shadow-[0_0_8px_rgba(255,255,255,0.4)]'
                    : isMinimal
                    ? 'bg-[var(--paper-dim,#B9AC9C)]/30'
                    : 'bg-white/25'
                }`}
              />
            </div>

            {/* Track Info Header */}
            <div
              className={`px-4 py-3 flex items-center gap-3.5 shrink-0 ${
                isLiquid
                  ? 'border-b border-white/15 bg-white/[0.04]'
                  : isMinimal
                  ? 'border-b border-[var(--hair-strong,rgba(244,236,230,0.14))] bg-[var(--surface,#1D1720)]'
                  : 'border-b border-white/10 bg-black/20'
              }`}
            >
              <div
                className={`w-12 h-12 rounded-xl overflow-hidden shrink-0 flex items-center justify-center shadow-lg ${
                  isLiquid
                    ? 'border border-white/20'
                    : isMinimal
                    ? 'border border-[var(--hair-strong)]'
                    : 'border border-white/10 bg-slate-800'
                }`}
              >
                <TrackCoverImage src={track.cover_url} alt={track.title} />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <p
                  className={`text-sm font-bold truncate ${
                    isMinimal
                      ? 'font-serif text-[var(--paper,#F4ECE1)]'
                      : 'text-white'
                  }`}
                >
                  {track.title}
                </p>
                <p
                  className={`text-xs truncate mt-0.5 ${
                    isMinimal
                      ? 'text-[var(--muted,#8B8090)]'
                      : 'text-slate-400'
                  }`}
                >
                  {track.artist || 'Không rõ nghệ sĩ'}
                </p>
                {currentAlbumDisplay && hasRealAlbumDisplay && (
                  <p
                    className={`text-[10px] truncate mt-0.5 ${
                      isMinimal
                        ? 'text-[var(--accent,#C98A3D)] font-mono'
                        : 'text-[var(--spotify-glow,#22d3ee)]'
                    }`}
                  >
                    {currentAlbumDisplay}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className={`p-2 rounded-full active:scale-[0.97] transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] shrink-0 ${
                  isLiquid
                    ? 'text-white/60 hover:text-white bg-white/10 active:bg-white/20'
                    : isMinimal
                    ? 'text-[var(--muted)] hover:text-[var(--paper)] bg-[var(--surface-3)] active:bg-[var(--hair-strong)]'
                    : 'text-slate-400 hover:text-white bg-white/5 active:bg-white/15'
                }`}
                title="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Action Buttons Scrollable List */}
            <div ref={mobileListRef} className="p-3 overflow-y-auto overscroll-contain flex flex-col gap-1 text-sm">
              {/* Toggle Favorite */}
              <button
                type="button"
                onClick={(e) => {
                  onToggleFavorite(e)
                  onClose()
                }}
                className={itemBaseClass}
              >
                <div
                  className={`p-2 rounded-xl flex items-center justify-center shrink-0 ${
                    isLiquid
                      ? 'bg-rose-500/15 border border-rose-500/25 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
                      : isMinimal
                      ? 'bg-[var(--wine)]/15 border border-[var(--wine)]/30'
                      : 'bg-rose-500/10'
                  }`}
                >
                  <Heart
                    className={`w-4 h-4 ${
                      isFavorite
                        ? isMinimal
                          ? 'fill-[var(--wine,#A24B3D)] text-[var(--wine,#A24B3D)]'
                          : 'fill-rose-500 text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                        : isMinimal
                        ? 'text-[var(--wine,#A24B3D)]'
                        : 'text-rose-400'
                    }`}
                  />
                </div>
                <span
                  className={
                    isFavorite
                      ? isMinimal
                        ? 'text-[var(--wine,#A24B3D)] font-semibold'
                        : 'text-rose-300 font-semibold'
                      : ''
                  }
                >
                  {isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'}
                </span>
              </button>

              {/* Add to Queue */}
              {onAddToQueue && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose()
                    onAddToQueue()
                  }}
                  className={itemBaseClass}
                >
                  <div
                    className={`p-2 rounded-xl flex items-center justify-center shrink-0 ${
                      isLiquid
                        ? 'bg-[var(--primary-spotify)]/20 border border-[var(--primary-spotify)]/30 shadow-[0_0_12px_var(--spotify-glow)]'
                        : isMinimal
                        ? 'bg-[var(--accent)]/15 border border-[var(--accent)]/30'
                        : 'bg-[var(--primary-spotify,#06b6d4)]/10'
                    }`}
                  >
                    <ListMusic
                      className={`w-4 h-4 ${
                        isMinimal
                          ? 'text-[var(--accent,#C98A3D)]'
                          : 'text-[var(--spotify-glow,#22d3ee)]'
                      }`}
                    />
                  </div>
                  <span
                    className={`font-semibold ${
                      isMinimal
                        ? 'text-[var(--accent,#C98A3D)]'
                        : 'text-[var(--spotify-glow,#22d3ee)]'
                    }`}
                  >
                    Thêm vào hàng đợi
                  </span>
                </button>
              )}

              {/* Go to Album */}
              <button
                type="button"
                onClick={(e) => {
                  onClose()
                  onOpenAlbum(e)
                }}
                disabled={isResolvingAlbum}
                className={`${itemBaseClass} disabled:opacity-50`}
              >
                <div
                  className={`p-2 rounded-xl flex items-center justify-center shrink-0 ${
                    isLiquid
                      ? 'bg-[var(--theme-secondary,#818cf8)]/20 border border-[var(--theme-secondary,#818cf8)]/30'
                      : isMinimal
                      ? 'bg-[var(--surface-3)]'
                      : 'bg-[var(--theme-secondary,#818cf8)]/10'
                  }`}
                >
                  {isResolvingAlbum ? (
                    <Loader2 className="w-4 h-4 text-[var(--theme-secondary,#818cf8)] animate-spin" />
                  ) : (
                    <DiscAlbum
                      className={`w-4 h-4 ${
                        isMinimal
                          ? 'text-[var(--paper-dim,#B9AC9C)]'
                          : 'text-[var(--theme-secondary,#818cf8)]'
                      }`}
                    />
                  )}
                </div>
                <span>Vào Album bài hát</span>
              </button>

              {/* Admin Edit */}
              {isAdmin && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditMode()
                    onClose()
                  }}
                  className={itemBaseClass}
                >
                  <div
                    className={`p-2 rounded-xl flex items-center justify-center shrink-0 ${
                      isLiquid
                        ? 'bg-[var(--primary-spotify,#06b6d4)]/20 border border-[var(--primary-spotify,#06b6d4)]/30'
                        : isMinimal
                        ? 'bg-[var(--accent-strong)]/15 border border-[var(--accent-strong)]/30'
                        : 'bg-[var(--primary-spotify,#06b6d4)]/10'
                    }`}
                  >
                    <Pencil
                      className={`w-4 h-4 ${
                        isMinimal
                          ? 'text-[var(--accent-strong,#E8A94F)]'
                          : 'text-[var(--spotify-glow,#22d3ee)]'
                      }`}
                    />
                  </div>
                  <span
                    className={
                      isMinimal
                        ? 'text-[var(--accent-strong,#E8A94F)] font-semibold'
                        : 'text-[var(--spotify-glow,#22d3ee)] font-semibold'
                    }
                  >
                    Sửa Tên / Nghệ sĩ / Album
                  </span>
                </button>
              )}

              {/* Add to Playlist */}
              {onAddToPlaylist && userPlaylists.length > 0 && (
                <div className={`pt-2 ${sectionDividerClass}`}>
                  <div className={sectionHeaderClass}>Thêm vào Playlist</div>
                  <div className="max-h-44 overflow-y-auto flex flex-col gap-1 mt-1">
                    {userPlaylists.map((pl) => (
                      <button
                        type="button"
                        key={pl.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          onAddToPlaylist?.(pl.id, track)
                          onClose()
                        }}
                        className={itemBaseClass}
                      >
                        <div
                          className={`p-1.5 rounded-lg flex items-center justify-center shrink-0 ${
                            isLiquid
                              ? 'bg-[var(--primary-spotify,#06b6d4)]/15 border border-[var(--primary-spotify,#06b6d4)]/25'
                              : isMinimal
                              ? 'bg-[var(--sage)]/15 border border-[var(--sage)]/30'
                              : 'bg-[var(--primary-spotify,#06b6d4)]/10'
                          }`}
                        >
                          <Plus
                            className={`w-3.5 h-3.5 ${
                              isMinimal
                                ? 'text-[var(--sage,#7C9070)]'
                                : 'text-[var(--primary-spotify,#06b6d4)]'
                            }`}
                          />
                        </div>
                        <span className="truncate">{pl.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Remove from Playlist */}
              {onDeleteTrack && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteTrack(track.id)
                    onClose()
                  }}
                  className={`${itemBaseClass} hover:bg-red-500/15 text-red-300 hover:text-red-200 mt-1`}
                >
                  <div className="p-2 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center shrink-0">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </div>
                  <span>Bỏ khỏi Playlist này</span>
                </button>
              )}

              {/* Delete Permanently (Admin) */}
              {isAdmin && onDeleteTrackPermanently && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteTrackPermanently(track.id)
                    onClose()
                  }}
                  className={`${itemBaseClass} hover:bg-red-500/25 text-red-400 hover:text-red-300 font-semibold mt-1`}
                >
                  <div className="p-2 rounded-xl bg-red-500/25 border border-red-500/35 flex items-center justify-center shrink-0">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </div>
                  <span>Xóa vĩnh viễn khỏi Thư viện</span>
                </button>
              )}
            </div>

            {/* Bottom Safe Area Dismiss */}
            <div
              className={`p-3 border-t pb-safe ${
                isLiquid
                  ? 'border-white/15 bg-white/[0.03]'
                  : isMinimal
                  ? 'border-[var(--hair-strong)] bg-[var(--surface-2)]'
                  : 'border-white/10 bg-black/30'
              }`}
            >
              <button
                type="button"
                onClick={onClose}
                className={`w-full py-3 rounded-2xl font-semibold text-center text-sm active:scale-[0.97] transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] ${
                  isLiquid
                    ? 'bg-white/15 active:bg-white/25 text-white border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                    : isMinimal
                    ? 'bg-[var(--surface-3,#2E2632)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink,#2A1704)] active:bg-[var(--accent-strong)] text-[var(--paper)] border border-[var(--hair-strong)] font-serif tracking-wide'
                    : 'bg-white/10 active:bg-white/20 text-white'
                }`}
              >
                Đóng
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
