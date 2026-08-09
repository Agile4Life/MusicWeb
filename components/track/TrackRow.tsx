'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Track, Playlist } from '@/types'
import { Play, Pause, Music, Trash2, MoreVertical, Plus, Pencil, Check, X, Heart, Cloud, ListMusic, DiscAlbum, Loader2, Eye } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isAdmin, getValidUserId } from '@/lib/accessControl'
import { formatViewCount } from '@/lib/utils'
import { fetchViewCountForVideo } from '@/lib/youtube'
import { useSession } from 'next-auth/react'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
import { getCachedResolvedAlbum, setCachedResolvedAlbum, isRealAlbumName } from '@/lib/albumCache'
import { triggerDrivePrewarm } from '@/lib/googleDriveUpload'

const viewCountCache = new Map<string, number>()

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
}: TrackRowProps) {
  const router = useRouter()
  const [isResolvingAlbum, setIsResolvingAlbum] = useState(false)
  const [liveAlbum, setLiveAlbum] = useState<string | null>(() => {
    if (isRealAlbumName(track.album)) return track.album || null
    const cached = getCachedResolvedAlbum(track.title, track.artist, track.album)
    if (cached?.albumName) return cached.albumName
    return track.album || null
  })

  useEffect(() => {
    if (isRealAlbumName(track.album)) {
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
          if (!isRealAlbumName(track.album)) {
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
  const menuRef = useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = useRef<any>(null)

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    hoverTimeoutRef.current = setTimeout(() => {
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

  useEffect(() => {
    if (!showMenu) return

    const handlePointerDownOutside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false)
      }
    }

    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', handlePointerDownOutside)
    }, 0)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', handlePointerDownOutside)
    }
  }, [showMenu])

  const [fetchedViews, setFetchedViews] = useState<number | null>(null)
  const [loadingViews, setLoadingViews] = useState(false)

  useEffect(() => {
    if (track.view_count != null || track.play_count != null) return

    const cacheKey = track.youtube_id || `${(track.title || '').trim().toLowerCase()}_${(track.artist || '').trim().toLowerCase()}`
    if (!cacheKey || cacheKey === '_') return

    if (viewCountCache.has(cacheKey)) {
      setFetchedViews(viewCountCache.get(cacheKey)!)
      return
    }

    let isMounted = true
    setLoadingViews(true)

    const params = new URLSearchParams()
    if (track.youtube_id) params.set('youtube_id', track.youtube_id)
    if (track.title) params.set('title', track.title)
    if (track.artist) params.set('artist', track.artist)

    fetch(`/api/track-views?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted) {
          const views = data?.viewCount ?? null
          if (views != null && views > 0) {
            viewCountCache.set(cacheKey, views)
            setFetchedViews(views)
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setLoadingViews(false)
      })

    return () => {
      isMounted = false
    }
  }, [track.youtube_id, track.title, track.artist, track.view_count, track.play_count])

  const displayViews = track.view_count ?? track.play_count ?? fetchedViews

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
    const { error } = await supabase
      .from('tracks')
      .update({
        title: newTitle,
        artist: editArtist.trim() || null,
        album: editAlbum.trim() || null,
      })
      .eq('id', track.id)

    if (!error) {
      onTrackUpdated?.(track.id, {
        title: newTitle,
        artist: editArtist.trim() || undefined,
        album: editAlbum.trim() || undefined,
      })
      setEditMode(false)
    } else {
      alert('Lỗi cập nhật: ' + error.message)
    }
    setSaving(false)
  }

  const handleCancelEdit = () => {
    setEditArtist(track.artist || '')
    setEditAlbum(track.album || '')
    setEditMode(false)
  }

  const handleToggleFavorite = async (event: React.MouseEvent) => {
    event.stopPropagation()
    const nextValue = !isFavorite
    setIsFavorite(nextValue)
    onTrackUpdated?.(track.id, { is_favorite: nextValue })

    try {
      const userId = userEmail ? getValidUserId({ email: userEmail }) : null

      let dbTrackId = track.id

      if (track.source && track.source !== 'local' && userId) {
        const { data: existing } = await supabase
          .from('tracks')
          .select('id')
          .eq('file_path', track.file_path)
          .maybeSingle()

        if (existing && existing.id) {
          dbTrackId = existing.id
        } else {
          const { data: inserted } = await supabase
            .from('tracks')
            .insert({
              user_id: userId,
              title: track.title,
              artist: track.artist || null,
              album: track.album || null,
              duration: track.duration || 0,
              file_path: track.file_path,
              cover_url: track.cover_url || null,
              created_at: new Date().toISOString(),
            })
            .select('id')
            .single()

          if (inserted && inserted.id) dbTrackId = inserted.id
        }
      }

      if (userId && dbTrackId) {
        if (nextValue) {
          await supabase.from('favorite_tracks').upsert({ user_id: userId, track_id: dbTrackId })
        } else {
          await supabase.from('favorite_tracks').delete().eq('user_id', userId).eq('track_id', dbTrackId)
        }
      }
    } catch (e) {
      console.warn('Favorite toggle sync error:', e)
    }
  }

  return (
    <div
      onClick={onPlayClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={
        isSelected
          ? {
              backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
              borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
            }
          : undefined
      }
      className={`group flex items-center justify-between px-3 md:px-4 py-2.5 rounded-xl transition-all duration-200 cursor-pointer select-none border ${
        showMenu ? 'relative z-40 bg-white/[0.08] border-white/10 text-white' : 'relative'
      } ${
        isSelected
          ? 'text-white'
          : isCurrent
          ? 'bg-white/[0.08] border-white/10 text-white'
          : showMenu
          ? ''
          : 'border-transparent hover:bg-white/[0.06] hover:border-white/[0.08]'
      }`}
    >
      {/* Select Checkbox */}
      {selectable && (
        <div className="shrink-0 flex items-center pr-2.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect?.()}
            className="rounded accent-cyan-400 w-4 h-4 cursor-pointer"
          />
        </div>
      )}

      {/* Index & Play button */}
      <div className="flex items-center gap-2.5 sm:gap-3.5 flex-1 min-w-0 pr-2 truncate">
        <div className="w-5 text-center text-xs font-mono text-slate-400 shrink-0">
          <span className="group-hover:hidden">
            {isPlayingThis ? (
              <div className="flex items-end justify-center gap-0.5 h-3">
                <span className="w-0.5 bg-[var(--primary-spotify)] rounded-full eq-bar-1" />
                <span className="w-0.5 bg-[var(--primary-spotify)] rounded-full eq-bar-2" />
                <span className="w-0.5 bg-[var(--primary-spotify)] rounded-full eq-bar-3" />
              </div>
            ) : (
              <span className={isCurrent ? 'text-[var(--primary-spotify)] font-bold' : ''}>{index + 1}</span>
            )}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPlayClick?.()
            }}
            className="hidden group-hover:inline-block text-white hover:scale-110 transition-transform"
          >
            {isPlayingThis ? (
              <Pause className="w-4 h-4 fill-current text-[var(--primary-spotify)]" />
            ) : (
              <Play className="w-4 h-4 fill-current text-white" />
            )}
          </button>
        </div>

        {/* Cover thumbnail & Title/Artist */}
        <div className="w-9 h-9 bg-slate-800 rounded-lg overflow-hidden shrink-0 flex items-center justify-center border border-white/10">
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
              <p
                className={`text-xs font-bold truncate ${
                  isCurrent ? 'text-[var(--primary-spotify)]' : 'text-white'
                }`}
              >
                {track.title}
              </p>
            )}
            {track.source === 'spotify' && (
              <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20 shrink-0 hidden xs:inline">
                Spotify
              </span>
            )}
            {track.source === 'youtube' && (
              <span className="text-[9px] font-mono text-red-400 bg-red-500/10 px-1.5 py-0.2 rounded border border-red-500/20 shrink-0 hidden xs:inline">
                YouTube
              </span>
            )}
            {track.source === 'audius' && (
              <span className="text-[9px] font-mono text-purple-300 bg-purple-500/10 px-1.5 py-0.2 rounded border border-purple-500/20 shrink-0 hidden xs:inline">
                Audius
              </span>
            )}
            {track.source === 'itunes' && (
              <span className="text-[9px] font-mono text-pink-400 bg-pink-500/10 px-1.5 py-0.2 rounded border border-pink-500/20 shrink-0 hidden xs:inline">
                iTunes
              </span>
            )}
          </div>

          {/* Artist — editable inline */}
          {editMode ? (
            <input
              autoFocus
              value={editArtist}
              onChange={(e) => setEditArtist(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Tên nghệ sĩ..."
              className="text-xs bg-white/10 border border-[var(--primary-spotify)]/50 rounded px-1.5 py-0.5 text-white outline-none mt-0.5 w-full max-w-[160px]"
            />
          ) : (
            <p className="text-xs text-slate-400 truncate">
              {track.artist || 'Nghệ sĩ chưa xác định'}
            </p>
          )}
        </div>
      </div>

      {/* Album — editable inline */}
      <div className="hidden md:block w-1/4 truncate text-xs text-slate-400">
        {editMode ? (
          <input
            value={editAlbum}
            onChange={(e) => setEditAlbum(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Tên album..."
            className="text-xs bg-white/10 border border-[var(--primary-spotify)]/50 rounded px-1.5 py-0.5 text-white outline-none w-full max-w-[160px]"
          />
        ) : (
          <button
            onClick={handleOpenTrackAlbum}
            disabled={isResolvingAlbum}
            className="hover:text-[var(--spotify-glow,#22d3ee)] hover:underline transition-colors text-left inline-flex items-center gap-1.5 max-w-[180px] truncate text-xs cursor-pointer group"
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

      {/* Duration & Options */}
      <div className="shrink-0 flex items-center justify-end md:w-1/4 text-xs text-slate-400 gap-3">
        <span className="w-12 text-center font-mono text-slate-300 shrink-0">
          {formatDuration(track.duration)}
        </span>

        {/* Options container */}
        <div className="min-w-[32px] flex items-center justify-end shrink-0 gap-0.5">
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
            <div className="relative flex items-center gap-0.5">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onAddToQueue?.()
                }}
                className={`p-1.5 text-slate-400 hover:text-[var(--spotify-glow,#22d3ee)] hover:bg-white/10 rounded-lg transition-all hidden sm:block ${
                  showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                title="Thêm vào hàng đợi"
              >
                <ListMusic className="w-4 h-4" />
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(!showMenu)
                }}
                className={`p-1.5 hover:text-white hover:bg-white/10 rounded-lg transition-colors ${
                  showMenu ? 'opacity-100 text-white bg-white/10' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'
                }`}
                title="Khác"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

            {showMenu && (
              <div
                ref={menuRef}
                className="absolute right-0 top-9 bg-[#0b121e]/95 backdrop-blur-2xl shadow-2xl rounded-2xl py-2 w-56 z-50 text-xs text-slate-200 border border-white/15 animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Edit artist/album */}
                <button
                  onClick={handleToggleFavorite}
                  className="w-full text-left px-3.5 py-2 hover:bg-white/10 flex items-center gap-2 transition-colors"
                >
                  <Heart className={`w-3.5 h-3.5 ${isFavorite ? 'fill-rose-400 text-rose-400' : 'text-rose-400'}`} />
                  {isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'}
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowMenu(false)
                    onAddToQueue?.()
                  }}
                  className="w-full text-left px-3.5 py-2 hover:bg-white/10 flex items-center gap-2 transition-colors text-cyan-400"
                >
                  <ListMusic className="w-3.5 h-3.5 text-cyan-400" />
                  Thêm vào hàng đợi
                </button>

                <button
                  onClick={(e) => {
                    setShowMenu(false)
                    handleOpenTrackAlbum(e)
                  }}
                  disabled={isResolvingAlbum}
                  className="w-full text-left px-3.5 py-2 hover:bg-white/10 flex items-center gap-2 transition-colors text-purple-300"
                >
                  {isResolvingAlbum ? (
                    <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                  ) : (
                    <DiscAlbum className="w-3.5 h-3.5 text-purple-400" />
                  )}
                  <span>Vào Album bài hát</span>
                </button>
                {userIsAdmin && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditMode(true)
                      setShowMenu(false)
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-white/10 flex items-center gap-2 transition-colors border-b border-white/10"
                  >
                    <Pencil className="w-3.5 h-3.5 text-blue-400" />
                    Sửa Tên / Nghệ sĩ / Album
                  </button>
                )}

                {userIsAdmin && userPlaylists.length > 0 && onAddToPlaylist && (
                  <div className="px-3 py-1 text-slate-400 font-semibold text-[10px] uppercase tracking-wider border-b border-white/10">
                    Thêm vào Playlist
                  </div>
                )}
                {userIsAdmin && userPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddToPlaylist?.(pl.id, track)
                      setShowMenu(false)
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-white/10 flex items-center gap-2 truncate transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="truncate">{pl.name}</span>
                  </button>
                ))}

                {onDeleteTrack && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteTrack(track.id)
                      setShowMenu(false)
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-red-500/10 text-slate-300 hover:text-red-300 flex items-center gap-2 border-t border-white/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                    Bỏ khỏi Playlist này
                  </button>
                )}

                {userIsAdmin && onDeleteTrackPermanently && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteTrackPermanently(track.id)
                      setShowMenu(false)
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-red-500/20 text-red-400 flex items-center gap-2 border-t border-white/10 transition-colors font-semibold"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    Xóa vĩnh viễn khỏi Thư viện
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  )
}

export const TrackRow = React.memo(TrackRowComponent)
