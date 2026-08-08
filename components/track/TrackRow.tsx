'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Track, Playlist } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { Play, Pause, Music, Trash2, MoreVertical, Plus, Pencil, Check, X, Heart, Cloud, ListMusic } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isAdmin, getValidUserId } from '@/lib/accessControl'
import { useSession } from 'next-auth/react'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
interface TrackRowProps {
  track: Track
  index: number
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
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const { currentTrack, isPlaying, playTrack, togglePlay, queue, addToQueue } = usePlayer()
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState(track.title || '')
  const [editArtist, setEditArtist] = useState(track.artist || '')
  const [editAlbum, setEditAlbum] = useState(track.album || '')
  const [saving, setSaving] = useState(false)
  const [isFavorite, setIsFavorite] = useState(Boolean(track.is_favorite))
  const [supabaseEmail, setSupabaseEmail] = useState<string | null>(null)

  React.useEffect(() => {
    supabase.auth.getUser().then((res: any) => {
      setSupabaseEmail(res?.data?.user?.email || null)
    })
  }, [])

  const userEmail = supabaseEmail || nextAuthSession?.user?.email
  const userIsAdmin = isAdmin(userEmail)

  const isCurrent = currentTrack?.id === track.id

  const handlePlayClick = () => {
    if (isCurrent) {
      togglePlay()
    } else {
      playTrack(track, playlistTracks.length > 0 ? playlistTracks : [track])
    }
  }

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
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      const activeUser = currentUser || (nextAuthSession?.user ? { id: nextAuthSession.user.email, email: nextAuthSession.user.email } : null)
      const userId = activeUser ? getValidUserId(activeUser) : null

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
      onClick={handlePlayClick}
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
            {isCurrent && isPlaying ? (
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
            onClick={handlePlayClick}
            className="hidden group-hover:inline-block text-white hover:scale-110 transition-transform"
          >
            {isCurrent && isPlaying ? (
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
        ) : !track.album || track.album === 'Google Drive' || track.album === 'Google Drive Sync' ? (
          '—'
        ) : track.spotify_album_id ? (
          <Link
            href={`/album/${track.spotify_album_id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-[var(--spotify-glow,#22d3ee)] hover:underline transition-colors"
          >
            {track.album}
          </Link>
        ) : (
          track.album
        )}
      </div>

      {/* Duration & Options */}
      <div className="shrink-0 flex items-center justify-end gap-1.5 sm:gap-2 md:w-1/4 text-xs text-slate-400">
        <span className="font-mono">{formatDuration(track.duration)}</span>

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
                addToQueue(track)
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
                    addToQueue(track)
                  }}
                  className="w-full text-left px-3.5 py-2 hover:bg-white/10 flex items-center gap-2 transition-colors text-cyan-400"
                >
                  <ListMusic className="w-3.5 h-3.5 text-cyan-400" />
                  Thêm vào hàng đợi
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
  )
}

export const TrackRow = React.memo(TrackRowComponent)
