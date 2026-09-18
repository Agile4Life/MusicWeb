'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Track, Playlist } from '@/types'
import { Play, Pause, Music, Trash2, MoreVertical, Plus, Pencil, Check, X, Heart, Cloud, ListMusic, DiscAlbum, Loader2, Eye } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isAdmin, getValidUserId } from '@/lib/accessControl'
import { formatViewCount } from '@/lib/utils'
import { resolveExternalTrackId, isExternalTrack } from '@/lib/trackPersistence'
import { useSession } from 'next-auth/react'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
import { ArtistLinks } from '@/components/common/ArtistLinks'
import { getCachedResolvedAlbum, setCachedResolvedAlbum, isRealAlbumName } from '@/lib/albumCache'
import { triggerDrivePrewarm } from '@/lib/googleDriveUpload'
import { prewarmNctStreamUrl } from '@/lib/nhaccuatuiClient'
import { TrackContextMenu } from './TrackContextMenu'



interface TrackRowProps {
  track: Track
  index: number
  isCurrent?: boolean
  isPlayingThis?: boolean
  onPlayClick?: () => void
  onAddToQueue?: () => void
  playlistTracks?: Track[]
  userPlaylists?: Playlist[]
  onAddToPlaylist?: (playlistId: string, track: Track) => void
  onDeleteTrack?: (trackId: string) => void
  onDeleteTrackPermanently?: (trackId: string) => void
  onTrackUpdated?: (trackId: string, updates: Partial<Track>) => void
  selectable?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
  onMouseEnterRow?: (e: React.MouseEvent<HTMLDivElement>) => void
  /** Pre-fetched view count from batch API — skips per-row /api/track-views call */
  batchViewCount?: number | null
}

function formatDuration(seconds: number) {
  if (!seconds || isNaN(seconds)) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}


function TrackRowComponent({
  track,
  index,
  isCurrent = false,
  isPlayingThis = false,
  onPlayClick,
  onAddToQueue,
  playlistTracks = [],
  userPlaylists = [],
  onAddToPlaylist,
  onDeleteTrack,
  onDeleteTrackPermanently,
  onTrackUpdated,
  selectable = false,
  isSelected = false,
  onToggleSelect,
  onMouseEnterRow,
  batchViewCount,
}: TrackRowProps) {
  const router = useRouter()
  const [isResolvingAlbum, setIsResolvingAlbum] = useState(false)
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false)
  const [liveAlbum, setLiveAlbum] = useState<string | null>(() => {
    if (isRealAlbumName(track.album, track.title)) return track.album || null
    const cached = getCachedResolvedAlbum(track.title, track.artist, track.album)
    if (cached?.albumName) return cached.albumName
    return track.album || null
  })

  useEffect(() => {
    if (isRealAlbumName(track.album, track.title)) {
      setLiveAlbum(track.album || null)
      return
    }

    const cached = getCachedResolvedAlbum(track.title, track.artist, track.album)
    if (cached?.albumName) setLiveAlbum(cached.albumName)

    const handleAlbumResolved = (e: any) => {
      const detail = e.detail
      if (detail && detail.album?.albumName) {
        const isTitleMatch = detail.title && track.title && detail.title.toLowerCase().trim() === track.title.toLowerCase().trim()
        const isArtistMatch = detail.artist && track.artist && detail.artist.toLowerCase().trim() === track.artist.toLowerCase().trim()
        if (isTitleMatch && isArtistMatch) {
          if (!isRealAlbumName(track.album, track.title)) {
            setLiveAlbum(detail.album.albumName)
          }
        }
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('album-resolved', handleAlbumResolved)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('album-resolved', handleAlbumResolved)
      }
    }
  }, [track.title, track.artist, track.album])
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const [showMenu, setShowMenu] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const hoverTimeoutRef = useRef<any>(null)
  const favBusyRef = useRef(false)
  // Track recently pre-warmed NCT IDs to avoid re-triggering
  const recentlyPrewarmedRef = useRef<Set<string>>(new Set())

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    onMouseEnterRow?.(e)
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    hoverTimeoutRef.current = setTimeout(() => {
      // Pre-warm NCT stream URL so play is instant when user clicks
      if (track.source === 'nhaccuatui' && track.nhaccuatui_id) {
        const id = track.nhaccuatui_id
        if (!recentlyPrewarmedRef.current.has(id)) {
          recentlyPrewarmedRef.current.add(id)
          prewarmNctStreamUrl(id).catch(() => {})
          // Clear from recently-prewarmed set after TTL so re-hovering works later
          setTimeout(() => recentlyPrewarmedRef.current.delete(id), 8 * 60 * 1000)
        }
      }
      // Also pre-warm Drive for local tracks
      triggerDrivePrewarm([track])
    }, 150)
  }

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
  }

  const handleOpenTrackAlbum = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (track.spotify_album_id && !track.spotify_album_id.includes('299152445') && !track.spotify_album_id.includes('296970753')) {
      router.push(`/album/${track.spotify_album_id}`)
      return
    }

    const hasRealAlbum =
      track.album &&
      !['Google Drive', 'Google Drive Sync', 'YouTube Music', 'Apple Music Top Hits', 'iTunes Global', 'Spotify Album'].includes(track.album.trim())

    const titleToSearch = track.title || ''
    const artistToSearch = track.artist || ''
    const albumToSearch = hasRealAlbum ? track.album! : ''

    try {
      setIsResolvingAlbum(true)

      const res = await fetch(
        `/api/albums/resolve?title=${encodeURIComponent(titleToSearch)}&artist=${encodeURIComponent(artistToSearch)}&album=${encodeURIComponent(albumToSearch)}&track_id=${encodeURIComponent(track.id || '')}`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.albumId) {
          track.spotify_album_id = data.albumId
          if (data.albumName) {
            track.album = data.albumName
            setLiveAlbum(data.albumName)
            setCachedResolvedAlbum(track.title, track.artist, { albumId: data.albumId, albumName: data.albumName })
          }
          onTrackUpdated?.(track.id, { spotify_album_id: data.albumId, album: data.albumName || undefined })
          router.push(`/album/${data.albumId}`)
          return
        }
      }
    } catch (err) {
      console.warn('TrackRow resolve album error:', err)
    } finally {
      setIsResolvingAlbum(false)
    }

    const targetQuery = albumToSearch || titleToSearch
    router.push(targetQuery ? `/albums?q=${encodeURIComponent(targetQuery)}` : '/albums')
  }

  const currentAlbumDisplay = liveAlbum || track.album

  const hasRealAlbumDisplay = Boolean(
    currentAlbumDisplay &&
    !['Google Drive', 'Google Drive Sync', 'Apple Music Top Hits', 'iTunes Global', 'Spotify Album', 'YouTube Music', 'Unknown Album'].includes(currentAlbumDisplay.trim())
  )

  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleToggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!showMenu) {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        const menuEstimatedHeight = 280
        const spaceBelow = window.innerHeight - rect.bottom
        const openUpward = spaceBelow < menuEstimatedHeight && rect.top > spaceBelow

        setMenuPos({
          top: openUpward ? undefined : rect.bottom + 6,
          bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined,
          right: Math.max(12, window.innerWidth - rect.right),
        })
      }
      setShowMenu(true)
    } else {
      setShowMenu(false)
    }
  }


  // Display view count: embedded track.view_count takes priority; otherwise use the
  // batch-fetched value provided by the parent (via useBatchViewCounts).
  // Per-row individual fetching has been removed to prevent N+1 Serverless Function bursts.
  const displayViews = (track.view_count != null && track.view_count > 0 ? track.view_count : null) ?? batchViewCount ?? null

  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState(track.title || '')
  const [editArtist, setEditArtist] = useState(track.artist || '')
  const [editAlbum, setEditAlbum] = useState(track.album || '')
  const [saving, setSaving] = useState(false)
  const [isFavorite, setIsFavorite] = useState(Boolean(track.is_favorite))
  const { userEmail: contextEmail } = useCurrentUser()

  const userEmail = contextEmail || nextAuthSession?.user?.email
  const userIsAdmin = isAdmin(userEmail)

  const handleSaveEdit = async () => {
    setSaving(true)
    const newTitle = editTitle.trim() || track.title
    const newArtist = editArtist.trim() || null
    const newAlbum = editAlbum.trim() || null

    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          artist: newArtist,
          album: newAlbum,
        }),
      })

      if (res.ok) {
        onTrackUpdated?.(track.id, {
          title: newTitle,
          artist: newArtist || undefined,
          album: newAlbum || undefined,
        })
        setEditMode(false)
      } else {
        const errData = await res.json().catch(() => ({}))
        alert('Lỗi sửa track: ' + (errData.error || 'Không xác định'))
      }
    } catch (err: any) {
      alert('Lỗi sửa track: ' + (err?.message || 'Lỗi mạng'))
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setEditArtist(track.artist || '')
    setEditAlbum(track.album || '')
    setEditMode(false)
  }

  const handleToggleFavorite = async (event: React.MouseEvent) => {
    if (favBusyRef.current) return
    favBusyRef.current = true
    event.stopPropagation()
    const nextValue = !isFavorite
    setIsFavorite(nextValue)
    onTrackUpdated?.(track.id, { is_favorite: nextValue })

    try {
      let dbTrackId = track.id

      if (isExternalTrack(track)) {
        const userId = userEmail ? getValidUserId({ email: userEmail }) : null
        if (userId) {
          const resolvedId = await resolveExternalTrackId(supabase, track, userId)
          if (resolvedId) dbTrackId = resolvedId
        }
      }

      const res = await fetch('/api/favorites/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: dbTrackId, nextValue }),
      })

      if (!res.ok) {
        console.warn('[Favorite] toggle failed', await res.json().catch(() => null))
        setIsFavorite(!nextValue)
        onTrackUpdated?.(track.id, { is_favorite: !nextValue })
      }
    } catch (e) {
      console.warn('Favorite toggle sync error:', e)
      setIsFavorite(!nextValue)
      onTrackUpdated?.(track.id, { is_favorite: !nextValue })
    } finally {
      favBusyRef.current = false
    }
  }

  return (
    <div
      onClick={onPlayClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`recent-row song-row cv-auto group flex items-center justify-between px-3 md:px-4 py-2.5 rounded-xl transition-all duration-200 cursor-pointer select-none border relative ${
        showMenu
          ? 'z-40 bg-white/[0.12] border-white/20 text-white shadow-lg'
          : isSelected
          ? 'bg-[var(--primary-spotify,#06b6d4)]/20 border-[var(--primary-spotify,#06b6d4)]/50 text-white font-bold shadow-md hover:bg-[var(--primary-spotify,#06b6d4)]/25'
          : isCurrent
          ? 'is-playing bg-[var(--primary-spotify,#06b6d4)]/10 border-[var(--primary-spotify,#06b6d4)]/30 text-white hover:bg-[var(--primary-spotify,#06b6d4)]/18 shadow-[0_2px_12px_color-mix(in_srgb,var(--primary-spotify,#06b6d4)_15%,transparent)]'
          : 'bg-transparent border-transparent'
      }`}
    >
      {/* Active Left Accent Indicator Bar */}
      {isCurrent && (
        <div className="absolute left-0 top-2 bottom-2 w-1 bg-[var(--spotify-glow,#22d3ee)] rounded-r-md shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
      )}

      {/* Left Slot: Checkbox (optional) + Index/Play + Cover + Metadata */}
      <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0 pr-2 truncate">
        {/* Select Checkbox */}
        {selectable && (
          <div className="w-5 shrink-0 flex items-center justify-center z-10" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect?.()}
              className="rounded accent-cyan-400 w-4 h-4 cursor-pointer"
            />
          </div>
        )}

        {/* Index & Play button */}
        <div className="w-7 sm:w-8 shrink-0 flex items-center justify-center text-xs font-mono text-slate-400 select-none">
          <span className="group-hover:hidden flex items-center justify-center">
            {isPlayingThis ? (
              <div className="flex items-end justify-center gap-0.5 h-3">
                <span className="w-0.5 bg-[var(--primary-spotify)] rounded-full eq-bar-1" />
                <span className="w-0.5 bg-[var(--primary-spotify)] rounded-full eq-bar-2" />
                <span className="w-0.5 bg-[var(--primary-spotify)] rounded-full eq-bar-3" />
              </div>
            ) : (
              <span className={isCurrent ? 'text-[var(--spotify-glow,#22d3ee)] font-bold' : ''}>{index + 1}</span>
            )}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onPlayClick?.()
            }}
            aria-label={isPlayingThis ? 'Tạm dừng' : 'Phát'}
            className="hidden group-hover:flex items-center justify-center text-white hover:scale-110 transition-transform"
          >
            {isPlayingThis ? (
              <Pause className="w-4 h-4 fill-current text-[var(--spotify-glow,#22d3ee)]" />
            ) : (
              <Play className="w-4 h-4 fill-current text-white" />
            )}
          </button>
        </div>

        {/* Cover thumbnail & Title/Artist */}
        <div className="row-thumb w-9 h-9 bg-slate-800 rounded-lg overflow-hidden shrink-0 flex items-center justify-center border border-white/10">
          <TrackCoverImage src={track.cover_url} alt={track.title} />
        </div>

        <div className="truncate flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 truncate">
            {editMode ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Tên bài hát..."
                className="text-xs bg-white/10 border border-[var(--primary-spotify)]/50 rounded px-1.5 py-0.5 text-white font-bold outline-none w-full max-w-[200px]"
              />
            ) : (
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <p
                  className={`text-xs font-bold truncate ${
                    isCurrent ? 'text-[var(--primary-spotify)]' : 'text-white'
                  }`}
                >
                  {track.title}
                </p>
                {track.source === 'soundcloud' && (
                  <span className="px-1.5 py-0.2 text-[9px] font-black uppercase rounded bg-[#ff5500]/20 text-[#ff7700] border border-[#ff5500]/40 shrink-0">
                    SoundCloud
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Artist & Mobile View Count */}
          <div className="flex items-center gap-1.5 truncate mt-0.5">
            {editMode ? (
              <input
                autoFocus
                value={editArtist}
                onChange={(e) => setEditArtist(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Tên nghệ sĩ..."
                className="text-xs bg-white/10 border border-[var(--primary-spotify)]/50 rounded px-1.5 py-0.5 text-white outline-none w-full max-w-[160px]"
              />
            ) : (
              <>
                <ArtistLinks
                  artist={track.artist}
                  className="text-xs text-slate-400 truncate block"
                  linkClassName="hover:underline hover:text-[var(--spotify-glow,#22d3ee)] transition-colors cursor-pointer"
                />
                {displayViews != null && displayViews > 0 && (
                  <span
                    className="sm:hidden inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 shrink-0"
                    title={`${displayViews.toLocaleString('vi-VN')} lượt xem trên YouTube`}
                  >
                    <span>•</span>
                    <Eye className="w-3 h-3 text-slate-500 shrink-0" />
                    <span>{formatViewCount(displayViews).replace(' lượt xem', '')}</span>
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Album — editable inline */}
      <div className="hidden md:block w-40 lg:w-52 xl:w-64 shrink-0 truncate text-xs text-slate-400 px-2">
        {editMode ? (
          <input
            value={editAlbum}
            onChange={(e) => setEditAlbum(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Tên album..."
            className="text-xs bg-white/10 border border-[var(--primary-spotify)]/50 rounded px-1.5 py-0.5 text-white outline-none w-full"
          />
        ) : (
          <button
            onClick={handleOpenTrackAlbum}
            disabled={isResolvingAlbum}
            className="hover:text-[var(--spotify-glow,#22d3ee)] hover:underline transition-colors text-left inline-flex items-center gap-1.5 max-w-full truncate text-xs cursor-pointer group"
            title={hasRealAlbumDisplay ? `Vào album: ${currentAlbumDisplay}` : 'Vào Album bài hát'}
          >
            {isResolvingAlbum ? (
              <Loader2 className="w-3 h-3 text-[var(--primary-spotify,#06b6d4)] animate-spin shrink-0" />
            ) : (
              <DiscAlbum className="w-3 h-3 text-[var(--primary-spotify,#06b6d4)]/80 group-hover:text-[var(--primary-spotify,#06b6d4)] shrink-0" />
            )}
            <span className="truncate group-hover:text-[var(--primary-spotify,#06b6d4)]">
              {hasRealAlbumDisplay ? currentAlbumDisplay : 'Album'}
            </span>
          </button>
        )}
      </div>

      {/* Views */}
      <div
        className="hidden sm:flex items-center justify-end gap-1.5 w-24 md:w-28 shrink-0 text-[11px] font-mono text-slate-400 hover:text-cyan-400 transition-colors px-2"
        title={displayViews ? `${displayViews.toLocaleString('vi-VN')} lượt xem trên YouTube` : undefined}
      >
        {displayViews != null && displayViews > 0 ? (
          <>
            <Eye className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="font-mono text-right truncate">{formatViewCount(displayViews).replace(' lượt xem', '')}</span>
          </>
        ) : null}
      </div>

      {/* Duration */}
      <div className={`w-14 sm:w-16 flex items-center justify-end shrink-0 font-mono text-xs pr-1 ${track.duration ? 'text-slate-300' : 'text-slate-600'}`}>
        {formatDuration(track.duration)}
      </div>

      {/* Options container */}
      <div className="w-8 sm:w-16 flex items-center justify-end shrink-0">
          {/* Edit mode save/cancel */}
          {editMode ? (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="p-1.5 bg-[var(--primary-spotify)] text-black rounded-lg hover:opacity-80 transition-opacity disabled:opacity-50"
                title="Lưu"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleCancelEdit}
                className="p-1.5 bg-white/10 text-slate-300 rounded-lg hover:bg-white/20 transition-colors"
                title="Hủy"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="relative flex items-center gap-0.5 sm:gap-1">
              {onAddToQueue && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddToQueue()
                  }}
                  className={`p-1.5 text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/10 rounded-lg transition-all hidden sm:block ${
                    showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title="Thêm vào hàng đợi"
                >
                  <ListMusic className="w-4 h-4" />
                </button>
              )}

              <button
                ref={buttonRef}
                onClick={handleToggleMenu}
                className={`p-1.5 hover:text-white hover:bg-white/10 rounded-lg transition-colors ${
                  showMenu ? 'opacity-100 text-white bg-white/10' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'
                }`}
                title="Khác"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {/* Unified Themed Context Menu (Desktop Dropdown + Mobile Bottom Sheet) */}
              <TrackContextMenu
                track={track}
                isOpen={showMenu}
                onClose={() => setShowMenu(false)}
                menuPos={menuPos}
                isFavorite={isFavorite}
                onToggleFavorite={handleToggleFavorite}
                onAddToQueue={onAddToQueue}
                onOpenAlbum={handleOpenTrackAlbum}
                isResolvingAlbum={isResolvingAlbum}
                currentAlbumDisplay={currentAlbumDisplay}
                hasRealAlbumDisplay={hasRealAlbumDisplay}
                isAdmin={userIsAdmin}
                onEditMode={() => setEditMode(true)}
                userPlaylists={userPlaylists}
                onAddToPlaylist={onAddToPlaylist}
                onDeleteTrack={onDeleteTrack}
                onDeleteTrackPermanently={onDeleteTrackPermanently}
                triggerRef={buttonRef}
              />
            </div>
        )}
      </div>
    </div>
  )
}

export const TrackRow = React.memo(TrackRowComponent)
