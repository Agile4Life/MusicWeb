'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
import { useTheme } from '../theme/ThemeContext'
import { TrackCoverImage } from '../common/TrackCoverImage'
import { LyricsShareModal } from './LyricsShareModal'
import { getPrimaryLyrics } from '@/lib/lyricsFlow'
import { parseLrc, parsePlainLyrics, findActiveLyricIndex, LyricLine } from '@/lib/lrcParser'
import { fetchLyricsRomaji } from '@/lib/romajiTransliteration'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Star,
  Heart,
  Shuffle,
  MoreHorizontal,
  Volume2,
  VolumeX,
  Languages,
  Sparkles,
  ListMusic,
  Share2,
  Loader2,
  X,
} from 'lucide-react'

interface ExtendedLyricLine extends LyricLine {
  romaji?: string
}

// 🚀 Global module-level in-memory cache for parsed lyrics (zero lag & non-freezing on open/close)
const globalLyricsCache = new Map<string, { lyrics: ExtendedLyricLine[]; isSynced: boolean }>()

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

function formatNegativeTime(seconds: number) {
  if (isNaN(seconds) || seconds <= 0) return '-0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `-${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export function MobileFullviewPlayer() {
  const router = useRouter()
  const { currentTime, duration } = usePlaybackProgress()
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    togglePlay,
    nextTrack,
    prevTrack,
    seek,
    volume,
    setVolume,
    isShuffle,
    toggleShuffle,
    toggleFavoriteCurrentTrack,
    isNowPlayingOpen,
    closeNowPlayingOverlay,
    toggleQueue,
    isQueueOpen,
    mvIntroOffset,
  } = usePlayer()

  const { themeStyle, currentTheme } = useTheme()

  // Unified iOS Drag to Dismiss Physics
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const touchStartYRef = useRef(0)
  const touchStartXRef = useRef(0)
  const touchStartTimeRef = useRef(0)
  const lastTouchYRef = useRef(0)
  const isDraggingRef = useRef(false)
  const dragYRef = useRef(0)
  const isClosingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Lyrics state
  const [lyrics, setLyrics] = useState<ExtendedLyricLine[]>(() => {
    if (currentTrack?.id && globalLyricsCache.has(currentTrack.id)) {
      return globalLyricsCache.get(currentTrack.id)!.lyrics
    }
    return []
  })
  const [isSynced, setIsSynced] = useState<boolean>(() => {
    if (currentTrack?.id && globalLyricsCache.has(currentTrack.id)) {
      return globalLyricsCache.get(currentTrack.id)!.isSynced
    }
    return false
  })
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [showTranslation, setShowTranslation] = useState(true)
  const [showMenuSheet, setShowMenuSheet] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)

  // Auto-scroll management
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isUserInteractingRef = useRef(false)
  const lyricsReqIdRef = useRef(0)

  // Reset drag on open
  useEffect(() => {
    if (isNowPlayingOpen) {
      setDragY(0)
      dragYRef.current = 0
      setIsDragging(false)
      isDraggingRef.current = false
      isClosingRef.current = false
    }
  }, [isNowPlayingOpen])

  // Fetch lyrics whenever currentTrack changes (with fast-path cache hit)
  useEffect(() => {
    if (!currentTrack) {
      setLyrics([])
      setIsSynced(false)
      setLyricsLoading(false)
      return
    }

    const trackId = currentTrack.id

    // ⚡ Fast-path: Check memory cache first (instant 0ms response)
    const cached = globalLyricsCache.get(trackId)
    if (cached) {
      setLyrics(cached.lyrics)
      setIsSynced(cached.isSynced)
      setLyricsLoading(false)
      return
    }

    const reqId = ++lyricsReqIdRef.current
    setLyricsLoading(true)

    getPrimaryLyrics({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      duration: currentTrack.duration,
      youtube_id: currentTrack.youtube_id,
      nhaccuatui_id: currentTrack.nhaccuatui_id,
      source: currentTrack.source,
    })
      .then(async (res) => {
        if (reqId !== lyricsReqIdRef.current) return
        if (!res || (!res.syncedLyrics && !res.plainLyrics)) {
          setLyrics([])
          setIsSynced(false)
          return
        }

        let parsed: ExtendedLyricLine[] = []
        let hasSynced = false

        if (res.syncedLyrics && res.syncedLyrics.trim().length > 0) {
          parsed = parseLrc(res.syncedLyrics)
          hasSynced = true
        } else if (res.plainLyrics && res.plainLyrics.trim().length > 0) {
          parsed = parsePlainLyrics(res.plainLyrics)
          hasSynced = false
        }

        const validLyrics = parsed.filter((l) => l.text && l.text.trim().length > 0)
        setLyrics(validLyrics)
        setIsSynced(hasSynced)
        globalLyricsCache.set(trackId, { lyrics: validLyrics, isSynced: hasSynced })

        // Asynchronously fetch Romaji transliteration for all lines
        if (validLyrics.length > 0) {
          try {
            const rawLines = validLyrics.map((p) => p.text)
            const romajiResults = await fetchLyricsRomaji(rawLines)
            if (reqId === lyricsReqIdRef.current && romajiResults.length === validLyrics.length) {
              const withRomaji = validLyrics.map((line, idx) => ({
                ...line,
                romaji: romajiResults[idx] || '',
              }))
              setLyrics(withRomaji)
              globalLyricsCache.set(trackId, { lyrics: withRomaji, isSynced: hasSynced })
            }
          } catch (err) {
            console.warn('Romaji transliteration error:', err)
          }
        }
      })
      .catch((err) => {
        console.warn('Error fetching mobile fullview lyrics:', err)
        if (reqId === lyricsReqIdRef.current) {
          setLyrics([])
          setIsSynced(false)
        }
      })
      .finally(() => {
        if (reqId === lyricsReqIdRef.current) {
          setLyricsLoading(false)
        }
      })
  }, [currentTrack])

  // Active lyric index calculation
  const activeIndex = useMemo(() => {
    if (!lyrics || lyrics.length === 0 || !isSynced) return -1
    return findActiveLyricIndex(lyrics, currentTime, -(mvIntroOffset || 0))
  }, [lyrics, currentTime, isSynced, mvIntroOffset])

  // Ultra-Smooth Spring Auto-scroll to active line
  useEffect(() => {
    if (!isNowPlayingOpen || isUserInteractingRef.current || activeIndex < 0 || !isSynced) {
      return
    }

    const rafId = requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      const activeEl = lineRefs.current[activeIndex]

      if (container && activeEl) {
        const targetScroll = activeEl.offsetTop - container.clientHeight * 0.38 + activeEl.clientHeight / 2
        container.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: 'smooth',
        })
      }
    })

    return () => cancelAnimationFrame(rafId)
  }, [activeIndex, isSynced, isNowPlayingOpen])

  // Instant scroll on opening overlay
  useEffect(() => {
    if (isNowPlayingOpen && activeIndex >= 0 && isSynced) {
      const rafId = requestAnimationFrame(() => {
        const container = scrollContainerRef.current
        const activeEl = lineRefs.current[activeIndex]
        if (container && activeEl) {
          const targetScroll = activeEl.offsetTop - container.clientHeight * 0.38 + activeEl.clientHeight / 2
          container.scrollTo({
            top: Math.max(0, targetScroll),
            behavior: 'auto',
          })
        }
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [isNowPlayingOpen])

  // User touch detection (Only user finger drag pauses auto-scroll)
  const handleUserTouchStart = useCallback(() => {
    isUserInteractingRef.current = true
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current)
    }
  }, [])

  const handleUserTouchEnd = useCallback(() => {
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current)
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserInteractingRef.current = false
    }, 3000)
  }, [])

  // Unified iOS Sheet Drag Gestures
  const handleDragTouchStart = useCallback((e: React.TouchEvent) => {
    if (isClosingRef.current) return
    const touch = e.touches[0]
    touchStartYRef.current = touch.clientY
    touchStartXRef.current = touch.clientX
    lastTouchYRef.current = touch.clientY
    touchStartTimeRef.current = Date.now()
    dragYRef.current = 0
  }, [])

  const handleDragTouchMove = useCallback((e: React.TouchEvent) => {
    if (isClosingRef.current) return
    const touch = e.touches[0]
    const currentY = touch.clientY
    const currentX = touch.clientX
    const deltaY = currentY - touchStartYRef.current
    const deltaX = currentX - touchStartXRef.current
    lastTouchYRef.current = currentY

    if (!isDraggingRef.current) {
      // If horizontal movement is dominant, ignore vertical drag
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
        return
      }

      // If touching the lyrics scroll container, only allow drag down if at top
      const isOverLyrics = scrollContainerRef.current && scrollContainerRef.current.contains(e.target as Node)
      if (isOverLyrics) {
        if ((scrollContainerRef.current?.scrollTop || 0) > 2) {
          return
        }
      }

      // If moved down past 6px threshold, engage drag
      if (deltaY > 6) {
        isDraggingRef.current = true
        setIsDragging(true)
        isUserInteractingRef.current = true
      }
    }

    if (isDraggingRef.current) {
      if (e.cancelable) {
        e.preventDefault()
      }
      if (deltaY > 0) {
        // Direct tracking with smooth finger follow
        setDragY(deltaY)
        dragYRef.current = deltaY
      } else {
        // Rubberband resistance when pulling upwards
        const rubberband = deltaY * 0.18
        setDragY(rubberband)
        dragYRef.current = rubberband
      }
    }
  }, [])

  const handleDragTouchEnd = useCallback(() => {
    if (isClosingRef.current) return
    if (!isDraggingRef.current) {
      setIsDragging(false)
      return
    }

    const elapsed = Math.max(1, Date.now() - touchStartTimeRef.current)
    const currentDragY = dragYRef.current
    const velocity = (lastTouchYRef.current - touchStartYRef.current) / elapsed

    isDraggingRef.current = false
    setIsDragging(false)

    // Dismiss if pulled down > 110px or flicked down with velocity > 0.45px/ms
    const shouldDismiss = currentDragY > 110 || (currentDragY > 40 && velocity > 0.45)

    if (shouldDismiss) {
      isClosingRef.current = true
      const screenH = typeof window !== 'undefined' ? window.innerHeight : 800
      setDragY(screenH)
      dragYRef.current = screenH

      setTimeout(() => {
        closeNowPlayingOverlay()
        setDragY(0)
        dragYRef.current = 0
        isClosingRef.current = false
      }, 300)
    } else {
      // Snap back to open with spring animation
      setDragY(0)
      dragYRef.current = 0
    }
  }, [closeNowPlayingOverlay])

  const handleLineClick = (line: ExtendedLyricLine) => {
    if (typeof line.time === 'number' && line.time >= 0) {
      const targetTime = Math.max(0, line.time + (mvIntroOffset || 0))
      seek(targetTime)
      isUserInteractingRef.current = false
    }
  }

  const handleVolumeToggle = () => {
    setVolume(volume > 0 ? 0 : 0.8)
  }

  if (!currentTrack) return null

  const effectiveDuration = duration > 0 ? duration : (currentTrack.duration || 0)
  const remainingTime = Math.max(0, effectiveDuration - currentTime)
  const progressPercent = effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)) : 0

  const isLiquid = themeStyle === 'liquid-glass'
  const isMinimal = themeStyle === 'minimal-flat'
  const isClassic = themeStyle === 'classic'

  const dragProgress = Math.min(1, Math.max(0, dragY / 500))
  const sheetScale = dragY > 0 ? Math.max(0.92, 1 - dragProgress * 0.08) : 1
  const sheetRadius = dragY > 0 ? Math.min(36, 16 + dragY * 0.12) : 0
  const sheetOpacity = dragY > 0 ? Math.max(0.35, 1 - dragProgress * 0.55) : 1

  return (
    <div
      ref={containerRef}
      onTouchStart={handleDragTouchStart}
      onTouchMove={handleDragTouchMove}
      onTouchEnd={handleDragTouchEnd}
      onTouchCancel={handleDragTouchEnd}
      className={`mobile-fullview-overlay fixed inset-0 z-[100] flex flex-col select-none overflow-hidden touch-pan-y ${
        isNowPlayingOpen ? 'pointer-events-auto' : 'pointer-events-none opacity-0 translate-y-full'
      } ${
        isMinimal ? 'bg-[#141017] text-[#F4ECE1]' : 'bg-[#07090e] text-white'
      }`}
      style={{
        transform: isNowPlayingOpen
          ? `translate3d(0, ${Math.max(0, dragY)}px, 0) scale(${sheetScale})`
          : 'translate3d(0, 100%, 0)',
        borderRadius: `${sheetRadius}px ${sheetRadius}px 0 0`,
        opacity: isNowPlayingOpen ? sheetOpacity : 0,
        boxShadow: dragY > 0 ? '0 -12px 48px rgba(0, 0, 0, 0.85)' : 'none',
        transition: isDragging
          ? 'none'
          : 'transform 0.38s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease, border-radius 0.3s ease',
        transformOrigin: 'bottom center',
        willChange: 'transform, opacity',
      }}
    >
      {/* 🌟 1. Theme-Aware Ambient Fluid Background */}
      {isLiquid && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
          {currentTrack.cover_url ? (
            <div
              className="absolute inset-[-20%] bg-cover bg-center blur-[70px] brightness-[0.55] saturate-[180%] scale-110 opacity-70 transition-all duration-1000"
              style={{
                backgroundImage: `url(${currentTrack.cover_url})`,
              }}
            />
          ) : (
            <div
              className="absolute inset-[-20%] blur-[80px] opacity-50"
              style={{
                background: `radial-gradient(circle at 30% 30%, ${currentTheme.gradient1}, transparent 60%), radial-gradient(circle at 70% 70%, ${currentTheme.gradient2}, transparent 60%)`,
              }}
            />
          )}
          {/* Subtle dark vignette */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/80" />
        </div>
      )}

      {isClassic && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 bg-[#07090e]">
          <div
            className="absolute top-0 inset-x-0 h-96 opacity-30 blur-3xl"
            style={{
              background: `radial-gradient(circle at 50% 0%, ${currentTheme.accentColor}, transparent 70%)`,
            }}
          />
        </div>
      )}

      {isMinimal && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 bg-[#141017]">
          <div className="absolute inset-0 bg-radial from-[#1D1720] to-[#141017] opacity-90" />
        </div>
      )}

      {/* 📱 2. Header: Drag Handle & Floating Liquid Glass Track Plaque */}
      <header
        className="relative z-20 pt-[calc(0.6rem+env(safe-area-inset-top,0px))] px-4 flex flex-col gap-2 shrink-0 cursor-grab active:cursor-grabbing"
      >
        {/* Top Grabber Bar */}
        <div
          onClick={closeNowPlayingOverlay}
          className={`w-12 h-1.5 rounded-full transition-all mx-auto cursor-pointer active:scale-95 ${
            isMinimal
              ? 'bg-[#E8A94F]/50 hover:bg-[#E8A94F]'
              : isClassic
                ? 'bg-[var(--spotify-glow,#22d3ee)]/50 hover:bg-[var(--spotify-glow,#22d3ee)] shadow-[0_0_8px_var(--theme-glow-shadow)]'
                : 'bg-white/40 hover:bg-white/60 backdrop-blur-md'
          }`}
          title="Thu nhỏ"
        />

        {/* 🌊 Floating Liquid Glass Plaque (Positioned between top grabber and lyrics) */}
        <div
          className="relative mx-1 mt-2.5 mb-1.5 rounded-[28px] overflow-hidden select-none transition-all duration-300 shadow-xl"
          style={
            isMinimal
              ? {
                  backgroundColor: '#1D1720',
                  border: '1px solid rgba(232, 169, 79, 0.45)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                }
              : isClassic
                ? {
                    backgroundColor: 'var(--elevation-2-bg, #111622)',
                    border: '1px solid color-mix(in srgb, var(--spotify-glow, #22d3ee) 45%, rgba(255,255,255,0.15))',
                    boxShadow: '0 0 20px var(--theme-glow-shadow), 0 8px 24px rgba(0,0,0,0.45)',
                  }
                : {
                    backgroundColor: 'rgba(255, 255, 255, 0.035)',
                    border: '1px solid color-mix(in srgb, var(--spotify-glow, #22d3ee) 35%, rgba(255, 255, 255, 0.15))',
                    boxShadow: '0 10px 32px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 0 14px var(--theme-glow-shadow)',
                    backdropFilter: 'blur(20px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                  }
          }
        >
          {/* Inner specular highlight reflection line */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 28,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 40%)',
              pointerEvents: 'none',
            }}
          />

          <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-3.5 sm:py-2.5 relative z-10">
            {/* Track Info (Cover + Title + Artist) */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {/* Mini Cover Art */}
              <div
                className={`w-10 h-10 rounded-full overflow-hidden shrink-0 shadow-md relative ${
                  isPlaying ? 'is-playing' : ''
                }`}
                style={{
                  border: isMinimal
                    ? '1.5px solid rgba(232, 169, 79, 0.6)'
                    : isClassic || isLiquid
                      ? '1.5px solid var(--spotify-glow, #22d3ee)'
                      : '1.5px solid rgba(255,255,255,0.2)',
                  boxShadow: isMinimal ? 'none' : '0 0 10px var(--theme-glow-shadow)',
                }}
              >
                <TrackCoverImage src={currentTrack.cover_url} alt={currentTrack.title} />
              </div>

              {/* Title & Artist */}
              <div className="flex flex-col min-w-0 flex-1 pr-1">
                <span
                  className={`text-xs sm:text-sm font-bold truncate leading-tight ${
                    isMinimal
                      ? 'font-serif text-[#F4ECE1]'
                      : isClassic
                        ? 'text-white font-extrabold'
                        : 'text-white'
                  }`}
                >
                  {currentTrack.title}
                </span>
                <span
                  className={`text-[11px] truncate leading-tight mt-0.5 ${
                    isMinimal
                      ? 'text-[#B9AC9C]'
                      : isClassic
                        ? 'text-[var(--spotify-glow,#22d3ee)]/75'
                        : 'text-white/60'
                  }`}
                >
                  {currentTrack.artist || 'Nghệ sĩ chưa rõ'}
                </span>
              </div>
            </div>

            {/* Action Buttons: Star + More Options */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={toggleFavoriteCurrentTrack}
                style={
                  isMinimal
                    ? { backgroundColor: '#141017', border: '1px solid rgba(232, 169, 79, 0.35)', color: '#E8A94F' }
                    : isClassic
                      ? { backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid color-mix(in srgb, var(--spotify-glow, #22d3ee) 35%, rgba(255,255,255,0.1))' }
                      : { backgroundColor: 'rgba(255, 255, 255, 0.04)', border: '1px solid color-mix(in srgb, var(--spotify-glow, #22d3ee) 30%, rgba(255,255,255,0.1))', backdropFilter: 'blur(12px)' }
                }
                className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition-all cursor-pointer"
                title={currentTrack.is_favorite ? 'Bỏ yêu thích' : 'Yêu thích'}
              >
                <Star
                  className={`w-4 h-4 transition-all ${
                    currentTrack.is_favorite
                      ? isMinimal
                        ? 'text-[#E8A94F] fill-[#E8A94F]'
                        : isClassic
                          ? 'text-[var(--spotify-glow,#22d3ee)] fill-[var(--spotify-glow,#22d3ee)] drop-shadow-[0_0_10px_var(--theme-glow-shadow)]'
                          : 'text-amber-400 fill-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.6)]'
                      : isMinimal
                        ? 'text-[#B9AC9C] hover:text-[#E8A94F]'
                        : isClassic
                          ? 'text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)]'
                          : 'text-white/60 hover:text-white'
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => setShowMenuSheet(true)}
                style={
                  isMinimal
                    ? { backgroundColor: '#141017', border: '1px solid rgba(232, 169, 79, 0.35)', color: '#E8A94F' }
                    : isClassic
                      ? { backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid color-mix(in srgb, var(--spotify-glow, #22d3ee) 35%, rgba(255,255,255,0.1))' }
                      : { backgroundColor: 'rgba(255, 255, 255, 0.04)', border: '1px solid color-mix(in srgb, var(--spotify-glow, #22d3ee) 30%, rgba(255,255,255,0.1))', backdropFilter: 'blur(12px)' }
                }
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/70 hover:text-white active:scale-90 transition-all cursor-pointer"
                title="Tùy chọn khác"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 📜 3. Central Stage: Kinetic Time-Synced Lyrics with Theme Typography */}
      <main className="relative z-10 flex-1 min-h-0 flex flex-col justify-center overflow-hidden px-4 sm:px-6">
        {lyricsLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 my-auto text-slate-400">
            <Loader2
              className="w-7 h-7 animate-spin"
              style={{ color: isMinimal ? '#E8A94F' : 'var(--spotify-glow, #22d3ee)' }}
            />
            <span className="text-xs font-semibold">Đang tải lời bài hát...</span>
          </div>
        ) : lyrics.length > 0 ? (
          <div
            ref={scrollContainerRef}
            onTouchStart={handleUserTouchStart}
            onTouchEnd={handleUserTouchEnd}
            onWheel={handleUserTouchStart}
            className="w-full h-full overflow-y-auto overflow-x-hidden no-scrollbar flex flex-col gap-6 py-28 px-1 touch-pan-y"
            style={{
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
            }}
          >
            {lyrics.map((line, idx) => {
              const isActive = idx === activeIndex
              const isSyncedMode = isSynced && activeIndex >= 0

              let blurPx = 0
              let opacity = 1.0

              if (!isSyncedMode) {
                // Không sync được lời bài hát: đừng blur gì hết!
                blurPx = 0
                opacity = 0.95
              } else if (isActive) {
                // Đang hát: Tiêu điểm sắc nét 100%, không blur
                blurPx = 0
                opacity = 1.0
              } else {
                // Cả lời phía trên và phía dưới đều được blur quang học nhẹ theo tiêu cự
                const distance = Math.abs(idx - activeIndex)
                const isPast = idx < activeIndex

                if (distance === 1) {
                  blurPx = isLiquid ? 1.2 : 0.8
                  opacity = isPast ? 0.55 : 0.45
                } else if (distance === 2) {
                  blurPx = isLiquid ? 2.0 : 1.4
                  opacity = isPast ? 0.38 : 0.3
                } else {
                  blurPx = isLiquid ? 2.8 : 2.0
                  opacity = isPast ? 0.22 : 0.18
                }
              }

              const hasRomaji = showTranslation && Boolean(line.romaji) && line.romaji !== line.text

              return (
                <div
                  key={`${line.time}-${idx}`}
                  ref={(el) => {
                    lineRefs.current[idx] = el
                  }}
                  onClick={() => handleLineClick(line)}
                  className={`cursor-pointer select-none transition-all duration-300 ease-out py-1 px-1 pr-3 w-full max-w-full rounded-2xl flex flex-col ${
                    isActive ? '' : 'hover:opacity-80 active:scale-98'
                  }`}
                  style={{
                    opacity,
                    filter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
                  }}
                >
                  {/* Main Lyric Line (Safe Wrapping - Zero Clipping) */}
                  <p
                    className={`leading-snug break-words break-normal whitespace-pre-wrap transition-all duration-300 pr-1 ${
                      isMinimal ? 'font-serif' : 'font-sans'
                    } ${
                      isActive
                        ? isMinimal
                          ? 'text-[clamp(1.35rem,5.5vw,1.85rem)] font-black text-[#F4ECE1] drop-shadow-sm'
                          : isClassic
                            ? 'text-[clamp(1.35rem,5.5vw,1.85rem)] font-black text-white drop-shadow-[0_0_15px_var(--theme-glow-shadow)]'
                            : 'text-[clamp(1.35rem,5.5vw,1.85rem)] font-black text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]'
                        : isMinimal
                          ? 'text-[clamp(1.1rem,4.5vw,1.5rem)] font-bold text-[#B9AC9C]'
                          : isClassic
                            ? 'text-[clamp(1.1rem,4.5vw,1.5rem)] font-bold text-slate-300'
                            : 'text-[clamp(1.1rem,4.5vw,1.5rem)] font-bold text-white'
                    }`}
                  >
                    {line.text}
                  </p>

                  {/* Phonetic Romaji / Pronunciation Subtitle (Themed) */}
                  {hasRomaji && (
                    <p
                      className={`text-xs sm:text-sm font-semibold mt-1 tracking-wide leading-normal break-words whitespace-pre-wrap transition-all duration-300 pr-1 ${
                        isActive
                          ? isMinimal
                            ? 'text-[#E8A94F]'
                            : isClassic
                              ? 'text-[var(--spotify-glow,#22d3ee)] drop-shadow-[0_0_8px_var(--theme-glow-shadow)] font-bold'
                              : 'text-white/85 drop-shadow-sm'
                          : isMinimal
                            ? 'text-[#8A7E70]'
                            : isClassic
                              ? 'text-[var(--spotify-glow,#22d3ee)]/50'
                              : 'text-white/50'
                      }`}
                    >
                      {line.romaji}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 my-auto text-slate-400 text-center px-4">
            <Sparkles
              className="w-8 h-8 stroke-[1.5]"
              style={{ color: isMinimal ? '#E8A94F' : 'var(--spotify-glow, #22d3ee)' }}
            />
            <p className="text-sm font-semibold text-white">Chưa có lời đồng bộ cho bài hát này</p>
            <p className="text-xs text-slate-400">Bạn có thể tự tìm kiếm hoặc thưởng thức giai điệu tuyệt vời</p>
          </div>
        )}
      </main>

      {/* 🎛️ 4. Floating Liquid Glass Bottom Control Block (Unified & Refined) */}
      <footer
        className="relative z-20 mx-3 sm:mx-4 mb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] mt-auto rounded-2xl overflow-hidden select-none transition-all duration-300 shadow-2xl p-3.5 sm:p-4 flex flex-col gap-2.5"
        style={
          isMinimal
            ? {
                backgroundColor: '#1D1720',
                border: '1px solid rgba(232, 169, 79, 0.45)',
                boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
              }
            : isClassic
              ? {
                  backgroundColor: 'var(--elevation-2-bg, #111622)',
                  border: '1px solid color-mix(in srgb, var(--spotify-glow, #22d3ee) 45%, rgba(255,255,255,0.15))',
                  boxShadow: '0 0 20px var(--theme-glow-shadow), 0 8px 28px rgba(0,0,0,0.45)',
                }
              : {
                  backgroundColor: 'rgba(255, 255, 255, 0.035)',
                  border: '1px solid color-mix(in srgb, var(--spotify-glow, #22d3ee) 35%, rgba(255, 255, 255, 0.15))',
                  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 0 16px var(--theme-glow-shadow)',
                  backdropFilter: 'blur(20px) saturate(160%)',
                  WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                }
        }
      >
        {/* Inner specular highlight line */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '1rem',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 40%)',
            pointerEvents: 'none',
          }}
        />

        {/* Row 1: Utility Bar (Romaji + Shuffle + Favorite + Share) */}
        <div className="flex items-center justify-between px-0.5 relative z-10">
          {/* Romaji Toggle */}
          <button
            type="button"
            onClick={() => setShowTranslation((prev) => !prev)}
            style={
              showTranslation
                ? isMinimal
                  ? { backgroundColor: 'rgba(232, 169, 79, 0.18)', borderColor: '#E8A94F', color: '#E8A94F' }
                  : isClassic
                    ? {
                        backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.25))',
                        borderColor: 'var(--spotify-glow, #22d3ee)',
                        color: 'var(--spotify-glow, #22d3ee)',
                        boxShadow: '0 0 12px var(--theme-glow-shadow)',
                      }
                    : {
                        backgroundColor: 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 18%, rgba(255,255,255,0.06))',
                        borderColor: 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 60%, rgba(255,255,255,0.25))',
                        color: 'var(--spotify-glow, #22d3ee)',
                        boxShadow: '0 4px 14px var(--theme-glow-shadow)',
                        backdropFilter: 'blur(14px)',
                      }
                : isMinimal
                  ? { backgroundColor: '#141017', borderColor: 'rgba(232, 169, 79, 0.25)', color: '#B9AC9C' }
                  : { backgroundColor: 'rgba(255, 255, 255, 0.04)', borderColor: 'rgba(255, 255, 255, 0.08)', color: 'rgba(255, 255, 255, 0.5)' }
            }
            className="px-2.5 py-1 rounded-full flex items-center gap-1 text-[11px] font-bold border transition-all cursor-pointer active:scale-95"
            title="Bật/Tắt phiên âm Romaji"
          >
            <Languages className="w-3.5 h-3.5" />
            <span>Romaji</span>
          </button>

          {/* Right Action Icons: Shuffle + Favorite + Share */}
          <div className="flex items-center gap-2">
            {/* Shuffle Toggle Button */}
            <button
              type="button"
              onClick={toggleShuffle}
              style={
                isShuffle
                  ? isMinimal
                    ? { backgroundColor: 'rgba(232, 169, 79, 0.2)', borderColor: '#E8A94F', color: '#E8A94F' }
                    : isClassic
                      ? {
                          backgroundColor: 'rgba(255, 255, 255, 0.08)',
                          borderColor: 'var(--spotify-glow, #22d3ee)',
                          color: 'var(--spotify-glow, #22d3ee)',
                          boxShadow: '0 0 10px var(--theme-glow-shadow)',
                        }
                      : {
                          backgroundColor: 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 20%, rgba(255,255,255,0.06))',
                          borderColor: 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 50%, rgba(255,255,255,0.2))',
                          color: 'var(--spotify-glow, #22d3ee)',
                          boxShadow: '0 0 12px var(--theme-glow-shadow)',
                          backdropFilter: 'blur(12px)',
                        }
                  : isMinimal
                    ? { backgroundColor: '#141017', borderColor: 'rgba(232, 169, 79, 0.2)', color: '#B9AC9C' }
                    : { backgroundColor: 'rgba(255, 255, 255, 0.04)', borderColor: 'rgba(255, 255, 255, 0.08)', color: 'rgba(255, 255, 255, 0.5)' }
              }
              className="w-8 h-8 rounded-full flex items-center justify-center border active:scale-90 transition-all cursor-pointer relative"
              title={isShuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
            >
              <Shuffle className="w-3.5 h-3.5" />
              {isShuffle && (
                <span
                  className="absolute -bottom-0.5 w-1 h-1 rounded-full"
                  style={{ backgroundColor: isMinimal ? '#E8A94F' : 'var(--spotify-glow, #22d3ee)' }}
                />
              )}
            </button>

            {/* Favorite Toggle Button */}
            <button
              type="button"
              onClick={toggleFavoriteCurrentTrack}
              style={
                currentTrack.is_favorite
                  ? isMinimal
                    ? { backgroundColor: 'rgba(232, 169, 79, 0.2)', borderColor: '#E8A94F', color: '#E8A94F' }
                    : isClassic
                      ? {
                          backgroundColor: 'rgba(255, 255, 255, 0.08)',
                          borderColor: 'var(--spotify-glow, #22d3ee)',
                          color: 'var(--spotify-glow, #22d3ee)',
                          boxShadow: '0 0 10px var(--theme-glow-shadow)',
                        }
                      : {
                          backgroundColor: 'rgba(244, 63, 94, 0.15)',
                          borderColor: 'rgba(244, 63, 94, 0.35)',
                          color: '#f43f5e',
                          boxShadow: '0 0 12px rgba(244, 63, 94, 0.3)',
                          backdropFilter: 'blur(12px)',
                        }
                  : isMinimal
                    ? { backgroundColor: '#141017', borderColor: 'rgba(232, 169, 79, 0.2)', color: '#B9AC9C' }
                    : { backgroundColor: 'rgba(255, 255, 255, 0.04)', borderColor: 'rgba(255, 255, 255, 0.08)', color: 'rgba(255, 255, 255, 0.5)' }
              }
              className="w-8 h-8 rounded-full flex items-center justify-center border active:scale-90 transition-all cursor-pointer"
              title={currentTrack.is_favorite ? 'Bỏ yêu thích' : 'Yêu thích'}
            >
              <Heart
                className={`w-3.5 h-3.5 transition-all ${
                  currentTrack.is_favorite
                    ? isMinimal
                      ? 'fill-[#E8A94F]'
                      : isClassic
                        ? 'fill-[var(--spotify-glow,#22d3ee)]'
                        : 'fill-[#f43f5e]'
                    : ''
                }`}
              />
            </button>

            {/* Share Lyrics Story Button */}
            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              style={
                isMinimal
                  ? { backgroundColor: '#141017', borderColor: 'rgba(232, 169, 79, 0.2)', color: '#E8A94F' }
                  : isClassic
                    ? {
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        borderColor: 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 40%, rgba(255,255,255,0.1))',
                        color: 'var(--spotify-glow, #22d3ee)',
                        boxShadow: '0 0 10px var(--theme-glow-shadow)',
                      }
                    : {
                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        color: 'var(--spotify-glow, #22d3ee)',
                        backdropFilter: 'blur(14px)',
                      }
              }
              className="w-8 h-8 rounded-full flex items-center justify-center border active:scale-95 transition-all cursor-pointer"
              title="Chia sẻ câu hát"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row 2: Timeline Precision Scrubber */}
        <div className="flex flex-col gap-1 w-full relative z-10">
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
              seek(pct * effectiveDuration)
            }}
            className="relative w-full h-3.5 flex items-center cursor-pointer group"
          >
            {/* Background Track */}
            <div
              className={`w-full h-1.5 rounded-full overflow-hidden relative ${
                isMinimal ? 'bg-[#2A222F]' : 'bg-white/15'
              }`}
            >
              {/* Progress Fill */}
              <div
                className="h-full rounded-full transition-[width] duration-100"
                style={{
                  width: `${progressPercent}%`,
                  background: isMinimal
                    ? '#E8A94F'
                    : isClassic
                      ? 'linear-gradient(90deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))'
                      : 'linear-gradient(90deg, color-mix(in srgb, var(--spotify-glow, #22d3ee) 70%, white), var(--spotify-glow, #22d3ee))',
                  boxShadow: isClassic || isLiquid ? '0 0 10px var(--theme-glow-shadow)' : 'none',
                }}
              />
            </div>
            {/* Grabber thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-md transition-transform scale-0 group-hover:scale-100 group-active:scale-100"
              style={{
                left: `calc(${progressPercent}% - 6px)`,
                backgroundColor: isMinimal ? '#E8A94F' : 'var(--spotify-glow, #ffffff)',
                boxShadow: isMinimal ? 'none' : '0 0 10px var(--theme-glow-shadow)',
              }}
            />
          </div>

          <div
            className="flex items-center justify-between text-[11px] font-mono tracking-tight font-semibold px-0.5"
            style={{
              color: isMinimal
                ? '#B9AC9C'
                : isClassic
                  ? 'var(--spotify-glow, #22d3ee)'
                  : 'rgba(255, 255, 255, 0.65)',
            }}
          >
            <span>{formatTime(currentTime)}</span>
            <span>{formatNegativeTime(remainingTime)}</span>
          </div>
        </div>

        {/* Row 3: Main Playback Controls Trio (Prev / Play-Pause / Next) */}
        <div className="flex items-center justify-center gap-9 sm:gap-11 py-0.5 relative z-10">
          {/* Previous Track Button */}
          <button
            type="button"
            onClick={prevTrack}
            style={
              isMinimal
                ? { backgroundColor: '#141017', borderColor: 'rgba(232, 169, 79, 0.3)', color: '#E8A94F' }
                : isClassic
                  ? {
                      backgroundColor: 'var(--elevation-2-bg, #111622)',
                      borderColor: 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 35%, rgba(255,255,255,0.1))',
                      color: 'var(--spotify-glow, #22d3ee)',
                      boxShadow: '0 0 12px var(--theme-glow-shadow)',
                    }
                  : {
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      borderColor: 'rgba(255, 255, 255, 0.12)',
                      color: 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 75%, white)',
                      backdropFilter: 'blur(16px)',
                    }
            }
            className="w-10 h-10 rounded-full flex items-center justify-center border active:scale-85 transition-all cursor-pointer shadow-md"
            title="Bài trước"
          >
            <SkipBack className="w-4.5 h-4.5 fill-current" />
          </button>

          {/* Main Play / Pause Button (Themed Hero Vessel) */}
          <button
            type="button"
            onClick={togglePlay}
            style={
              isMinimal
                ? {
                    backgroundColor: '#E8A94F',
                    borderColor: '#E8A94F',
                    color: '#141017',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  }
                : isClassic
                  ? {
                      background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                      borderColor: 'rgba(255, 255, 255, 0.4)',
                      color: '#07090e',
                      boxShadow: '0 0 25px var(--theme-glow-shadow), 0 4px 16px rgba(0,0,0,0.5)',
                    }
                  : {
                      background: 'rgba(255, 255, 255, 0.08)',
                      borderColor: 'rgba(255, 255, 255, 0.22)',
                      color: 'var(--spotify-glow, #22d3ee)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3), 0 0 20px var(--theme-glow-shadow)',
                      backdropFilter: 'blur(20px) saturate(160%)',
                      WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                    }
            }
            className="w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center border active:scale-85 transition-all cursor-pointer"
            title={isPlaying ? 'Tạm dừng' : 'Phát'}
          >
            {isBuffering ? (
              <Loader2 className="w-6 h-6 animate-spin text-current" />
            ) : isPlaying ? (
              <Pause className="w-6 h-6 fill-current" />
            ) : (
              <Play className="w-6 h-6 fill-current ml-0.5" />
            )}
          </button>

          {/* Next Track Button */}
          <button
            type="button"
            onClick={nextTrack}
            style={
              isMinimal
                ? { backgroundColor: '#141017', borderColor: 'rgba(232, 169, 79, 0.3)', color: '#E8A94F' }
                : isClassic
                  ? {
                      backgroundColor: 'var(--elevation-2-bg, #111622)',
                      borderColor: 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 35%, rgba(255,255,255,0.1))',
                      color: 'var(--spotify-glow, #22d3ee)',
                      boxShadow: '0 0 12px var(--theme-glow-shadow)',
                    }
                  : {
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      borderColor: 'rgba(255, 255, 255, 0.12)',
                      color: 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 75%, white)',
                      backdropFilter: 'blur(16px)',
                    }
            }
            className="w-10 h-10 rounded-full flex items-center justify-center border active:scale-85 transition-all cursor-pointer shadow-md"
            title="Bài kế tiếp"
          >
            <SkipForward className="w-4.5 h-4.5 fill-current" />
          </button>
        </div>

        {/* Row 4: Volume Slider Row */}
        <div className="flex items-center gap-3 px-1 pt-0.5 relative z-10">
          <button
            type="button"
            onClick={handleVolumeToggle}
            style={{
              color: isMinimal
                ? '#E8A94F'
                : isClassic
                  ? 'var(--spotify-glow, #22d3ee)'
                  : 'rgba(255, 255, 255, 0.6)',
            }}
            className="active:scale-90 transition-all cursor-pointer"
          >
            {volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{
              background: `linear-gradient(to right, ${
                isMinimal
                  ? '#E8A94F'
                  : isClassic
                    ? 'var(--spotify-glow, #22d3ee)'
                    : 'color-mix(in srgb, var(--spotify-glow, #22d3ee) 80%, white)'
              } ${volume * 100}%, ${
                isMinimal ? '#2A222F' : 'rgba(255,255,255,0.15)'
              } ${volume * 100}%)`,
            }}
            className="w-full h-1 rounded-lg appearance-none cursor-pointer outline-none"
          />
          <Volume2
            className="w-3.5 h-3.5"
            style={{
              color: isMinimal
                ? '#E8A94F'
                : isClassic
                  ? 'var(--spotify-glow, #22d3ee)'
                  : 'rgba(255, 255, 255, 0.6)',
            }}
          />
        </div>
      </footer>

      {/* 📱 5. Context Menu Bottom Sheet */}
      {showMenuSheet && (
        <div
          onClick={() => setShowMenuSheet(false)}
          className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-md flex items-end justify-center p-0 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full border-t rounded-t-3xl p-5 shadow-2xl flex flex-col gap-3 max-h-[70vh] animate-in slide-in-from-bottom-5 duration-200 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] ${
              isMinimal
                ? 'bg-[#141017] border-[#E8A94F]/30 text-[#F4ECE1]'
                : isClassic
                  ? 'bg-[#0a0e17] border-white/15 text-white'
                  : 'bg-[#10141e]/95 backdrop-blur-2xl border-white/15 text-white'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <span className="text-sm font-bold">Tùy chọn bài hát</span>
              <button
                type="button"
                onClick={() => setShowMenuSheet(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-full bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowMenuSheet(false)
                setShowShareModal(true)
              }}
              style={
                isMinimal
                  ? { backgroundColor: 'rgba(232, 169, 79, 0.1)', borderColor: 'rgba(232, 169, 79, 0.25)' }
                  : isClassic
                    ? { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderColor: 'rgba(255, 255, 255, 0.1)' }
                    : { backgroundColor: 'rgba(255, 255, 255, 0.04)', borderColor: 'rgba(255, 255, 255, 0.08)' }
              }
              className="flex items-center gap-3 p-3.5 rounded-2xl border text-xs font-semibold transition-all"
            >
              <Share2
                className="w-4 h-4"
                style={{ color: isMinimal ? '#E8A94F' : 'var(--spotify-glow, #22d3ee)' }}
              />
              <span>Chia sẻ trích dẫn lời bài hát</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowMenuSheet(false)
                closeNowPlayingOverlay()
                toggleQueue()
              }}
              style={
                isMinimal
                  ? { backgroundColor: 'rgba(232, 169, 79, 0.1)', borderColor: 'rgba(232, 169, 79, 0.25)' }
                  : isClassic
                    ? { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderColor: 'rgba(255, 255, 255, 0.1)' }
                    : { backgroundColor: 'rgba(255, 255, 255, 0.04)', borderColor: 'rgba(255, 255, 255, 0.08)' }
              }
              className="flex items-center gap-3 p-3.5 rounded-2xl border text-xs font-semibold transition-all"
            >
              <ListMusic
                className="w-4 h-4"
                style={{ color: isMinimal ? '#E8A94F' : '#34d399' }}
              />
              <span>Xem danh sách hàng đợi phát</span>
            </button>
          </div>
        </div>
      )}

      {/* 📱 6. Lyrics Share Story Modal */}
      {showShareModal && (
        <LyricsShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          track={currentTrack}
          lyrics={lyrics}
        />
      )}
    </div>
  )
}
