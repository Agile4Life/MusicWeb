'use client'

import React, { useState } from 'react'
import { Track, Playlist } from '@/types'
import { TrackRow } from './TrackRow'
import { Clock, CheckSquare, Pencil, Trash2, X, Loader2, User, Disc, Scissors, Eye } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { triggerDrivePrewarm } from '@/lib/googleDriveUpload'
import { usePlayer } from '@/components/player/PlayerContext'
import { useListGlideIndicator } from '@/components/common/useGlideIndicator'

interface TrackListProps {
  tracks: Track[]
  userPlaylists?: Playlist[]
  onAddToPlaylist?: (playlistId: string, track: Track) => void
  onDeleteTrack?: (trackId: string) => void
  onDeleteTrackPermanently?: (trackId: string) => void
  onTrackUpdated?: (trackId: string, updates: Partial<Track>) => void
  isAdmin?: boolean
  onBulkUpdated?: (trackIds: string[], updates: Partial<Track>) => void
  onBulkDeleted?: (trackIds: string[]) => void
}

export function TrackList({
  tracks,
  userPlaylists = [],
  onAddToPlaylist,
  onDeleteTrack,
  onDeleteTrackPermanently,
  onTrackUpdated,
  isAdmin = false,
  onBulkUpdated,
  onBulkDeleted,
}: TrackListProps) {
  const { currentTrack, isPlaying, playTrack, togglePlay, addToQueue } = usePlayer()
  const supabase = createClient()
  const {
    containerRef: listContainerRef,
    indicator: trackIndicator,
    handleItemMouseEnter: handleRowMouseEnter,
    handleContainerMouseLeave: handleListMouseLeave,
  } = useListGlideIndicator(52)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkArtist, setBulkArtist] = useState('')
  const [bulkAlbum, setBulkAlbum] = useState('')
  const [updateArtist, setUpdateArtist] = useState(true)
  const [updateAlbum, setUpdateAlbum] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  React.useEffect(() => {
    if (showBulkModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [showBulkModal])

  // Fire-and-forget prewarm for top 3 visible Drive tracks
  React.useEffect(() => {
    if (tracks && tracks.length > 0) {
      triggerDrivePrewarm(tracks.slice(0, 3))
    }
  }, [tracks])

  if (tracks.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 bg-[#181818]/60 border border-white/5 rounded-2xl">
        <p className="text-base font-semibold text-white">Chưa có bài hát nào</p>
      </div>
    )
  }

  const allSelected = tracks.length > 0 && selectedIds.size === tracks.length

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(tracks.map((t) => t.id)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleExecuteBulkEdit = async () => {
    if (selectedIds.size === 0) return
    if (!updateArtist && !updateAlbum) {
      alert('Vui lòng chọn ít nhất một trường thông tin cần cập nhật (Nghệ sĩ hoặc Album)!')
      return
    }

    setSaving(true)
    try {
      const updates: { artist?: string | null; album?: string | null } = {}
      if (updateArtist) updates.artist = bulkArtist.trim() || null
      if (updateAlbum) updates.album = bulkAlbum.trim() || null

      const targetIds = Array.from(selectedIds)

      const res = await fetch('/api/tracks/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetIds, updates }),
      })
      const result = await res.json()

      if (!res.ok) {
        alert('Lỗi sửa hàng loạt: ' + (result.error || 'Không xác định'))
        return
      }

      const updatedIds: string[] = result.updatedIds || targetIds

      // Notify parent or update local state
      if (onBulkUpdated) {
        onBulkUpdated(updatedIds, {
          ...(updateArtist ? { artist: bulkArtist.trim() || undefined } : {}),
          ...(updateAlbum ? { album: bulkAlbum.trim() || undefined } : {}),
        })
      } else if (onTrackUpdated) {
        updatedIds.forEach((id) => {
          onTrackUpdated(id, {
            ...(updateArtist ? { artist: bulkArtist.trim() || undefined } : {}),
            ...(updateAlbum ? { album: bulkAlbum.trim() || undefined } : {}),
          })
        })
      }

      if (result.deniedIds && result.deniedIds.length > 0) {
        alert(`✅ Đã cập nhật ${updatedIds.length} bài hát của bạn. (${result.deniedIds.length} bài hát không thuộc quyền sở hữu đã được bỏ qua).`)
      } else {
        alert(`✅ Đã cập nhật ${updatedIds.length} bài hát thành công!`)
      }
      setShowBulkModal(false)
      setSelectedIds(new Set())
      setBulkArtist('')
      setBulkAlbum('')
    } finally {
      setSaving(false)
    }
  }

  const handleExecuteStripLeadingNumbers = async () => {
    if (selectedIds.size === 0) return
    const targetIds = Array.from(selectedIds)
    const tracksToClean = tracks.filter((t) => targetIds.includes(t.id))

    const leadingNumRegex = /^\s*\d{1,3}[\.\_\-\:\)\s\|]+\s*/

    let cleanedCount = 0
    setSaving(true)
    try {
      for (const track of tracksToClean) {
        if (track.title && leadingNumRegex.test(track.title)) {
          const cleanedTitle = track.title.replace(leadingNumRegex, '').trim()
          if (cleanedTitle && cleanedTitle !== track.title) {
            const res = await fetch(`/api/tracks/${track.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: cleanedTitle }),
            })
            if (res.ok) {
              if (onTrackUpdated) {
                onTrackUpdated(track.id, { title: cleanedTitle })
              }
              cleanedCount++
            }
          }
        }
      }

      alert(`✅ Đã tự động xóa số thứ tự ở đầu tên bài hát cho ${cleanedCount} bài hát!`)
      setSelectedIds(new Set())
    } catch (err: any) {
      alert('Lỗi khi xóa số thứ tự: ' + err?.message)
    } finally {
      setSaving(false)
    }
  }

  const handleExecuteBulkDelete = async () => {
    if (selectedIds.size === 0) return
    const targetIds = Array.from(selectedIds)

    if (!confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn ${targetIds.length} bài hát đã chọn khỏi Thư viện?\n\nHành động này không thể hoàn tác!`)) {
      return
    }

    setDeleting(true)
    try {
      const res = await fetch('/api/tracks/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds: targetIds }),
      })
      const result = await res.json()
      if (!res.ok) {
        alert('Lỗi xóa: ' + (result.error || 'Không xác định'))
        return
      }

      if (result.deniedIds?.length) {
        console.warn('Không có quyền xóa các track:', result.deniedIds)
      }

      const deletedIds: string[] = result.deletedIds ?? targetIds

      if (onBulkDeleted) {
        onBulkDeleted(deletedIds)
      } else if (onDeleteTrackPermanently) {
        deletedIds.forEach((id) => onDeleteTrackPermanently(id))
      }

      alert(`✅ Đã xóa ${deletedIds.length} bài hát khỏi thư viện!`)
      setSelectedIds(new Set())
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 relative">
      {/* Table Header */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 text-xs font-semibold text-gray-400 border-b border-[#282828] mb-2 select-none">
        <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
          {isAdmin && (
            <div className="w-5 shrink-0 flex items-center justify-center" title="Chọn tất cả">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="rounded accent-cyan-400 w-4 h-4 cursor-pointer"
              />
            </div>
          )}
          <span className="w-7 sm:w-8 text-center shrink-0">#</span>
          <span>TIÊU ĐỀ</span>
        </div>
        <div className="hidden lg:block w-1/4">ALBUM</div>
        <div className="flex items-center justify-end shrink-0 lg:w-1/4 text-xs font-semibold text-slate-400 select-none gap-3">
          <span className="w-12 flex justify-center shrink-0" title="Thời lượng">
            <Clock className="w-4 h-4 text-slate-400" />
          </span>
          <div className="min-w-[32px] shrink-0" />
        </div>
      </div>

      {/* Track Rows with Liquid Glide Indicator */}
      <div
        ref={listContainerRef}
        onMouseLeave={handleListMouseLeave}
        className="flex flex-col gap-1 relative"
      >
        <div
          className="track-glide-indicator"
          style={{
            transform: `translateY(${trackIndicator.top}px) scaleY(${trackIndicator.scaleY})`,
            height: `${trackIndicator.height}px`,
            opacity: trackIndicator.opacity,
          }}
        />
        {tracks.map((track, idx) => {
          const isCurrent = currentTrack?.id === track.id
          const isPlayingThis = isCurrent && isPlaying
          return (
            <TrackRow
              key={`${track.source || 'local'}_${track.id}`}
              track={track}
              index={idx}
              isCurrent={isCurrent}
              isPlayingThis={isPlayingThis}
              onMouseEnterRow={handleRowMouseEnter}
              onPlayClick={() => {
                if (isCurrent) {
                  togglePlay()
                } else {
                  playTrack(track, tracks)
                }
              }}
              onAddToQueue={() => addToQueue(track)}
              playlistTracks={tracks}
              userPlaylists={userPlaylists}
              onAddToPlaylist={onAddToPlaylist}
              onDeleteTrack={onDeleteTrack}
              onDeleteTrackPermanently={onDeleteTrackPermanently}
              onTrackUpdated={onTrackUpdated}
              selectable={isAdmin}
              isSelected={selectedIds.has(track.id)}
              onToggleSelect={() => toggleSelect(track.id)}
            />
          )
        })}
      </div>

      {/* 🚀 FLOATING BULK ACTION BAR (ADMIN ONLY) */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="fixed bottom-24 lg:bottom-8 left-1/2 -translate-x-1/2 z-[9990] bg-[#090d16]/95 backdrop-blur-2xl border border-[var(--spotify-glow,#22d3ee)]/40 text-white px-4 sm:px-5 py-2.5 sm:py-3 rounded-full shadow-2xl shadow-black flex items-center gap-2.5 sm:gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200 select-none max-w-[92vw]">
          <div className="flex items-center gap-2 pr-2 border-r border-white/10 text-xs font-bold text-[var(--spotify-glow,#22d3ee)]">
            <CheckSquare className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
            <span>Đã chọn {selectedIds.size} bài</span>
          </div>

          <button
            onClick={() => setShowBulkModal(true)}
            className="bg-gradient-to-r from-[var(--spotify-glow,#22d3ee)] to-[var(--theme-secondary,#3b82f6)] hover:brightness-110 text-black font-extrabold text-xs px-4 py-2 rounded-full flex items-center gap-1.5 shadow-lg transition-transform hover:scale-105"
          >
            <Pencil className="w-3.5 h-3.5" />
            Sửa Nghệ Sĩ & Album
          </button>

          <button
            onClick={handleExecuteStripLeadingNumbers}
            disabled={saving}
            className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 font-semibold text-xs px-3.5 py-2 rounded-full flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Tự động xóa các số thứ tự ở đầu tên bài hát như '23. ', '22. ', '01 - '"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            Xóa Số Đầu Tên Bài
          </button>

          <button
            onClick={handleExecuteBulkDelete}
            disabled={deleting}
            className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 font-semibold text-xs px-3.5 py-2 rounded-full flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
            )}
            Xóa Đã Chọn
          </button>

          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-slate-400 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition-colors"
            title="Bỏ chọn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 🚀 BULK EDIT MODAL */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[99999] flex items-center justify-center p-4 overflow-y-auto">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl border border-[var(--spotify-glow,#22d3ee)]/30 bg-[#0b1019] shadow-2xl relative flex flex-col gap-5 my-auto animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowBulkModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white p-1 rounded-xl hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h3 className="text-xl font-black text-white flex items-center gap-2.5">
                <Pencil className="w-5 h-5 text-[var(--spotify-glow,#22d3ee)]" />
                Sửa Hàng Loạt ({selectedIds.size} bài hát)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Nhập thông tin mới để áp dụng đồng loạt cho tất cả các bài hát đã chọn.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Field 1: Artist */}
              <div className="flex flex-col gap-2 bg-black/40 p-3.5 rounded-2xl border border-white/5">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={updateArtist}
                    onChange={(e) => setUpdateArtist(e.target.checked)}
                    className="rounded accent-[var(--spotify-glow,#22d3ee)] w-3.5 h-3.5 cursor-pointer"
                  />
                  <User className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                  <span>Cập nhật Tên Nghệ Sĩ</span>
                </label>

                {updateArtist && (
                  <input
                    type="text"
                    value={bulkArtist}
                    onChange={(e) => setBulkArtist(e.target.value)}
                    placeholder="Ví dụ: RPT MCK"
                    className="w-full glass-input text-white text-xs rounded-xl px-3.5 py-2.5 outline-none font-medium mt-1 focus:border-[var(--spotify-glow,#22d3ee)]/50"
                  />
                )}
              </div>

              {/* Field 2: Album */}
              <div className="flex flex-col gap-2 bg-black/40 p-3.5 rounded-2xl border border-white/5">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={updateAlbum}
                    onChange={(e) => setUpdateAlbum(e.target.checked)}
                    className="rounded accent-[var(--spotify-glow,#22d3ee)] w-3.5 h-3.5 cursor-pointer"
                  />
                  <Disc className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                  <span>Cập nhật Tên Album</span>
                </label>

                {updateAlbum && (
                  <input
                    type="text"
                    value={bulkAlbum}
                    onChange={(e) => setBulkAlbum(e.target.value)}
                    placeholder="Ví dụ: 99%"
                    className="w-full glass-input text-white text-xs rounded-xl px-3.5 py-2.5 outline-none font-medium mt-1 focus:border-[var(--spotify-glow,#22d3ee)]/50"
                  />
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="px-4 py-2 rounded-full text-xs font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleExecuteBulkEdit}
                className="bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-black font-extrabold text-xs px-5 py-2.5 rounded-full flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang lưu DB...
                  </>
                ) : (
                  'Lưu Thay Đổi Đồng Loạt'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
