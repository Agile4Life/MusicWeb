'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
import type { RepeatMode } from './PlayerContext'
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
  Repeat,
  Repeat1,
  MoreHorizontal,
  Volume2,
  VolumeX,
  Languages,
  Sparkles,
  ListMusic,
  Share2,
  Loader2,
  X,
  MessageSquareQuote,
  GripVertical,
} from 'lucide-react'

interface ExtendedLyricLine extends LyricLine {
  romaji?: string
}

type FullviewTab = 'cover' | 'lyrics' | 'queue'

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
    repeatMode,
    toggleRepeat,
    toggleFavoriteCurrentTrack,
    isNowPlayingOpen,
    closeNowPlayingOverlay,
    queue,
    currentIndex,
    playTrack,
    mvIntroOffset,
  } = usePlayer()

  const { themeStyle, currentTheme } = useTheme()

  // ===== Tab State =====
  const [activeTab, setActiveTab] = useState<FullviewTab>('cover')

  // ===== Unified iOS Drag to Dismiss Physics =====
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

  // ===== Horizontal Swipe Between Tabs =====
  const swipeStartXRef = useRef(0)
  const swipeStartYRef = useRef(0)
  const isHorizontalSwipeRef = useRef(false)
  const swipeDeltaXRef = useRef(0)

  // ===== Lyrics State =====
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
  const [showTranslation, setShowTranslation] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('musicweb_show_romaji')
      if (saved !== null) return saved === 'true'
    }
    return true
  })
  const [showMenuSheet, setShowMenuSheet] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)

  // Auto-scroll management
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isUserInteractingRef = useRef(false)
  const lyricsReqIdRef = useRef(0)

  // ===== Progress bar scrub state =====
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubValue, setScrubValue] = useState(0)

  // ===== Reset state on open =====
  useEffect(() => {
    if (isNowPlayingOpen) {
      setDragY(0)
      dragYRef.current = 0
      setIsDragging(false)
      isDraggingRef.current = false
      isClosingRef.current = false
      setActiveTab('cover')
    }
  }, [isNowPlayingOpen])

  // ===== Fetch lyrics whenever currentTrack changes =====
  useEffect(() => {
    if (!currentTrack) {
      setLyrics([])
      setIsSynced(false)
      setLyricsLoading(false)
      return
    }

    const trackId = currentTrack.id
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
    if (!isNowPlayingOpen || activeTab !== 'lyrics' || isUserInteractingRef.current || activeIndex < 0 || !isSynced) {
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
  }, [activeIndex, isSynced, isNowPlayingOpen, activeTab])

  // Instant scroll on opening overlay or switching to lyrics tab
  useEffect(() => {
    if (isNowPlayingOpen && activeTab === 'lyrics' && activeIndex >= 0 && isSynced) {
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
  }, [isNowPlayingOpen, activeTab])

  // User touch detection
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

  // ===== iOS Sheet Drag Gestures =====
  const handleDragTouchStart = useCallback((e: React.TouchEvent) => {
    if (isClosingRef.current) return
    const touch = e.touches[0]
    touchStartYRef.current = touch.clientY
    touchStartXRef.current = touch.clientX
    lastTouchYRef.current = touch.clientY
    touchStartTimeRef.current = Date.now()
    dragYRef.current = 0
    // Reset horizontal swipe detection
    swipeStartXRef.current = touch.clientX
    swipeStartYRef.current = touch.clientY
    isHorizontalSwipeRef.current = false
    swipeDeltaXRef.current = 0
  }, [])

  const handleDragTouchMove = useCallback((e: React.TouchEvent) => {
    if (isClosingRef.current) return
    const touch = e.touches[0]
    const currentY = touch.clientY
    const currentX = touch.clientX
    const deltaY = currentY - touchStartYRef.current
    const deltaX = currentX - touchStartXRef.current
    lastTouchYRef.current = currentY

    // Detect horizontal swipe for tab switching
    if (!isDraggingRef.current && !isHorizontalSwipeRef.current) {
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 12) {
        // Check if we're NOT over a scrollable lyrics container
        const isOverLyrics = scrollContainerRef.current && scrollContainerRef.current.contains(e.target as Node)
        if (!isOverLyrics) {
          isHorizontalSwipeRef.current = true
          swipeDeltaXRef.current = deltaX
          return
        }
      }
    }

    if (isHorizontalSwipeRef.current) {
      swipeDeltaXRef.current = deltaX
      return
    }

    if (!isDraggingRef.current) {
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
        return
      }

      const isOverLyrics = scrollContainerRef.current && scrollContainerRef.current.contains(e.target as Node)
      if (isOverLyrics) {
        if ((scrollContainerRef.current?.scrollTop || 0) > 2) {
          return
        }
      }

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
        setDragY(deltaY)
        dragYRef.current = deltaY
      } else {
        const rubberband = deltaY * 0.18
        setDragY(rubberband)
        dragYRef.current = rubberband
      }
    }
  }, [])

  const tabOrder: FullviewTab[] = ['cover', 'lyrics', 'queue']

  const handleDragTouchEnd = useCallback(() => {
    // Handle horizontal swipe → tab switch
    if (isHorizontalSwipeRef.current) {
      isHorizontalSwipeRef.current = false
      const dx = swipeDeltaXRef.current
      if (Math.abs(dx) > 50) {
        setActiveTab((prev) => {
          const idx = tabOrder.indexOf(prev)
          if (dx < 0 && idx < tabOrder.length - 1) return tabOrder[idx + 1]
          if (dx > 0 && idx > 0) return tabOrder[idx - 1]
          return prev
        })
      }
      swipeDeltaXRef.current = 0
      return
    }

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

  // ===== Progress Scrubbing =====
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seek(pct * effectiveDuration)
  }

  const handleProgressTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    setIsScrubbing(true)
    const rect = e.currentTarget.getBoundingClientRect()
    const touch = e.touches[0]
    const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width))
    setScrubValue(pct * effectiveDuration)
  }

  const handleProgressTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isScrubbing) return
    const rect = e.currentTarget.getBoundingClientRect()
    const touch = e.touches[0]
    const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width))
    setScrubValue(pct * effectiveDuration)
  }

  const handleProgressTouchEnd = () => {
    if (isScrubbing) {
      seek(scrubValue)
      setIsScrubbing(false)
    }
  }

  if (!currentTrack) return null

  const effectiveDuration = duration > 0 ? duration : (currentTrack.duration || 0)
  const displayTime = isScrubbing ? scrubValue : currentTime
  const remainingTime = Math.max(0, effectiveDuration - displayTime)
  const progressPercent = effectiveDuration > 0 ? Math.min(100, Math.max(0, (displayTime / effectiveDuration) * 100)) : 0

  const isLiquid = themeStyle === 'liquid-glass'
  const isMinimal = themeStyle === 'minimal-flat'
  const isClassic = themeStyle === 'classic'

  const dragProgress = Math.min(1, Math.max(0, dragY / 500))
  const sheetScale = dragY > 0 ? Math.max(0.92, 1 - dragProgress * 0.08) : 1
  const sheetRadius = dragY > 0 ? Math.min(36, 16 + dragY * 0.12) : 0
  const sheetOpacity = dragY > 0 ? Math.max(0.35, 1 - dragProgress * 0.55) : 1

  // Queue: upcoming tracks after current
  const nextUpTracks = currentIndex >= 0 ? queue.slice(currentIndex + 1) : queue

  // Repeat icon
  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat
  const isRepeatActive = repeatMode !== 'off'

  return (
    <div
      ref={containerRef}
      onTouchStart={handleDragTouchStart}
      onTouchMove={handleDragTouchMove}
      onTouchEnd={handleDragTouchEnd}
      onTouchCancel={handleDragTouchEnd}
      className={`mobile-fullview-overlay fixed inset-0 z-[100] flex flex-col select-none overflow-hidden touch-pan-y ${
        isNowPlayingOpen ? 'pointer-events-auto' : 'pointer-events-none opacity-0 translate-y-full'
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
        backgroundColor: isMinimal ? '#141017' : '#0a0a0a',
        color: isMinimal ? '#F4ECE1' : 'white',
      }}
    >
      {/* ══════════════════════════════════════════════════════════════════
          🌟 BACKGROUND — Blurred album art (Apple Music style)
          ══════════════════════════════════════════════════════════════════ */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        {currentTrack.cover_url ? (
          <div
            className="absolute inset-[-30%] bg-cover bg-center transition-all duration-[1200ms]"
            style={{
              backgroundImage: `url(${currentTrack.cover_url})`,
              filter: 'blur(80px) brightness(0.4) saturate(1.8)',
              transform: 'scale(1.2)',
            }}
          />
        ) : (
          <div
            className="absolute inset-[-20%] blur-[80px] opacity-40"
            style={{
              background: `radial-gradient(circle at 30% 30%, ${currentTheme.gradient1}, transparent 60%), radial-gradient(circle at 70% 70%, ${currentTheme.gradient2}, transparent 60%)`,
            }}
          />
        )}
        {/* Dark vignette overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70" />
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          📎 DRAG HANDLE
          ══════════════════════════════════════════════════════════════════ */}
      <div
        className="relative z-20 flex justify-center pt-[calc(0.6rem+env(safe-area-inset-top,0px))] pb-1 cursor-grab active:cursor-grabbing"
      >
        <div
          onClick={closeNowPlayingOverlay}
          className="w-10 h-1 rounded-full bg-white/40 hover:bg-white/60 transition-all cursor-pointer active:scale-95"
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          🎵 HEADER PLAQUE (Lyrics & Queue tabs only)
          ══════════════════════════════════════════════════════════════════ */}
      {activeTab !== 'cover' && (
        <div className="relative z-20 px-5 py-2 flex items-center gap-3 cursor-grab active:cursor-grabbing">
          {/* Mini Cover */}
          <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 shadow-lg">
            <TrackCoverImage src={currentTrack.cover_url} alt={currentTrack.title} />
          </div>
          {/* Title & Artist */}
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-bold truncate leading-tight text-white">
              {currentTrack.title}
            </span>
            <span className="text-xs truncate leading-tight mt-0.5 text-white/55">
              {currentTrack.artist || 'Nghệ sĩ chưa rõ'}
            </span>
          </div>
          {/* Star + ⋯ */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleFavoriteCurrentTrack}
              className="p-1.5 active:scale-90 transition-transform cursor-pointer"
            >
              <Star
                className={`w-5 h-5 transition-all ${
                  currentTrack.is_favorite
                    ? 'text-amber-400 fill-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                    : 'text-white/50 hover:text-white/80'
                }`}
              />
            </button>
            <button
              type="button"
              onClick={() => setShowMenuSheet(true)}
              className="p-1.5 text-white/50 hover:text-white/80 active:scale-90 transition-all cursor-pointer"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          📱 MAIN CONTENT AREA — Switches between 3 tabs
          ══════════════════════════════════════════════════════════════════ */}
      <main className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">

        {/* ─── TAB 1: COVER ART VIEW ─── */}
        {activeTab === 'cover' && (
          <div className="flex-1 flex flex-col justify-center px-6 sm:px-8 gap-6 overflow-hidden">
            {/* Large Cover Art */}
            <div className="w-full aspect-square max-w-[min(85vw,380px)] mx-auto rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.6)] transition-all duration-500">
              <TrackCoverImage
                src={currentTrack.cover_url}
                alt={currentTrack.title}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Song Info Row */}
            <div className="flex items-start justify-between gap-3 px-1">
              <div className="flex flex-col min-w-0 flex-1">
                <h2 className="text-xl font-bold truncate leading-tight text-white">
                  {currentTrack.title}
                </h2>
                <p className="text-base truncate leading-tight mt-1 text-white/55">
                  {currentTrack.artist || 'Nghệ sĩ chưa rõ'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 mt-0.5">
                <button
                  type="button"
                  onClick={toggleFavoriteCurrentTrack}
                  className="p-1.5 active:scale-90 transition-transform cursor-pointer"
                >
                  <Star
                    className={`w-[22px] h-[22px] transition-all ${
                      currentTrack.is_favorite
                        ? 'text-amber-400 fill-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                        : 'text-white/45 hover:text-white/75'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setShowMenuSheet(true)}
                  className="p-1.5 text-white/45 hover:text-white/75 active:scale-90 transition-all cursor-pointer"
                >
                  <MoreHorizontal className="w-[22px] h-[22px]" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 2: LYRICS VIEW ─── */}
        {activeTab === 'lyrics' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 sm:px-6">
            {lyricsLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 my-auto text-white/40">
                <Loader2 className="w-7 h-7 animate-spin text-white/60" />
                <span className="text-xs font-semibold">Đang tải lời bài hát...</span>
              </div>
            ) : lyrics.length > 0 ? (
              <div
                ref={scrollContainerRef}
                onTouchStart={handleUserTouchStart}
                onTouchEnd={handleUserTouchEnd}
                onWheel={handleUserTouchStart}
                className="w-full h-full overflow-y-auto overflow-x-hidden no-scrollbar flex flex-col gap-5 py-24 px-1 touch-pan-y"
                style={{
                  maskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)',
                }}
              >
                {lyrics.map((line, idx) => {
                  const isActive = idx === activeIndex
                  const isSyncedMode = isSynced && activeIndex >= 0

                  let blurPx = 0
                  let opacity = 1.0

                  if (!isSyncedMode) {
                    blurPx = 0
                    opacity = 0.95
                  } else if (isActive) {
                    blurPx = 0
                    opacity = 1.0
                  } else {
                    const distance = Math.abs(idx - activeIndex)
                    const isPast = idx < activeIndex

                    if (distance === 1) {
                      blurPx = 1.0
                      opacity = isPast ? 0.5 : 0.4
                    } else if (distance === 2) {
                      blurPx = 1.8
                      opacity = isPast ? 0.35 : 0.28
                    } else {
                      blurPx = 2.5
                      opacity = isPast ? 0.2 : 0.15
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
                      {/* Main Lyric Line */}
                      <p
                        className={`leading-snug break-words break-normal whitespace-pre-wrap transition-all duration-300 pr-1 font-sans ${
                          isActive
                            ? 'text-[clamp(1.35rem,5.5vw,1.85rem)] font-black text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]'
                            : 'text-[clamp(1.1rem,4.5vw,1.5rem)] font-bold text-white'
                        }`}
                      >
                        {line.text}
                      </p>

                      {/* Romaji / Translation */}
                      {hasRomaji && (
                        <p
                          className={`text-xs sm:text-sm font-semibold mt-1 tracking-wide leading-normal break-words whitespace-pre-wrap transition-all duration-300 pr-1 ${
                            isActive
                              ? 'text-white/70 drop-shadow-sm'
                              : 'text-white/40'
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
              <div className="flex flex-col items-center justify-center gap-3 my-auto text-white/40 text-center px-4">
                <Sparkles className="w-8 h-8 stroke-[1.5] text-white/30" />
                <p className="text-sm font-semibold text-white/70">Chưa có lời đồng bộ cho bài hát này</p>
                <p className="text-xs text-white/40">Bạn có thể tự tìm kiếm hoặc thưởng thức giai điệu tuyệt vời</p>
              </div>
            )}

            {/* Lyrics utility bar: Language toggle + Share */}
            {lyrics.length > 0 && (
              <div className="flex items-center justify-between px-2 py-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowTranslation((prev) => {
                    const next = !prev
                    try { localStorage.setItem('musicweb_show_romaji', String(next)) } catch {}
                    return next
                  })}
                  className={`p-2 rounded-full transition-all cursor-pointer active:scale-95 ${
                    showTranslation
                      ? 'bg-white/15 text-white'
                      : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  <Languages className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowShareModal(true)}
                  className="p-2 rounded-full text-white/40 hover:text-white/60 transition-all cursor-pointer active:scale-95"
                >
                  <Sparkles className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 3: QUEUE VIEW ─── */}
        {activeTab === 'queue' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 sm:px-5">
            {/* Control Pills: Shuffle / Repeat / Autoplay */}
            <div className="flex items-center gap-2 py-3 px-1 shrink-0">
              <button
                type="button"
                onClick={toggleShuffle}
                className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer active:scale-95 ${
                  isShuffle
                    ? 'bg-white/20 text-white border border-white/25'
                    : 'bg-white/[0.06] text-white/55 border border-white/10 hover:bg-white/10'
                }`}
              >
                <Shuffle className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={toggleRepeat}
                className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer active:scale-95 ${
                  isRepeatActive
                    ? 'bg-white/20 text-white border border-white/25'
                    : 'bg-white/[0.06] text-white/55 border border-white/10 hover:bg-white/10'
                }`}
              >
                <RepeatIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* "Tiếp tục phát" header */}
            <div className="px-1 pb-2 shrink-0">
              <h3 className="text-base font-bold text-white">Tiếp tục phát</h3>
            </div>

            {/* Track List */}
            <div className="flex-1 overflow-y-auto no-scrollbar touch-pan-y pb-4">
              {nextUpTracks.length > 0 ? (
                <div className="flex flex-col">
                  {nextUpTracks.map((track, idx) => (
                    <button
                      key={`queue-${track.id}-${idx}`}
                      type="button"
                      onClick={() => playTrack(track, queue, currentIndex + 1 + idx)}
                      className="flex items-center gap-3 py-2.5 px-1 rounded-xl hover:bg-white/[0.04] transition-colors cursor-pointer group text-left w-full"
                    >
                      {/* Mini Cover */}
                      <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 shadow-md">
                        <TrackCoverImage src={track.cover_url} alt={track.title} />
                      </div>
                      {/* Track Info */}
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm font-semibold truncate text-white leading-tight">
                          {track.title}
                        </span>
                        <span className="text-xs truncate text-white/45 leading-tight mt-0.5">
                          {track.artist || 'Nghệ sĩ chưa rõ'}
                        </span>
                      </div>
                      {/* Drag Handle Icon */}
                      <div className="shrink-0 text-white/20 group-hover:text-white/35">
                        <GripVertical className="w-5 h-5" />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-white/30">
                  <ListMusic className="w-8 h-8" />
                  <p className="text-sm font-medium">Chưa có bài hát trong hàng đợi</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ══════════════════════════════════════════════════════════════════
          🎛️ SHARED CONTROLS FOOTER (Apple Music style — no glassmorphism panel)
          ══════════════════════════════════════════════════════════════════ */}
      <footer className="relative z-20 px-6 sm:px-8 pb-1 pt-1 shrink-0">

        {/* ─── Progress Bar ─── */}
        <div className="flex flex-col gap-1 w-full">
          <div
            onClick={handleProgressClick}
            onTouchStart={handleProgressTouchStart}
            onTouchMove={handleProgressTouchMove}
            onTouchEnd={handleProgressTouchEnd}
            className="relative w-full h-4 flex items-center cursor-pointer group touch-none"
          >
            {/* Track background */}
            <div className="w-full h-[3px] rounded-full overflow-hidden bg-white/[0.18] group-active:h-[5px] transition-all">
              {/* Progress fill */}
              <div
                className="h-full rounded-full transition-[width] duration-75"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: 'rgba(255, 255, 255, 0.92)',
                }}
              />
            </div>
            {/* Scrub thumb (appears on hover/touch) */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md transition-transform scale-0 group-hover:scale-100 group-active:scale-100"
              style={{ left: `calc(${progressPercent}% - 6px)` }}
            />
          </div>

          {/* Time labels */}
          <div className="flex items-center justify-between text-[11px] font-medium tracking-tight text-white/50 px-0.5">
            <span>{formatTime(displayTime)}</span>
            <span>{formatNegativeTime(remainingTime)}</span>
          </div>
        </div>

        {/* ─── Playback Controls (Apple style: no backgrounds, pure white icons) ─── */}
        <div className="flex items-center justify-center gap-10 py-3">
          {/* Previous */}
          <button
            type="button"
            onClick={prevTrack}
            className="text-white active:scale-85 active:opacity-60 transition-all cursor-pointer p-2"
          >
            <SkipBack className="w-7 h-7 fill-white" />
          </button>

          {/* Play / Pause */}
          <button
            type="button"
            onClick={togglePlay}
            className="text-white active:scale-85 active:opacity-60 transition-all cursor-pointer p-2"
          >
            {isBuffering ? (
              <Loader2 className="w-10 h-10 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-10 h-10 fill-white" />
            ) : (
              <Play className="w-10 h-10 fill-white ml-0.5" />
            )}
          </button>

          {/* Next */}
          <button
            type="button"
            onClick={nextTrack}
            className="text-white active:scale-85 active:opacity-60 transition-all cursor-pointer p-2"
          >
            <SkipForward className="w-7 h-7 fill-white" />
          </button>
        </div>

        {/* ─── Volume Slider ─── */}
        <div className="flex items-center gap-3 px-1 pb-2">
          <button
            type="button"
            onClick={handleVolumeToggle}
            className="text-white/50 active:scale-90 transition-all cursor-pointer"
          >
            {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{
              background: `linear-gradient(to right, rgba(255,255,255,0.85) ${volume * 100}%, rgba(255,255,255,0.15) ${volume * 100}%)`,
            }}
            className="w-full h-[3px] rounded-lg appearance-none cursor-pointer outline-none"
          />
          <Volume2 className="w-4 h-4 text-white/50" />
        </div>

        {/* ─── Bottom Tab Bar (Apple Music style) ─── */}
        <div className="flex items-center justify-center gap-16 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
          {/* Lyrics Tab */}
          <button
            type="button"
            onClick={() => setActiveTab('lyrics')}
            className={`p-2.5 rounded-full transition-all cursor-pointer active:scale-90 ${
              activeTab === 'lyrics'
                ? 'bg-white/15 text-white'
                : 'text-white/40 hover:text-white/60'
            }`}
            title="Lời bài hát"
          >
            <MessageSquareQuote className="w-5 h-5" />
          </button>

          {/* Share / Lyrics Story Tab (Middle — replaces AirPlay) */}
          <button
            type="button"
            onClick={() => setShowShareModal(true)}
            className={`p-2.5 rounded-full transition-all cursor-pointer active:scale-90 ${
              showShareModal
                ? 'bg-white/15 text-white'
                : 'text-white/40 hover:text-white/60'
            }`}
            title="Chia sẻ"
          >
            <Sparkles className="w-5 h-5" />
          </button>

          {/* Queue Tab */}
          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`p-2.5 rounded-full transition-all cursor-pointer active:scale-90 ${
              activeTab === 'queue'
                ? 'bg-white/15 text-white'
                : 'text-white/40 hover:text-white/60'
            }`}
            title="Hàng đợi phát"
          >
            <ListMusic className="w-5 h-5" />
          </button>
        </div>
      </footer>

      {/* ══════════════════════════════════════════════════════════════════
          📱 Context Menu Bottom Sheet
          ══════════════════════════════════════════════════════════════════ */}
      {showMenuSheet && (
        <div
          onClick={() => setShowMenuSheet(false)}
          className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-md flex items-end justify-center p-0 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full border-t rounded-t-3xl p-5 shadow-2xl flex flex-col gap-3 max-h-[70vh] animate-in slide-in-from-bottom-5 duration-200 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] bg-[#1a1a1a]/95 backdrop-blur-2xl border-white/15 text-white"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <span className="text-sm font-bold">Tùy chọn bài hát</span>
              <button
                type="button"
                onClick={() => setShowMenuSheet(false)}
                className="p-1.5 text-white/40 hover:text-white rounded-full bg-white/5"
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
              className="flex items-center gap-3 p-3.5 rounded-2xl border border-white/8 bg-white/[0.04] text-xs font-semibold transition-all hover:bg-white/[0.08]"
            >
              <Share2 className="w-4 h-4 text-white/60" />
              <span>Chia sẻ trích dẫn lời bài hát</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowMenuSheet(false)
                setActiveTab('queue')
              }}
              className="flex items-center gap-3 p-3.5 rounded-2xl border border-white/8 bg-white/[0.04] text-xs font-semibold transition-all hover:bg-white/[0.08]"
            >
              <ListMusic className="w-4 h-4 text-emerald-400/80" />
              <span>Xem danh sách hàng đợi phát</span>
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          📱 Lyrics Share Story Modal
          ══════════════════════════════════════════════════════════════════ */}
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
