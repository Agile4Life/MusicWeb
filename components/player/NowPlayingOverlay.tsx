'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
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
import { setCachedResolvedAlbum, getCachedResolvedAlbum, isRealAlbumName } from '@/lib/albumCache'
import { LyricsShareModal } from './LyricsShareModal'
import { getPrimaryLyrics } from '@/lib/lyricsFlow'
import { parseLrc, parsePlainLyrics, LyricLine } from '@/lib/lrcParser'
import { MobileFullviewPlayer } from './MobileFullviewPlayer'
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
  Mic2,
  Sparkles,
  ListMusic,
  Loader2,
  Share2,
  Cloud,
} from 'lucide-react'

const StageWithFrequencyData = React.memo(function StageWithFrequencyData({
  coverUrl,
  title,
  artist,
  isPlaying,
  onArtistClick,
  children,
}: {
  coverUrl?: string | null
  title?: string | null
  artist?: string | null
  isPlaying: boolean
  onArtistClick?: (artistName: string, e: React.MouseEvent) => void
  children?: React.ReactNode
}) {
  const { frequencyData } = usePlayer()
  return (
    <NowPlayingStage
      analyserData={frequencyData}
      coverUrl={coverUrl}
      title={title}
      artist={artist}
      isPlaying={isPlaying}
      onArtistClick={onArtistClick}
    >
      {children}
    </NowPlayingStage>
  )
})

export function NowPlayingOverlay() {
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
    toggleQueue,
    isQueueOpen,
    queue,
    currentIndex,
  } = usePlayer()

  const router = useRouter()
  const [mobileTab, setMobileTab] = useState<'cover' | 'lyrics'>('cover')
  const [isNavigatingAlbum, setIsNavigatingAlbum] = useState(false)
  const [resolvedAlbumInfo, setResolvedAlbumInfo] = useState<{ id?: string; name?: string } | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareLyrics, setShareLyrics] = useState<LyricLine[]>([])

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
    if (cached?.albumId && !cached.albumId.includes('299152445') && !cached.albumId.includes('296970753')) {
      setResolvedAlbumInfo({
        id: cached.albumId,
        name: cached.albumName,
      })
      if (cached.albumId) return
    }

    if (hasRealAlbum && currentTrack.spotify_album_id && currentTrack.album !== 'My Spot' && !currentTrack.spotify_album_id.includes('299152445') && !currentTrack.spotify_album_id.includes('296970753')) {
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

      fetch(
        `/api/albums/resolve?title=${encodeURIComponent(titleToSearch)}&artist=${encodeURIComponent(artistToSearch)}&album=${encodeURIComponent(albumToSearch)}&track_id=${encodeURIComponent(currentTrack.id || '')}`
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (isCancelled) return
          if (data && data.albumId) {
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

    return () => {
      isCancelled = true
      clearTimeout(timer)
    }
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.album, currentTrack?.spotify_album_id])

  const displayAlbumName = resolvedAlbumInfo?.name || (
    currentTrack?.album && isRealAlbumName(currentTrack.album, currentTrack.title)
      ? currentTrack.album
      : undefined
  )

  const trackNum = (currentIndex >= 0 ? currentIndex : 0) + 1
  const totalTracks = queue?.length || 1
  const releaseYear = currentTrack?.created_at ? new Date(currentTrack.created_at).getFullYear() : null
  const contextAlbumName = displayAlbumName || 'Album'

  const handleOpenAlbum = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!currentTrack) {
      closeNowPlayingOverlay()
      router.push('/albums')
      return
    }

    if (currentTrack.spotify_album_id && !currentTrack.spotify_album_id.includes('299152445') && !currentTrack.spotify_album_id.includes('296970753')) {
      closeNowPlayingOverlay()
      router.push(`/album/${currentTrack.spotify_album_id}`)
      return
    }

    if (resolvedAlbumInfo?.id && !resolvedAlbumInfo.id.includes('299152445') && !resolvedAlbumInfo.id.includes('296970753')) {
      closeNowPlayingOverlay()
      router.push(`/album/${resolvedAlbumInfo.id}`)
      return
    }

    const hasRealAlbum =
      currentTrack.album &&
      isRealAlbumName(currentTrack.album, currentTrack.title)

    const titleToSearch = currentTrack.title || ''
    const artistToSearch = currentTrack.artist || ''
    const albumToSearch = hasRealAlbum ? currentTrack.album! : ''

    try {
      setIsNavigatingAlbum(true)

      const res = await fetch(
        `/api/albums/resolve?title=${encodeURIComponent(titleToSearch)}&artist=${encodeURIComponent(artistToSearch)}&album=${encodeURIComponent(albumToSearch)}&track_id=${encodeURIComponent(currentTrack.id || '')}`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.albumId) {
          setResolvedAlbumInfo({ id: data.albumId, name: data.albumName || currentTrack.album || 'Album' })
          currentTrack.spotify_album_id = data.albumId
          if (data.albumName) currentTrack.album = data.albumName
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

  // Listen to Esc key to close overlay
  useEffect(() => {
    if (!isNowPlayingOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeNowPlayingOverlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isNowPlayingOpen, closeNowPlayingOverlay])

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
        <MobileFullviewPlayer />
      </div>

      {/* 💻 Desktop Now Playing Overlay (>=1024px screens) */}
      <div
        className={`now-playing-overlay hidden lg:flex fixed inset-0 z-50 bg-[#07090e] text-white flex-col transition-transform duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] select-none ${
          isNowPlayingOpen ? 'open translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        {/* 🌟 Single Shared Ambient Glow Layer (Behind Top Bar, Stage & PlayerBar) */}
        <div
          className="absolute inset-0 z-0 pointer-events-none overflow-hidden opacity-60"
          aria-hidden="true"
        >
          <div className="absolute -top-1/4 -left-1/4 w-[75vw] h-[75vw] rounded-full bg-[radial-gradient(circle,var(--spotify-glow,rgba(34,211,238,0.25))_0%,transparent_65%)] blur-3xl" />
          <div className="absolute -bottom-1/4 -right-1/4 w-[75vw] h-[75vw] rounded-full bg-[radial-gradient(circle,var(--theme-gradient-1,rgba(168,85,247,0.2))_0%,transparent_65%)] blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[55vw] h-[55vw] rounded-full bg-[radial-gradient(circle,var(--theme-gradient-2,rgba(6,182,212,0.15))_0%,transparent_70%)] blur-3xl" />
        </div>

        {/* 🔝 Unified Top Header (Desktop) */}
        <div className="relative z-30 flex items-center justify-between h-16 px-6 border-b border-white/[0.08] shrink-0 bg-[#07090e]/90 backdrop-blur-xl">
          <button
            onClick={closeNowPlayingOverlay}
            className="fullview-header-btn p-2 text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-all active:scale-95 flex items-center gap-1.5 text-xs font-semibold shrink-0 border border-white/10"
            title="Thu nhỏ player (Esc)"
          >
            <ChevronDown className="w-5 h-5" />
            <span className="hidden sm:inline">Thu nhỏ</span>
          </button>

          {/* Right Header context badge */}
          <div className="flex items-center gap-2 shrink-0">
            {currentTrack.source === 'soundcloud' ? (
              <span className="fullview-header-badge text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#ff5500]/20 text-[#ff7700] border border-[#ff5500]/40 flex items-center gap-1.5 shadow-[0_0_12px_rgba(255,85,0,0.3)]">
                <Cloud className="w-3 h-3 text-[#ff7700]" />
                SOUNDCLOUD
              </span>
            ) : (
              <span className="fullview-header-badge text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[var(--accent,#06b6d4)]/10 text-[var(--spotify-glow,#22d3ee)] border border-[var(--accent,#06b6d4)]/25 flex items-center gap-1.5 shadow-[0_0_12px_var(--theme-glow-shadow)]">
                <Sparkles className="w-3 h-3 text-[var(--spotify-glow,#22d3ee)]" />
                SYNCED LYRICS
              </span>
            )}
          </div>
        </div>

      {/* 🎭 Main Stage Area (Full Height underneath header so Lyrics & Particles scroll under the glass PlayerBar) */}
      <div className="flex-1 min-h-0 relative flex overflow-hidden bg-gradient-to-r from-[#07090e] via-[#07090e] to-[#0f0b16]">
        {/* Desktop View (>=1024px): Centered 2-Column Unified Stage (Album 320px Left, Lyrics Right) */}
        <div className="hidden lg:block w-full h-full relative">
          {/* Layer 1 & 2: Full Stage 3D Background & Left Album Scene */}
          <div className="absolute inset-0 z-0">
            <StageWithFrequencyData
              coverUrl={currentTrack.cover_url}
              title={currentTrack.title}
              artist={currentTrack.artist}
              isPlaying={isPlaying}
              onArtistClick={(name, e) => handleOpenArtist(name, e)}
            />
          </div>

          {/* Layer 3: Right Column Lyrics (Centered inside shared max-w-[1360px] stage) */}
          <div className="absolute inset-0 z-10 w-full h-full max-w-[1360px] xl:max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12 flex items-center justify-end pointer-events-none">
            <div className="w-full max-w-[640px] lg:w-[50%] xl:w-[48%] h-full pointer-events-auto flex flex-col justify-center pb-24 sm:pb-28 lg:pb-32 pt-2 sm:pt-4">
              <LyricsView isModal={false} showControls={false} showHeader={false} />
            </div>
          </div>
        </div>

        {/* 🎛️ DESKTOP FLOATING CONTROL BAR (>= 1024px) */}
        <div className="player-bar group/playerbar hidden lg:flex absolute bottom-2 sm:bottom-3 lg:bottom-4 inset-x-3 sm:inset-x-6 z-30 px-4 lg:px-6 xl:px-8 py-2 xl:py-3.5 h-[76px] lg:h-[84px] xl:h-[96px] items-center justify-between rounded-2xl transition-all duration-300 select-none overflow-hidden">
          {/* Inner glass specular gradient (Same as Mobile Player Bar) */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 'inherit',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 40%)',
              pointerEvents: 'none',
            }}
          />
          {/* Top ambient highlight reflection line (fades in on hover) */}
          <div className="absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-[var(--spotify-glow,#22d3ee)]/35 to-transparent pointer-events-none rounded-t-2xl opacity-0 group-hover/playerbar:opacity-100 transition-opacity duration-300" />

          {/* Left: Track Metadata (Matches Main Menu PlayerBar) */}
          <div className="flex items-center gap-3.5 w-1/4 min-w-[220px]">
            <div className="relative group shrink-0 cursor-pointer" title="Thông tin bài hát">
              <div className={`player-cover w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center border border-white/10 shadow-md ${isPlaying ? 'is-playing' : ''}`}>
                <TrackCoverImage src={currentTrack.cover_url} alt={currentTrack.title} />
              </div>
            </div>

            <div className="truncate flex flex-col flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0 max-w-full">
                <div className={`inline-flex items-center gap-1.5 min-w-0 max-w-full ${trackMetadataTitleClass}`}>
                  <OverflowMarqueeText
                    text={currentTrack.title}
                    className="text-xs lg:text-sm font-bold text-white hover:text-[var(--spotify-glow)] transition-colors cursor-pointer truncate"
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
                    className={`${trackMetadataLoadingClass} inline-flex items-center gap-1 text-[10px] font-semibold border px-2 py-0.5 rounded-full animate-pulse`}
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
                  className="flex items-center gap-1 min-w-0 max-w-[180px] sm:max-w-[220px] xl:max-w-[280px] text-[10px] text-slate-300 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 px-2 py-0.5 rounded-md hover:border-[var(--spotify-glow,#22d3ee)]/50 cursor-pointer transition-all group shadow-sm"
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
          <div className="flex flex-col items-center gap-1.5 w-2/4 max-w-xl">
            <div className="flex items-center gap-4">
              <button
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
                className={`p-2 rounded-xl relative transition-all duration-200 hover:scale-110 active:scale-95 ${isShuffle ? 'border shadow-md' : 'text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/10'
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
                onClick={prevTrack}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110 active:scale-95"
                title="Bài trước"
              >
                <SkipBack className="w-4.5 h-4.5" />
              </button>

              <button
                onClick={togglePlay}
                style={{
                  background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                  boxShadow: '0 4px 16px var(--theme-glow-shadow, rgba(6,182,212,0.45))',
                }}
                className="w-10 h-10 rounded-full hover:scale-110 hover:brightness-110 active:scale-95 transition-all duration-200 flex items-center justify-center text-black font-bold shrink-0 border border-white/20"
                title={isPlaying ? 'Tạm dừng' : 'Phát'}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current text-black" />
                ) : (
                  <Play className="w-4 h-4 fill-current text-black ml-0.5" />
                )}
              </button>

              <button
                onClick={nextTrack}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-all duration-200 hover:scale-110 active:scale-95"
                title="Bài kế tiếp"
              >
                <SkipForward className="w-4.5 h-4.5" />
              </button>

              <button
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
                className={`p-2 rounded-xl relative transition-all duration-200 hover:scale-110 active:scale-95 ${repeatMode !== 'off' ? 'border shadow-md' : 'text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/10'
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
                currentTime={currentTime}
                duration={duration || currentTrack.duration || 0}
                isPlaying={isPlaying}
                trackId={currentTrack.id}
                onSeek={seek}
                barCount={56}
              />
            </div>

          </div>

          {/* Right: Volume & Favorite Controls (Clean Fullview) */}
          <div className="w-1/4 flex justify-end items-center gap-3 min-w-0">
            <button
              onClick={handleOpenShare}
              className="p-2 rounded-xl transition-all text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/5"
              title="Chia sẻ câu hát (Lyrics Story)"
            >
              <Share2 className="w-4 h-4" />
            </button>

            <button
              onClick={handleFavoriteClick}
              className={`p-2 rounded-xl transition-all ${currentTrack.is_favorite
                ? 'text-rose-500 bg-rose-500/15 border border-rose-500/30'
                : 'text-slate-400 hover:text-rose-400 hover:bg-white/5'
                }`}
              title={currentTrack.is_favorite ? 'Bỏ khỏi bài hát yêu thích' : 'Thêm vào bài hát yêu thích'}
            >
              <Heart
                className={`w-4 h-4 transition-all ${currentTrack.is_favorite ? 'fill-current drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]' : ''
                  }`}
              />
            </button>

            <div className="flex items-center gap-2.5 bg-white/[0.04] border border-white/[0.06] rounded-full px-3 py-1">
              <button
                onClick={handleVolumeToggle}
                className="text-slate-400 hover:text-white transition-colors p-0.5 shrink-0"
                title={volume === 0 ? 'Mở tiếng' : 'Tắt tiếng'}
              >
                {volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <div className="volume-track-wrapper w-16 lg:w-20 ml-0.5">
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
