'use client'

import React, { useEffect, useState, useRef } from 'react'
import { usePlayer } from './PlayerContext'
import { fetchLyricsFromLrclib, LrclibResponse } from '@/lib/lrclib'
import { parseLrc, parsePlainLyrics, findActiveLyricIndex, LyricLine } from '@/lib/lrcParser'
import {
  Headphones,
  RefreshCw,
  Sparkles,
  Mic2,
  AlertCircle,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react'

interface LyricsViewProps {
  onClose?: () => void
  isModal?: boolean
}

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export function LyricsView({ onClose, isModal = false }: LyricsViewProps) {
  const {
    currentTrack,
    currentTime,
    duration,
    seek,
    isPlaying,
    togglePlay,
    nextTrack,
    prevTrack,
  } = usePlayer()

  const [loading, setLoading] = useState(false)
  const [lyricsData, setLyricsData] = useState<LrclibResponse | null>(null)
  const [parsedLyrics, setParsedLyrics] = useState<LyricLine[]>([])
  const [isSynced, setIsSynced] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const activeLineRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const isUserScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 1. Fetch lyrics when currentTrack changes
  useEffect(() => {
    if (!currentTrack) {
      setLyricsData(null)
      setParsedLyrics([])
      setIsSynced(false)
      return
    }

    setErrorMessage(null)
    loadLyricsForTrack(currentTrack.title, currentTrack.artist, currentTrack.duration)
  }, [currentTrack?.id])

  const loadLyricsForTrack = async (title: string, artist?: string | null, duration?: number | null) => {
    setLoading(true)
    setErrorMessage(null)

    try {
      const data = await fetchLyricsFromLrclib({ title, artist, duration })

      if (data) {
        setLyricsData(data)
        if (data.syncedLyrics && data.syncedLyrics.trim().length > 0) {
          const parsed = parseLrc(data.syncedLyrics)
          setParsedLyrics(parsed)
          setIsSynced(true)
        } else if (data.plainLyrics && data.plainLyrics.trim().length > 0) {
          const parsed = parsePlainLyrics(data.plainLyrics)
          setParsedLyrics(parsed)
          setIsSynced(false)
        } else {
          setParsedLyrics([])
          setIsSynced(false)
        }
      } else {
        setLyricsData(null)
        setParsedLyrics([])
        setIsSynced(false)
      }
    } catch (err: any) {
      console.error('Error fetching lyrics:', err)
      setErrorMessage('Khởi tạo lời bài hát thất bại. Vui lòng thử lại.')
    } finally {
      setLoading(false)
    }
  }

  // 2. Track active line index based on currentTime
  useEffect(() => {
    if (!isSynced || parsedLyrics.length === 0) return

    const idx = findActiveLyricIndex(parsedLyrics, currentTime)
    if (idx !== activeIndex) {
      setActiveIndex(idx)
    }
  }, [currentTime, parsedLyrics, isSynced])

  // 3. Smooth 60FPS auto-scroll to active line
  useEffect(() => {
    if (!isSynced || activeIndex < 0 || !activeLineRef.current || !scrollContainerRef.current) return
    if (isUserScrollingRef.current) return

    const activeEl = activeLineRef.current

    // Request animation frame for buttery smooth 60FPS GPU scrolling
    requestAnimationFrame(() => {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [activeIndex, isSynced])

  // Handle user scroll detection
  const handleScroll = () => {
    isUserScrollingRef.current = true
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)

    // Resume auto-scroll after 3 seconds of scroll inactivity
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false
    }, 3000)
  }

  const handleLineClick = (line: LyricLine) => {
    if (line.time >= 0) {
      seek(line.time)
      isUserScrollingRef.current = false
    }
  }

  if (!currentTrack) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-slate-400 p-8 text-center select-none bg-[#07080c]">
        <Headphones className="w-16 h-16 text-cyan-400/60 mb-4 animate-pulse" />
        <h3 className="text-lg font-bold text-slate-200">Chưa có bài hát đang phát</h3>
        <p className="text-xs text-slate-500 mt-1">Hãy chọn một bài hát từ thư viện để xem lời bài hát</p>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden select-none bg-[#07080c] touch-manipulation">
      {/* 🌟 Dynamic Blurred Album Cover Background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        {currentTrack.cover_url ? (
          <img
            src={currentTrack.cover_url}
            alt=""
            className="w-full h-full object-cover blur-3xl scale-125 opacity-25 filter brightness-50"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-emerald-950/40 via-[#0a0c14] to-purple-950/30 blur-2xl" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07080c] via-[#07080c]/85 to-[#07080c]/70" />
      </div>

      {/* 🔝 Lyrics Header */}
      <div className="relative z-10 flex items-center justify-between gap-4 p-4 md:px-6 md:py-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden shadow-lg">
            {currentTrack.cover_url ? (
              <img src={currentTrack.cover_url} alt={currentTrack.title} className="w-full h-full object-cover" />
            ) : (
              <Mic2 className="w-5 h-5 text-[var(--primary-spotify)]" />
            )}
          </div>
          <div className="truncate flex flex-col">
            <h2 className="text-sm md:text-base font-bold text-white truncate flex items-center gap-2">
              <span>{currentTrack.title}</span>
              {isSynced && (
                <span className="text-[9px] md:text-[10px] uppercase font-mono font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                  ✨ Synced
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 truncate">
              {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
            </p>
          </div>
        </div>

        {/* Top Actions: Refresh & Optional Close button */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => loadLyricsForTrack(currentTrack.title, currentTrack.artist, currentTrack.duration)}
            disabled={loading}
            className="w-10 h-10 flex items-center justify-center bg-white/5 active:bg-white/15 text-slate-300 rounded-xl border border-white/10 transition-colors"
            title="Tải lại lời bài hát"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center bg-white/10 active:bg-white/20 text-slate-300 rounded-full border border-white/10 transition-colors"
              title="Đóng lời bài hát"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* 📜 Lyrics Main Content Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto px-4 md:px-8 scrollbar-thin scrollbar-thumb-white/10"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16">
            <RefreshCw className="w-8 h-8 text-[var(--primary-spotify)] animate-spin mb-3" />
            <p className="text-sm font-semibold text-slate-300">Đang tải lời bài hát từ LRCLIB...</p>
          </div>
        ) : parsedLyrics.length > 0 ? (
          <div className="flex flex-col gap-4 py-16 md:py-24 text-center sm:text-left max-w-2xl mx-auto">
            {parsedLyrics.map((line, index) => {
              const isActive = index === activeIndex
              const isPast = index < activeIndex

              return (
                <div
                  key={index}
                  ref={isActive ? activeLineRef : null}
                  onClick={() => handleLineClick(line)}
                  className={`transition-all duration-300 ease-out cursor-pointer rounded-2xl p-3 sm:px-5 sm:py-3.5 select-none transform-gpu origin-center sm:origin-left active:scale-[0.97] ${
                    isActive
                      ? 'scale-[1.05] bg-white/10 border border-cyan-500/40 text-white font-extrabold text-lg sm:text-xl md:text-2xl shadow-xl shadow-cyan-950/50 opacity-100'
                      : isPast
                      ? 'text-slate-400 font-bold text-base sm:text-lg md:text-xl opacity-40 hover:opacity-75'
                      : 'text-slate-300 font-bold text-base sm:text-lg md:text-xl opacity-50 hover:opacity-85'
                  }`}
                >
                  <p
                    className={`transition-colors leading-snug ${
                      isActive
                        ? 'text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-emerald-300 drop-shadow-[0_0_18px_rgba(6,182,212,0.65)]'
                        : ''
                    }`}
                  >
                    {line.text}
                  </p>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16 text-center">
            <AlertCircle className="w-12 h-12 text-slate-600 mb-3" />
            <h4 className="text-base font-bold text-slate-300 mb-1">Không tìm thấy lời bài hát</h4>
            <p className="text-xs text-slate-500 max-w-sm mb-4">
              Bài hát này chưa có dữ liệu trên thư viện LRCLIB hoặc chưa cập nhật.
            </p>
          </div>
        )}
      </div>

      {/* 🎵 BOTTOM PLAYER CONTROLS & SEEK BAR (Thanh tua bài hát & Điều khiển) */}
      <div className="relative z-20 bg-[#0d0f18]/95 backdrop-blur-2xl border-t border-white/10 p-3 md:p-4 flex flex-col gap-2 shrink-0 pb-safe">
        {/* Scrubber Range Slider */}
        <div className="w-full flex items-center gap-3 text-xs font-mono text-slate-400 px-1">
          <span className="w-10 text-right shrink-0">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[var(--primary-spotify)] active:scale-105 transition-transform"
          />
          <span className="w-10 shrink-0">{formatTime(duration)}</span>
        </div>

        {/* Playback Buttons */}
        <div className="flex items-center justify-center gap-6 py-1">
          <button
            onClick={prevTrack}
            className="p-2.5 text-slate-300 active:text-white active:scale-90 transition-transform"
            title="Bài trước"
          >
            <SkipBack className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          <button
            onClick={togglePlay}
            className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-[var(--primary-spotify)] text-black flex items-center justify-center shadow-lg shadow-[var(--theme-glow-shadow)] active:scale-95 transition-transform shrink-0"
            title={isPlaying ? 'Tạm dừng' : 'Phát'}
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 md:w-7 md:h-7 fill-current" />
            ) : (
              <Play className="w-6 h-6 md:w-7 md:h-7 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={nextTrack}
            className="p-2.5 text-slate-300 active:text-white active:scale-90 transition-transform"
            title="Bài tiếp theo"
          >
            <SkipForward className="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </div>
      </div>
    </div>
  )
}
