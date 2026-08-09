'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
import { LyricsView } from './LyricsView'
import { QueueDrawer } from './QueueDrawer'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
import { setCachedResolvedAlbum } from '@/lib/albumCache'
import { AudioWaveformScrubber } from './AudioWaveformScrubber'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music,
  Headphones,
  ChevronDown,
  Mic2,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  ListMusic,
  Loader2,
  DiscAlbum,
  Eye,
} from 'lucide-react'
import { formatViewCount } from '@/lib/utils'

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export function PlayerBar() {
  const { currentTime, duration } = usePlaybackProgress()
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
  } = usePlayer()
  const router = useRouter()

  const [isNavigatingAlbum, setIsNavigatingAlbum] = useState(false)
  const [isResolvingAlbumInfo, setIsResolvingAlbumInfo] = useState(false)
  const [resolvedAlbumInfo, setResolvedAlbumInfo] = useState<{ id?: string; name?: string } | null>(null)

  useEffect(() => {
    // Immediately clear previous track's album info on track change
    setResolvedAlbumInfo(null)
    setIsResolvingAlbumInfo(false)

    if (!currentTrack) {
      return
    }

    const titleNorm = (currentTrack.title || '').trim().toLowerCase()
    const albumNorm = (currentTrack.album || '').trim().toLowerCase()
    const isAlbumSameAsTitle = Boolean(titleNorm && albumNorm && (albumNorm === titleNorm || albumNorm.includes(titleNorm) || titleNorm.includes(albumNorm)))

    const hasRealAlbum =
      currentTrack.album &&
      !isAlbumSameAsTitle &&
      !['Google Drive', 'Google Drive Sync', 'YouTube Music', 'Apple Music Top Hits', 'iTunes Global', 'Spotify Album', 'Single', 'Unknown Album'].includes(currentTrack.album.trim())

    if (hasRealAlbum && currentTrack.spotify_album_id) {
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

      fetch(
        `/api/albums/resolve?title=${encodeURIComponent(titleToSearch)}&artist=${encodeURIComponent(artistToSearch)}&album=${encodeURIComponent(albumToSearch)}&track_id=${encodeURIComponent(currentTrack.id || '')}`
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (isCancelled) return
          setIsResolvingAlbumInfo(false)
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
            setIsResolvingAlbumInfo(false)
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
    currentTrack?.album && !['Google Drive', 'Google Drive Sync', 'YouTube Music', 'Apple Music Top Hits', 'iTunes Global', 'Spotify Album'].includes(currentTrack.album.trim())
      ? currentTrack.album
      : undefined
  )

  const handleOpenAlbum = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!currentTrack) {
      router.push('/albums')
      return
    }

    if (currentTrack.spotify_album_id) {
      setShowMobileFullPlayer(false)
      router.push(`/album/${currentTrack.spotify_album_id}`)
      return
    }

    if (resolvedAlbumInfo?.id) {
      setShowMobileFullPlayer(false)
      router.push(`/album/${resolvedAlbumInfo.id}`)
      return
    }

    try {
      setIsNavigatingAlbum(true)
      const hasRealAlbum =
        currentTrack.album &&
        !['Google Drive', 'Google Drive Sync', 'YouTube Music', 'Apple Music Top Hits', 'iTunes Global', 'Spotify Album'].includes(currentTrack.album.trim())

      const titleToSearch = currentTrack.title || ''
      const artistToSearch = currentTrack.artist || ''
      const albumToSearch = hasRealAlbum ? currentTrack.album! : ''

      const res = await fetch(
        `/api/albums/resolve?title=${encodeURIComponent(titleToSearch)}&artist=${encodeURIComponent(artistToSearch)}&album=${encodeURIComponent(albumToSearch)}&track_id=${encodeURIComponent(currentTrack.id || '')}`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.albumId) {
          setResolvedAlbumInfo({ id: data.albumId, name: data.albumName || currentTrack.album || 'Album' })
          currentTrack.spotify_album_id = data.albumId
          if (data.albumName) currentTrack.album = data.albumName
          setShowMobileFullPlayer(false)
          router.push(`/album/${data.albumId}`)
          return
        }
      }
    } catch (err) {
      console.warn('Failed to resolve album ID:', err)
    } finally {
      setIsNavigatingAlbum(false)
    }

    setShowMobileFullPlayer(false)
    router.push('/albums')
  }

  const [prevVol, setPrevVol] = useState(0.8)
  const [showMobileFullPlayer, setShowMobileFullPlayer] = useState(false)
  const [showLyricsModal, setShowLyricsModal] = useState(false)

  const handleVolumeToggle = () => {
    if (volume > 0) {
      setPrevVol(volume)
      setVolume(0)
    } else {
      setVolume(prevVol || 0.8)
    }
  }

  const effectiveDuration = duration > 0 ? duration : (currentTrack?.duration || 0)
  const progressPercent = effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)) : 0

  if (!currentTrack) {
    return (
      <footer className="hidden md:flex h-20 bg-[#090b10]/95 backdrop-blur-2xl rounded-2xl border border-white/[0.08] px-6 items-center justify-between text-slate-400 select-none z-30 shadow-2xl shrink-0">
        <div className="flex items-center gap-3 w-1/4 min-w-[200px]">
          <div className="w-11 h-11 bg-white/5 rounded-xl flex items-center justify-center text-slate-600 border border-white/5">
            <Music className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-300">Chưa chọn bài hát</p>
            <p className="text-[10px] text-slate-500">Chọn một bài hát từ thư viện để phát</p>
          </div>
        </div>

        {/* Desktop Disabled Controls when empty */}
        <div className="flex flex-col items-center gap-1.5 w-2/4 max-w-xl">
          <div className="flex items-center gap-4 text-slate-600">
            <SkipBack className="w-4 h-4 cursor-not-allowed" />
            <button className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-slate-600 cursor-not-allowed border border-white/5">
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

        <div className="w-1/4 flex justify-end items-center gap-2.5 text-slate-600">
          <Volume2 className="w-4 h-4 cursor-not-allowed" />
          <div className="w-24 h-1 bg-white/5 rounded-full" />
        </div>
      </footer>
    )
  }

  return (
    <>
      {/* 📱 Mobile Centered Screen Loading Toast */}
      {(() => {
        const currentViews = currentTrack?.view_count ?? currentTrack?.play_count
        return null
      })()}
      {isBuffering && (!currentTrack.source || currentTrack.source === 'local') && !showMobileFullPlayer && (
        <div className="md:hidden fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[#0a0d14]/95 backdrop-blur-2xl border border-cyan-500/40 px-6 py-4 rounded-2xl shadow-2xl flex flex-col items-center justify-center gap-2.5 text-center pointer-events-none">
          <div className="w-11 h-11 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shadow-lg">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          </div>
          <span className="text-xs font-extrabold text-white tracking-wide">Đang tải bản Lossless...</span>
        </div>
      )}

      {/* 📱 MOBILE FLOATING MINI PLAYER BAR (Visible on < 768px) */}
      <div
        onClick={() => setShowMobileFullPlayer(true)}
        className="md:hidden fixed bottom-[68px] left-3 right-3 z-40 bg-[#0d1017]/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-2.5 pb-3 shadow-2xl select-none overflow-hidden cursor-pointer active:opacity-95"
      >
        <div className="relative flex items-center justify-between w-full h-10">
          {/* Left Zone: Cover + Title/Artist */}
          <div
            className="flex items-center gap-2.5 min-w-0 max-w-[130px] xs:max-w-[170px] sm:max-w-[210px] z-10 shrink-0 overflow-hidden"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center overflow-hidden shrink-0 relative">
              <TrackCoverImage src={currentTrack.cover_url} alt={currentTrack.title} />
            </div>

            <div className="flex flex-col min-w-0 overflow-hidden w-full gap-0.5">
              <div className="overflow-hidden w-full relative">
                <span
                  className={`text-xs font-bold text-white block ${
                    currentTrack.title.length > 12
                      ? 'animate-marquee-text'
                      : 'truncate'
                  }`}
                >
                  {currentTrack.title}
                </span>
              </div>
              <div className="overflow-hidden w-full relative">
                <div
                  className={`text-[10px] text-slate-400 whitespace-nowrap flex items-center gap-1.5 ${
                    ((currentTrack.artist || '') + (displayAlbumName || '')).length > 12
                      ? 'animate-marquee-text'
                      : 'truncate'
                  }`}
                >
                  <span className="shrink-0">{currentTrack.artist || 'Nghệ sĩ chưa xác định'}</span>
                  {displayAlbumName && (
                    <>
                      <span className="text-slate-600 shrink-0">•</span>
                      <span className="text-cyan-400 font-medium shrink-0 flex items-center gap-0.5">
                        <DiscAlbum className="w-2.5 h-2.5 text-cyan-400 shrink-0 inline" />
                        {displayAlbumName}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Center Zone: Absolute 50% Centered Playback Controls */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center gap-1 z-20 pointer-events-auto">
            <button
              onClick={(e) => {
                e.stopPropagation()
                prevTrack()
              }}
              className="p-2 text-slate-300 active:text-white active:scale-95 transition-transform flex items-center justify-center"
              title="Bài trước"
            >
              <SkipBack className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation()
                togglePlay()
              }}
              className="w-9.5 h-9.5 rounded-full bg-[var(--primary-spotify,#06b6d4)] text-black flex items-center justify-center font-bold shadow-md active:scale-95 transition-transform shrink-0"
              title={isPlaying ? 'Tạm dừng' : 'Phát'}
            >
              {isPlaying ? <Pause className="w-4.5 h-4.5 fill-current" /> : <Play className="w-4.5 h-4.5 fill-current" />}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation()
                nextTrack()
              }}
              className="p-2 text-slate-300 active:text-white active:scale-95 transition-transform flex items-center justify-center"
              title="Bài kế tiếp"
            >
              <SkipForward className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Right Zone: Favorite Heart */}
          <div className="flex items-center justify-end z-10">
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleFavoriteCurrentTrack()
              }}
              className="p-2 text-slate-400 active:text-rose-400 transition-colors flex items-center justify-center"
              title={currentTrack.is_favorite ? 'Bỏ yêu thích' : 'Thêm yêu thích'}
            >
              <Heart
                className={`w-4.5 h-4.5 ${
                  currentTrack.is_favorite ? 'text-rose-500 fill-current' : 'text-slate-400'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Mini progress bar on bottom edge */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10 overflow-hidden">
          <div
            className="h-full bg-[var(--primary-spotify,#06b6d4)] transition-all duration-200"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 📱 FULL-SCREEN MOBILE PLAYER OVERLAY MODAL */}
      {showMobileFullPlayer && (
        <div className="md:hidden fixed inset-0 z-50 bg-[#07090e] flex flex-col justify-between p-6 select-none overflow-y-auto">
          {/* Header handle */}
          <div className="flex items-center justify-between pb-4 border-b border-white/[0.05]">
            <button
              onClick={() => setShowMobileFullPlayer(false)}
              className="p-2 bg-white/5 rounded-xl text-slate-300 border border-white/10"
            >
              <ChevronDown className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-cyan-500/20 to-pink-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                <Headphones className="w-3 h-3" />
              </div>
              <img
                src="/phong-signature.png"
                alt="Phong's Music Signature"
                className="h-5 w-auto object-contain signature-img-invert translate-y-[0.5px]"
              />
            </div>

            <button
              onClick={() => {
                setShowMobileFullPlayer(false)
                setShowLyricsModal(true)
              }}
              className="p-2 bg-cyan-500/10 rounded-xl text-cyan-400 border border-cyan-500/20"
              title="Xem lời bài hát"
            >
              <Mic2 className="w-4 h-4" />
            </button>
          </div>

          {/* Large Album Artwork */}
          <div className="flex-1 flex items-center justify-center my-8 relative">
            <div className="w-64 h-64 sm:w-72 sm:h-72 rounded-2xl bg-slate-800 border border-white/10 flex items-center justify-center overflow-hidden shadow-2xl relative">
              <TrackCoverImage
                src={currentTrack.cover_url}
                alt={currentTrack.title}
                fallbackIconClassName="w-20 h-20 text-slate-600"
              />

              {/* Centered Lossless Loading Overlay on Artwork */}
              {isBuffering && (!currentTrack.source || currentTrack.source === 'local') && (
                <div className="absolute inset-0 bg-black/75 backdrop-blur-md flex flex-col items-center justify-center gap-2 p-4 text-center z-10">
                  <Loader2 className="w-9 h-9 animate-spin text-cyan-400" />
                  <span className="text-xs font-extrabold text-white tracking-wide">Đang tải bản Lossless...</span>
                </div>
              )}
            </div>
          </div>

          {/* Track Info Header */}
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex flex-col items-start gap-1 min-w-0 flex-1">
              <h2 className="text-lg font-bold text-white truncate w-full">{currentTrack.title}</h2>
              <p className="text-xs text-slate-400 truncate w-full">
                {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
              </p>
              <div
                onClick={handleOpenAlbum}
                className="flex items-center gap-1.5 mt-1.5 text-xs truncate max-w-full cursor-pointer group bg-[var(--primary-spotify)]/10 border border-[var(--primary-spotify)]/20 px-2.5 py-1 rounded-lg hover:bg-[var(--primary-spotify)]/20 transition-all"
              >
                {isNavigatingAlbum ? (
                  <Loader2 className="w-3.5 h-3.5 text-[var(--primary-spotify,#06b6d4)] animate-spin shrink-0" />
                ) : (
                  <DiscAlbum className="w-3.5 h-3.5 text-[var(--primary-spotify,#06b6d4)] shrink-0" />
                )}
                <span
                  className="text-[var(--primary-spotify,#06b6d4)] font-semibold group-hover:underline truncate"
                  title={displayAlbumName ? `Vào Album: ${displayAlbumName}` : 'Vào Album bài hát'}
                >
                  {displayAlbumName || 'Album'}
                </span>
              </div>

              {/* end album pill */}
            </div>
            <button
              onClick={toggleFavoriteCurrentTrack}
              className="p-2.5 rounded-xl bg-white/5 text-slate-400 border border-white/10 shrink-0"
            >
              <Heart
                className={`w-5 h-5 ${
                  currentTrack.is_favorite ? 'text-rose-500 fill-current' : 'text-slate-400'
                }`}
              />
            </button>
          </div>

          {/* Waveform Scrubber (Mobile Modal View) */}
          <div className="w-full mb-6">
            <AudioWaveformScrubber
              currentTime={currentTime}
              duration={effectiveDuration}
              isPlaying={isPlaying}
              trackId={currentTrack.id}
              onSeek={seek}
              barCount={55}
            />
          </div>

          {/* Full Playback Controls */}
          <div className="grid grid-cols-5 items-center justify-items-center w-full px-2 mb-8">
            <button
              onClick={toggleShuffle}
              className={`p-3 rounded-full transition-all flex items-center justify-center ${
                isShuffle
                  ? 'text-[var(--primary-spotify,#06b6d4)] bg-[var(--primary-spotify,#06b6d4)]/20 border border-[var(--primary-spotify,#06b6d4)]/40 shadow-lg'
                  : 'text-slate-400 hover:text-white bg-white/5'
              }`}
              title={isShuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
            >
              <Shuffle className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>

            <button
              onClick={prevTrack}
              className="p-3 text-slate-300 hover:text-white active:scale-95 transition-transform flex items-center justify-center"
              title="Bài trước"
            >
              <SkipBack className="w-7 h-7 sm:w-8 sm:h-8" />
            </button>

            <button
              onClick={togglePlay}
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[var(--primary-spotify,#06b6d4)] text-black flex items-center justify-center shadow-xl active:scale-95 transition-transform border border-white/20 shrink-0"
              title={isPlaying ? 'Tạm dừng' : 'Phát'}
            >
              {isPlaying ? <Pause className="w-7 h-7 sm:w-8 sm:h-8 fill-current" /> : <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-current" />}
            </button>

            <button
              onClick={nextTrack}
              className="p-3 text-slate-300 hover:text-white active:scale-95 transition-transform flex items-center justify-center"
              title="Bài kế tiếp"
            >
              <SkipForward className="w-7 h-7 sm:w-8 sm:h-8" />
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
              className={`p-3 rounded-full border transition-all flex items-center justify-center ${
                repeatMode !== 'off'
                  ? 'border-[var(--spotify-glow)] shadow-lg'
                  : 'text-slate-400 hover:text-white bg-white/5 border-transparent'
              }`}
              title={
                repeatMode === 'one'
                  ? 'Lặp lại 1 bài'
                  : repeatMode === 'all'
                  ? 'Lặp lại danh sách'
                  : 'Tắt lặp lại'
              }
            >
              {repeatMode === 'one' ? <Repeat1 className="w-5 h-5 sm:w-6 sm:h-6" /> : <Repeat className="w-5 h-5 sm:w-6 sm:h-6" />}
            </button>
          </div>

          {/* Volume Control Bar */}
          <div className="flex items-center gap-3 px-4 py-3 bg-white/5 rounded-2xl border border-white/10 mb-4">
            <button onClick={handleVolumeToggle} className="text-slate-400 hover:text-white">
              {volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={{
                background: `linear-gradient(to right, var(--primary-spotify,#06b6d4) ${volume * 100}%, rgba(255,255,255,0.1) ${volume * 100}%)`,
              }}
              className="w-full h-1.5 rounded-lg appearance-none cursor-pointer outline-none"
            />
          </div>

          {/* Extra Mobile Actions: Lyrics & Queue */}
          <div className="flex items-center justify-around px-4 mb-4">
            <button
              onClick={() => {
                setShowMobileFullPlayer(false)
                setShowLyricsModal(true)
              }}
              className="p-3 text-slate-300 hover:text-white rounded-full bg-white/5 border border-white/10 flex items-center gap-2 text-xs font-semibold"
            >
              <Mic2 style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-4 h-4" />
              <span>Lời bài hát</span>
            </button>

            <button
              onClick={() => {
                setShowMobileFullPlayer(false)
                toggleQueue()
              }}
              style={
                isQueueOpen
                  ? {
                      color: 'var(--spotify-glow, #22d3ee)',
                      backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                      borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                    }
                  : undefined
              }
              className={`p-3 rounded-full border transition-all flex items-center gap-2 text-xs font-semibold ${
                isQueueOpen
                  ? 'shadow-lg'
                  : 'text-slate-300 hover:text-white bg-white/5 border-white/10'
              }`}
            >
              <ListMusic style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-4 h-4" />
              <span>Hàng đợi</span>
            </button>
          </div>
        </div>
      )}

      {/* 💻 DESKTOP PLAYER BAR (Visible on >= 768px screens) */}
      <footer className="hidden md:flex h-[96px] py-3.5 bg-[#090b10]/95 backdrop-blur-2xl rounded-2xl border border-white/[0.08] px-6 md:px-8 items-center justify-between text-slate-300 select-none z-30 shadow-2xl shrink-0">
        {/* Left: Track Metadata */}
        <div className="flex items-center gap-3.5 w-1/4 min-w-[220px]">
          <div className="relative group shrink-0">
            <div className="w-12 h-12 bg-slate-800 rounded-xl overflow-hidden relative flex items-center justify-center border border-white/10 shadow-md">
              <TrackCoverImage src={currentTrack.cover_url} alt={currentTrack.title} />
            </div>
          </div>

          <div className="truncate flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs md:text-sm font-bold text-white truncate hover:text-[var(--spotify-glow)] transition-colors cursor-pointer">
                {currentTrack.title}
              </p>
              {isPlaying && (
                <div className="flex items-end gap-0.5 h-3 shrink-0" title="Đang phát">
                  <span className="w-0.5 bg-[var(--primary-spotify,#06b6d4)] rounded-full eq-bar-1" />
                  <span className="w-0.5 bg-[var(--primary-spotify,#06b6d4)] rounded-full eq-bar-2" />
                  <span className="w-0.5 bg-[var(--primary-spotify,#06b6d4)] rounded-full eq-bar-3" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 truncate">
              <p className="text-[11px] text-slate-400 truncate hover:text-slate-200 transition-colors cursor-pointer">
                {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
              </p>

              {/* Album Link Pill */}
              <div
                onClick={handleOpenAlbum}
                className="flex items-center gap-1 shrink-0 text-[10px] text-slate-300 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 px-2 py-0.5 rounded-md max-w-[200px] hover:border-cyan-500/50 cursor-pointer transition-all group shadow-sm"
                title={displayAlbumName ? `Vào album: ${displayAlbumName}` : 'Vào Album bài hát'}
              >
                {isNavigatingAlbum ? (
                  <Loader2 className="w-3 h-3 animate-spin text-cyan-400 shrink-0" />
                ) : (
                  <DiscAlbum style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-3 h-3 shrink-0" />
                )}
                <span className="truncate font-semibold text-slate-200 group-hover:text-[var(--spotify-glow)] transition-colors">
                  {displayAlbumName || 'Album'}
                </span>
              </div>

              {/* View Count Pill hidden */}

              {isBuffering && (!currentTrack.source || currentTrack.source === 'local') && (
                <span
                  style={{
                    color: 'var(--spotify-glow, #22d3ee)',
                    backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                    borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                  }}
                  className="flex items-center gap-1 text-[10px] font-semibold border px-2 py-0.5 rounded-full animate-pulse shrink-0"
                >
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--spotify-glow, #22d3ee)' }} />
                  <span>Đang tải bản Lossless...</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center: Playback Controls & Seekbar */}
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
              className={`p-1.5 rounded-lg relative transition-all ${
                isShuffle ? 'border shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title={isShuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
            >
              <Shuffle className="w-4 h-4" />
              {isShuffle && (
                <span
                  style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                  className="w-1 h-1 rounded-full absolute -bottom-0.5 left-1/2 -translate-x-1/2"
                />
              )}
            </button>

            <button
              onClick={prevTrack}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90"
              title="Bài trước"
            >
              <SkipBack className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={togglePlay}
              style={{
                background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
              }}
              className="w-10 h-10 rounded-full hover:brightness-110 active:scale-95 transition-all flex items-center justify-center text-black font-bold shrink-0 border border-white/20"
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
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90"
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
              className={`p-1.5 rounded-lg relative transition-all ${
                repeatMode !== 'off' ? 'border shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
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
                  className="w-1 h-1 rounded-full absolute -bottom-0.5 left-1/2 -translate-x-1/2"
                />
              )}
            </button>
          </div>

          {/* Waveform Scrubber (Desktop PlayerBar View) */}
          <div className="w-full max-w-2xl px-2">
            <AudioWaveformScrubber
              currentTime={currentTime}
              duration={duration || currentTrack.duration || 0}
              isPlaying={isPlaying}
              trackId={currentTrack.id}
              onSeek={seek}
              barCount={100}
            />
          </div>
        </div>

        {/* Right: Volume & Extra Controls */}
        <div className="w-1/4 flex justify-end items-center gap-2.5">
          <button
            onClick={toggleFavoriteCurrentTrack}
            className={`p-2 rounded-xl transition-all ${
              currentTrack.is_favorite
                ? 'text-rose-500 bg-rose-500/15 border border-rose-500/30'
                : 'text-slate-400 hover:text-rose-400 hover:bg-white/5'
            }`}
            title={currentTrack.is_favorite ? 'Bỏ khỏi bài hát yêu thích' : 'Thêm vào bài hát yêu thích'}
          >
            <Heart
              className={`w-4 h-4 transition-all ${
                currentTrack.is_favorite ? 'fill-current drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]' : ''
              }`}
            />
          </button>

          <button
            onClick={() => setShowLyricsModal(!showLyricsModal)}
            className={`p-2 rounded-xl transition-all ${
              showLyricsModal
                ? 'bg-[var(--primary-spotify,#06b6d4)] text-black shadow-md font-bold'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            title="Lời bài hát (Lyrics)"
          >
            <Mic2 className="w-4 h-4" />
          </button>

          <button
            onClick={toggleQueue}
            style={
              isQueueOpen
                ? {
                    color: 'var(--spotify-glow, #22d3ee)',
                    backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                    borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                  }
                : undefined
            }
            className={`p-2 rounded-xl relative transition-all ${
              isQueueOpen ? 'border shadow-md font-bold' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            title="Danh sách hàng đợi (Queue)"
          >
            <ListMusic className="w-4 h-4" />
            {isQueueOpen && (
              <span
                style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                className="w-1 h-1 rounded-full absolute -bottom-0.5 left-1/2 -translate-x-1/2"
              />
            )}
          </button>

          <div className="h-4 w-[1px] bg-white/10" />

          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-full px-3 py-1.5">
            <button
              onClick={handleVolumeToggle}
              className="text-slate-400 hover:text-white transition-colors p-0.5"
              title={volume === 0 ? 'Mở tiếng' : 'Tắt tiếng'}
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
                background: `linear-gradient(to right, var(--primary-spotify,#06b6d4) ${volume * 100}%, rgba(255,255,255,0.12) ${volume * 100}%)`,
              }}
              className="w-16 md:w-20 h-1 rounded-lg appearance-none cursor-pointer outline-none transition-all"
            />
          </div>
        </div>
      </footer>

      {/* 🎤 FULLSCREEN / MODAL LYRICS OVERLAY FOR MOBILE (ANDROID/IOS) & DESKTOP */}
      <div
        className={`fixed inset-0 z-50 bg-black/85 p-2 md:p-6 flex items-center justify-center transition-all duration-200 ${
          showLyricsModal
            ? 'opacity-100 pointer-events-auto visible scale-100'
            : 'opacity-0 pointer-events-none invisible scale-95'
        }`}
      >
        <div className="w-full h-full max-w-5xl bg-[#090b10] rounded-2xl border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col relative">
          <LyricsView onClose={() => setShowLyricsModal(false)} isModal={true} />
        </div>
      </div>
    </>
  )
}

