'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePlayer } from './PlayerContext'
import { usePlaybackDuration } from './PlaybackProgressStore'
import { NowPlayingStage } from './NowPlayingStage'
import { LyricsView } from './LyricsView'
import { MiniEqualizer } from './MiniEqualizer'
import { AudioWaveformScrubber } from './AudioWaveformScrubber'
import { TrackCoverImage } from '../common/TrackCoverImage'
import { OverflowMarqueeText } from '../common/OverflowMarqueeText'
import { ArtistLinks } from '../common/ArtistLinks'
import {
  trackMetadataArtistInlineClass,
  trackMetadataLoadingClass,
  trackMetadataProgressClass,
  trackMetadataTitleClass,
} from './trackMetadataLayout'
import { setCachedResolvedAlbum, getCachedResolvedAlbum, isRealAlbumName, isKnownBadFallback, makeAlbumCacheKey } from '@/lib/albumCache'
import { cleanDisplayAlbumName } from '@/lib/albumMatching'
import { resolveAlbumDeduped } from '@/lib/albumResolveClient'
import { LyricsShareModal } from './LyricsShareModal'
import { getPrimaryLyrics } from '@/lib/lyricsFlow'
import { parseLrc, parsePlainLyrics, LyricLine } from '@/lib/lrcParser'
import { MobileFullviewPlayer } from './MobileFullviewPlayer'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { isAdmin } from '@/lib/accessControl'
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Volume2,
  VolumeX,
  DiscAlbum,
  Loader2,
  Share2,
  Cloud,
  Languages,
  PenTool,
} from 'lucide-react'

export function NowPlayingOverlay() {
  const duration = usePlaybackDuration()
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
  } = usePlayer()

  const router = useRouter()
  const { userEmail } = useCurrentUser()
  const userIsAdmin = isAdmin(userEmail)
  const [isNavigatingAlbum, setIsNavigatingAlbum] = useState(false)
  const [resolvedAlbumInfo, setResolvedAlbumInfo] = useState<{ id?: string; name?: string } | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareLyrics, setShareLyrics] = useState<LyricLine[]>([])
  const [openEditorSignal, setOpenEditorSignal] = useState(0)
  const [isLiquidGlass, setIsLiquidGlass] = useState(false)
  const [showRomaji, setShowRomaji] = useState(true)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('musicweb_show_romaji')
      if (saved !== null) setShowRomaji(saved === 'true')
    } catch {}
  }, [])

  const toggleRomaji = () => {
    setShowRomaji((prev) => {
      const next = !prev
      try {
        localStorage.setItem('musicweb_show_romaji', String(next))
      } catch {}
      return next
    })
  }

  useEffect(() => {
    const root = document.documentElement
    const check = () => setIsLiquidGlass(root.getAttribute('data-theme-style') === 'liquid-glass')
    check()
    const observer = new MutationObserver(check)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme-style'] })
    return () => observer.disconnect()
  }, [])

  const handleOpenShare = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!currentTrack) return
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
      setShowShareModal(true)
    }
  }

  useEffect(() => {
    setResolvedAlbumInfo(null)

    if (!currentTrack) return

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
    const timer = setTimeout(() => {
      const titleToSearch = currentTrack.title || ''
      const artistToSearch = currentTrack.artist || ''
      const albumToSearch = hasRealAlbum ? currentTrack.album! : ''

      resolveAlbumDeduped({ title: titleToSearch, artist: artistToSearch, album: albumToSearch, trackId: currentTrack.id || '' })
        .then((data) => {
          if (isCancelled) return
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
      closeNowPlayingOverlay()
      router.push('/albums')
      return
    }

    if (resolvedAlbumInfo?.id && !isKnownBadFallback(resolvedAlbumInfo.id)) {
      closeNowPlayingOverlay()
      router.push(`/album/${resolvedAlbumInfo.id}`)
      return
    }

    const cached = getCachedResolvedAlbum(currentTrack.title, currentTrack.artist, currentTrack.album)
    if (cached?.albumId && !isKnownBadFallback(cached.albumId)) {
      currentTrack.spotify_album_id = cached.albumId
      if (cached.albumName) currentTrack.album = cached.albumName
      closeNowPlayingOverlay()
      router.push(`/album/${cached.albumId}`)
      return
    }

    const hasRealAlbum = Boolean(
      currentTrack.album &&
      isRealAlbumName(currentTrack.album, currentTrack.title)
    )

    if (hasRealAlbum && currentTrack.spotify_album_id && !isKnownBadFallback(currentTrack.spotify_album_id)) {
      closeNowPlayingOverlay()
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
          closeNowPlayingOverlay()
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
      closeNowPlayingOverlay()
      router.push(`/album/${currentTrack.spotify_album_id}`)
      return
    }

    const targetQuery = albumToSearch || titleToSearch
    closeNowPlayingOverlay()
    router.push(targetQuery ? `/albums?q=${encodeURIComponent(targetQuery)}` : '/albums')
  }

  const handleOpenArtist = (artistName?: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    const name = artistName || currentTrack?.artist
    if (!name) return
    closeNowPlayingOverlay()
    router.push(`/artist?name=${encodeURIComponent(name)}`)
  }

  // Listen to Esc key to close overlay (only when no nested dialog is open)
  useEffect(() => {
    if (!isNowPlayingOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showShareModal || document.querySelector('[role="dialog"]')) return
        closeNowPlayingOverlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isNowPlayingOpen, showShareModal, closeNowPlayingOverlay])

  if (!currentTrack) return null

  const handleFavoriteClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await toggleFavoriteCurrentTrack()
  }

  const handleVolumeToggle = () => {
    if (volume > 0) setVolume(0)
    else setVolume(0.8)
  }

  return (
    <>
      {/* 📱 Mobile Fullview Player (<1024px screens) - Persistent mount for zero-lag and non-freezing sync */}
      <div className="lg:hidden">
        <MobileFullviewPlayer
          displayAlbumName={displayAlbumName}
          isNavigatingAlbum={isNavigatingAlbum}
          onOpenAlbum={handleOpenAlbum}
          onOpenArtist={(e, artistName) => handleOpenArtist(artistName, e)}
        />
      </div>

      {/* 💻 Desktop Now Playing Overlay (>=1024px screens) */}
      <div
        inert={!isNowPlayingOpen}
        aria-hidden={!isNowPlayingOpen}
        className={`now-playing-overlay hidden lg:flex fixed inset-0 z-[60] bg-[#07090e] text-white flex-col transition-transform duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] select-none ${
          isNowPlayingOpen ? 'open translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        {/* Subtle Single Shared Ambient Radial Wash */}
        <div
          className="absolute inset-0 z-0 pointer-events-none overflow-hidden opacity-50"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(circle at 28% 38%, color-mix(in srgb, var(--spotify-glow, #22d3ee) 18%, transparent) 0%, transparent 55%), radial-gradient(circle at 76% 68%, color-mix(in srgb, var(--theme-gradient-1, #a855f7) 14%, transparent) 0%, transparent 60%)',
          }}
        />

        {/* 🔝 Unified Top Header (Desktop) */}
        <div className="relative z-30 flex items-center justify-between h-16 px-6 border-b border-white/[0.08] shrink-0 bg-[#07090e]/90 backdrop-blur-xl">
          <button
            aria-label="Thu nhỏ player (Esc)"
            onClick={closeNowPlayingOverlay}
            className="fullview-header-btn p-2 text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors active:scale-95 flex items-center gap-1.5 text-xs font-semibold shrink-0 border border-white/10 cursor-pointer"
            title="Thu nhỏ player (Esc)"
          >
            <ChevronDown className="w-5 h-5" />
            <span className="hidden sm:inline">Thu nhỏ</span>
          </button>

          {/* Right Header context & actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            {currentTrack.source === 'soundcloud' && (
              <span className="fullview-header-badge text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#ff5500]/15 text-[#ff7700] border border-[#ff5500]/35 flex items-center gap-1.5">
                <Cloud className="w-3 h-3 text-[#ff7700]" />
                SOUNDCLOUD
              </span>
            )}
            {userIsAdmin && (
              <button
                type="button"
                onClick={() => setOpenEditorSignal((n) => n + 1)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 hover:text-white transition-colors cursor-pointer"
                title="Chỉnh sửa lời bài hát (Admin)"
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>Sửa lời</span>
              </button>
            )}
          </div>
        </div>

      {/* 🎭 Main Stage Area */}
      <div className="flex-1 min-h-0 relative flex overflow-hidden bg-gradient-to-r from-[#07090e] via-[#07090e] to-[#0f0b16]">
        {/* Desktop View (>=1024px): 2-Column Unified Stage */}
        <div className="hidden lg:block w-full h-full min-h-0 relative">
          <NowPlayingStage
            coverUrl={currentTrack.cover_url}
            title={currentTrack.title}
            artist={currentTrack.artist}
            isPlaying={isPlaying}
            onArtistClick={(name, e) => handleOpenArtist(name, e)}
          >
            <LyricsView
              isModal={false}
              showControls={false}
              showHeader={false}
              showRomaji={showRomaji}
              onToggleRomaji={toggleRomaji}
              hideFloatingActions={true}
              openEditorSignal={openEditorSignal}
            />
          </NowPlayingStage>
        </div>

        {/* 🎛️ DESKTOP FLOATING CONTROL BAR (>= 1024px) */}
        <div
          className="player-bar hidden lg:grid lg:grid-cols-[minmax(190px,1fr)_minmax(320px,min(560px,42vw))_minmax(220px,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,560px)_minmax(0,1fr)] lg:gap-3 xl:gap-6 absolute bottom-2 sm:bottom-3 lg:bottom-4 inset-x-3 sm:inset-x-6 z-30 px-4 xl:px-6 py-2 xl:py-2.5 h-[84px] xl:h-[92px] items-center rounded-[37px] select-none"
          style={isLiquidGlass ? {
            backdropFilter: 'blur(40px) saturate(220%) brightness(1.08)',
            WebkitBackdropFilter: 'blur(40px) saturate(220%) brightness(1.08)',
          } : undefined}
        >
          {/* Inner glass specular gradient */}
          <div aria-hidden="true" className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
            <span
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 'inherit',
                background: isLiquidGlass
                  ? 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 20%, transparent 40%)'
                  : 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 40%)',
              }}
            />
          </div>

          {/* Left: Track Metadata (Matches Main Menu PlayerBar) */}
          <div className="flex items-center gap-3 min-w-0 relative z-20">
            <div className="relative shrink-0">
              <div className={`player-cover w-12 h-12 xl:w-14 xl:h-14 rounded-full bg-slate-800 flex items-center justify-center border border-white/10 shadow-md ${isPlaying ? 'is-playing' : ''}`}>
                <TrackCoverImage src={currentTrack.cover_url} alt={currentTrack.title} />
              </div>
            </div>

            <div className="truncate flex flex-col flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0 max-w-full">
                <div className={`inline-flex items-center gap-1.5 min-w-0 max-w-full ${trackMetadataTitleClass}`}>
                  <OverflowMarqueeText
                    text={currentTrack.title}
                    className="text-xs lg:text-sm font-bold text-white truncate"
                  />
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
                  className="flex items-center gap-1 min-w-0 max-w-[160px] xl:max-w-[260px] text-[10px] text-slate-300 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 px-2 py-0.5 rounded-md hover:border-[var(--spotify-glow,#22d3ee)]/50 cursor-pointer transition-[background-color,border-color,color] group shadow-sm"
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

            </div>
          </div>

          {/* Center: Playback Controls & Seekbar (Matches Main Menu PlayerBar Layout) */}
          <div className="flex flex-col items-center gap-2.5 w-full min-w-0 relative z-20">
            <div className="flex items-center gap-3 xl:gap-4">
              <button
                aria-label={isShuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
                onClick={toggleShuffle}
                style={
                  isShuffle
                    ? {
                      color: 'var(--spotify-glow, #22d3ee)',
                      backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                      borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                    }
                    : undefined
                }
                className={`p-1.5 xl:p-2 rounded-xl relative transition-colors active:scale-95 cursor-pointer ${isShuffle ? 'border shadow-sm' : 'text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/10'
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
                aria-label="Bài trước"
                onClick={prevTrack}
                className="p-1.5 xl:p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors active:scale-95 cursor-pointer"
                title="Bài trước"
              >
                <SkipBack className="w-4.5 h-4.5" />
              </button>

              <button
                aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}
                onClick={togglePlay}
                style={{
                  background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                  boxShadow: '0 4px 16px var(--theme-glow-shadow, rgba(6,182,212,0.45))',
                }}
                className="w-9 h-9 rounded-full hover:brightness-110 active:scale-95 transition-[filter,transform] flex items-center justify-center text-black font-bold shrink-0 border border-white/20 cursor-pointer"
                title={isPlaying ? 'Tạm dừng' : 'Phát'}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current text-black" />
                ) : (
                  <Play className="w-4 h-4 fill-current text-black ml-0.5" />
                )}
              </button>

              <button
                aria-label="Bài kế tiếp"
                onClick={nextTrack}
                className="p-1.5 xl:p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors active:scale-95 cursor-pointer"
                title="Bài kế tiếp"
              >
                <SkipForward className="w-4.5 h-4.5" />
              </button>

              <button
                aria-label={
                  repeatMode === 'one'
                    ? 'Lặp lại 1 bài'
                    : repeatMode === 'all'
                      ? 'Lặp lại toàn bộ danh sách'
                      : 'Bật lặp lại bài hát'
                }
                onClick={toggleRepeat}
                style={
                  repeatMode !== 'off'
                    ? {
                      color: 'var(--spotify-glow, #22d3ee)',
                      backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                      borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                    }
                    : undefined
                }
                className={`p-1.5 xl:p-2 rounded-xl relative transition-colors active:scale-95 cursor-pointer ${repeatMode !== 'off' ? 'border shadow-sm' : 'text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/10'
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

          {/* Right: Volume, Romaji & Favorite Controls (Clean Fullview) */}
          <div className="flex justify-end items-center gap-1.5 xl:gap-2.5 min-w-0 relative z-20">
            <button
              onClick={toggleRomaji}
              style={
                showRomaji
                  ? {
                      color: 'var(--spotify-glow, #22d3ee)',
                      backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                      borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                    }
                  : undefined
              }
              className={`p-1.5 xl:p-2 rounded-xl border transition-colors flex items-center justify-center cursor-pointer ${
                showRomaji
                  ? 'border shadow-sm'
                  : 'text-slate-400 border-transparent hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/5'
              }`}
              title="Bật/Tắt phiên âm Romaji / Pinyin"
              aria-label="Bật/Tắt phiên âm Romaji"
            >
              <Languages className="w-4 h-4" />
            </button>

            <button
              aria-label="Chia sẻ câu hát (Lyrics Story)"
              onClick={handleOpenShare}
              className="p-1.5 xl:p-2 rounded-xl transition-colors text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/5 cursor-pointer"
              title="Chia sẻ câu hát (Lyrics Story)"
            >
              <Share2 className="w-4 h-4" />
            </button>

            <button
              aria-label={currentTrack.is_favorite ? 'Bỏ khỏi bài hát yêu thích' : 'Thêm vào bài hát yêu thích'}
              onClick={handleFavoriteClick}
              className={`p-1.5 xl:p-2 rounded-xl transition-colors cursor-pointer ${currentTrack.is_favorite
                ? 'text-rose-500 bg-rose-500/15 border border-rose-500/30'
                : 'text-slate-400 hover:text-rose-400 hover:bg-white/5'
                }`}
              title={currentTrack.is_favorite ? 'Bỏ khỏi bài hát yêu thích' : 'Thêm vào bài hát yêu thích'}
            >
              <Heart
                className={`w-4 h-4 transition-colors ${currentTrack.is_favorite ? 'fill-current drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]' : ''
                  }`}
              />
            </button>

            <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-full px-2.5 xl:px-3 py-1 shrink-0">
              <button
                aria-label={volume === 0 ? 'Mở tiếng' : 'Tắt tiếng'}
                onClick={handleVolumeToggle}
                className="text-slate-400 hover:text-white transition-colors p-0.5 shrink-0 cursor-pointer"
                title={volume === 0 ? 'Mở tiếng' : 'Tắt tiếng'}
              >
                {volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <div className="volume-track-wrapper w-14 lg:w-16 xl:w-20 ml-0.5">
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
      </div>
    </div>

      {/* 🚀 Lyrics Share Modal */}
      {showShareModal && currentTrack && (
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
