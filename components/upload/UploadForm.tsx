'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Upload,
  Music,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Trash2,
  RotateCcw,
  FileAudio,
  Plus,
  SlidersHorizontal,
  Check,
  Play,
  Copy,
  AlertTriangle,
  Zap,
  X,
} from 'lucide-react'
import * as mm from 'music-metadata-browser'
import { uploadToGoogleDrive, buildDriveStreamUrl } from '@/lib/googleDriveUpload'

export interface QueueItem {
  id: string
  file: File
  title: string
  artist: string
  album: string
  duration: number
  fileSize: number
  status: 'idle' | 'parsing' | 'compressing' | 'uploading' | 'saving_db' | 'completed' | 'error' | 'skipped'
  progress: number
  compressInfo?: string | null
  error?: string | null
  isDuplicate?: boolean
  duplicateReason?: string | null
  forceUpload?: boolean
  dbTrackId?: string | null
  uploadedFilePath?: string | null
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

function cleanSongTitle(str: string): string {
  if (!str) return ''
  return str
    .toLowerCase()
    .replace(/\.[^/.]+$/, '') // remove file extension if any
    .replace(/^\d+[\s._-]+/, '') // remove leading track numbers like "01 - ", "01. ", "1 "
    .replace(/\(official audio\)|\(lyric video\)|\(audio\)|\(official music video\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanSongArtist(str: string | null | undefined): string {
  return (str || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function trackDuplicateKey(title: string, artist: string | null | undefined): string {
  return `${cleanSongTitle(title)}|||${cleanSongArtist(artist)}`
}

interface UploadFormProps {
  playlistId?: string
  onClose?: () => void
}

export function UploadForm({ playlistId, onClose }: UploadFormProps = {}) {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [skipDuplicates, setSkipDuplicates] = useState<boolean>(true) // Auto-skip duplicates
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [overallBatchInfo, setOverallBatchInfo] = useState<string | null>(null)
  const [existingUserTracks, setExistingUserTracks] = useState<Array<{ title: string; artist?: string | null }>>([])

  // Fetch user's existing tracks from DB for duplicate checking (returns array directly to avoid closure stale state)
  const fetchExistingTracks = async (): Promise<Array<{ title: string; artist?: string | null }>> => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return []

      const trackList: Array<{ title: string; artist?: string | null }> = []

      // The base schema stores artist directly on tracks. Do not query the
      // optional view/artist relation here: a failed nested select used to be
      // silently ignored and disabled duplicate detection completely.
      const { data: rawData } = await supabase
        .from('tracks')
        .select('title, artist')
        .eq('user_id', user.id)

      if (rawData) {
        rawData.forEach((t: any) => {
          const cleanTitle = cleanSongTitle(t.title || '')
          if (cleanTitle) {
            trackList.push({
              title: cleanTitle,
              artist: cleanSongArtist(t.artist),
            })
          }
        })
      }

      setExistingUserTracks(trackList)
      return trackList
    } catch (err) {
      console.warn('Could not fetch user tracks for duplicate checking:', err)
      return []
    }
  }

  useEffect(() => {
    fetchExistingTracks()
  }, [])

  // Helper to check if a track is a duplicate against DB or local Queue
  const checkDuplicate = (
    title: string,
    artist: string,
    id: string,
    currentQueue: QueueItem[],
    dbTracks: Array<{ title: string; artist?: string | null }>
  ): { isDuplicate: boolean; reason: string | null } => {
    const normTitle = cleanSongTitle(title)
    const normArtist = cleanSongArtist(artist)

    if (!normTitle) return { isDuplicate: false, reason: null }

    // 1. Check against DB library (matches normalized title)
    const existsInDb = dbTracks.some((t) => {
      if (cleanSongTitle(t.title) !== normTitle) return false
      if (!normArtist || !t.artist) return true
      const existingArtist = cleanSongArtist(t.artist)
      return existingArtist === normArtist
    })

    if (existsInDb) {
      return { isDuplicate: true, reason: 'Bài hát đã có sẵn trong Thư viện cá nhân' }
    }

    // 2. Check against other items in current Queue
    const existsInQueue = currentQueue.some(
      (item) =>
      item.id !== id &&
        trackDuplicateKey(item.title, item.artist) === trackDuplicateKey(title, artist)
    )

    if (existsInQueue) {
      return { isDuplicate: true, reason: 'Trùng lặp với 1 bài khác trong hàng chờ' }
    }

    return { isDuplicate: false, reason: null }
  }

  // Update queue items with duplicate status
  const recalculateDuplicates = (
    items: QueueItem[],
    dbTracks: Array<{ title: string; artist?: string | null }> = existingUserTracks
  ): QueueItem[] => {
    return items.map((item) => {
      const dupInfo = checkDuplicate(item.title, item.artist, item.id, items, dbTracks)
      return {
        ...item,
        isDuplicate: dupInfo.isDuplicate,
        duplicateReason: dupInfo.reason,
      }
    })
  }

  // Automatically recalculate queue duplicates whenever existingUserTracks state is loaded or updated
  useEffect(() => {
    if (existingUserTracks.length > 0 && queue.length > 0) {
      setQueue((prev) => recalculateDuplicates(prev, existingUserTracks))
    }
  }, [existingUserTracks])

  // Update a single queue item helper (optimized: skips expensive recalculateDuplicates on progress ticks)
  const updateItem = (id: string, updates: Partial<QueueItem>) => {
    setQueue((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
      if (updates.title !== undefined || updates.artist !== undefined) {
        return recalculateDuplicates(next)
      }
      return next
    })
  }

  // Handle selected/dropped files
  const handleFilesSelected = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(
      (f) =>
        /\.(mp3|wav|m4a|flac|aac|ogg)$/i.test(f.name) ||
        f.type.startsWith('audio/')
    )

    if (fileArray.length === 0) return

    // Fetch fresh user tracks from DB synchronously to avoid closure lag
    const freshDbTracks = await fetchExistingTracks()

    // Create unique queue items immediately for EVERY file in the dropped selection
    const timestamp = Date.now()
    const newItems: QueueItem[] = fileArray.map((f, idx) => {
      const fileNameWithoutExt = f.name.replace(/\.[^/.]+$/, '')
      return {
        id: `${timestamp}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
        file: f,
        title: fileNameWithoutExt,
        artist: '',
        album: '',
        duration: 0,
        fileSize: f.size,
        status: 'parsing',
        progress: 0,
      }
    })

    // Immediately add all items to queue so user sees every song in the list right away with duplicate checks
    setQueue((prev) => recalculateDuplicates([...prev, ...newItems], freshDbTracks))

    // Parse metadata concurrently (parallel) for all dropped files
    await Promise.all(
      newItems.map(async (item) => {
        try {
          const metadata = await mm.parseBlob(item.file)
          const metaTitle = metadata.common.title ? metadata.common.title.trim() : ''
          const metaArtist = metadata.common.artist ? metadata.common.artist.trim() : ''
          const metaAlbum = metadata.common.album ? metadata.common.album.trim() : ''
          const metaDuration = metadata.format.duration ? Math.round(metadata.format.duration) : 0

          setQueue((prev) => {
            const updated = prev.map((q) => {
              if (q.id !== item.id) return q
              return {
                ...q,
                title: metaTitle || q.title,
                artist: metaArtist || q.artist,
                album: metaAlbum || q.album,
                duration: metaDuration || q.duration,
                status: 'idle' as const,
              }
            })
            return recalculateDuplicates(updated, freshDbTracks)
          })
        } catch (err) {
          console.warn('Metadata parsing notice:', err)
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, status: 'idle' } : q))
          )
        }
      })
    )
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files)
    }
  }

  const removeItem = async (id: string) => {
    if (isUploading) return
    const itemToRemove = queue.find((i) => i.id === id)

    // If the track was already successfully uploaded to DB & Storage during this session
    if (itemToRemove && (itemToRemove.status === 'completed' || itemToRemove.dbTrackId)) {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (user) {
          let tracksToDelete: Array<{ id: string; file_path?: string | null }> = []

          if (itemToRemove.dbTrackId) {
            tracksToDelete.push({
              id: itemToRemove.dbTrackId,
              file_path: itemToRemove.uploadedFilePath,
            })
          } else {
            const cleanTitle = (itemToRemove.title || itemToRemove.file.name).trim()
            const { data: foundTracks } = await supabase
              .from('tracks')
              .select('id, file_path')
              .eq('user_id', user.id)
              .eq('title', cleanTitle)

            if (foundTracks && foundTracks.length > 0) {
              tracksToDelete = foundTracks
            }
          }

          for (const t of tracksToDelete) {
            // Delete dependent records first to prevent foreign key constraint failures
            await supabase.from('playlist_tracks').delete().eq('track_id', t.id)
            await supabase.from('favorite_tracks').delete().eq('track_id', t.id)
            await supabase.from('listening_history').delete().eq('track_id', t.id)

            // Delete track record from DB
            const { error: delError } = await supabase.from('tracks').delete().eq('id', t.id)
            if (delError) {
              console.error('Failed to delete track from DB:', delError.message)
            }

            // Remove file from Supabase Storage (skip if it's a Google Drive URL)
            if (t.file_path && !t.file_path.startsWith('http')) {
              await supabase.storage.from('music-files').remove([t.file_path])
            }
          }

          router.refresh()
          await fetchExistingTracks()
        }
      } catch (err) {
        console.warn('Error deleting track from DB/Storage:', err)
      }
    }

    setQueue((prev) => recalculateDuplicates(prev.filter((item) => item.id !== id)))
  }

  const clearCompleted = () => {
    setQueue((prev) => recalculateDuplicates(prev.filter((item) => item.status !== 'completed' && item.status !== 'skipped')))
  }

  // Upload single track workflow with mandatory lightweight MP3 compression & live DB check
  const processSingleTrack = async (
    item: QueueItem,
    userId: string,
    batchKeys: Set<string>
  ): Promise<boolean> => {
    const cleanTitle = (item.title || item.file.name).trim()
    const uploadKey = trackDuplicateKey(cleanTitle, item.artist)

    // 0. Auto-skip if marked duplicate and skipDuplicates is checked (unless forceUpload is true)
    if (skipDuplicates && item.isDuplicate && !item.forceUpload) {
      updateItem(item.id, {
        status: 'skipped',
        progress: 0,
        compressInfo: null,
        error: `Tự động bỏ qua bài trùng (${item.duplicateReason || 'Đã có trong Thư viện'})`,
      })
      return true
    }

    // 0b. Live DB duplicate check right before processing. This is done after
    // metadata parsing and uses the same title+artist normalization as the UI.
    if (skipDuplicates && !item.forceUpload) {
      const { data: dbCheck } = await supabase
        .from('tracks')
        .select('id, title, artist')
        .eq('user_id', userId)
        .limit(1000)

      const existsInDb = dbCheck?.some((track: { title: string; artist: string | null }) =>
        trackDuplicateKey(track.title, track.artist) === uploadKey
      )
      if (existsInDb || batchKeys.has(uploadKey)) {
        updateItem(item.id, {
          status: 'skipped',
          progress: 0,
          isDuplicate: true,
          duplicateReason: 'Bài hát đã có sẵn trong Thư viện cá nhân',
          compressInfo: null,
          error: `Tự động bỏ qua bài trùng ("${cleanTitle}" đã có trong Thư viện)`,
        })
        return true
      }
    }

    // Reserve the normalized key before the network upload starts. This closes
    // the same-batch race where every item was checked against the old DB state.
    if (!item.forceUpload) batchKeys.add(uploadKey)

    try {
      const uploadFile = item.file

      updateItem(item.id, {
        status: 'uploading',
        progress: 10,
        compressInfo: `Đang tải file gốc (${formatFileSize(item.file.size)}) lên Google Drive...`,
      })

      // Lấy tên Playlist nếu có playlistId để tự tạo thư mục tương ứng trên Google Drive
      let targetFolderName: string | undefined = undefined
      if (playlistId) {
        try {
          const { data: plData } = await supabase
            .from('playlists')
            .select('name')
            .eq('id', playlistId)
            .single()
          if (plData?.name) targetFolderName = plData.name
        } catch {
          // ignore
        }
      }

      // 2. Upload trực tiếp lên Google Drive qua Cloudflare Resumable Upload Session
      const driveResult = await uploadToGoogleDrive({
        file: uploadFile,
        fileName: cleanTitle,
        folderName: targetFolderName,
        onProgress: ({ percent }) => {
          updateItem(item.id, {
            progress: 10 + Math.round(percent * 0.7),
          })
        },
      })

      if (!driveResult.success || !driveResult.fileId) {
        throw new Error(`Upload Google Drive thất bại: ${driveResult.error || 'Không nhận được File ID'}`)
      }

      // Streaming URL phát nhạc trực tiếp từ Google Drive
      const filePath = buildDriveStreamUrl(driveResult.fileId)

      // 3. Save to DB
      updateItem(item.id, { status: 'saving_db', progress: 80 })

      let artistId: string | null = null
      // Note: artist_id FK is not in the base schema — artist name stored directly as TEXT
      // Kept here in case user has an extended schema with artist_id
      if (item.artist && item.artist.trim()) {
        try {
          const { data: artistData } = await supabase.rpc('fn_get_or_create_artist', {
            p_name: item.artist.trim(),
          })
          if (artistData) artistId = artistData
        } catch {
          // RPC not available — use artist TEXT column directly
        }
      }

      let insertedTrackId: string | null = null

      const { data: trackData, error: dbError } = await supabase
        .from('tracks')
        .insert({
          user_id: userId,
          title: cleanTitle,
          artist: item.artist || null,
          album: item.album || null,
          duration: item.duration || 0,
          file_path: filePath,
          file_size: uploadFile.size,
          ...(artistId ? { artist_id: artistId } : {}),
        })
        .select('id')
        .single()

      if (trackData?.id) {
        insertedTrackId = trackData.id
      }

      if (dbError) {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('tracks')
          .insert({
            user_id: userId,
            title: cleanTitle,
            artist: item.artist || null,
            album: item.album || null,
            duration: item.duration || 0,
            file_path: filePath,
          })
          .select('id')
          .single()

        if (fallbackError) {
          throw new Error(`Lỗi lưu DB: ${dbError.message}`)
        }
        if (fallbackData?.id) {
          insertedTrackId = fallbackData.id
        }
      }

      // If uploading directly into a playlist, add track to playlist
      if (playlistId && insertedTrackId) {
        try {
          await supabase.rpc('fn_add_track_to_playlist', {
            p_playlist_id: playlistId,
            p_track_id: insertedTrackId,
          })
        } catch (plErr) {
          console.warn('Could not add track to playlist:', plErr)
        }
      }

      // Refresh DB tracks list after successful insert
      await fetchExistingTracks()

      updateItem(item.id, {
        status: 'completed',
        progress: 100,
        compressInfo: '✅ Hoàn tất!',
        error: null,
        dbTrackId: insertedTrackId,
        uploadedFilePath: filePath,
      })
      return true
    } catch (err: any) {
      if (!item.forceUpload) batchKeys.delete(uploadKey)
      let msg = err.message || 'Đã xảy ra lỗi khi upload'
      if (msg.includes('exceeded the maximum allowed size') || msg.includes('413')) {
        msg = 'File vượt quá giới hạn Supabase Storage Bucket. Vui lòng kiểm tra Max file size trong Dashboard.'
      }
      updateItem(item.id, {
        status: 'error',
        progress: 0,
        error: msg,
      })
      return false
    }
  }

  // Sequential upload runner — processes one track at a time to avoid Supabase overload
  const startBatchUpload = async (targetItems?: QueueItem[]) => {
    const itemsToUpload =
      targetItems ||
      queue.filter((i) => i.status === 'idle' || i.status === 'error' || (i.status === 'skipped' && i.forceUpload))

    if (itemsToUpload.length === 0) return

    setIsUploading(true)
    setOverallBatchInfo(`Chuẩn bị upload ${itemsToUpload.length} bài hát...`)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        alert('Bạn cần đăng nhập để upload nhạc')
        setIsUploading(false)
        return
      }

      // Fetch fresh existing tracks list from DB before starting
      await fetchExistingTracks()

      const total = itemsToUpload.length
      const batchKeys = new Set<string>()
      for (let i = 0; i < total; i++) {
        const item = itemsToUpload[i]
        setOverallBatchInfo(`⏫ Đang xử lý bài ${i + 1} / ${total}: "${item.title}"...`)
        // Process one track at a time — await before moving to next
        await processSingleTrack(item, user.id, batchKeys)
      }

      setOverallBatchInfo('🎉 Đã hoàn tất xử lý tất cả bài hát!')
    } catch (err: any) {
      console.error('Upload error:', err)
    } finally {
      setIsUploading(false)
    }
  }

  // Queue Statistics
  const totalCount = queue.length
  const completedCount = queue.filter((i) => i.status === 'completed').length
  const skippedCount = queue.filter((i) => i.status === 'skipped').length
  const errorCount = queue.filter((i) => i.status === 'error').length
  const duplicateCount = queue.filter((i) => i.isDuplicate).length
  const inProgressCount = queue.filter(
    (i) =>
      i.status === 'compressing' ||
      i.status === 'uploading' ||
      i.status === 'saving_db'
  ).length
  const pendingCount = queue.filter(
    (i) => (i.status === 'idle' || i.status === 'parsing') && (!i.isDuplicate || i.forceUpload)
  ).length

  const finishedCount = completedCount + skippedCount
  const overallProgressPercent =
    totalCount > 0 ? Math.round((finishedCount / totalCount) * 100) : 0

  return (
    <div className="max-w-4xl mx-auto glass-panel p-5 md:p-6 rounded-3xl border border-white/10 shadow-2xl relative flex flex-col max-h-[85vh] overflow-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 shrink-0 pr-8 relative">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-white flex items-center gap-2.5">
            <Upload className="w-6 h-6 text-[var(--primary-spotify)]" />
            Upload Hàng Loạt Bài Hát
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Tải nhiều bài hát cùng lúc • Nén MP3 (256kbps) file &gt;= 10MB • Tự phát hiện &amp; bỏ qua bài trùng
          </p>
        </div>

        {/* Settings: Skip Duplicates */}
        <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white select-none bg-black/40 px-3 py-1.5 rounded-2xl border border-white/10">
          <input
            type="checkbox"
            checked={skipDuplicates}
            onChange={(e) => setSkipDuplicates(e.target.checked)}
            className="rounded accent-[var(--primary-spotify)] w-3.5 h-3.5 cursor-pointer"
          />
          <span className="font-semibold text-xs text-amber-300 flex items-center gap-1">
            <Copy className="w-3.5 h-3.5" /> Tự bỏ bài trùng
          </span>
        </label>

        {/* Optional Close Button */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-0 right-0 text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition-colors"
            title="Đóng cửa sổ"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Multi-file Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-4 text-center transition-all cursor-pointer mb-3 shrink-0 ${
          isDragging
            ? 'border-[var(--primary-spotify)] bg-[var(--primary-spotify)]/15 scale-[1.01] shadow-xl shadow-[var(--theme-glow-shadow)]'
            : 'border-white/15 hover:border-[var(--primary-spotify)]/80 bg-black/30 hover:bg-black/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".mp3,.wav,.m4a,.flac,.aac,.ogg"
          onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
          className="hidden"
        />

        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-gradient-to-tr from-[var(--primary-spotify)]/20 to-purple-500/20 rounded-xl flex items-center justify-center text-[var(--primary-spotify)] border border-[var(--primary-spotify)]/30">
            <FileAudio className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-bold text-white">
              Nhấp để chọn hoặc Kéo & thả nhiều file âm thanh vào đây
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Upload file gốc trực tiếp lên Google Drive (Không giới hạn dung lượng)
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--primary-spotify)] bg-[var(--primary-spotify)]/10 px-2.5 py-0.5 rounded-full border border-[var(--primary-spotify)]/20">
            <Plus className="w-3 h-3" /> Thêm file vào danh sách
          </span>
        </div>
      </div>

      {/* Overall Queue Progress Banner */}
      {totalCount > 0 && (
        <div className="bg-black/40 rounded-2xl p-3 border border-white/10 mb-3 flex flex-col gap-2 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-slate-200 text-[11px]">
              <span>Hàng chờ: <strong className="text-white">{totalCount}</strong> bài</span>
              <span>•</span>
              <span className="text-emerald-400">Đã xong: <strong>{completedCount}</strong></span>
              {duplicateCount > 0 && (
                <>
                  <span>•</span>
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Trùng bài: <strong>{duplicateCount}</strong>
                  </span>
                </>
              )}
              {skippedCount > 0 && (
                <>
                  <span>•</span>
                  <span className="text-slate-400">Đã bỏ qua: <strong>{skippedCount}</strong></span>
                </>
              )}
              <span>•</span>
              <span className="text-cyan-400">Đang chạy: <strong>{inProgressCount}</strong></span>
              <span>•</span>
              <span className="text-red-400">Lỗi: <strong>{errorCount}</strong></span>
            </div>

            <div className="text-slate-400 text-[11px] font-bold">
              Tiến trình tổng: {overallProgressPercent}%
            </div>
          </div>

          {/* Overall Progress Bar */}
          <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-[var(--primary-spotify)] to-emerald-400 h-full transition-all duration-300"
              style={{ width: `${overallProgressPercent}%` }}
            />
          </div>

          {overallBatchInfo && (
            <div className="text-[11px] font-medium text-[var(--primary-spotify)] flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 animate-pulse" />
              <span>{overallBatchInfo}</span>
            </div>
          )}
        </div>
      )}

      {/* Controls Bar */}
      {totalCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 shrink-0">
          <div className="flex items-center gap-2">
            {(completedCount > 0 || skippedCount > 0) && (
              <button
                type="button"
                disabled={isUploading}
                onClick={clearCompleted}
                className="text-[11px] font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-xl border border-white/10 transition-all"
              >
                Xóa bài đã xong / bỏ qua ({completedCount + skippedCount})
              </button>
            )}

            {errorCount > 0 && (
              <button
                type="button"
                disabled={isUploading}
                onClick={() => startBatchUpload(queue.filter((i) => i.status === 'error'))}
                className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 rounded-xl border border-amber-500/30 transition-all flex items-center gap-1.5"
              >
                <RotateCcw className="w-3 h-3" /> Thử lại bài lỗi ({errorCount})
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={isUploading || (pendingCount === 0 && errorCount === 0)}
            onClick={() => startBatchUpload()}
            className="bg-[var(--primary-spotify)] text-black font-extrabold px-5 py-2 rounded-full transition-all flex items-center justify-center gap-2 disabled:opacity-40 shadow-lg shadow-[var(--theme-glow-shadow)] text-xs"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Đang Nén & Upload từng bài...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-black" />
                Bắt Đầu Nén & Upload Mới ({pendingCount} bài)
              </>
            )}
          </button>
        </div>
      )}

      {/* Queue Items List */}
      {totalCount === 0 ? (
        <div className="text-center py-8 border border-dashed border-white/5 rounded-2xl bg-black/20 shrink-0">
          <Music className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-40" />
          <p className="text-slate-400 text-xs font-medium">Chưa có bài hát nào trong hàng chờ</p>
          <p className="text-slate-500 text-[11px] mt-0.5">Kéo thả các file nhạc vào ô phía trên để bắt đầu</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 flex-1 min-h-0 overflow-y-auto pr-1">
          {queue.map((item, idx) => {
            const isCompleted = item.status === 'completed'
            const isSkipped = item.status === 'skipped'
            const isError = item.status === 'error'
            const isProcessing =
              item.status === 'compressing' ||
              item.status === 'uploading' ||
              item.status === 'saving_db'
            const isParsing = item.status === 'parsing'

            return (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border transition-all flex flex-col gap-3 ${
                  isCompleted
                    ? 'bg-emerald-950/20 border-emerald-500/30'
                    : isSkipped
                    ? 'bg-slate-900/40 border-slate-700/40 opacity-75'
                    : isError
                    ? 'bg-red-950/20 border-red-500/30'
                    : item.isDuplicate
                    ? 'bg-amber-950/20 border-amber-500/40'
                    : isProcessing
                    ? 'bg-black/60 border-[var(--primary-spotify)]/50 shadow-md'
                    : 'bg-black/30 border-white/10 hover:border-white/20'
                }`}
              >
                {/* Item Top Info */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center shrink-0 border border-white/10 text-slate-300">
                      {isParsing ? (
                        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                      ) : isCompleted ? (
                        <CheckCircle2 className="w-5 h-5 text-[var(--primary-spotify)]" />
                      ) : isError ? (
                        <AlertCircle className="w-5 h-5 text-red-400" />
                      ) : item.isDuplicate ? (
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                      ) : (
                        <Music className="w-5 h-5 text-[var(--primary-spotify)]" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400">#{idx + 1}</span>
                        <input
                          type="text"
                          disabled={isUploading || isCompleted}
                          value={item.title}
                          onChange={(e) => updateItem(item.id, { title: e.target.value })}
                          placeholder="Tên bài hát *"
                          className="bg-transparent text-sm font-bold text-white focus:outline-none border-b border-transparent focus:border-[var(--primary-spotify)] transition-colors w-full"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
                        <input
                          type="text"
                          disabled={isUploading || isCompleted}
                          value={item.artist}
                          onChange={(e) => updateItem(item.id, { artist: e.target.value })}
                          placeholder="Nghệ sĩ..."
                          className="bg-transparent text-xs text-slate-300 focus:outline-none border-b border-transparent focus:border-[var(--primary-spotify)] w-36"
                        />
                        <span>•</span>
                        <span>{formatFileSize(item.fileSize)}</span>
                        <span>•</span>
                        <span>{formatDuration(item.duration)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge & Actions */}
                  <div className="flex items-center gap-3 self-end md:self-center shrink-0">
                    <div className="text-xs">
                      {isParsing && (
                        <span className="text-slate-400 italic">Đang đọc metadata...</span>
                      )}
                      {item.status === 'idle' && !item.isDuplicate && (
                        <span className="text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10 font-semibold">
                          {item.fileSize >= 10 * 1024 * 1024 ? 'Sẵn sàng nén' : 'Sẵn sàng upload'}
                        </span>
                      )}
                      {item.status === 'idle' && item.isDuplicate && (
                        <span className="text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/30 font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Bài trùng
                        </span>
                      )}
                      {item.status === 'compressing' && (
                        <span className="text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20 font-semibold flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Đang nén MP3
                        </span>
                      )}
                      {item.status === 'uploading' && (
                        <span className="text-[var(--primary-spotify)] bg-[var(--primary-spotify)]/10 px-2.5 py-1 rounded-full border border-[var(--primary-spotify)]/20 font-semibold flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Đang upload
                        </span>
                      )}
                      {item.status === 'saving_db' && (
                        <span className="text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded-full border border-cyan-500/20 font-semibold flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Lưu DB
                        </span>
                      )}
                      {isCompleted && (
                        <span className="text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 font-bold flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Hoàn thành
                        </span>
                      )}
                      {isSkipped && (
                        <span className="text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10 font-medium">
                          Đã bỏ qua (Trùng)
                        </span>
                      )}
                      {isError && (
                        <span className="text-red-400 bg-red-500/10 px-2.5 py-1 rounded-full border border-red-500/20 font-bold flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" /> Lỗi
                        </span>
                      )}
                    </div>

                    {item.isDuplicate && !isCompleted && !isUploading && (
                      <button
                        type="button"
                        onClick={() => {
                          updateItem(item.id, { forceUpload: !item.forceUpload })
                        }}
                        className={`text-xs px-2.5 py-1 rounded-xl font-bold border transition-all ${
                          item.forceUpload
                            ? 'bg-amber-500 text-black border-amber-400 shadow-md'
                            : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                        }`}
                        title="Cho phép upload trùng"
                      >
                        {item.forceUpload ? 'Vẫn upload' : 'Bỏ qua (Trùng)'}
                      </button>
                    )}

                    {isError && !isUploading && (
                      <button
                        type="button"
                        onClick={() => startBatchUpload([item])}
                        className="text-amber-400 hover:text-amber-300 p-1.5 rounded-lg hover:bg-amber-500/10 transition-colors"
                        title="Thử lại bài này"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}

                    {!isUploading && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        title="Xóa khỏi hàng chờ"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Duplicate warning notification */}
                {item.isDuplicate && !isCompleted && !isSkipped && (
                  <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                      <span>{item.duplicateReason}</span>
                    </div>
                    <span className="text-[10px] text-amber-400/80 italic">
                      {item.forceUpload ? '(Sẽ upload trùng bài)' : skipDuplicates ? '(Sẽ tự động bỏ qua không nén/up)' : '(Vẫn upload)'}
                    </span>
                  </div>
                )}

                {/* Compression info notification */}
                {item.compressInfo && (
                  <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-xs flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 shrink-0 animate-pulse text-amber-400" />
                    <span className="truncate">{item.compressInfo}</span>
                  </div>
                )}

                {/* Error notification */}
                {item.error && (
                  <div className="p-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{item.error}</span>
                  </div>
                )}

                {/* Individual Progress Bar */}
                {(isProcessing || item.progress > 0) && !isCompleted && (
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden mt-1">
                    <div
                      className="bg-[var(--primary-spotify)] h-full transition-all duration-200"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Done Footer */}
      {completedCount > 0 && completedCount + skippedCount === totalCount && (
        <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3 text-emerald-300 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-[var(--primary-spotify)] shrink-0" />
            <span className="font-semibold">
              Đã xử lý xong hàng chờ: {completedCount} bài upload thành công{skippedCount > 0 ? `, ${skippedCount} bài bị trùng đã bỏ qua` : ''}!
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              router.push('/')
              router.refresh()
            }}
            className="bg-[var(--primary-spotify)] text-black font-extrabold px-4 py-2 rounded-full hover:brightness-110 transition-all text-xs shrink-0"
          >
            Về Trang Chủ nghe nhạc ➔
          </button>
        </div>
      )}
    </div>
  )
}
