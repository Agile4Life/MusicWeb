'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
import { useTheme } from '../theme/ThemeContext'
import { TrackCoverImage } from '../common/TrackCoverImage'
import { LyricsShareModal } from './LyricsShareModal'
import { MobileTabTransition } from './MobileTabTransition'
import { getPrimaryLyrics, getTrackLyricsCacheKey } from '@/lib/lyricsFlow'
import { parseLrc, parsePlainLyrics, findActiveLyricIndex, LyricLine } from '@/lib/lrcParser'
import { fetchLyricsRomaji } from '@/lib/romajiTransliteration'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Star,
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
  const [tabDirection, setTabDirection] = useState(0)
  const prefersReducedMotion = useReducedMotion()

  // Direction-aware tab setter
  const switchTab = useCallback((newTab: FullviewTab) => {
    setActiveTab((prev) => {
      const tabOrder: FullviewTab[] = ['cover', 'lyrics', 'queue']
      const prevIdx = tabOrder.indexOf(prev)
      const newIdx = tabOrder.indexOf(newTab)
      setTabDirection(newIdx > prevIdx ? 1 : -1)
      return newTab
    })
  }, [])

  // ===== Unified iOS Drag to Dismiss Physics =====
  const touchStartYRef = useRef(0)
  const touchStartXRef = useRef(0)
  const touchStartTimeRef = useRef(0)
  const lastTouchYRef = useRef(0)
  const touchHistoryRef = useRef<{ y: number; t: number }[]>([])
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
    if (currentTrack) {
      return globalLyricsCache.get(getTrackLyricsCacheKey(currentTrack))?.lyrics || []
    }
    return []
  })
  const [isSynced, setIsSynced] = useState<boolean>(() => {
    if (currentTrack) {
      return globalLyricsCache.get(getTrackLyricsCacheKey(currentTrack))?.isSynced || false
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

  // Auto-scroll management & timeouts
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUserScrollingLyricsRef = useRef(false)
  const scrollableElRef = useRef<HTMLElement | null>(null)
  const isOverScrollableRef = useRef(false)
  const lyricsReqIdRef = useRef(0)

  // ===== Progress bar scrub state =====
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubValue, setScrubValue] = useState(0)

  // ===== Cleanup timeouts on unmount =====
  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) clearTimeout(dismissTimeoutRef.current)
      if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current)
    }
  }, [])

  // ===== Reset state on open =====
  useEffect(() => {
    if (isNowPlayingOpen) {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current)
        dismissTimeoutRef.current = null
      }
      dragYRef.current = 0
      isDraggingRef.current = false
      isClosingRef.current = false
      touchHistoryRef.current = []
      if (containerRef.current) {
        containerRef.current.style.transform = ''
        containerRef.current.style.opacity = ''
        containerRef.current.style.borderRadius = ''
        containerRef.current.style.boxShadow = ''
        containerRef.current.style.transition = ''
      }
      setActiveTab('cover')
      setTabDirection(0)
    }
  }, [isNowPlayingOpen])

  // ===== Fetch lyrics whenever currentTrack changes =====
  useEffect(() => {
    const reqId = ++lyricsReqIdRef.current
    const invalidate = () => { lyricsReqIdRef.current++ }
    if (!currentTrack) {
      setLyrics([])
      setIsSynced(false)
      setLyricsLoading(false)
      return invalidate
    }

    const cacheKey = getTrackLyricsCacheKey(currentTrack)
    const cached = globalLyricsCache.get(cacheKey)
    if (cached) {
      setLyrics(cached.lyrics)
      setIsSynced(cached.isSynced)
      setLyricsLoading(false)
      globalLyricsCache.delete(cacheKey)
      globalLyricsCache.set(cacheKey, cached)
      return invalidate
    }

    setLyricsLoading(true)
    setLyrics([])
    setIsSynced(false)

    getPrimaryLyrics(currentTrack)
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
        if (validLyrics.length > 0) {
          globalLyricsCache.set(cacheKey, { lyrics: validLyrics, isSynced: hasSynced })
          while (globalLyricsCache.size > 200) {
            globalLyricsCache.delete(globalLyricsCache.keys().next().value!)
          }
        }

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
              globalLyricsCache.set(cacheKey, { lyrics: withRomaji, isSynced: hasSynced })
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
    return invalidate
  }, [currentTrack])

  // Active lyric index calculation
  const activeIndex = useMemo(() => {
    if (!lyrics || lyrics.length === 0 || !isSynced) return -1
    return findActiveLyricIndex(lyrics, currentTime, -(mvIntroOffset || 0))
  }, [lyrics, currentTime, isSynced, mvIntroOffset])

  // Ultra-Smooth Spring Auto-scroll to active line
  useEffect(() => {
    if (!isNowPlayingOpen || activeTab !== 'lyrics' || isUserScrollingLyricsRef.current || activeIndex < 0 || !isSynced) {
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

  // User touch & scroll detection for lyrics auto-scroll (responsive 1.8s resume)
  const handleLyricsUserScroll = useCallback(() => {
    isUserScrollingLyricsRef.current = true
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current)
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingLyricsRef.current = false
    }, 1800)
  }, [])

  // ===== iOS Sheet Drag Gestures =====
  const handleDragTouchStart = useCallback((e: TouchEvent) => {
    if (isClosingRef.current) return
    const touch = e.touches[0]
    const now = Date.now()
    touchStartYRef.current = touch.clientY
    touchStartXRef.current = touch.clientX
    lastTouchYRef.current = touch.clientY
    touchStartTimeRef.current = now
    touchHistoryRef.current = [{ y: touch.clientY, t: now }]
    dragYRef.current = 0

    // Cache DOM query at touchstart once (O(1) instead of O(N) traversal on every move)
    const target = e.target as HTMLElement | null
    scrollableElRef.current = target?.closest?.('.overflow-y-auto') as HTMLElement | null
    isOverScrollableRef.current = Boolean(scrollableElRef.current)

    // Reset horizontal swipe detection
    swipeStartXRef.current = touch.clientX
    swipeStartYRef.current = touch.clientY
    isHorizontalSwipeRef.current = false
    swipeDeltaXRef.current = 0
  }, [])

  const handleDragTouchMove = useCallback((e: TouchEvent) => {
    if (isClosingRef.current) return
    const touch = e.touches[0]
    const currentY = touch.clientY
    const currentX = touch.clientX
    const deltaY = currentY - touchStartYRef.current
    const deltaX = currentX - touchStartXRef.current
    const now = Date.now()
    lastTouchYRef.current = currentY
    touchHistoryRef.current.push({ y: currentY, t: now })
    if (touchHistoryRef.current.length > 6) {
      touchHistoryRef.current.shift()
    }

    // Detect horizontal swipe for tab switching (uses cached isOverScrollableRef)
    if (!isDraggingRef.current && !isHorizontalSwipeRef.current) {
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 12) {
        if (!isOverScrollableRef.current) {
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

      // Check if user is scrolling inside a scrollable container (uses cached scrollableElRef)
      const scrollableEl = scrollableElRef.current
      if (scrollableEl && scrollableEl.scrollTop > 2) {
        return
      }

      if (deltaY > 6) {
        isDraggingRef.current = true
        if (containerRef.current) {
          containerRef.current.style.transition = 'none'
        }
      }
    }

    if (isDraggingRef.current) {
      if (e.cancelable) {
        e.preventDefault() // Guarantees preventDefault succeeds because listener is { passive: false }
      }
      const currentDrag = deltaY > 0 ? deltaY : deltaY * 0.18
      dragYRef.current = currentDrag

      if (containerRef.current) {
        const progress = Math.min(1, Math.max(0, currentDrag / 500))
        const scale = currentDrag > 0 ? Math.max(0.92, 1 - progress * 0.08) : 1
        const radius = currentDrag > 0 ? Math.min(36, 16 + currentDrag * 0.12) : 0
        const opacity = currentDrag > 0 ? Math.max(0.35, 1 - progress * 0.55) : 1

        containerRef.current.style.transform = `translateY(${Math.max(0, currentDrag)}px) scale(${scale})`
        containerRef.current.style.opacity = `${opacity}`
        containerRef.current.style.borderRadius = `${radius}px ${radius}px 0 0`
        containerRef.current.style.boxShadow = currentDrag > 0 ? '0 -12px 48px rgba(0, 0, 0, 0.85)' : 'none'
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
          if (dx < 0 && idx < tabOrder.length - 1) {
            setTabDirection(1)
            return tabOrder[idx + 1]
          }
          if (dx > 0 && idx > 0) {
            setTabDirection(-1)
            return tabOrder[idx - 1]
          }
          return prev
        })
      }
      swipeDeltaXRef.current = 0
      return
    }

    if (isClosingRef.current) return
    if (!isDraggingRef.current) {
      return
    }

    // Precise flick velocity calculation from recent touch points window
    let velocity = 0
    const history = touchHistoryRef.current
    if (history.length >= 2) {
      const first = history[0]
      const last = history[history.length - 1]
      const dt = Math.max(1, last.t - first.t)
      velocity = (last.y - first.y) / dt // px per ms
    } else {
      const elapsed = Math.max(1, Date.now() - touchStartTimeRef.current)
      velocity = (lastTouchYRef.current - touchStartYRef.current) / elapsed
    }

    const currentDragY = dragYRef.current
    isDraggingRef.current = false

    const shouldDismiss = currentDragY > 100 || (currentDragY > 35 && velocity > 0.4)

    if (shouldDismiss) {
      isClosingRef.current = true

      if (containerRef.current) {
        containerRef.current.style.transition =
          'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.25s ease-out, border-radius 0.25s ease, box-shadow 0.25s ease'
        containerRef.current.style.transform = 'translateY(100%) scale(0.92)'
        containerRef.current.style.opacity = '0'
        containerRef.current.style.borderRadius = '36px 36px 0 0'
        containerRef.current.style.boxShadow = 'none'
      }

      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current)
      }
      dismissTimeoutRef.current = setTimeout(() => {
        closeNowPlayingOverlay()
        if (containerRef.current) {
          containerRef.current.style.transform = ''
          containerRef.current.style.opacity = ''
          containerRef.current.style.borderRadius = ''
          containerRef.current.style.boxShadow = ''
          containerRef.current.style.transition = ''
        }
        dragYRef.current = 0
        isClosingRef.current = false
        dismissTimeoutRef.current = null
      }, 280)
    } else {
      if (containerRef.current) {
        containerRef.current.style.transition =
          'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease, border-radius 0.3s ease, box-shadow 0.3s ease'
        containerRef.current.style.transform = 'translateY(0px) scale(1)'
        containerRef.current.style.opacity = '1'
        containerRef.current.style.borderRadius = '0px'
        containerRef.current.style.boxShadow = 'none'

        setTimeout(() => {
          if (containerRef.current && !isDraggingRef.current) {
            containerRef.current.style.transition = ''
          }
        }, 350)
      }
      dragYRef.current = 0
    }
  }, [closeNowPlayingOverlay])

  // Attach native non-passive touchmove listener to allow preventDefault
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onTouchStart = (e: TouchEvent) => handleDragTouchStart(e)
    const onTouchMove = (e: TouchEvent) => handleDragTouchMove(e)
    const onTouchEnd = () => handleDragTouchEnd()

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [handleDragTouchStart, handleDragTouchMove, handleDragTouchEnd])

  const handleLineClick = (line: ExtendedLyricLine) => {
    if (typeof line.time === 'number' && line.time >= 0) {
      const targetTime = Math.max(0, line.time + (mvIntroOffset || 0))
      seek(targetTime)
      isUserScrollingLyricsRef.current = false
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
    e.stopPropagation()
    setIsScrubbing(true)
    const rect = e.currentTarget.getBoundingClientRect()
    const touch = e.touches[0]
    const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width))
    setScrubValue(pct * effectiveDuration)
  }

  const handleProgressTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (!isScrubbing) return
    const rect = e.currentTarget.getBoundingClientRect()
    const touch = e.touches[0]
    const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width))
    setScrubValue(pct * effectiveDuration)
  }

  const handleProgressTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation()
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

  // Queue: upcoming tracks after current
  const nextUpTracks = currentIndex >= 0 ? queue.slice(currentIndex + 1) : queue

  // Repeat icon
  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat
  const isRepeatActive = repeatMode !== 'off'

  return (
    <div
      ref={containerRef}
      inert={!isNowPlayingOpen}
      aria-hidden={!isNowPlayingOpen}
      className={`mobile-fullview-overlay fixed inset-0 h-[100dvh] max-h-[100dvh] z-[100] flex flex-col select-none overflow-hidden touch-manipulation transition-all duration-350 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        isNowPlayingOpen
          ? 'translate-y-0 opacity-100 pointer-events-auto'
          : 'translate-y-full opacity-0 pointer-events-none'
      }`}
      style={{
        transformOrigin: 'bottom center',
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
        <button
          type="button"
          aria-label="Đóng trình phát toàn màn hình"
          onClick={closeNowPlayingOverlay}
          className="w-16 h-7 flex items-center justify-center -my-2.5 cursor-pointer active:scale-95 group focus:outline-none"
        >
          <span className="w-10 h-1 rounded-full bg-white/40 group-hover:bg-white/60 transition-all" />
        </button>
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
              aria-label={currentTrack.is_favorite ? "Bỏ yêu thích" : "Thêm yêu thích"}
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
              aria-label="Tùy chọn bài hát"
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
        <MobileTabTransition activeTab={activeTab} direction={tabDirection}>

        {/* ─── TAB 1: COVER ART VIEW ─── */}
        {activeTab === 'cover' && (
          <div className="flex-1 flex flex-col justify-center px-6 sm:px-8 gap-6 overflow-hidden">
            {/* Large Cover Art — stagger entrance */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, transform: 'scale(0.92)' }}
              animate={{ opacity: 1, transform: 'scale(1)' }}
              transition={{ duration: 0.4, delay: 0.1, ease: [0.32, 0.72, 0, 1] }}
              className="w-full aspect-square max-w-[min(85vw,380px)] mx-auto rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.6)] will-change-transform"
            >
              <TrackCoverImage
                src={currentTrack.cover_url}
                alt={currentTrack.title}
                className="w-full h-full object-cover"
              />
            </motion.div>

            {/* Song Info Row — stagger entrance */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, transform: 'translateY(12px)' }}
              animate={{ opacity: 1, transform: 'translateY(0px)' }}
              transition={{ duration: 0.3, delay: 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="flex items-start justify-between gap-3 px-1"
            >
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
                  aria-label={currentTrack.is_favorite ? "Bỏ yêu thích" : "Thêm yêu thích"}
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
                  aria-label="Tùy chọn bài hát"
                  type="button"
                  onClick={() => setShowMenuSheet(true)}
                  className="p-1.5 text-white/45 hover:text-white/75 active:scale-90 transition-all cursor-pointer"
                >
                  <MoreHorizontal className="w-[22px] h-[22px]" />
                </button>
              </div>
            </motion.div>
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
                onTouchStart={handleLyricsUserScroll}
                onTouchEnd={handleLyricsUserScroll}
                onWheel={handleLyricsUserScroll}
                onScroll={handleLyricsUserScroll}
                className="w-full h-full overflow-y-auto overflow-x-hidden no-scrollbar flex flex-col gap-5 py-24 px-1 touch-pan-y"
                style={{
                  maskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 88%, transparent 100%)',
                }}
              >
                {lyrics.map((line, idx) => {
                  const isActive = idx === activeIndex
                  const isSyncedMode = isSynced && activeIndex >= 0
                  const distance = isSyncedMode ? Math.abs(idx - activeIndex) : 99
                  const isNearby = distance <= 1

                  let opacity = 1.0
                  let scale = 1.0

                  if (!isSyncedMode) {
                    opacity = 0.95
                  } else if (isActive) {
                    opacity = 1.0
                    scale = 1.02
                  } else {
                    const isPast = idx < activeIndex

                    if (distance === 1) {
                      opacity = isPast ? 0.45 : 0.4
                    } else if (distance === 2) {
                      opacity = isPast ? 0.3 : 0.25
                    } else {
                      opacity = isPast ? 0.2 : 0.15
                    }
                  }

                  const hasRomaji = showTranslation && Boolean(line.romaji) && line.romaji !== line.text

                  // Heuristic for word-wrap on narrow mobile viewports (~28-34 chars/line)
                  const textLen = line.text?.length || 0
                  let intrinsicHeight = textLen > 70 ? 92 : textLen > 35 ? 68 : 48
                  if (hasRomaji) {
                    intrinsicHeight += (line.romaji && line.romaji.length > 40) ? 44 : 28
                  }

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
                        transform: `scale(${scale})`,
                        transformOrigin: 'left center',
                        willChange: (isActive || isNearby) ? 'opacity, transform' : 'auto',
                        contentVisibility: (isActive || distance <= 6) ? 'visible' : 'auto',
                        containIntrinsicSize: `auto ${intrinsicHeight}px`,
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
                  aria-label="Bật/Tắt phiên âm Romaji"
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
                  aria-label="Chia sẻ lời bài hát"
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
                aria-label={isShuffle ? "Tắt phát ngẫu nhiên" : "Bật phát ngẫu nhiên"}
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
                aria-label="Chế độ lặp lại"
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
        </MobileTabTransition>
      </main>

      {/* ══════════════════════════════════════════════════════════════════
          🎛️ SHARED CONTROLS FOOTER (Apple Music style)
          ══════════════════════════════════════════════════════════════════ */}
      <footer className="relative z-20 px-6 sm:px-8 pb-1 pt-1 shrink-0">

        {/* ─── Progress Bar (Apple Music: thin track only, no knob) ─── */}
        <div className="flex flex-col gap-0.5 w-full">
          <div
            onClick={handleProgressClick}
            onTouchStart={handleProgressTouchStart}
            onTouchMove={handleProgressTouchMove}
            onTouchEnd={handleProgressTouchEnd}
            className="relative w-full h-6 flex items-center cursor-pointer touch-none"
          >
            {/* Track */}
            <div className="w-full h-[3px] rounded-full overflow-hidden bg-white/[0.22]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: 'rgba(255, 255, 255, 0.92)',
                  transition: isScrubbing ? 'none' : 'width 0.15s linear',
                }}
              />
            </div>
          </div>

          {/* Time labels */}
          <div className="flex items-center justify-between text-[10px] font-semibold tracking-tight text-white/45 px-0.5 -mt-0.5">
            <span>{formatTime(displayTime)}</span>
            <span>{formatNegativeTime(remainingTime)}</span>
          </div>
        </div>

        {/* ─── Playback Controls (Apple style: no backgrounds, pure white icons) ─── */}
        <div className="flex items-center justify-center gap-10 py-2.5">
          {/* Previous */}
          <button
            aria-label="Bài trước"
            type="button"
            onClick={prevTrack}
            className="text-white active:scale-85 active:opacity-60 transition-all cursor-pointer p-2"
          >
            <SkipBack className="w-8 h-8 fill-white" />
          </button>

          {/* Play / Pause */}
          <button
            aria-label={isPlaying ? "Tạm dừng" : "Phát"}
            type="button"
            onClick={togglePlay}
            className="text-white active:scale-85 active:opacity-60 transition-all cursor-pointer p-2"
          >
            {isBuffering ? (
              <Loader2 className="w-12 h-12 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-12 h-12 fill-white" />
            ) : (
              <Play className="w-12 h-12 fill-white ml-1" />
            )}
          </button>

          {/* Next */}
          <button
            aria-label="Bài tiếp theo"
            type="button"
            onClick={nextTrack}
            className="text-white active:scale-85 active:opacity-60 transition-all cursor-pointer p-2"
          >
            <SkipForward className="w-8 h-8 fill-white" />
          </button>
        </div>

        {/* ─── Volume Slider (Apple Music: thin bar only, no knob — supported on iOS via Web Audio GainNode) ─── */}
        <div className="flex items-center gap-3 px-0.5 pb-2">
          <button
            aria-label={volume === 0 ? "Mở tiếng" : "Tắt tiếng"}
            type="button"
            onClick={handleVolumeToggle}
            className="text-white/35 active:scale-90 transition-all cursor-pointer shrink-0"
          >
            {volume === 0 ? <VolumeX className="w-[14px] h-[14px]" /> : <Volume2 className="w-[14px] h-[14px]" />}
          </button>
          {/* Custom volume track (div-based, no knob — Apple Music style) */}
          <div
            className="relative flex-1 h-6 flex items-center cursor-pointer touch-none"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
              setVolume(pct)
            }}
            onTouchStart={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              const touch = e.touches[0]
              const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width))
              setVolume(pct)
            }}
            onTouchMove={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              const touch = e.touches[0]
              const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width))
              setVolume(pct)
            }}
            onTouchEnd={(e) => {
              e.stopPropagation()
            }}
          >
            {/* Volume track */}
            <div className="w-full h-[3px] rounded-full overflow-hidden bg-white/[0.18]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${volume * 100}%`,
                  backgroundColor: 'rgba(255, 255, 255, 0.85)',
                }}
              />
            </div>
          </div>
          <Volume2 className="w-[14px] h-[14px] text-white/35 shrink-0" />
        </div>

        {/* ─── Bottom Tab Bar (Apple Music style) ─── */}
        <div className="flex items-center justify-center gap-16 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
          {/* Lyrics Tab */}
          <button
            aria-label="Lời bài hát"
            type="button"
            onClick={() => switchTab(activeTab === 'lyrics' ? 'cover' : 'lyrics')}
            className={`p-2.5 rounded-full transition-all cursor-pointer active:scale-90 ${
              activeTab === 'lyrics'
                ? 'bg-white/15 text-white'
                : 'text-white/40 hover:text-white/60'
            }`}
            title="Lời bài hát"
          >
            <MessageSquareQuote className="w-5 h-5" />
          </button>


          {/* Queue Tab */}
          <button
            aria-label="Hàng đợi phát"
            type="button"
            onClick={() => switchTab(activeTab === 'queue' ? 'cover' : 'queue')}
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
      <AnimatePresence>
        {showMenuSheet && (
          <motion.div
            key="menu-sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            onClick={() => setShowMenuSheet(false)}
            className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-md flex items-end justify-center p-0"
          >
            <motion.div
              key="menu-sheet-content"
              initial={{ transform: 'translateY(100%)' }}
              animate={{ transform: 'translateY(0%)' }}
              exit={{ transform: 'translateY(100%)' }}
              transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full border-t rounded-t-3xl p-5 shadow-2xl flex flex-col gap-3 max-h-[70vh] pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] bg-[#1a1a1a]/95 backdrop-blur-2xl border-white/15 text-white will-change-transform"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <span className="text-sm font-bold">Tùy chọn bài hát</span>
                <button
                  aria-label="Đóng tùy chọn"
                  type="button"
                  onClick={() => setShowMenuSheet(false)}
                  className="p-1.5 text-white/40 hover:text-white rounded-full bg-white/5"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <button
                aria-label="Chia sẻ trích dẫn lời bài hát"
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
