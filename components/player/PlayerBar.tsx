'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT, SPRING_DELIGHT, modalBackdropProps, modalPanelProps } from '@/lib/motion'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
import { usePlaybackDuration } from './PlaybackProgressStore'
import { LyricsView } from './LyricsView'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
import { OverflowMarqueeText } from '@/components/common/OverflowMarqueeText'
import { ArtistLinks } from '@/components/common/ArtistLinks'
import { setCachedResolvedAlbum, getCachedResolvedAlbum, isRealAlbumName, isKnownBadFallback, makeAlbumCacheKey } from '@/lib/albumCache'
import { cleanDisplayAlbumName } from '@/lib/albumMatching'
import { resolveAlbumDeduped } from '@/lib/albumResolveClient'
import { AudioWaveformScrubber } from './AudioWaveformScrubber'
import { MiniEqualizer } from './MiniEqualizer'
import { PlayerBarGlowBorder } from './PlayerBarGlowBorder'
import {
  trackMetadataArtistInlineClass,
  trackMetadataLoadingClass,
  trackMetadataProgressClass,
  trackMetadataTitleClass,
} from './trackMetadataLayout'
import { isPlayerBarFeatureTarget } from './playerBarInteraction'
import { miniPlayerClassName } from './mobileLayout'
import { LyricsShareModal } from './LyricsShareModal'
import { getPrimaryLyrics } from '@/lib/lyricsFlow'
import { parseLrc, parsePlainLyrics, LyricLine } from '@/lib/lrcParser'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { useTheme } from '@/components/theme/ThemeContext'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music,
  Mic2,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  ListMusic,
  Loader2,
  DiscAlbum,
  Share2,
} from 'lucide-react'

// Only this leaf follows the ticking clock; PlayerBar itself re-renders on duration changes.
function MiniProgressFill({ duration }: { duration: number }) {
  const { currentTime } = usePlaybackProgress()
  const ratio = Math.min(1, Math.max(0, currentTime / Math.max(duration, 1)))
  return (
    <div
      className="h-full w-full bg-[#E8A94F] transition-transform duration-150 ease-linear motion-reduce:transition-none"
      style={{ transform: `scaleX(${ratio})`, transformOrigin: 'left center' }}
    />
  )
}

export function PlayerBar({ isScrolled }: { isScrolled?: boolean } = {}) {
  const { t } = useLanguage()
  const { themeStyle } = useTheme()
  const prefersReducedMotion = useReducedMotion()
  const isLiquidGlass = themeStyle === 'liquid-glass'
  const isMinimalFlat = themeStyle === 'minimal-flat'
  const duration = usePlaybackDuration()
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    volume,
    isShuffle,
    toggleShuffle,
    repeatMode,
    toggleRepeat,
    toggleFavoriteCurrentTrack,
    togglePlay,
    seek,
    setVolume,
    nextTrack,
    prevTrack,
    isQueueOpen,
    toggleQueue,
    isNowPlayingOpen,
    openNowPlayingOverlay,
  } = usePlayer()
  const router = useRouter()

  const [isNavCollapsed, setIsNavCollapsed] = useState(false)

  useEffect(() => {
    const handleNavMode = (e: Event) => {
      const detail = (e as CustomEvent<{ mode: string; isCollapsed: boolean }>).detail
      if (typeof detail?.isCollapsed === 'boolean') {
        setIsNavCollapsed(detail.isCollapsed)
      }
    }
    window.addEventListener('mweb:navbar-mode', handleNavMode)
    return () => window.removeEventListener('mweb:navbar-mode', handleNavMode)
  }, [])

  const [isNavigatingAlbum, setIsNavigatingAlbum] = useState(false)
  const [, setIsResolvingAlbumInfo] = useState(false)
  const [resolvedAlbumInfo, setResolvedAlbumInfo] = useState<{ id?: string; name?: string } | null>(null)

  useEffect(() => {
    // Immediately clear previous track's album info on track change
    setResolvedAlbumInfo(null)
    setIsResolvingAlbumInfo(false)

    if (!currentTrack) {
      return
    }

    const hasRealAlbum = Boolean(
      currentTrack.album &&
      isRealAlbumName(currentTrack.album, currentTrack.title)
    )

    const cached = getCachedResolvedAlbum(currentTrack.title, currentTrack.artist, currentTrack.album)
    if (cached?.albumId && !isKnownBadFallback(cached.albumId)) {
      setResolvedAlbumInfo({
        id: cached.albumId,
        name: cached.albumName,
      })
      return
    }

    if (hasRealAlbum && currentTrack.spotify_album_id && !isKnownBadFallback(currentTrack.spotify_album_id)) {
      setResolvedAlbumInfo({
        id: currentTrack.spotify_album_id,
        name: currentTrack.album!,
      })
      return
    }

    let isCancelled = false
    // ⚡ DEFER ALBUM RESOLUTION: Delay background fetch by 1.5s after track change
    // This ensures 100% of network bandwidth & CPU are dedicated to INSTANT audio streaming
    const timer = setTimeout(() => {
      setIsResolvingAlbumInfo(true)
      const titleToSearch = currentTrack.title || ''
      const artistToSearch = currentTrack.artist || ''
      const albumToSearch = hasRealAlbum ? currentTrack.album! : ''

      resolveAlbumDeduped({ title: titleToSearch, artist: artistToSearch, album: albumToSearch, trackId: currentTrack.id || '' })
        .then((data) => {
          if (isCancelled) return
          setIsResolvingAlbumInfo(false)
          if (data && data.albumId && !isKnownBadFallback(data.albumId)) {
            const finalAlbumName = data.albumName || (hasRealAlbum ? currentTrack.album! : 'Album')
            setResolvedAlbumInfo({
              id: data.albumId,
              name: finalAlbumName,
            })
            if (currentTrack) {
              currentTrack.spotify_album_id = data.albumId
              if (data.albumName) currentTrack.album = data.albumName
            }
            setCachedResolvedAlbum(currentTrack.title, currentTrack.artist, {
              albumId: data.albumId,
              albumName: data.albumName,
            })
          } else {
            setResolvedAlbumInfo(
              hasRealAlbum ? { name: currentTrack.album! } : null
            )
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setIsResolvingAlbumInfo(false)
            setResolvedAlbumInfo(
              hasRealAlbum ? { name: currentTrack.album! } : null
            )
          }
        })
    }, 1500)

    const expectedKey = makeAlbumCacheKey(currentTrack.title, currentTrack.artist)
    const handleAlbumResolved = (e: any) => {
      const detail = e?.detail
      if (!detail || !detail.album?.albumName) return
      const isKeyMatch = detail.key && detail.key === expectedKey
      const isDirectMatch =
        detail.title &&
        currentTrack.title &&
        detail.title.toLowerCase().trim() === currentTrack.title.toLowerCase().trim() &&
        detail.artist &&
        currentTrack.artist &&
        detail.artist.toLowerCase().trim() === currentTrack.artist.toLowerCase().trim()
      if ((isKeyMatch || isDirectMatch) && !isKnownBadFallback(detail.album.albumId)) {
        setResolvedAlbumInfo({
          id: detail.album.albumId,
          name: detail.album.albumName,
        })
        if (detail.album.albumId && !currentTrack.spotify_album_id) {
          currentTrack.spotify_album_id = detail.album.albumId
        }
        if (detail.album.albumName && !hasRealAlbum) {
          currentTrack.album = detail.album.albumName
        }
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('album-resolved', handleAlbumResolved)
    }

    return () => {
      isCancelled = true
      clearTimeout(timer)
      if (typeof window !== 'undefined') {
        window.removeEventListener('album-resolved', handleAlbumResolved)
      }
    }
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.album, currentTrack?.spotify_album_id])

  const rawDisplayAlbumName = resolvedAlbumInfo?.name || (
    currentTrack?.album && isRealAlbumName(currentTrack.album, currentTrack.title)
      ? currentTrack.album
      : undefined
  )
  const displayAlbumName = rawDisplayAlbumName ? cleanDisplayAlbumName(rawDisplayAlbumName) : undefined

  const handleOpenAlbum = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!currentTrack) {
      router.push('/albums')
      return
    }

    if (resolvedAlbumInfo?.id && !isKnownBadFallback(resolvedAlbumInfo.id)) {
      router.push(`/album/${resolvedAlbumInfo.id}`)
      return
    }

    const cached = getCachedResolvedAlbum(currentTrack.title, currentTrack.artist, currentTrack.album)
    if (cached?.albumId && !isKnownBadFallback(cached.albumId)) {
      currentTrack.spotify_album_id = cached.albumId
      if (cached.albumName) currentTrack.album = cached.albumName
      router.push(`/album/${cached.albumId}`)
      return
    }

    const hasRealAlbum = Boolean(
      currentTrack.album &&
      isRealAlbumName(currentTrack.album, currentTrack.title)
    )

    if (hasRealAlbum && currentTrack.spotify_album_id && !isKnownBadFallback(currentTrack.spotify_album_id)) {
      router.push(`/album/${currentTrack.spotify_album_id}`)
      return
    }

    const titleToSearch = currentTrack.title || ''
    const artistToSearch = currentTrack.artist || ''
    const albumToSearch = hasRealAlbum ? currentTrack.album! : ''

    try {
      setIsNavigatingAlbum(true)

      const resolved = await resolveAlbumDeduped({ title: titleToSearch, artist: artistToSearch, album: albumToSearch, trackId: currentTrack.id || '' })
      if (resolved) {
        const data = resolved
        if (data.albumId && !isKnownBadFallback(data.albumId)) {
          setResolvedAlbumInfo({ id: data.albumId, name: data.albumName || currentTrack.album || 'Album' })
          currentTrack.spotify_album_id = data.albumId
          if (data.albumName) {
            currentTrack.album = data.albumName
            setCachedResolvedAlbum(currentTrack.title, currentTrack.artist, {
              albumId: data.albumId,
              albumName: data.albumName,
            })
          }
          router.push(`/album/${data.albumId}`)
          return
        }
      }
    } catch (err) {
      console.warn('Failed to resolve album ID:', err)
    } finally {
      setIsNavigatingAlbum(false)
    }

    if (currentTrack.spotify_album_id && !isKnownBadFallback(currentTrack.spotify_album_id)) {
      router.push(`/album/${currentTrack.spotify_album_id}`)
      return
    }

    const targetQuery = albumToSearch || titleToSearch
    router.push(targetQuery ? `/albums?q=${encodeURIComponent(targetQuery)}` : '/albums')
  }

  const handleOpenArtist = (artistName?: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    const name = artistName || currentTrack?.artist
    if (!name) return
    router.push(`/artist?name=${encodeURIComponent(name)}`)
  }

  const [prevVol, setPrevVol] = useState(0.8)
  const [isDraggingVolume, setIsDraggingVolume] = useState(false)
  const [showLyricsModal, setShowLyricsModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareLyrics, setShareLyrics] = useState<LyricLine[]>([])
  const [, setIsFetchingLyricsForShare] = useState(false)
  const [mounted, setMounted] = useState(false)
  const prevFavRef = useRef<{ id: string | null; fav: boolean }>({ id: null, fav: false })
  const [heartPopping, setHeartPopping] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const id = currentTrack?.id ?? null
    const fav = Boolean(currentTrack?.is_favorite)
    let timer: ReturnType<typeof setTimeout> | null = null
    if (id && prevFavRef.current.id === id && !prevFavRef.current.fav && fav && !prefersReducedMotion) {
      setHeartPopping(true)
      timer = setTimeout(() => setHeartPopping(false), 100)
    }
    prevFavRef.current = { id, fav }
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [currentTrack?.id, currentTrack?.is_favorite, prefersReducedMotion])

  useEffect(() => {
    if (!showLyricsModal) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowLyricsModal(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showLyricsModal])

  const handleOpenShare = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!currentTrack) return
    setIsFetchingLyricsForShare(true)
    try {
      const res = await getPrimaryLyrics({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album,
        duration: currentTrack.duration,
        youtube_id: currentTrack.youtube_id,
        nhaccuatui_id: currentTrack.nhaccuatui_id,
      })
      if (res?.syncedLyrics) {
        setShareLyrics(parseLrc(res.syncedLyrics))
      } else if (res?.plainLyrics) {
        setShareLyrics(parsePlainLyrics(res.plainLyrics))
      } else {
        setShareLyrics([])
      }
    } catch {
      setShareLyrics([])
    } finally {
      setIsFetchingLyricsForShare(false)
      setShowShareModal(true)
    }
  }

  const handleVolumeToggle = () => {
    if (volume > 0) {
      setPrevVol(volume)
      setVolume(0)
    } else {
      setVolume(prevVol || 0.8)
    }
  }

  if (!currentTrack) {
    return (
      <footer
        className={`player-bar hidden lg:grid lg:grid-cols-[minmax(190px,1fr)_minmax(320px,min(560px,42vw))_minmax(220px,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,560px)_minmax(0,1fr)] lg:gap-3 xl:gap-6 h-[84px] xl:h-[92px] py-2 xl:py-2.5 rounded-[37px] px-4 xl:px-6 items-center text-slate-400 select-none shrink-0 pointer-events-auto relative ${isScrolled ? 'is-scrolled' : ''}`}
        style={isLiquidGlass ? {
          background: 'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 40%, hsla(var(--base-h, 224), var(--base-s, 45%), 12%, 0.35) 100%)',
          backdropFilter: 'blur(36px) saturate(220%) brightness(1.06)',
          WebkitBackdropFilter: 'blur(36px) saturate(220%) brightness(1.06)',
          border: '1px solid rgba(255,255,255,0.22)',
          borderTopColor: 'rgba(255,255,255,0.40)',
          boxShadow: '0 20px 50px -10px rgba(0,0,0,0.6), 0 0 40px -4px var(--theme-glow-shadow, rgba(34,211,238,0.2)), inset 0 1px 0 rgba(255,255,255,0.30)',
        } : undefined}
      >
        {/* Inner glass specular gradient */}
        <div aria-hidden="true" className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 'inherit',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 40%)',
            }}
          />
        </div>
        <div className="flex items-center gap-3 min-w-0 relative z-20">
          <div className="w-11 h-11 bg-white/5 rounded-xl flex items-center justify-center text-slate-600 border border-white/5 shrink-0">
            <Music className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-300 truncate">Chưa chọn bài hát</p>
            <p className="text-[10px] text-slate-500 truncate">Chọn một bài hát từ thư viện để phát</p>
          </div>
        </div>

        {/* Desktop Disabled Controls when empty */}
        <div className="flex flex-col items-center gap-2.5 w-full min-w-0 relative z-20">
          <div className="flex items-center gap-3 xl:gap-4 text-slate-600">
            <SkipBack className="w-4 h-4 cursor-not-allowed" />
            <button className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center text-slate-600 cursor-not-allowed border border-white/5">
              <Play className="w-4 h-4 fill-current ml-0.5" />
            </button>
            <SkipForward className="w-4 h-4 cursor-not-allowed" />
          </div>
          <div className="w-full flex items-center gap-2.5 text-[11px] text-slate-600 font-mono">
            <span className="w-9 text-right">0:00</span>
            <div className="flex-1 h-1 bg-white/5 rounded-full" />
            <span className="w-9">0:00</span>
          </div>
        </div>

        <div className="flex justify-end items-center gap-2 text-slate-600 min-w-0 relative z-20">
          <Volume2 className="w-4 h-4 cursor-not-allowed shrink-0" />
          <div className="w-16 xl:w-20 h-1 bg-white/5 rounded-full" />
        </div>
      </footer>
    )
  }

  const playStateKey = isBuffering ? 'buffering' : isPlaying ? 'pause' : 'play'
  const iconSwapMotion = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.14, ease: 'easeOut' as const },
      }
    : {
        initial: { opacity: 0, transform: 'scale(0.84)' },
        animate: { opacity: 1, transform: 'scale(1)' },
        exit: { opacity: 0, transform: 'scale(0.84)' },
        transition: { duration: 0.15, ease: EASE_OUT },
      }

  return (
    <>
      {/* 📱 Mobile Centered Screen Loading Toast */}
      <div className="lg:hidden fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none">
        <AnimatePresence>
          {isBuffering && (!currentTrack.source || currentTrack.source === 'local') && (
            <motion.div
              key="mobile-buffering-toast"
              {...modalPanelProps(prefersReducedMotion)}
              className={`px-6 py-4 flex flex-col items-center justify-center gap-2.5 text-center ${
                isMinimalFlat
                  ? 'bg-[#1D1720] border border-[rgba(232,169,79,0.35)] rounded-[16px] shadow-[0_18px_40px_rgba(0,0,0,0.7)]'
                  : 'bg-[#0a0d14]/95 backdrop-blur-2xl border border-[var(--spotify-glow,#22d3ee)]/40 rounded-2xl shadow-2xl'
              }`}
            >
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center ${
                  isMinimalFlat
                    ? 'bg-[#E8A94F]/15 border border-[#E8A94F]/35'
                    : 'bg-[var(--primary-spotify,#06b6d4)]/10 border border-[var(--primary-spotify,#06b6d4)]/30 shadow-lg'
                }`}
              >
                <Loader2 className={`w-6 h-6 animate-spin ${isMinimalFlat ? 'text-[#E8A94F]' : 'text-[var(--spotify-glow,#22d3ee)]'}`} />
              </div>
              <span className={`text-xs font-extrabold tracking-wide ${isMinimalFlat ? 'text-[#F4ECE1]' : 'text-white'}`}>
                Đang tải bản Lossless...
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 📱 MOBILE FLOATING MINI PLAYER BAR (Visible on < 1024px) */}
      <div
        className="lg:hidden"
        aria-hidden={isNowPlayingOpen ? true : undefined}
        style={{
          transform: prefersReducedMotion
            ? 'none'
            : isNavCollapsed
              ? 'translate3d(0, 72px, 0) scale(0.92)'
              : 'translate3d(0, 0px, 0) scale(1)',
          opacity: isNavCollapsed ? 0 : 1,
          pointerEvents: (isNavCollapsed || isNowPlayingOpen) ? 'none' : 'auto',
          transition: prefersReducedMotion
            ? 'opacity 180ms ease'
            : isNavCollapsed
              ? 'transform 240ms var(--ease-drawer), opacity 220ms var(--ease-drawer)'
              : 'transform 280ms var(--ease-out), opacity 240ms var(--ease-out)',
        }}
      >
        <div
          onClick={openNowPlayingOverlay}
          className={`${miniPlayerClassName} ${
            isMinimalFlat ? '!rounded-[18px] rounded-[18px]' : '!rounded-[37px] rounded-[37px]'
          } select-none cursor-pointer active:scale-[0.97] transition-transform duration-150 ease-[var(--ease-out)] relative overflow-hidden`}
          style={{
            borderRadius: isMinimalFlat ? 18 : 37,
            ...(isMinimalFlat
              ? {
                  background: 'rgba(29, 23, 32, 0.96)',
                  border: '1px solid rgba(244, 236, 230, 0.14)',
                  boxShadow: '0 12px 28px rgba(0, 0, 0, 0.6)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                }
              : {
                  background: 'rgba(255, 255, 255, 0.025)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.12)',
                  backdropFilter: 'blur(16px) saturate(150%)',
                  WebkitBackdropFilter: 'blur(16px) saturate(150%)',
                }),
          }}
        >
          {/* Inner glass specular gradient */}
          {!isMinimalFlat && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 37,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 40%)',
                pointerEvents: 'none',
              }}
            />
          )}
          {!isMinimalFlat ? (
            <PlayerBarGlowBorder duration={duration || currentTrack.duration} rx={34} />
          ) : (
            <div
              aria-hidden="true"
              className="absolute bottom-0 left-0 right-0 h-[2px] bg-[rgba(244,236,230,0.08)] pointer-events-none z-20"
            >
              <MiniProgressFill duration={duration || currentTrack.duration || 1} />
            </div>
          )}
          {/* Main row */}
          <div className="flex items-center gap-2.5 w-full h-[54px] px-3 sm:px-3.5 relative z-10">
            {/* Cover Art */}
            <div
              className={`player-cover w-10 h-10 flex items-center justify-center overflow-hidden shrink-0 relative ${
                isMinimalFlat
                  ? 'rounded-[10px] bg-[#251E29] border border-[rgba(244,236,230,0.14)]'
                  : `rounded-full bg-slate-800 border border-white/10 shadow-md ${isPlaying ? 'is-playing' : ''}`
              }`}
            >
              <TrackCoverImage src={currentTrack.cover_url} alt={currentTrack.title} />
            </div>

            {/* Title + Artist — flex-1 takes remaining space */}
            <motion.div
              key={currentTrack.id}
              initial={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, transform: 'translate3d(0, 4px, 0)' }
              }
              animate={
                prefersReducedMotion
                  ? { opacity: 1 }
                  : { opacity: 1, transform: 'translate3d(0, 0px, 0)' }
              }
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="flex flex-col min-w-0 flex-1 overflow-hidden justify-center pr-1"
            >
              <OverflowMarqueeText
                text={currentTrack.title}
                className={`text-xs font-bold leading-tight ${isMinimalFlat ? 'text-[#F4ECE1]' : 'text-white'} ${trackMetadataTitleClass}`}
              />
              <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                {currentTrack.source === 'soundcloud' && (
                  <span className="px-1 py-0.1 text-[8px] font-black uppercase rounded bg-[#ff5500]/20 text-[#ff7700] border border-[#ff5500]/40 shrink-0">
                    SoundCloud
                  </span>
                )}
                <ArtistLinks
                  artist={currentTrack.artist}
                  className={`text-[10px] truncate leading-tight block ${isMinimalFlat ? 'text-[#B9AC9C]' : 'text-slate-400'}`}
                  linkClassName={`hover:underline transition-colors cursor-pointer ${isMinimalFlat ? 'hover:text-[#F4ECE1]' : 'hover:text-slate-200'}`}
                  onArtistClick={(name, e) => {
                    e.stopPropagation()
                    handleOpenArtist(name, e)
                  }}
                />
              </div>
            </motion.div>

            {/* Compact Controls: Prev + Play/Pause + Next + Heart */}
            <div className="flex items-center shrink-0 gap-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); prevTrack() }}
                className={`w-8 h-8 flex items-center justify-center active:scale-[0.97] transition-[transform,color] duration-150 ease-[var(--ease-out)] rounded-full ${
                  isMinimalFlat ? 'text-[#B9AC9C] hover:text-[#F4ECE1]' : 'text-slate-400 hover:text-white'
                }`}
                title={t('previous')}
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); togglePlay() }}
                className={`player-play-btn w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-[0.97] transition-[transform,filter] duration-150 ease-[var(--ease-out)] ${
                  isMinimalFlat ? 'border border-[rgba(232,169,79,0.5)]' : 'shadow-lg border border-white/20'
                }`}
                style={
                  isMinimalFlat
                    ? {
                        background: '#E8A94F',
                        boxShadow: 'none',
                      }
                    : {
                        background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                        boxShadow: '0 2px 10px var(--theme-glow-shadow, rgba(6,182,212,0.4))',
                      }
                }
                title={isBuffering ? t('buffering') : isPlaying ? t('pause') : t('play')}
                aria-label={isBuffering ? t('buffering') : isPlaying ? t('pause') : t('play')}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={playStateKey}
                    {...iconSwapMotion}
                    className="inline-flex items-center justify-center"
                  >
                    {isBuffering ? (
                      <Loader2 className={`w-4 h-4 animate-spin shrink-0 ${isMinimalFlat ? 'text-[#141017]' : 'text-black'}`} />
                    ) : isPlaying ? (
                      <Pause className={`w-4 h-4 fill-current shrink-0 ${isMinimalFlat ? 'text-[#141017]' : 'text-black'}`} />
                    ) : (
                      <Play className={`w-4 h-4 fill-current ml-0.5 shrink-0 ${isMinimalFlat ? 'text-[#141017]' : 'text-black'}`} />
                    )}
                  </motion.span>
                </AnimatePresence>
              </button>

              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); nextTrack() }}
                className={`w-8 h-8 flex items-center justify-center active:scale-[0.97] transition-[transform,color] duration-150 ease-[var(--ease-out)] rounded-full ${
                  isMinimalFlat ? 'text-[#B9AC9C] hover:text-[#F4ECE1]' : 'text-slate-400 hover:text-white'
                }`}
                title={t('next')}
              >
                <SkipForward className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleFavoriteCurrentTrack() }}
                aria-pressed={Boolean(currentTrack.is_favorite)}
                className={`w-8 h-8 flex items-center justify-center active:scale-[0.97] transition-[transform,color] duration-150 ease-[var(--ease-out)] rounded-full ${currentTrack.is_favorite ? 'is-active' : ''}`}
                title={currentTrack.is_favorite ? t('remove_favorite') : t('add_to_favorite')}
              >
                <motion.span
                  animate={{ transform: heartPopping && !prefersReducedMotion ? 'scale(1.22)' : 'scale(1)' }}
                  transition={heartPopping ? { duration: 0.09, ease: EASE_OUT } : SPRING_DELIGHT}
                  className="inline-flex items-center justify-center"
                >
                  <Heart
                    className={`w-4 h-4 transition-colors duration-150 ${currentTrack.is_favorite
                        ? isMinimalFlat
                          ? 'text-[#E8A94F] fill-current'
                          : 'text-rose-500 fill-current drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]'
                        : isMinimalFlat
                          ? 'text-[#8B8090]'
                          : 'text-slate-500'
                      }`}
                  />
                </motion.span>
              </button>
            </div>
          </div>
        </div>
      </div>


      {/* 💻 DESKTOP PLAYER BAR (Visible on >= 1024px screens) */}
      <footer
        className={`player-bar hidden lg:grid lg:grid-cols-[minmax(190px,1fr)_minmax(320px,min(560px,42vw))_minmax(220px,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,560px)_minmax(0,1fr)] lg:gap-3 xl:gap-6 h-[84px] xl:h-[92px] py-2 xl:py-2.5 rounded-[37px] px-4 xl:px-6 items-center text-slate-300 select-none shrink-0 relative ${isNowPlayingOpen ? 'pointer-events-none' : 'pointer-events-auto'} ${isScrolled ? 'is-scrolled' : ''}`}
        aria-hidden={isNowPlayingOpen ? true : undefined}
        style={isLiquidGlass ? {
          background: 'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 40%, hsla(var(--base-h, 224), var(--base-s, 45%), 12%, 0.35) 100%)',
          backdropFilter: 'blur(36px) saturate(220%) brightness(1.06)',
          WebkitBackdropFilter: 'blur(36px) saturate(220%) brightness(1.06)',
          border: '1px solid rgba(255,255,255,0.22)',
          borderTopColor: 'rgba(255,255,255,0.40)',
          boxShadow: '0 20px 50px -10px rgba(0,0,0,0.6), 0 0 40px -4px var(--theme-glow-shadow, rgba(34,211,238,0.2)), inset 0 1px 0 rgba(255,255,255,0.30)',
        } : undefined}
        onClick={(e) => {
          if (!isPlayerBarFeatureTarget(e.target as { closest?: (selector: string) => unknown })) {
            openNowPlayingOverlay()
          }
        }}
        role="presentation"
      >
        {/* Inner glass specular gradient */}
        <div aria-hidden="true" className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 'inherit',
              background: isLiquidGlass
                ? 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.015) 15%, transparent 40%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 40%)',
            }}
          />
        </div>
        <PlayerBarGlowBorder duration={duration || currentTrack.duration} rx={37} />
        {/* Left: Track Metadata */}
        <div className="flex items-center gap-3 min-w-0 relative z-20">
          <div onClick={openNowPlayingOverlay} className="relative group shrink-0 cursor-pointer" title="Mở Now Playing">
            <div className={`player-cover w-12 h-12 xl:w-14 xl:h-14 rounded-full bg-slate-800 flex items-center justify-center border border-white/10 shadow-md ${isPlaying ? 'is-playing' : ''}`}>
              <TrackCoverImage src={currentTrack.cover_url} alt={currentTrack.title} />
            </div>
          </div>

          <motion.div
            key={currentTrack.id}
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, transform: 'translate3d(0, 4px, 0)' }
            }
            animate={
              prefersReducedMotion
                ? { opacity: 1 }
                : { opacity: 1, transform: 'translate3d(0, 0px, 0)' }
            }
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="truncate flex flex-col flex-1 min-w-0"
          >
            <div className="flex items-center gap-2 min-w-0 max-w-full">
              <div className={`inline-flex items-center gap-1.5 min-w-0 max-w-full ${trackMetadataTitleClass}`}>
                <OverflowMarqueeText
                  text={currentTrack.title}
                  className="text-xs lg:text-sm font-bold text-white hover:text-[var(--spotify-glow)] transition-colors cursor-pointer truncate"
                  title="Mở Now Playing"
                  onClick={openNowPlayingOverlay}
                />
                {currentTrack.source === 'soundcloud' && (
                  <span className="px-1.5 py-0.2 text-[9px] font-black uppercase rounded bg-[#ff5500]/20 text-[#ff7700] border border-[#ff5500]/40 shrink-0">
                    SoundCloud
                  </span>
                )}
                {isPlaying && (
                  <MiniEqualizer isPlaying={isPlaying} className="shrink-0" />
                )}
              </div>
              {isBuffering && (!currentTrack.source || currentTrack.source === 'local') && (
                <span
                  style={{
                    color: 'var(--spotify-glow, #22d3ee)',
                    backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                    borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                  }}
                  className={`${trackMetadataLoadingClass} inline-flex items-center gap-1 text-[10px] font-semibold border px-2 py-0.5 rounded-full`}
                  title="Đang tải bản Lossless..."
                >
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--spotify-glow, #22d3ee)' }} />
                  <span className="min-w-0 truncate">Đang tải bản Lossless...</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 min-w-0">
              <ArtistLinks
                artist={currentTrack.artist}
                className={`${trackMetadataArtistInlineClass} text-[11px] text-slate-400 shrink-0 max-w-[130px] truncate block`}
                linkClassName="hover:underline hover:text-[var(--spotify-glow,#22d3ee)] transition-colors cursor-pointer"
                onArtistClick={(name, e) => handleOpenArtist(name, e)}
                data-playerbar-exclude-fullview
              />

              {/* Album Link Pill with Overflow Marquee Text */}
              <div
                onClick={handleOpenAlbum}
                data-playerbar-exclude-fullview
                className="flex items-center gap-1 min-w-0 max-w-[160px] xl:max-w-[260px] text-[10px] text-slate-300 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 px-2 py-0.5 rounded-md hover:border-[var(--spotify-glow,#22d3ee)]/50 cursor-pointer active:scale-[0.97] transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] group shadow-sm"
                title={displayAlbumName ? `Vào album: ${displayAlbumName}` : 'Vào Album bài hát'}
              >
                {isNavigatingAlbum ? (
                  <Loader2 className="w-3 h-3 animate-spin text-[var(--spotify-glow,#22d3ee)] shrink-0" />
                ) : (
                  <DiscAlbum style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-3 h-3 shrink-0" />
                )}
                <OverflowMarqueeText
                  text={displayAlbumName || 'Album'}
                  className="font-semibold text-slate-200 group-hover:text-[var(--spotify-glow)] transition-colors min-w-0"
                />
              </div>
            </div>

          </motion.div>
        </div>

        {/* Center: Playback Controls */}
        <div className="flex flex-col items-center gap-2.5 w-full min-w-0 relative z-20">
          <div className="flex items-center gap-3 xl:gap-4">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleShuffle() }}
              aria-label={isShuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
              aria-pressed={isShuffle}
              style={
                isShuffle
                  ? {
                    color: 'var(--spotify-glow, #22d3ee)',
                    backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                    borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                  }
                  : undefined
              }
              className={`p-1.5 xl:p-2 rounded-xl relative active:scale-[0.97] transition-[transform,color,background-color,border-color] duration-150 ease-[var(--ease-out)] cursor-pointer ${isShuffle ? 'is-active border shadow-sm' : 'text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/10'
                }`}
              title={isShuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
            >
              <Shuffle className="w-4 h-4" />
              {isShuffle && (
                <span
                  style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                  className="w-1.5 h-1.5 rounded-full absolute -bottom-0.5 left-1/2 -translate-x-1/2 shadow-[0_0_6px_var(--spotify-glow,#22d3ee)]"
                />
              )}
            </button>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); prevTrack() }}
              aria-label={t('previous')}
              className="p-1.5 xl:p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full active:scale-[0.97] transition-[transform,color,background-color] duration-150 ease-[var(--ease-out)] cursor-pointer"
              title={t('previous')}
            >
              <SkipBack className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); togglePlay() }}
              aria-label={isBuffering ? t('buffering') : isPlaying ? t('pause') : t('play')}
              style={{
                background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4), 0 0 10px var(--theme-glow-shadow, rgba(6,182,212,0.25))',
              }}
              className="player-play-btn w-9 h-9 rounded-full transition-[filter,transform] duration-150 ease-[var(--ease-out)] hover:brightness-110 active:scale-[0.97] flex items-center justify-center text-black font-bold shrink-0 border border-white/20 cursor-pointer"
              title={isBuffering ? t('buffering') : isPlaying ? t('pause') : t('play')}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={playStateKey}
                  {...iconSwapMotion}
                  className="inline-flex items-center justify-center"
                >
                  {isBuffering ? (
                    <Loader2 className="w-4 h-4 animate-spin text-black shrink-0" />
                  ) : isPlaying ? (
                    <Pause className="w-4 h-4 fill-current text-black shrink-0" />
                  ) : (
                    <Play className="w-4 h-4 fill-current text-black ml-0.5 shrink-0" />
                  )}
                </motion.span>
              </AnimatePresence>
            </button>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); nextTrack() }}
              aria-label={t('next')}
              className="p-1.5 xl:p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full active:scale-[0.97] transition-[transform,color,background-color] duration-150 ease-[var(--ease-out)] cursor-pointer"
              title={t('next')}
            >
              <SkipForward className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleRepeat() }}
              aria-label={
                repeatMode === 'one'
                  ? t('repeat_one')
                  : repeatMode === 'all'
                    ? t('repeat_all')
                    : t('repeat_off')
              }
              aria-pressed={repeatMode !== 'off'}
              style={
                repeatMode !== 'off'
                  ? {
                    color: 'var(--spotify-glow, #22d3ee)',
                    backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                    borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                  }
                  : undefined
              }
              className={`p-1.5 xl:p-2 rounded-xl relative active:scale-[0.97] transition-[transform,color,background-color,border-color] duration-150 ease-[var(--ease-out)] cursor-pointer ${repeatMode !== 'off' ? 'is-active border shadow-sm' : 'text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/10'
                }`}
              title={
                repeatMode === 'one'
                  ? t('repeat_one')
                  : repeatMode === 'all'
                    ? t('repeat_all')
                    : t('repeat_off')
              }
            >
              {repeatMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
              {repeatMode !== 'off' && (
                <span
                  style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                  className="w-1.5 h-1.5 rounded-full absolute -bottom-0.5 left-1/2 -translate-x-1/2 shadow-[0_0_6px_var(--spotify-glow,#22d3ee)]"
                />
              )}
            </button>
          </div>

          {/* Progress track stays centered directly below the play controls. */}
          <div className={`${trackMetadataProgressClass} shrink-0`} onClick={(e) => e.stopPropagation()}>
              <AudioWaveformScrubber
                duration={duration || currentTrack.duration || 0}
                isPlaying={isPlaying}
                trackId={currentTrack.id}
                onSeek={seek}
                barCount={56}
              />
          </div>

        </div>

        {/* Right: Volume & Extra Controls */}
        <div className="flex items-center justify-end gap-1.5 xl:gap-2.5 min-w-0 relative z-20">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleFavoriteCurrentTrack() }}
            aria-label={currentTrack.is_favorite ? t('remove_favorite') : t('add_to_favorite')}
            aria-pressed={Boolean(currentTrack.is_favorite)}
            className={`p-1.5 xl:p-2 rounded-xl active:scale-[0.97] transition-[transform,color,background-color,border-color] duration-150 ease-[var(--ease-out)] cursor-pointer ${currentTrack.is_favorite
                ? 'is-active text-rose-500 bg-rose-500/15 border border-rose-500/30'
                : 'text-slate-400 hover:text-rose-400 hover:bg-white/5'
              }`}
            title={currentTrack.is_favorite ? t('remove_favorite') : t('add_to_favorite')}
          >
            <motion.span
              animate={{ transform: heartPopping && !prefersReducedMotion ? 'scale(1.22)' : 'scale(1)' }}
              transition={heartPopping ? { duration: 0.09, ease: EASE_OUT } : SPRING_DELIGHT}
              className="inline-flex items-center justify-center"
            >
              <Heart
                className={`w-4 h-4 transition-colors duration-150 ${currentTrack.is_favorite ? 'fill-current drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]' : ''
                  }`}
              />
            </motion.span>
          </button>

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowLyricsModal(!showLyricsModal) }}
            aria-label={t('lyrics')}
            aria-pressed={showLyricsModal}
            className={`p-1.5 xl:p-2 rounded-xl active:scale-[0.97] transition-[transform,color,background-color] duration-150 ease-[var(--ease-out)] cursor-pointer ${showLyricsModal
                ? 'is-active bg-[var(--primary-spotify,#06b6d4)] text-black shadow-sm font-bold'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            title={t('lyrics')}
          >
            <Mic2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleOpenShare}
            aria-label={t('share_lyrics')}
            className="p-1.5 xl:p-2 rounded-xl active:scale-[0.97] transition-[transform,color,background-color] duration-150 ease-[var(--ease-out)] text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/5 cursor-pointer"
            title={t('share_lyrics')}
          >
            <Share2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleQueue() }}
            aria-label={t('queue')}
            aria-pressed={isQueueOpen}
            style={
              isQueueOpen
                ? {
                  color: 'var(--spotify-glow, #22d3ee)',
                  backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                  borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                }
                : undefined
            }
            className={`p-1.5 xl:p-2 rounded-xl relative active:scale-[0.97] transition-[transform,color,background-color,border-color] duration-150 ease-[var(--ease-out)] cursor-pointer ${isQueueOpen ? 'is-active border shadow-sm font-bold' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            title={t('queue')}
          >
            <ListMusic className="w-4 h-4" />
            {isQueueOpen && (
              <span
                style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                className="w-1 h-1 rounded-full absolute -bottom-0.5 left-1/2 -translate-x-1/2"
              />
            )}
          </button>

          <div className="h-4 w-[1px] bg-white/10 shrink-0" />

          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-full px-2.5 xl:px-3 py-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleVolumeToggle() }}
              aria-label={volume === 0 ? t('unmute') : t('mute')}
              className="text-slate-400 hover:text-white active:scale-[0.97] transition-[transform,color] duration-150 ease-[var(--ease-out)] p-0.5 shrink-0 cursor-pointer"
              title={volume === 0 ? t('unmute') : t('mute')}
            >
              {volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <div className={`volume-track-wrapper w-14 lg:w-16 xl:w-20 ml-0.5 ${isDraggingVolume ? 'dragging' : ''}`}>
              <div className="volume-track">
                <div
                  className="volume-fill"
                  style={{
                    width: '100%',
                    transformOrigin: 'left center',
                    transform: `scaleX(${volume})`,
                  }}
                />
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ transform: `translate3d(${(volume - 1) * 100}%, 0, 0)` }}
                >
                  <div className="volume-thumb" style={{ left: '100%' }} />
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onPointerDown={() => setIsDraggingVolume(true)}
                onPointerUp={() => setIsDraggingVolume(false)}
                onPointerCancel={() => setIsDraggingVolume(false)}
                onBlur={() => setIsDraggingVolume(false)}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
            </div>
          </div>
        </div>
      </footer>

      {/* 🎤 FULLSCREEN / MODAL LYRICS OVERLAY FOR MOBILE (ANDROID/IOS) & DESKTOP */}
      {mounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showLyricsModal && (
            <motion.div
              key="desktop-lyrics-modal-backdrop"
              {...modalBackdropProps(prefersReducedMotion)}
              className="fixed inset-0 z-[70] bg-black/85 p-2 md:p-6 flex items-center justify-center"
              role="dialog"
              aria-modal="true"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowLyricsModal(false)
              }}
            >
              <motion.div
                key="desktop-lyrics-modal-panel"
                {...modalPanelProps(prefersReducedMotion)}
                onClick={(e) => e.stopPropagation()}
                className="modal-content w-full h-full max-w-5xl bg-[var(--bg-space,#090b10)] rounded-2xl border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col relative"
              >
                <LyricsView onClose={() => setShowLyricsModal(false)} isModal={true} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* 🚀 Lyrics Share Modal */}
      {currentTrack && (
        <LyricsShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          track={currentTrack}
          lyrics={shareLyrics}
        />
      )}
    </>
  )
}
