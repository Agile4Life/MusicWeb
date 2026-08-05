'use client'

import React, { useState } from 'react'
import { Track, Playlist } from '@/types'
import { TrackRow } from './TrackRow'
import { Clock, CheckSquare, Pencil, Trash2, X, Loader2, User, Disc } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
  const supabase = createClient()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkArtist, setBulkArtist] = useState('')
  const [bulkAlbum, setBulkAlbum] = useState('')
  const [updateArtist, setUpdateArtist] = useState(true)
  const [updateAlbum, setUpdateAlbum] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  React.useEffect(() => {
    const mainEl = document.querySelector('main')
    if (showBulkModal) {
      document.body.style.overflow = 'hidden'
      if (mainEl) mainEl.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      if (mainEl) mainEl.style.overflow = 'auto'
    }
    return () => {
      document.body.style.overflow = ''
      if (mainEl) mainEl.style.overflow = 'auto'
    }
  }, [showBulkModal])

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

      const { error } = await supabase
        .from('tracks')
        .update(updates)
        .in('id', targetIds)

      if (error) {
        alert('Lỗi cập nhật DB: ' + error.message)
        return
      }

      // Notify parent or update local state
      if (onBulkUpdated) {
        onBulkUpdated(targetIds, {
          ...(updateArtist ? { artist: bulkArtist.trim() || undefined } : {}),
          ...(updateAlbum ? { album: bulkAlbum.trim() || undefined } : {}),
        })
      } else if (onTrackUpdated) {
        targetIds.forEach((id) => {
          onTrackUpdated(id, {
            ...(updateArtist ? { artist: bulkArtist.trim() || undefined } : {}),
            ...(updateAlbum ? { album: bulkAlbum.trim() || undefined } : {}),
          })
        })
      }

      alert(`✅ Đã cập nhật ${targetIds.length} bài hát thành công!`)
      setShowBulkModal(false)
      setSelectedIds(new Set())
      setBulkArtist('')
      setBulkAlbum('')
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
      // Find track file paths for storage deletion
      const tracksToDelete = tracks.filter((t) => selectedIds.has(t.id))

      for (const id of targetIds) {
        await supabase.from('playlist_tracks').delete().eq('track_id', id)
        await supabase.from('favorite_tracks').delete().eq('track_id', id)
        await supabase.from('listening_history').delete().eq('track_id', id)
      }

      const { error } = await supabase.from('tracks').delete().in('id', targetIds)

      if (error) {
        alert('Lỗi xóa DB: ' + error.message)
        return
      }

      // Delete storage files (skip Google Drive URLs that start with http)
      const storagePaths = tracksToDelete.map((t) => t.file_path).filter((p) => p && !p.startsWith('http')) as string[]
      if (storagePaths.length > 0) {
        await supabase.storage.from('music-files').remove(storagePaths)
      }

      if (onBulkDeleted) {
        onBulkDeleted(targetIds)
      } else if (onDeleteTrackPermanently) {
        targetIds.forEach((id) => onDeleteTrackPermanently(id))
      }

      alert(`✅ Đã xóa ${targetIds.length} bài hát khỏi thư viện!`)
      setSelectedIds(new Set())
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 relative">
      {/* Table Header */}
      <div className="flex items-center justify-between px-4 py-2 text-xs font-semibold text-gray-400 border-b border-[#282828] mb-2 select-none">
        <div className="flex items-center gap-4 w-1/2">
          {isAdmin ? (
            <div className="shrink-0 flex items-center pr-1" title="Chọn tất cả">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="rounded accent-amber-400 w-4 h-4 cursor-pointer"
              />
            </div>
          ) : (
            <span className="w-6 text-center">#</span>
          )}
          <span>TIÊU ĐỀ</span>
        </div>
        <div className="hidden md:block w-1/4">ALBUM</div>
        <div className="flex items-center justify-end w-1/4 pr-2">
          <Clock className="w-4 h-4" />
        </div>
      </div>

      {/* Track Rows */}
      {tracks.map((track, idx) => (
        <TrackRow
          key={track.id}
          track={track}
          index={idx}
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
      ))}

      {/* 🚀 FLOATING BULK ACTION BAR (ADMIN ONLY) */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/90 backdrop-blur-xl border border-amber-500/40 text-white px-5 py-3 rounded-full shadow-2xl shadow-black/80 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200 select-none">
          <div className="flex items-center gap-2 pr-2 border-r border-white/10 text-xs font-bold text-amber-400">
            <CheckSquare className="w-4 h-4 text-amber-400" />
            <span>Đã chọn {selectedIds.size} bài</span>
          </div>

          <button
            onClick={() => setShowBulkModal(true)}
            className="bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs px-4 py-2 rounded-full flex items-center gap-1.5 shadow-lg transition-transform hover:scale-105"
          >
            <Pencil className="w-3.5 h-3.5" />
            Sửa Hàng Loạt
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl border border-amber-500/30 shadow-2xl relative flex flex-col gap-5 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowBulkModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white p-1 rounded-xl hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h3 className="text-xl font-black text-white flex items-center gap-2.5">
                <Pencil className="w-5 h-5 text-amber-400" />
                Sửa Hàng Loạt ({selectedIds.size} bài hát)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Nhập thông tin mới để áp dụng đồng loạt cho tất cả các bài hát đã chọn.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Field 1: Artist */}
              <div className="flex flex-col gap-2 bg-black/30 p-3.5 rounded-2xl border border-white/5">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={updateArtist}
                    onChange={(e) => setUpdateArtist(e.target.checked)}
                    className="rounded accent-amber-400 w-3.5 h-3.5 cursor-pointer"
                  />
                  <User className="w-4 h-4 text-amber-400" />
                  <span>Cập nhật Tên Nghệ Sĩ</span>
                </label>

                {updateArtist && (
                  <input
                    type="text"
                    value={bulkArtist}
                    onChange={(e) => setBulkArtist(e.target.value)}
                    placeholder="Ví dụ: RPT MCK"
                    className="w-full glass-input text-white text-xs rounded-xl px-3.5 py-2.5 outline-none font-medium mt-1 focus:border-amber-400/50"
                  />
                )}
              </div>

              {/* Field 2: Album */}
              <div className="flex flex-col gap-2 bg-black/30 p-3.5 rounded-2xl border border-white/5">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={updateAlbum}
                    onChange={(e) => setUpdateAlbum(e.target.checked)}
                    className="rounded accent-amber-400 w-3.5 h-3.5 cursor-pointer"
                  />
                  <Disc className="w-4 h-4 text-amber-400" />
                  <span>Cập nhật Tên Album</span>
                </label>

                {updateAlbum && (
                  <input
                    type="text"
                    value={bulkAlbum}
                    onChange={(e) => setBulkAlbum(e.target.value)}
                    placeholder="Ví dụ: 99%"
                    className="w-full glass-input text-white text-xs rounded-xl px-3.5 py-2.5 outline-none font-medium mt-1 focus:border-amber-400/50"
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
                className="bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs px-5 py-2.5 rounded-full flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50"
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
