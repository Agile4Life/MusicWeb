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
} from 'lucide-react'
import * as mm from 'music-metadata-browser'
import { compressAudioIfNeeded } from '@/lib/audioCompressor'

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

export function UploadForm() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [batchSize, setBatchSize] = useState<number>(2) // Default 2 tracks per batch chunk
  const [targetBitrate, setTargetBitrate] = useState<number>(256) // Default 256kbps lightweight MP3
  const [skipDuplicates, setSkipDuplicates] = useState<boolean>(true) // Auto-skip duplicates
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [overallBatchInfo, setOverallBatchInfo] = useState<string | null>(null)
  const [existingUserTracks, setExistingUserTracks] = useState<Array<{ title: string; artist?: string | null }>>([])

  // Fetch user's existing tracks from DB for duplicate checking
  useEffect(() => {
    const fetchExistingTracks = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data } = await supabase
        .from('tracks')
        .select('title, artist, artists(name)')
        .eq('user_id', user.id)

      if (data) {
        const normalized = data.map((t: any) => ({
          title: (t.title || '').trim().toLowerCase(),
          artist: (t.artists?.name || t.artist || '').trim().toLowerCase(),
        }))
        setExistingUserTracks(normalized)
      }
    }

    fetchExistingTracks()
  }, [])

  // Helper to check if a track is a duplicate against DB or local Queue
  const checkDuplicate = (
    title: string,
    artist: string,
    id: string,
    currentQueue: QueueItem[]
  ): { isDuplicate: boolean; reason: string | null } => {
    const cleanTitle = title.trim().toLowerCase()
    const cleanArtist = artist.trim().toLowerCase()

    if (!cleanTitle) return { isDuplicate: false, reason: null }

    // 1. Check against DB library
    const existsInDb = existingUserTracks.some((t) => {
      if (t.title !== cleanTitle) return false
      if (!cleanArtist) return true
      return t.artist === cleanArtist || t.artist === ''
    })

    if (existsInDb) {
      return { isDuplicate: true, reason: 'Bài hát đã có sẵn trong Thư viện cá nhân' }
    }

    // 2. Check against other items in current Queue
    const existsInQueue = currentQueue.some(
      (item) =>
        item.id !== id &&
        item.title.trim().toLowerCase() === cleanTitle &&
        (!cleanArtist || item.artist.trim().toLowerCase() === cleanArtist)
    )

    if (existsInQueue) {
      return { isDuplicate: true, reason: 'Trùng lặp với 1 bài khác trong hàng chờ' }
    }

    return { isDuplicate: false, reason: null }
  }

  // Update a single queue item helper & re-check duplicate status
  const updateItem = (id: string, updates: Partial<QueueItem>) => {
    setQueue((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
      return next.map((item) => {
        const dupInfo = checkDuplicate(item.title, item.artist, item.id, next)
        return {
          ...item,
          isDuplicate: dupInfo.isDuplicate,
          duplicateReason: dupInfo.reason,
        }
      })
    })
  }

  // Handle selected files
  const handleFilesSelected = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(
      (f) =>
        /\.(mp3|wav|m4a|flac|aac|ogg)$/i.test(f.name) ||
        f.type.startsWith('audio/')
    )

    if (fileArray.length === 0) return

    const newItems: QueueItem[] = fileArray.map((f) => ({
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      file: f,
      title: f.name.replace(/\.[^/.]+$/, ''),
      artist: '',
      album: '',
      duration: 0,
      fileSize: f.size,
      status: 'parsing',
      progress: 0,
    }))

    setQueue((prev) => {
      const updatedQueue = [...prev, ...newItems]
      return updatedQueue.map((item) => {
        const dupInfo = checkDuplicate(item.title, item.artist, item.id, updatedQueue)
        return {
          ...item,
          isDuplicate: dupInfo.isDuplicate,
          duplicateReason: dupInfo.reason,
        }
      })
    })

    // Background ID3 Metadata parsing for each item
    for (const item of newItems) {
      try {
        const metadata = await mm.parseBlob(item.file)
        setQueue((prev) => {
          const updated = prev.map((q) => {
            if (q.id !== item.id) return q
            return {
              ...q,
              title: metadata.common.title || q.title,
              artist: metadata.common.artist || '',
              album: metadata.common.album || '',
              duration: metadata.format.duration
                ? Math.round(metadata.format.duration)
                : 0,
              status: 'idle' as const,
            }
          })

          return updated.map((q) => {
            const dupInfo = checkDuplicate(q.title, q.artist, q.id, updated)
            return {
              ...q,
              isDuplicate: dupInfo.isDuplicate,
              duplicateReason: dupInfo.reason,
            }
          })
        })
      } catch (err) {
        console.warn('Metadata parsing warning:', err)
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: 'idle' } : q))
        )
      }
    }
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

  const removeItem = (id: string) => {
    if (isUploading) return
    setQueue((prev) => prev.filter((item) => item.id !== id))
  }

  const clearCompleted = () => {
    setQueue((prev) => prev.filter((item) => item.status !== 'completed' && item.status !== 'skipped'))
  }

  // Upload single track workflow with mandatory lightweight MP3 compression
  const processSingleTrack = async (
    item: QueueItem,
    userId: string
  ): Promise<boolean> => {
    // Check if skipped due to duplicate policy
    if (skipDuplicates && item.isDuplicate && !item.forceUpload) {
      updateItem(item.id, {
        status: 'skipped',
        progress: 0,
        compressInfo: null,
        error: `Đã bỏ qua bài trùng (${item.duplicateReason})`,
      })
      return true
    }

    try {
      // 1. Mandatory Lightweight Compression Stage for EVERY file
      updateItem(item.id, {
        status: 'compressing',
        progress: 5,
        compressInfo: `⚡ Đang nén âm thanh nhẹ (${formatFileSize(item.file.size)} ➔ MP3 ${targetBitrate}kbps)...`,
      })

      const compRes = await compressAudioIfNeeded(
        item.file,
        (pct, stage) => {
          updateItem(item.id, {
            progress: Math.round(pct * 0.5),
            compressInfo: stage,
          })
        },
        targetBitrate,
        true // Force compression for ALL files regardless of size
      )

      const uploadFile = compRes.file
      const infoText = compRes.compressed
        ? `✅ Đã tối ưu dung lượng (${compRes.originalSizeMB} MB ➜ ${compRes.newSizeMB} MB MP3)! Đang tải lên...`
        : `Đang tải lên Supabase...`

      updateItem(item.id, { compressInfo: infoText })

      // 2. Storage upload stage
      updateItem(item.id, { status: 'uploading', progress: 55 })
      const fileExt = uploadFile.name.split('.').pop() || 'mp3'
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
      const filePath = `${userId}/${fileName}`

      let uploadErr: any = null
      const { data: signedData, error: signedTokenErr } = await supabase.storage
        .from('music-files')
        .createSignedUploadUrl(filePath)

      if (!signedTokenErr && signedData?.token) {
        const { error: signedUploadErr } = await supabase.storage
          .from('music-files')
          .uploadToSignedUrl(filePath, signedData.token, uploadFile)
        uploadErr = signedUploadErr
      } else {
        const { error: directErr } = await supabase.storage
          .from('music-files')
          .upload(filePath, uploadFile, { upsert: true })
        uploadErr = directErr
      }

      if (uploadErr) {
        throw new Error(`Upload storage thất bại: ${uploadErr.message}`)
      }

      // 3. Save to DB
      updateItem(item.id, { status: 'saving_db', progress: 80 })

      let artistId: string | null = null
      if (item.artist && item.artist.trim()) {
        try {
          const { data: artistData } = await supabase.rpc('fn_get_or_create_artist', {
            p_name: item.artist.trim(),
          })
          if (artistData) artistId = artistData
        } catch {
          // Ignore RPC error fallback
        }
      }

      const { error: dbError } = await supabase.from('tracks').insert({
        user_id: userId,
        title: item.title || item.file.name,
        artist_id: artistId,
        duration: item.duration || 0,
        file_path: filePath,
        file_size: uploadFile.size,
      })

      if (dbError) {
        const { error: fallbackError } = await supabase.from('tracks').insert({
          user_id: userId,
          title: item.title || item.file.name,
          artist: item.artist || null,
          album: item.album || null,
          duration: item.duration || 0,
          file_path: filePath,
          file_size: uploadFile.size,
        })
        if (fallbackError) {
          throw new Error(`Lỗi lưu DB: ${dbError.message}`)
        }
      }

      updateItem(item.id, {
        status: 'completed',
        progress: 100,
        compressInfo: `✅ Hoàn tất! (${compRes.originalSizeMB}MB ➜ ${compRes.newSizeMB}MB)`,
        error: null,
      })
      return true
    } catch (err: any) {
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

  // Batch runner loop
  const startBatchUpload = async (targetItems?: QueueItem[]) => {
    const itemsToUpload =
      targetItems ||
      queue.filter((i) => i.status === 'idle' || i.status === 'error' || i.status === 'skipped')

    if (itemsToUpload.length === 0) return

    setIsUploading(true)
    setOverallBatchInfo(`Bắt đầu đợt upload (${itemsToUpload.length} bài hát)...`)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        alert('Bạn cần đăng nhập để upload nhạc')
        setIsUploading(false)
        return
      }

      // Divide queue items into chunked batches
      const totalItems = itemsToUpload.length
      const chunks: QueueItem[][] = []
      for (let i = 0; i < totalItems; i += batchSize) {
        chunks.push(itemsToUpload.slice(i, i + batchSize))
      }

      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const currentChunk = chunks[chunkIdx]
        setOverallBatchInfo(
          `🚀 Đang xử lý Đợt ${chunkIdx + 1} / ${chunks.length} (${currentChunk.length} bài cùng lúc)...`
        )

        // Execute batch chunk concurrently up to batchSize
        await Promise.all(
          currentChunk.map((item) => processSingleTrack(item, user.id))
        )
      }

      setOverallBatchInfo('🎉 Đã hoàn tất xử lý tất cả bài hát!')
    } catch (err: any) {
      console.error('Batch upload error:', err)
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
    (i) => i.status === 'idle' || i.status === 'parsing'
  ).length

  const finishedCount = completedCount + skippedCount
  const overallProgressPercent =
    totalCount > 0 ? Math.round((finishedCount / totalCount) * 100) : 0

  return (
    <div className="max-w-4xl mx-auto glass-panel p-6 md:p-8 rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2.5">
            <Upload className="w-6 h-6 text-[var(--primary-spotify)]" />
            Upload Hàng Loạt Bài Hát
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Tải nhiều bài hát cùng lúc • Nén siêu nhẹ mọi bài • Phát hiện trùng lặp
          </p>
        </div>

        {/* Compression & Batch Settings */}
        <div className="flex flex-wrap items-center gap-3 bg-black/40 p-2 rounded-2xl border border-white/10 text-xs">
          {/* Bitrate quality selector */}
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400 ml-1" />
            <span className="text-slate-300 font-medium">Định dạng nén:</span>
            {[
              { label: 'Siêu nhẹ (192k)', value: 192 },
              { label: 'Cân bằng (256k)', value: 256 },
              { label: 'Studio (320k)', value: 320 },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={isUploading}
                onClick={() => setTargetBitrate(opt.value)}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition-all ${
                  targetBitrate === opt.value
                    ? 'bg-amber-400 text-black shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="h-4 w-[1px] bg-white/10 hidden sm:block" />

          {/* Batch size selector */}
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-300 font-medium">Đợt:</span>
            {[1, 2, 3, 5].map((size) => (
              <button
                key={size}
                type="button"
                disabled={isUploading}
                onClick={() => setBatchSize(size)}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition-all ${
                  batchSize === size
                    ? 'bg-[var(--primary-spotify)] text-black shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {size} bài
              </button>
            ))}
          </div>

          <div className="h-4 w-[1px] bg-white/10 hidden sm:block" />

          {/* Auto Skip Duplicate Checkbox */}
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white select-none">
            <input
              type="checkbox"
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
              className="rounded accent-[var(--primary-spotify)] w-3.5 h-3.5 cursor-pointer"
            />
            <span className="font-semibold text-xs text-amber-300 flex items-center gap-1">
              <Copy className="w-3.5 h-3.5" /> Bỏ bài trùng
            </span>
          </label>
        </div>
      </div>

      {/* Multi-file Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer mb-6 ${
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

        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 bg-gradient-to-tr from-[var(--primary-spotify)]/20 to-purple-500/20 rounded-2xl flex items-center justify-center text-[var(--primary-spotify)] border border-[var(--primary-spotify)]/30">
            <FileAudio className="w-7 h-7" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">
              Nhấp để chọn hoặc Kéo & thả nhiều file âm thanh vào đây
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Tự động chuyển đổi & nén siêu nhẹ mọi bài sang MP3 ({targetBitrate}kbps) giúp tiết kiệm bộ nhớ
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--primary-spotify)] bg-[var(--primary-spotify)]/10 px-3 py-1 rounded-full border border-[var(--primary-spotify)]/20">
            <Plus className="w-3.5 h-3.5" /> Thêm file vào danh sách
          </span>
        </div>
      </div>

      {/* Overall Queue Progress Banner */}
      {totalCount > 0 && (
        <div className="bg-black/40 rounded-2xl p-4 border border-white/10 mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-3 font-semibold text-slate-200">
              <span>Hàng chờ: <strong className="text-white">{totalCount}</strong> bài</span>
              <span>•</span>
              <span className="text-emerald-400">Đã xong: <strong>{completedCount}</strong></span>
              {duplicateCount > 0 && (
                <>
                  <span>•</span>
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Trùng: <strong>{duplicateCount}</strong>
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

            <div className="text-slate-400 text-xs font-bold">
              Tiến trình tổng: {overallProgressPercent}%
            </div>
          </div>

          {/* Overall Progress Bar */}
          <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-[var(--primary-spotify)] to-emerald-400 h-full transition-all duration-300"
              style={{ width: `${overallProgressPercent}%` }}
            />
          </div>

          {overallBatchInfo && (
            <div className="text-xs font-medium text-[var(--primary-spotify)] flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              <span>{overallBatchInfo}</span>
            </div>
          )}
        </div>
      )}

      {/* Controls Bar */}
      {totalCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            {(completedCount > 0 || skippedCount > 0) && (
              <button
                type="button"
                disabled={isUploading}
                onClick={clearCompleted}
                className="text-xs font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 transition-all"
              >
                Xóa bài đã xong / bỏ qua ({completedCount + skippedCount})
              </button>
            )}

            {errorCount > 0 && (
              <button
                type="button"
                disabled={isUploading}
                onClick={() => startBatchUpload(queue.filter((i) => i.status === 'error'))}
                className="text-xs font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-xl border border-amber-500/30 transition-all flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Thử lại bài lỗi ({errorCount})
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={isUploading || (pendingCount === 0 && errorCount === 0)}
            onClick={() => startBatchUpload()}
            className="bg-[var(--primary-spotify)] text-black font-extrabold px-6 py-2.5 rounded-full transition-all flex items-center justify-center gap-2 disabled:opacity-40 shadow-lg shadow-[var(--theme-glow-shadow)] text-sm"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang Nén & Upload ({batchSize} bài/đợt)...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-black" />
                Bắt Đầu Nén & Upload Tất Cả ({pendingCount + errorCount} bài)
              </>
            )}
          </button>
        </div>
      )}

      {/* Queue Items List */}
      {totalCount === 0 ? (
        <div className="text-center py-12 border border-dashed border-white/5 rounded-2xl bg-black/20">
          <Music className="w-12 h-12 text-slate-600 mx-auto mb-3 opacity-40" />
          <p className="text-slate-400 text-sm font-medium">Chưa có bài hát nào trong hàng chờ</p>
          <p className="text-slate-500 text-xs mt-1">Kéo thả các file nhạc vào ô phía trên để bắt đầu</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-1">
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
                          Sẵn sàng nén
                        </span>
                      )}
                      {item.status === 'idle' && item.isDuplicate && (
                        <span className="text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/30 font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Trùng bài
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
                            ? 'bg-amber-500 text-black border-amber-400'
                            : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                        }`}
                        title="Cho phép upload trùng"
                      >
                        {item.forceUpload ? 'Vẫn upload' : 'Bỏ qua'}
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
                      {item.forceUpload ? '(Sẽ upload đè / tạo bản sao)' : skipDuplicates ? '(Sẽ tự động bỏ qua)' : '(Vẫn upload)'}
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
