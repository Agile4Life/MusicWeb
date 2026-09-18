'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Track, Playlist } from '@/types'
import { useTheme } from '@/components/theme/ThemeContext'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
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
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Ensure portal mounts on client only
  useEffect(() => {
    setMounted(true)
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Handle outside click, scroll, and escape dismissals
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        triggerRef?.current &&
        !triggerRef.current.contains(target)
      ) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    const handleScrollOrResize = () => {
      // Only close desktop dropdown on scroll/resize; mobile sheet has touch interactions
      if (!isMobile) {
        onClose()
      }
    }

    if (isMobile) {
      document.body.style.overflow = 'hidden'
    }

    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', handlePointerDownOutside)
      window.addEventListener('keydown', handleKeyDown)
      if (!isMobile) {
        window.addEventListener('scroll', handleScrollOrResize, true)
        window.addEventListener('resize', handleScrollOrResize)
      }
    }, 0)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', handlePointerDownOutside)
      window.removeEventListener('keydown', handleKeyDown)
      if (!isMobile) {
        window.removeEventListener('scroll', handleScrollOrResize, true)
        window.removeEventListener('resize', handleScrollOrResize)
      }
      if (isMobile) {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen, isMobile, onClose, triggerRef])

  if (!mounted || typeof window === 'undefined') return null

  const isLiquid = themeStyle === 'liquid-glass'
  const isMinimal = themeStyle === 'minimal-flat'

  // -------------------------------------------------------------
  // Dynamic Styling Tokens per Theme
  // -------------------------------------------------------------
  const desktopContainerStyle: React.CSSProperties = {
    position: 'fixed',
    top: menuPos?.top !== undefined ? `${menuPos.top}px` : undefined,
    bottom: menuPos?.bottom !== undefined ? `${menuPos.bottom}px` : undefined,
    right: menuPos?.right !== undefined ? `${menuPos.right}px` : 16,
    transformOrigin: menuPos?.bottom !== undefined ? 'bottom right' : 'top right',
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

  // Common interactive item classes
  const itemBaseClass = isLiquid
    ? 'w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-white/[0.12] active:bg-white/[0.2] flex items-center gap-3 transition-all duration-150 cursor-pointer text-white/90 hover:text-white group border border-transparent hover:border-white/10 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] active:scale-[0.98]'
    : isMinimal
    ? 'w-full text-left px-3.5 py-2.5 rounded-lg hover:bg-[var(--hair-strong,rgba(244,236,230,0.08))] active:bg-[var(--hair-strong,rgba(244,236,230,0.14))] flex items-center gap-3 transition-colors cursor-pointer text-[var(--paper,#F4ECE1)] hover:text-white active:scale-[0.99]'
    : 'w-full text-left px-3.5 py-2 rounded-xl hover:bg-white/10 active:bg-white/15 flex items-center gap-2.5 transition-colors cursor-pointer text-slate-200 hover:text-white active:scale-[0.98]'

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

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ========================================================================= */}
          {/* 💻 DESKTOP DROPDOWN (>= 768px)                                            */}
          {/* ========================================================================= */}
          <div className="hidden md:block select-none">
            <motion.div
              ref={menuRef}
              style={desktopContainerStyle}
              initial={{
                opacity: 0,
                scale: 0.94,
                y: menuPos?.bottom !== undefined ? 6 : -6,
              }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{
                opacity: 0,
                scale: 0.96,
                y: menuPos?.bottom !== undefined ? 4 : -4,
              }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="py-1.5 w-60 z-[99999] text-xs shadow-2xl relative overflow-hidden will-change-transform"
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
                    className={`w-3.5 h-3.5 transition-transform group-hover:scale-110 ${
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
                      className={`w-3.5 h-3.5 transition-transform group-hover:scale-110 ${
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
                    <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                  ) : (
                    <DiscAlbum
                      className={`w-3.5 h-3.5 transition-transform group-hover:scale-110 ${
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
                        ? 'bg-sky-500/15 border border-sky-500/30'
                        : isMinimal
                        ? 'bg-[var(--accent-strong)]/10'
                        : ''
                    }`}
                  >
                    <Pencil
                      className={`w-3.5 h-3.5 ${
                        isMinimal ? 'text-[var(--accent-strong,#E8A94F)]' : 'text-sky-400'
                      }`}
                    />
                  </div>
                  <span
                    className={
                      isMinimal ? 'text-[var(--accent-strong,#E8A94F)]' : 'text-sky-300'
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
                              : 'text-emerald-400'
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
          </div>

          {/* ========================================================================= */}
          {/* 📱 MOBILE ACTION SHEET DRAWER (< 768px)                                   */}
          {/* ========================================================================= */}
          <div className="fixed inset-0 z-[99999] md:hidden select-none">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
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
              initial={{ y: '100%' }}
              animate={{ y: '0%' }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
              className="fixed inset-x-0 bottom-0 z-10 flex flex-col max-h-[85vh] overflow-hidden will-change-transform"
              onClick={(e) => e.stopPropagation()}
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
                  onClick={onClose}
                  className={`p-2 rounded-full transition-colors shrink-0 ${
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
              <div className="p-3 overflow-y-auto overscroll-contain flex flex-col gap-1 text-sm">
                {/* Toggle Favorite */}
                <button
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
                          : 'bg-cyan-500/10'
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
                        : 'bg-purple-500/10'
                    }`}
                  >
                    {isResolvingAlbum ? (
                      <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
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
                          ? 'bg-sky-500/20 border border-sky-500/30'
                          : isMinimal
                          ? 'bg-[var(--accent-strong)]/15 border border-[var(--accent-strong)]/30'
                          : 'bg-blue-500/10'
                      }`}
                    >
                      <Pencil
                        className={`w-4 h-4 ${
                          isMinimal
                            ? 'text-[var(--accent-strong,#E8A94F)]'
                            : 'text-sky-400'
                        }`}
                      />
                    </div>
                    <span
                      className={
                        isMinimal
                          ? 'text-[var(--accent-strong,#E8A94F)] font-semibold'
                          : 'text-sky-300 font-semibold'
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
                                ? 'bg-emerald-500/15 border border-emerald-500/25'
                                : isMinimal
                                ? 'bg-[var(--sage)]/15 border border-[var(--sage)]/30'
                                : 'bg-emerald-500/10'
                            }`}
                          >
                            <Plus
                              className={`w-3.5 h-3.5 ${
                                isMinimal
                                  ? 'text-[var(--sage,#7C9070)]'
                                  : 'text-emerald-400'
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
                  onClick={onClose}
                  className={`w-full py-3 rounded-2xl font-semibold text-center text-sm transition-all duration-150 ${
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
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
