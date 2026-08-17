'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
import { useTheme } from '../theme/ThemeContext'
import { TrackCoverImage } from '../common/TrackCoverImage'
import { OverflowMarqueeText } from '../common/OverflowMarqueeText'
import { ArtistLinks } from '../common/ArtistLinks'
import { LyricsShareModal } from './LyricsShareModal'
import { getPrimaryLyrics } from '@/lib/lyricsFlow'
import { parseLrc, parsePlainLyrics, findActiveLyricIndex, LyricLine } from '@/lib/lrcParser'
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Heart,
  Star,
  MoreHorizontal,
  Volume2,
  VolumeX,
  Languages,
  Mic2,
  Sparkles,
  DiscAlbum,
  ListMusic,
  Share2,
  Loader2,
  X,
} from 'lucide-react'

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
    toggleFavoriteCurrentTrack,
    closeNowPlayingOverlay,
    toggleQueue,
    isQueueOpen,
  } = usePlayer()

  const { themeStyle, currentTheme } = useTheme()

  // Gesture Pull to Dismiss
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const touchStartYRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Lyrics state
  const [lyrics, setLyrics] = useState<LyricLine[]>([])
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [showTranslation, setShowTranslation] = useState(true)
  const [showMenuSheet, setShowMenuSheet] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareLyrics, setShareLyrics] = useState<LyricLine[]>([])

  // Auto-scroll management
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement | null>(null)
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isUserScrollingRef = useRef(false)

  // Fetch lyrics whenever currentTrack changes
  useEffect(() => {
    if (!currentTrack) {
      setLyrics([])
      return
    }

    let isMounted = true
    setLyricsLoading(true)

    getPrimaryLyrics({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      duration: currentTrack.duration,
      youtube_id: currentTrack.youtube_id,
      nhaccuatui_id: currentTrack.nhaccuatui_id,
    })
      .then((res) => {
        if (!isMounted) return
        if (res?.syncedLyrics) {
          const parsed = parseLrc(res.syncedLyrics)
          setLyrics(parsed)
          setShareLyrics(parsed)
        } else if (res?.plainLyrics) {
          const parsed = parsePlainLyrics(res.plainLyrics)
          setLyrics(parsed)
          setShareLyrics(parsed)
        } else {
          setLyrics([])
          setShareLyrics([])
        }
      })
      .catch((err) => {
        console.warn('Error fetching mobile fullview lyrics:', err)
        if (isMounted) setLyrics([])
      })
      .finally(() => {
        if (isMounted) setLyricsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [currentTrack?.id])

  // Active lyric index calculation
  const activeIndex = useMemo(() => {
    if (!lyrics || lyrics.length === 0) return -1
    return findActiveLyricIndex(lyrics, currentTime)
  }, [lyrics, currentTime])

  // Smooth Spring Auto-scroll to active line
  useEffect(() => {
    if (isUserScrollingRef.current || activeIndex < 0 || !activeLineRef.current || !scrollContainerRef.current) {
      return
    }

    activeLineRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }, [activeIndex])

  const handleUserScroll = useCallback(() => {
    isUserScrollingRef.current = true
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current)
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false
    }, 3500)
  }, [])

  // Touch Drag to Dismiss Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY
    setIsDragging(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const currentY = e.touches[0].clientY
    const deltaY = currentY - touchStartYRef.current
    if (deltaY > 0) {
      setDragY(deltaY)
    }
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
    if (dragY > 120) {
      closeNowPlayingOverlay()
    }
    setDragY(0)
  }

  const handleLineClick = (line: LyricLine) => {
    if (typeof line.time === 'number') {
      seek(line.time)
    }
  }

  const handleVolumeToggle = () => {
    setVolume(volume > 0 ? 0 : 0.8)
  }

  if (!currentTrack) return null

  const remainingTime = (duration || currentTrack.duration || 0) - currentTime
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  return (
    <div
      ref={containerRef}
      className={`mobile-fullview-overlay fixed inset-0 z-[100] flex flex-col select-none overflow-hidden touch-pan-y ${
        themeStyle === 'minimal-flat' ? 'bg-[#141017] text-[#F4ECE1]' : 'bg-[#07090e] text-white'
      }`}
      style={{
        transform: `translate3d(0, ${dragY}px, 0)`,
        transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* 🌟 1. Theme-Aware Ambient Fluid Background */}
      {themeStyle === 'liquid-glass' && (
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
          {/* Subtle noise grain and dark vignette */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/80" />
        </div>
      )}

      {themeStyle === 'classic' && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 bg-[#07090e]">
          <div
            className="absolute top-0 inset-x-0 h-96 opacity-25 blur-3xl"
            style={{
              background: `radial-gradient(circle at 50% 0%, ${currentTheme.accentColor}, transparent 70%)`,
            }}
          />
        </div>
      )}

      {themeStyle === 'minimal-flat' && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 bg-[#141017]">
          <div className="absolute inset-0 bg-radial from-[#1D1720] to-[#141017] opacity-90" />
        </div>
      )}

      {/* 📱 2. Header: Drag Handle & Mini Track Identity */}
      <header
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative z-20 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] px-4 pb-2 flex flex-col gap-2 shrink-0 cursor-grab active:cursor-grabbing"
      >
        {/* Grabber Bar */}
        <div
          onClick={closeNowPlayingOverlay}
          className="w-10 h-1.5 rounded-full bg-white/30 hover:bg-white/50 active:scale-95 transition-all mx-auto cursor-pointer"
          title="Thu nhỏ"
        />

        {/* Mini Identity Row */}
        <div className="flex items-center justify-between gap-3 mt-1">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Mini Cover Art */}
            <div className="w-11 h-11 rounded-xl bg-slate-900 border border-white/15 overflow-hidden shrink-0 shadow-lg relative">
              <TrackCoverImage src={currentTrack.cover_url} alt={currentTrack.title} />
            </div>

            {/* Title & Artist */}
            <div className="flex flex-col min-w-0 flex-1 pr-1">
              <span
                className={`text-sm font-bold truncate leading-tight ${
                  themeStyle === 'minimal-flat' ? 'font-serif text-[#F4ECE1]' : 'text-white'
                }`}
              >
                {currentTrack.title}
              </span>
              <span
                className={`text-xs truncate leading-tight mt-0.5 ${
                  themeStyle === 'minimal-flat' ? 'text-[#B9AC9C]' : 'text-slate-400'
                }`}
              >
                {currentTrack.artist || 'Nghệ sĩ chưa rõ'}
              </span>
            </div>
          </div>

          {/* Action Cluster: Star / Favorite + More Options */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={toggleFavoriteCurrentTrack}
              className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
              title={currentTrack.is_favorite ? 'Bỏ yêu thích' : 'Yêu thích'}
            >
              <Star
                className={`w-5 h-5 transition-all ${
                  currentTrack.is_favorite
                    ? themeStyle === 'minimal-flat'
                      ? 'text-[#E8A94F] fill-[#E8A94F]'
                      : 'text-amber-400 fill-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                    : 'text-white/60 hover:text-white'
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => setShowMenuSheet(true)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-white/60 hover:text-white active:scale-90 transition-transform cursor-pointer"
              title="Tùy chọn khác"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* 📜 3. Central Stage: Apple Music Kinetic Time-Synced Lyrics */}
      <main className="relative z-10 flex-1 min-h-0 flex flex-col justify-center overflow-hidden px-5 sm:px-6">
        {lyricsLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 my-auto text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin text-[var(--spotify-glow,#22d3ee)]" />
            <span className="text-xs font-semibold">Đang tải lời bài hát...</span>
          </div>
        ) : lyrics.length > 0 ? (
          <div
            ref={scrollContainerRef}
            onScroll={handleUserScroll}
            className="w-full h-full overflow-y-auto no-scrollbar flex flex-col gap-5 sm:gap-6 py-28 touch-pan-y"
            style={{
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
            }}
          >
            {lyrics.map((line, idx) => {
              const isActive = idx === activeIndex
              const distance = activeIndex >= 0 ? Math.abs(idx - activeIndex) : 99

              // Focus blur & opacity calculation based on theme style
              const isLiquid = themeStyle === 'liquid-glass'
              const isMinimal = themeStyle === 'minimal-flat'

              let blurPx = 0
              let opacity = 1.0

              if (isActive) {
                blurPx = 0
                opacity = 1.0
              } else if (distance === 1) {
                blurPx = isLiquid ? 1.0 : 0
                opacity = 0.55
              } else if (distance === 2) {
                blurPx = isLiquid ? 1.8 : 0
                opacity = 0.38
              } else {
                blurPx = isLiquid ? 2.5 : 0
                opacity = 0.22
              }

              return (
                <div
                  key={`${line.time}-${idx}`}
                  ref={isActive ? activeLineRef : undefined}
                  onClick={() => handleLineClick(line)}
                  className={`cursor-pointer select-none origin-left transition-all duration-300 ease-out py-1 px-1 rounded-2xl ${
                    isActive ? 'scale-[1.02]' : 'hover:opacity-80 active:scale-98'
                  }`}
                  style={{
                    opacity,
                    filter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
                    transform: isActive ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  <p
                    className={`leading-snug transition-all duration-300 ${
                      isMinimal ? 'font-serif' : 'font-sans'
                    } ${
                      isActive
                        ? isMinimal
                          ? 'text-2xl sm:text-3xl font-black text-[#F4ECE1] drop-shadow-sm'
                          : 'text-2xl sm:text-3xl font-black text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]'
                        : isMinimal
                          ? 'text-xl sm:text-2xl font-bold text-[#B9AC9C]'
                          : 'text-xl sm:text-2xl font-bold text-white'
                    }`}
                  >
                    {line.text}
                  </p>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 my-auto text-slate-400 text-center px-4">
            <Mic2 className="w-8 h-8 text-slate-500 stroke-[1.5]" />
            <p className="text-sm font-semibold text-white">Chưa có lời đồng bộ cho bài hát này</p>
            <p className="text-xs text-slate-400">Bạn có thể tự tìm kiếm hoặc thưởng thức giai điệu tuyệt vời</p>
          </div>
        )}
      </main>

      {/* 🎛️ 4. Bottom Control Island: Scrubber & Tactile Buttons */}
      <footer className="relative z-20 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] px-5 sm:px-6 pt-2 flex flex-col gap-3 shrink-0">
        {/* Utility Buttons Row */}
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => setShowTranslation((prev) => !prev)}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              showTranslation
                ? themeStyle === 'minimal-flat'
                  ? 'bg-[#E8A94F]/20 text-[#E8A94F] border border-[#E8A94F]/40'
                  : 'bg-white/15 text-white border border-white/20'
                : 'text-white/40 hover:text-white/70'
            }`}
            title="Bật/Tắt chế độ phiên âm/dịch"
          >
            <Languages className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowShareModal(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/60 hover:text-white bg-white/5 border border-white/10 active:scale-95 transition-all cursor-pointer"
            title="Chia sẻ câu hát"
          >
            <Sparkles className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
          </button>
        </div>

        {/* Timeline Precision Scrubber */}
        <div className="flex flex-col gap-1.5 w-full">
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
              seek(pct * (duration || currentTrack.duration || 0))
            }}
            className="relative w-full h-4 flex items-center cursor-pointer group"
          >
            <div className="w-full h-1.5 rounded-full bg-white/15 overflow-hidden relative">
              <div
                className={`h-full rounded-full transition-[width] duration-100 ${
                  themeStyle === 'minimal-flat' ? 'bg-[#E8A94F]' : 'bg-white'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {/* Grabber thumb */}
            <div
              className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full shadow-md transition-transform scale-0 group-hover:scale-100 group-active:scale-100 ${
                themeStyle === 'minimal-flat' ? 'bg-[#E8A94F]' : 'bg-white'
              }`}
              style={{ left: `calc(${progressPercent}% - 7px)` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono tracking-tight font-semibold text-white/50 px-0.5">
            <span>{formatTime(currentTime)}</span>
            <span>{formatNegativeTime(remainingTime)}</span>
          </div>
        </div>

        {/* Main Playback Controls Trio */}
        <div className="flex items-center justify-center gap-9 sm:gap-12 py-1">
          <button
            type="button"
            onClick={prevTrack}
            className="w-12 h-12 flex items-center justify-center text-white/90 active:scale-85 transition-transform cursor-pointer"
            title="Bài trước"
          >
            <SkipBack className="w-7 h-7 sm:w-8 sm:h-8 fill-current" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className={`w-16 h-16 rounded-full flex items-center justify-center text-black active:scale-90 transition-transform shadow-2xl cursor-pointer ${
              themeStyle === 'minimal-flat' ? 'bg-[#E8A94F]' : 'bg-white'
            }`}
            title={isPlaying ? 'Tạm dừng' : 'Phát'}
          >
            {isBuffering ? (
              <Loader2 className="w-8 h-8 animate-spin text-black" />
            ) : isPlaying ? (
              <Pause className="w-8 h-8 fill-current" />
            ) : (
              <Play className="w-8 h-8 fill-current ml-1" />
            )}
          </button>

          <button
            type="button"
            onClick={nextTrack}
            className="w-12 h-12 flex items-center justify-center text-white/90 active:scale-85 transition-transform cursor-pointer"
            title="Bài kế tiếp"
          >
            <SkipForward className="w-7 h-7 sm:w-8 sm:h-8 fill-current" />
          </button>
        </div>

        {/* Volume Slider Row */}
        <div className="flex items-center gap-3 px-2 pt-1">
          <button
            type="button"
            onClick={handleVolumeToggle}
            className="text-white/40 hover:text-white active:scale-90 transition-all cursor-pointer"
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
              background: `linear-gradient(to right, ${
                themeStyle === 'minimal-flat' ? '#E8A94F' : 'rgba(255,255,255,0.9)'
              } ${volume * 100}%, rgba(255,255,255,0.15) ${volume * 100}%)`,
            }}
            className="w-full h-1 rounded-lg appearance-none cursor-pointer outline-none"
          />
          <Volume2 className="w-4 h-4 text-white/40" />
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
            className="w-full bg-[#10141e] border-t border-white/15 rounded-t-3xl p-5 shadow-2xl flex flex-col gap-3 max-h-[70vh] animate-in slide-in-from-bottom-5 duration-200 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <span className="text-sm font-bold text-white">Tùy chọn bài hát</span>
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
              className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/10 text-white text-xs font-semibold transition-all"
            >
              <Share2 className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
              <span>Chia sẻ trích dẫn lời bài hát</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowMenuSheet(false)
                closeNowPlayingOverlay()
                toggleQueue()
              }}
              className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/10 text-white text-xs font-semibold transition-all"
            >
              <ListMusic className="w-4 h-4 text-emerald-400" />
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
          lyrics={shareLyrics}
        />
      )}
    </div>
  )
}
