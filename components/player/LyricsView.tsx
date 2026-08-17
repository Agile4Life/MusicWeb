'use client'

import React, { useEffect, useState, useRef, useCallback, memo } from 'react'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
import { Track } from '@/types'
import { LrclibResponse } from '@/lib/lrclib'
import { getPrimaryLyrics } from '@/lib/lyricsFlow'
import { parseLrc, parsePlainLyrics, findActiveLyricIndex, LyricLine } from '@/lib/lrcParser'
import { fetchLyricsRomaji } from '@/lib/romajiTransliteration'
import { OverflowMarqueeText } from '@/components/common/OverflowMarqueeText'
import { LyricsShareModal } from './LyricsShareModal'
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
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
  Minus,
  Plus,
  Share2,
  Languages,
} from 'lucide-react'

interface ExtendedLyricLine extends LyricLine {
  romaji?: string
}

interface LyricsViewProps {
  onClose?: () => void
  isModal?: boolean
  showControls?: boolean
  showHeader?: boolean
}

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

/* =========================================================================
   ⚡ MEMOIZED LYRIC LINE ITEM (Zero re-render when other lines change)
   ========================================================================= */
interface LyricLineItemProps {
  line: ExtendedLyricLine
  index: number
  isActive: boolean
  distance: number
  isPast: boolean
  showRomaji?: boolean
  onClick: (line: ExtendedLyricLine) => void
  activeLineRefSetter?: (el: HTMLDivElement | null) => void
}

const LyricLineItem = memo(function LyricLineItem({
  line,
  isActive,
  distance,
  isPast,
  showRomaji = true,
  onClick,
  activeLineRefSetter,
}: LyricLineItemProps) {
  let opacity = 1.0
  if (isActive) {
    opacity = 1.0
  } else if (distance === 1) {
    opacity = isPast ? 0.5 : 0.72
  } else if (distance === 2) {
    opacity = isPast ? 0.32 : 0.5
  } else {
    opacity = distance < 0 ? 0.75 : isPast ? 0.18 : 0.3
  }

  const hasRomaji = showRomaji && Boolean(line.romaji) && line.romaji !== line.text

  return (
    <div
      ref={isActive ? activeLineRefSetter : undefined}
      onClick={() => onClick(line)}
      className={`cursor-pointer rounded-2xl select-none origin-left group/line relative transform-gpu will-change-transform will-change-opacity transition-all duration-300 ease-out flex flex-col ${
        isActive
          ? 'active-lyric-pill py-2.5 sm:py-3.5 px-4 sm:px-6 bg-white/[0.05] border border-white/10 backdrop-blur-xl shadow-[0_10px_30px_rgba(0,0,0,0.35),0_0_20px_color-mix(in_srgb,var(--spotify-glow,#22d3ee)_12%,transparent)]'
          : 'py-1 sm:py-1.5 px-3 sm:px-5 bg-transparent border border-transparent hover:bg-white/[0.02] hover:border-white/[0.04]'
      }`}
      style={{
        opacity,
        transform: isActive ? 'translate3d(10px, 0, 0)' : 'translate3d(0, 0, 0)',
        contentVisibility: distance > 8 ? 'auto' : 'visible',
        containIntrinsicSize: distance > 8 ? '0 44px' : undefined,
      }}
    >
      <p
        className={`leading-snug transition-all duration-300 ease-out ${
          isActive
            ? 'text-[clamp(1.25rem,3.2vh,2.65rem)] font-black text-white bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-[var(--spotify-glow,#22d3ee)] drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]'
            : distance === 1
              ? 'text-[clamp(1rem,2.2vh,1.65rem)] font-bold text-slate-100 group-hover/line:text-white'
              : distance === 2
                ? 'text-[clamp(0.85rem,1.8vh,1.3rem)] font-semibold text-slate-300 group-hover/line:text-slate-100'
                : 'text-[clamp(0.85rem,1.8vh,1.3rem)] font-medium text-slate-400 group-hover/line:text-slate-200'
        }`}
      >
        {line.text}
      </p>
      {hasRomaji && (
        <p
          className={`text-xs sm:text-sm font-semibold mt-0.5 tracking-wide transition-all duration-300 ${
            isActive ? 'text-[var(--spotify-glow,#22d3ee)]' : 'text-slate-400/80'
          }`}
        >
          {line.romaji}
        </p>
      )}
    </div>
  )
}, (prev, next) => {
  return (
    prev.isActive === next.isActive &&
    prev.distance === next.distance &&
    prev.isPast === next.isPast &&
    prev.showRomaji === next.showRomaji &&
    prev.line.text === next.line.text &&
    prev.line.romaji === next.line.romaji
  )
})

/* =========================================================================
   ⚡ ISOLATED SEEKBAR & CONTROLS (Only this re-renders on audio tick)
   ========================================================================= */
const LyricsBottomControls = memo(function LyricsBottomControls() {
  const { currentTime, duration } = usePlaybackProgress()
  const {
    currentTrack,
    seek,
    isPlaying,
    togglePlay,
    nextTrack,
    prevTrack,
    isShuffle,
    toggleShuffle,
    repeatMode,
    toggleRepeat,
    volume,
    setVolume,
    toggleFavoriteCurrentTrack,
  } = usePlayer()

  const [prevVol, setPrevVol] = useState(0.8)

  const handleVolumeToggle = () => {
    if (volume > 0) {
      setPrevVol(volume)
      setVolume(0)
    } else {
      setVolume(prevVol || 0.8)
    }
  }

  if (!currentTrack) return null

  return (
    <div className="relative z-20 bg-black/50 backdrop-blur-2xl border-t border-white/10 px-4 sm:px-8 py-3.5 flex flex-col sm:flex-row items-center justify-between text-slate-300 select-none shrink-0 gap-3">
      {/* Left: Track Metadata (Desktop) */}
      <div className="hidden sm:flex items-center gap-3 w-1/4 min-w-[200px]">
        <div className="w-11 h-11 bg-slate-900 rounded-xl overflow-hidden relative flex items-center justify-center border border-white/15 shadow-md shrink-0">
          {currentTrack.cover_url ? (
            <img
              src={currentTrack.cover_url}
              alt={currentTrack.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <Headphones className="w-5 h-5 text-[var(--spotify-glow,#22d3ee)]" />
          )}
        </div>

        <div className="truncate flex flex-col min-w-0">
          <p className="text-xs sm:text-sm font-extrabold text-white truncate hover:text-[var(--spotify-glow,#22d3ee)] transition-colors cursor-pointer">
            {currentTrack.title}
          </p>
          <p className="text-[11px] font-semibold text-slate-400 truncate hover:text-slate-200 transition-colors cursor-pointer">
            {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
          </p>
        </div>

        <button
          onClick={toggleFavoriteCurrentTrack}
          className={`p-2 rounded-xl transition-all ml-1 shrink-0 ${
            currentTrack.is_favorite
              ? 'text-rose-400 bg-rose-500/20 border border-rose-500/40 shadow-lg'
              : 'text-slate-400 hover:text-rose-400 hover:bg-white/10'
          }`}
          title={currentTrack.is_favorite ? 'Bỏ khỏi bài hát yêu thích' : 'Thêm vào bài hát yêu thích'}
        >
          <Heart
            className={`w-4 h-4 transition-all ${
              currentTrack.is_favorite ? 'fill-current drop-shadow-[0_0_10px_rgba(244,63,94,0.7)]' : ''
            }`}
          />
        </button>
      </div>

      {/* Center: Playback Controls & Seekbar */}
      <div className="flex flex-col items-center gap-2 w-full sm:w-2/4 max-w-xl">
        <div className="flex items-center gap-5">
          <button
            onClick={toggleShuffle}
            style={
              isShuffle
                ? {
                    color: 'var(--spotify-glow, #22d3ee)',
                    backgroundColor: 'rgba(6,182,212,0.15)',
                    borderColor: 'rgba(6,182,212,0.4)',
                  }
                : undefined
            }
            className={`p-2 rounded-xl relative transition-all active:scale-90 ${
              isShuffle ? 'border shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/10'
            }`}
            title={isShuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
          >
            <Shuffle className="w-4 h-4" />
          </button>

          <button
            onClick={prevTrack}
            className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-full transition-all active:scale-90"
            title="Bài trước"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={togglePlay}
            style={{
              background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
              boxShadow: '0 4px 18px rgba(6,182,212,0.45)',
            }}
            className="w-11 h-11 rounded-full hover:scale-[1.08] hover:shadow-[0_0_30px_rgba(6,182,212,0.45)] active:scale-95 transition-all flex items-center justify-center text-black font-extrabold shrink-0 border border-white/30"
            title={isPlaying ? 'Tạm dừng' : 'Phát'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current text-black" />
            ) : (
              <Play className="w-5 h-5 fill-current text-black ml-0.5" />
            )}
          </button>

          <button
            onClick={nextTrack}
            className="p-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-full transition-all active:scale-90"
            title="Bài tiếp theo"
          >
            <SkipForward className="w-5 h-5" />
          </button>

          <button
            onClick={toggleRepeat}
            style={
              repeatMode !== 'off'
                ? {
                    color: 'var(--spotify-glow, #22d3ee)',
                    backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                    borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.4))',
                  }
                : undefined
            }
            className={`p-2 rounded-xl relative transition-all active:scale-90 ${
              repeatMode !== 'off' ? 'border shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/10'
            }`}
            title={
              repeatMode === 'one'
                ? 'Lặp lại 1 bài'
                : repeatMode === 'all'
                  ? 'Lặp lại toàn bộ danh sách'
                  : 'Bật lặp lại bài hát'
            }
          >
            {repeatMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
          </button>
        </div>

        {/* Seekbar Progress */}
        <div className="w-full flex items-center gap-3 text-[11px] text-slate-400 font-mono">
          <span className="w-9 text-right shrink-0 font-bold">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            style={{
              background: `linear-gradient(to right, var(--primary-spotify,#06b6d4) ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.15) ${(currentTime / (duration || 1)) * 100}%)`,
            }}
            className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer outline-none transition-all hover:h-2"
          />
          <span className="w-9 shrink-0 font-bold">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: Volume Control (Desktop) */}
      <div className="hidden sm:flex w-1/4 justify-end items-center">
        <div className="flex items-center gap-2.5 bg-white/[0.06] border border-white/10 rounded-full px-3.5 py-1 shadow-md">
          <button
            onClick={handleVolumeToggle}
            className="text-slate-300 hover:text-white transition-colors p-0.5"
            title={volume === 0 ? 'Mở tiếng' : 'Tắt tiếng'}
          >
            {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <div className="volume-track-wrapper w-16 md:w-24">
            <div className="volume-track">
              <div className="volume-fill" style={{ width: `${volume * 100}%` }} />
              <div className="volume-thumb" style={{ left: `${volume * 100}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
          </div>
        </div>
      </div>
    </div>
  )
})

/* =========================================================================
   ⚡ MAIN LYRICS VIEW COMPONENT
   ========================================================================= */
export const LyricsView = memo(function LyricsView({
  onClose,
  isModal = false,
  showControls = true,
  showHeader = true,
}: LyricsViewProps) {
  const { currentTime } = usePlaybackProgress()
  const { currentTrack, seek, mvIntroOffset } = usePlayer()

  const [loading, setLoading] = useState(false)
  const [, setLyricsData] = useState<LrclibResponse | null>(null)
  const [parsedLyrics, setParsedLyrics] = useState<ExtendedLyricLine[]>([])
  const [showRomaji, setShowRomaji] = useState(true)
  const [isSynced, setIsSynced] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [lyricOffset, setLyricOffset] = useState(0) // Default 0.0s
  const [, setErrorMessage] = useState<string | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)

  const activeLineRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const isUserScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lyricsReqIdRef = useRef(0)
  const lastLyricCheckRef = useRef(0)

  const loadLyricsForTrack = useCallback(async (
    title: string,
    artist?: string | null,
    album?: string | null,
    duration?: number | null,
    youtubeId?: string | null,
    nhaccuatuiId?: string | null,
    source?: Track['source'],
  ) => {
    const reqId = ++lyricsReqIdRef.current
    setLoading(true)
    setErrorMessage(null)

    try {
      const data = await getPrimaryLyrics({
        title,
        artist,
        album,
        duration: duration || 0,
        youtube_id: youtubeId || undefined,
        nhaccuatui_id: nhaccuatuiId || undefined,
        source: source || undefined,
      })

      if (reqId !== lyricsReqIdRef.current) return

      if (data) {
        setLyricsData(data)
        let parsed: ExtendedLyricLine[] = []
        if (data.syncedLyrics && data.syncedLyrics.trim().length > 0) {
          parsed = parseLrc(data.syncedLyrics)
          setParsedLyrics(parsed)
          setIsSynced(true)
        } else if (data.plainLyrics && data.plainLyrics.trim().length > 0) {
          parsed = parsePlainLyrics(data.plainLyrics)
          setParsedLyrics(parsed)
          setIsSynced(false)
        } else {
          setParsedLyrics([])
          setIsSynced(false)
        }

        // Asynchronously fetch Romaji
        if (parsed.length > 0) {
          fetchLyricsRomaji(parsed.map((p) => p.text)).then((romajiResults) => {
            if (reqId === lyricsReqIdRef.current && romajiResults.length === parsed.length) {
              setParsedLyrics(
                parsed.map((line, idx) => ({
                  ...line,
                  romaji: romajiResults[idx] || '',
                }))
              )
            }
          }).catch(() => {})
        }
      } else {
        setLyricsData(null)
        setParsedLyrics([])
        setIsSynced(false)
      }
    } catch {
      if (reqId !== lyricsReqIdRef.current) return
      setErrorMessage('Không thể tải lời bài hát')
      setParsedLyrics([])
      setIsSynced(false)
    } finally {
      if (reqId === lyricsReqIdRef.current) setLoading(false)
    }
  }, [])

  // 1. Fetch lyrics when currentTrack changes
  useEffect(() => {
    if (!currentTrack) {
      setLyricsData(null)
      setParsedLyrics([])
      setIsSynced(false)
      setActiveIndex(-1)
      setLyricOffset(0)
      return
    }

    setErrorMessage(null)
    setActiveIndex(-1)
    setLyricOffset(0)
    loadLyricsForTrack(
      currentTrack.title,
      currentTrack.artist,
      currentTrack.album,
      currentTrack.duration,
      currentTrack.youtube_id,
      currentTrack.nhaccuatui_id,
      currentTrack.source,
    )
  }, [
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.album,
    currentTrack?.duration,
    currentTrack?.youtube_id,
    currentTrack?.nhaccuatui_id,
    currentTrack?.source,
    loadLyricsForTrack,
  ])

  // 2. High-Performance Active Lyric Finder (Throttled calculation, zero state churn)
  useEffect(() => {
    if (!isSynced || parsedLyrics.length === 0) return

    const now = performance.now()
    if (now - lastLyricCheckRef.current < 60) return
    lastLyricCheckRef.current = now

    const index = findActiveLyricIndex(parsedLyrics, currentTime, lyricOffset - (mvIntroOffset || 0))
    setActiveIndex((prev) => (prev !== index ? index : prev))
  }, [currentTime, parsedLyrics, isSynced, lyricOffset, mvIntroOffset])

  // 3. Ultra-Smooth Hardware Accelerated Scroll
  useEffect(() => {
    if (activeIndex < 0 || !isSynced || isUserScrollingRef.current) return

    const rafId = requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      const activeLine = activeLineRef.current

      if (container && activeLine) {
        const targetScroll = activeLine.offsetTop - container.clientHeight * 0.38 + activeLine.clientHeight / 2
        container.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: 'smooth',
        })
      }
    })

    return () => cancelAnimationFrame(rafId)
  }, [activeIndex, isSynced])

  // Handle user scroll detection
  const handleScroll = useCallback(() => {
    isUserScrollingRef.current = true
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)

    // Resume auto-scroll after 3 seconds of scroll inactivity
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false
    }, 3000)
  }, [])

  const handleLineClick = useCallback((line: LyricLine) => {
    if (line.time >= 0) {
      const targetTime = Math.max(0, line.time - lyricOffset + (mvIntroOffset || 0))
      seek(targetTime)
      isUserScrollingRef.current = false
    }
  }, [lyricOffset, mvIntroOffset, seek])

  const activeLineRefSetter = useCallback((el: HTMLDivElement | null) => {
    activeLineRef.current = el
  }, [])

  if (!currentTrack) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-slate-400 p-8 text-center select-none bg-[#07080c]">
        <Headphones className="w-16 h-16 text-[var(--spotify-glow,#22d3ee)]/60 mb-4 animate-pulse" />
        <h3 className="text-lg font-bold text-slate-200">Chưa có bài hát đang phát</h3>
        <p className="text-xs text-slate-500 mt-1">Hãy chọn một bài hát từ thư viện để xem lời bài hát</p>
      </div>
    )
  }

  return (
    <div className={`relative w-full h-full flex flex-col overflow-hidden select-none touch-manipulation transform-gpu ${isModal ? 'bg-[#07090e] now-playing-bg' : 'bg-transparent'}`}>
      {/* 🌟 Rich Ambient Glassmorphic Background (only when standalone modal) */}
      {isModal && (
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          {currentTrack.cover_url ? (
            <img
              src={currentTrack.cover_url}
              alt=""
              className="w-full h-full object-cover blur-3xl opacity-30 scale-125 transform-gpu transition-all duration-700"
            />
          ) : (
            <div className="w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[var(--theme-gradient-1,rgba(6,182,212,0.25))] via-[#0a0d14] to-[#07090e]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-[#07090e]/70 via-[#07090e]/85 to-[#07090e]" />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 30%, var(--accent-dim), transparent 70%)' }} />
        </div>
      )}

      {/* 🔝 Glassmorphic Header */}
      {showHeader && (
        <div className="relative z-20 flex items-center justify-between gap-3 p-3 sm:p-4 md:px-8 md:py-4 border-b border-white/[0.08] shrink-0 bg-black/40 backdrop-blur-2xl shadow-lg">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-slate-900 border border-white/15 flex items-center justify-center shrink-0 overflow-hidden shadow-xl relative group">
              {currentTrack.cover_url ? (
                <img src={currentTrack.cover_url} alt={currentTrack.title} className="w-full h-full object-cover" />
              ) : (
                <Mic2 style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-5 h-5" />
              )}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2.5 min-w-0">
                <OverflowMarqueeText
                  text={currentTrack.title}
                  className="text-xs sm:text-sm md:text-base font-extrabold text-white tracking-tight flex-1 min-w-0"
                />
                {isSynced ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[var(--accent,#06b6d4)]/10 text-[var(--spotify-glow,#22d3ee)] border border-[var(--accent,#06b6d4)]/25 shrink-0 shadow-[0_0_12px_var(--theme-glow-shadow)] flex items-center gap-1.5 leading-none">
                    <Sparkles className="w-3 h-3 text-[var(--spotify-glow,#22d3ee)] shrink-0" />
                    Synced
                  </span>
                ) : parsedLyrics.length > 0 ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/40 shrink-0 leading-none">
                    Text
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] font-semibold text-slate-400 truncate mt-0.5 w-full">
                {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
              </p>
            </div>
          </div>

          {/* Top Right Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {isSynced && (
              <div className="flex items-center gap-1 bg-white/[0.06] backdrop-blur-md rounded-full border border-white/10 px-2 py-1 shadow-inner">
                <button
                  onClick={() => setLyricOffset((prev) => +(prev - 0.1).toFixed(1))}
                  className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 rounded-full transition-all active:scale-90"
                  title="Lời hiển thị sớm hơn 100ms"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-[10px] font-mono font-bold text-[var(--spotify-glow,#22d3ee)] min-w-[36px] text-center" title="Bù lệch thời gian (giây)">
                  {lyricOffset >= 0 ? '+' : ''}{lyricOffset.toFixed(1)}s
                </span>
                <button
                  onClick={() => setLyricOffset((prev) => +(prev + 0.1).toFixed(1))}
                  className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 rounded-full transition-all active:scale-90"
                  title="Lời hiển thị muộn hơn 100ms"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            )}

            <button
              onClick={() => setShowRomaji((prev) => !prev)}
              className={`px-2.5 py-1 rounded-full border text-xs font-bold transition-all flex items-center gap-1 shrink-0 ${
                showRomaji
                  ? 'bg-white/15 text-white border-white/25 shadow-sm'
                  : 'text-slate-400 hover:text-white bg-white/5 border-white/10'
              }`}
              title="Bật/Tắt phiên âm Romaji"
            >
              <Languages className="w-3.5 h-3.5" />
              <span className="text-[10px]">Romaji</span>
            </button>

            <button
              onClick={() => setShowShareModal(true)}
              disabled={parsedLyrics.length === 0}
              className="w-9 h-9 flex items-center justify-center bg-white/[0.06] hover:bg-white/15 active:scale-95 text-slate-200 hover:text-[var(--spotify-glow,#22d3ee)] rounded-full border border-white/10 transition-all shrink-0 shadow-md disabled:opacity-40 disabled:pointer-events-none"
              title="Chia sẻ câu hát (Lyrics Story)"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => loadLyricsForTrack(currentTrack.title, currentTrack.artist, currentTrack.album, currentTrack.duration, currentTrack.youtube_id, currentTrack.nhaccuatui_id, currentTrack.source)}
              disabled={loading}
              className="w-9 h-9 flex items-center justify-center bg-white/[0.06] hover:bg-white/15 active:scale-95 text-slate-200 rounded-full border border-white/10 transition-all shrink-0 shadow-md"
              title="Tải lại lời bài hát"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[var(--spotify-glow,#22d3ee)]' : ''}`} />
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-full border border-white/15 transition-all shrink-0 shadow-md"
                title="Đóng lời bài hát"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 📜 Main Lyrics Scroll Area (GPU Composited Layer) */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-8 md:px-12 pt-6 pb-8 no-scrollbar transform-gpu will-change-scroll"
        style={{
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-20">
            <div className="w-12 h-12 rounded-full bg-[var(--primary-spotify,#06b6d4)]/10 border border-[var(--primary-spotify,#06b6d4)]/30 flex items-center justify-center mb-4 shadow-xl shadow-black/40">
              <RefreshCw className="w-6 h-6 text-[var(--spotify-glow,#22d3ee)] animate-spin" />
            </div>
            <p className="text-sm font-extrabold text-white tracking-wide">Đang tải lời bài hát từ thư viện...</p>
          </div>
        ) : parsedLyrics.length > 0 ? (
          <div className="flex flex-col gap-2 pt-12 pb-28 md:pt-16 md:pb-36 text-center sm:text-left max-w-3xl mx-auto transform-gpu">
            {parsedLyrics.map((line, index) => {
              const isActive = index === activeIndex
              const distance = activeIndex >= 0 ? Math.abs(index - activeIndex) : -1
              const isPast = activeIndex >= 0 && index < activeIndex

              return (
                <LyricLineItem
                  key={`${index}-${line.time}`}
                  line={line}
                  index={index}
                  isActive={isActive}
                  distance={distance}
                  isPast={isPast}
                  showRomaji={showRomaji}
                  onClick={handleLineClick}
                  activeLineRefSetter={activeLineRefSetter}
                />
              )
            })}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4 shadow-xl">
              <AlertCircle className="w-8 h-8 text-slate-400" />
            </div>
            <h4 className="text-base font-extrabold text-white mb-1">Chưa có dữ liệu lời bài hát</h4>
            <p className="text-xs text-slate-400 max-w-sm">
              Bài hát này chưa có bản ghi lời trên thư viện LRCLIB hoặc đang được cập nhật.
            </p>
          </div>
        )}
      </div>

      {/* 🎵 Bottom Glassmorphic Player Controls & Seekbar (Isolated 60FPS re-render) */}
      {showControls && <LyricsBottomControls />}

      {/* Floating Share Button when header is hidden */}
      {!showHeader && parsedLyrics.length > 0 && (
        <div className="absolute top-4 right-4 z-30">
          <button
            onClick={() => setShowShareModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 hover:bg-white/15 active:scale-95 text-slate-300 hover:text-white border border-white/15 backdrop-blur-xl shadow-lg transition-all text-xs font-bold"
            title="Chia sẻ câu hát"
          >
            <Share2 className="w-3.5 h-3.5 text-[var(--spotify-glow,#22d3ee)]" />
            <span className="hidden sm:inline">Chia sẻ</span>
          </button>
        </div>
      )}

      {/* 🚀 Lyrics Share Modal */}
      {showShareModal && currentTrack && (
        <LyricsShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          track={currentTrack}
          lyrics={parsedLyrics}
          initialActiveIndex={activeIndex}
        />
      )}
    </div>
  )
})
