'use client'

import React, { useState } from 'react'
import { Track, Playlist } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { Play, Pause, Music, Trash2, MoreVertical, Plus, Pencil, Check, X, Heart } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface TrackRowProps {
  track: Track
  index: number
  playlistTracks?: Track[]
  userPlaylists?: Playlist[]
  onAddToPlaylist?: (playlistId: string, trackId: string) => void
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
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer()
  const [showMenu, setShowMenu] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editArtist, setEditArtist] = useState(track.artist || '')
  const [editAlbum, setEditAlbum] = useState(track.album || '')
  const [saving, setSaving] = useState(false)
  const [isFavorite, setIsFavorite] = useState(Boolean(track.is_favorite))

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
    const { error } = await supabase
      .from('tracks')
      .update({
        artist: editArtist.trim() || null,
        album: editAlbum.trim() || null,
      })
      .eq('id', track.id)

    if (!error) {
      onTrackUpdated?.(track.id, {
        artist: editArtist.trim() || undefined,
        album: editAlbum.trim() || undefined,
      })
    }
    setSaving(false)
    setEditMode(false)
  }

  const handleCancelEdit = () => {
    setEditArtist(track.artist || '')
    setEditAlbum(track.album || '')
    setEditMode(false)
  }

  const handleToggleFavorite = async (event: React.MouseEvent) => {
    event.stopPropagation()
    const nextValue = !isFavorite
    const { error } = await supabase
      .from('tracks')
      .update({ is_favorite: nextValue })
      .eq('id', track.id)
    if (!error) {
      setIsFavorite(nextValue)
      onTrackUpdated?.(track.id, { is_favorite: nextValue })
    }
  }

  return (
    <div
      className={`group flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer select-none border ${
        isSelected
          ? 'bg-amber-500/15 border-amber-500/40 shadow-md'
          : isCurrent
          ? 'bg-white/10 border-[var(--primary-spotify)]/30 shadow-md shadow-[var(--theme-glow-shadow)]'
          : 'border-transparent hover:bg-white/5 hover:border-white/5'
      }`}
      onMouseLeave={() => { if (!editMode) setShowMenu(false) }}
    >
      {/* Optional Admin Select Checkbox */}
      {selectable && (
        <div className="shrink-0 flex items-center pr-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect?.()}
            className="rounded accent-amber-400 w-4 h-4 cursor-pointer"
          />
        </div>
      )}

      {/* Index & Play button */}
      <div className="flex items-center gap-4 w-1/2 truncate">
        <div className="w-6 text-center text-xs font-semibold text-slate-400 shrink-0">
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
        <div className="w-10 h-10 bg-slate-800 rounded-lg overflow-hidden shrink-0 flex items-center justify-center border border-white/10">
          {track.cover_url ? (
            <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
          ) : (
            <Music className="w-4 h-4 text-slate-400" />
          )}
        </div>

        <div className="truncate flex flex-col min-w-0">
          <p
            className={`text-sm font-bold truncate ${
              isCurrent ? 'text-[var(--primary-spotify)]' : 'text-white'
            }`}
          >
            {track.title}
          </p>

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
          track.album || '—'
        )}
      </div>

      {/* Duration & Options */}
      <div className="flex items-center justify-end gap-2 w-1/4 text-xs text-slate-400">
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
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className="p-1.5 hover:text-white hover:bg-white/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMenu && (
              <div className="absolute right-0 top-8 glass-panel shadow-2xl rounded-xl py-1.5 w-56 z-30 text-xs text-slate-200 border border-white/10">
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
                    setEditMode(true)
                    setShowMenu(false)
                  }}
                  className="w-full text-left px-3.5 py-2 hover:bg-white/10 flex items-center gap-2 transition-colors border-b border-white/10"
                >
                  <Pencil className="w-3.5 h-3.5 text-blue-400" />
                  Sửa Nghệ sĩ / Album
                </button>

                {userPlaylists.length > 0 && onAddToPlaylist && (
                  <div className="px-3 py-1 text-slate-400 font-semibold text-[10px] uppercase tracking-wider border-b border-white/10">
                    Thêm vào Playlist
                  </div>
                )}
                {userPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddToPlaylist?.(pl.id, track.id)
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

                {onDeleteTrackPermanently && (
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
