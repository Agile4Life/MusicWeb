'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Upload, Music, CheckCircle2, AlertCircle, Loader2, Sparkles } from 'lucide-react'
import * as mm from 'music-metadata-browser'

export function UploadForm() {
  const router = useRouter()
  const supabase = createClient()

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [duration, setDuration] = useState(0)

  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleFileChange = async (selectedFile: File) => {
    if (!selectedFile) return
    setError(null)

    if (selectedFile.size > 150 * 1024 * 1024) {
      setError('Dung lượng file tối đa là 150MB')
      return
    }

    setFile(selectedFile)
    setTitle(selectedFile.name.replace(/\.[^/.]+$/, ''))

    try {
      const metadata = await mm.parseBlob(selectedFile)
      if (metadata.common.title) setTitle(metadata.common.title)
      if (metadata.common.artist) setArtist(metadata.common.artist)
      if (metadata.common.album) setAlbum(metadata.common.album)
      if (metadata.format.duration) setDuration(Math.round(metadata.format.duration))
    } catch (err) {
      console.warn('Metadata parsing warning:', err)
    }
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return

    setLoading(true)
    setError(null)
    setProgress(10)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        throw new Error('Bạn cần đăng nhập để upload nhạc')
      }

      setProgress(30)
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
      const filePath = `${user.id}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('music-files')
        .upload(filePath, file)

      if (uploadError) {
        throw new Error(`Lỗi upload storage: ${uploadError.message}`)
      }

      setProgress(70)

      let artistId: string | null = null
      if (artist && artist.trim()) {
        try {
          const { data: artistData } = await supabase.rpc('fn_get_or_create_artist', {
            p_name: artist.trim(),
          })
          if (artistData) artistId = artistData
        } catch {
          // Ignore RPC failure if function is not available
        }
      }

      const { error: dbError } = await supabase.from('tracks').insert({
        user_id: user.id,
        title: title || file.name,
        artist_id: artistId,
        duration: duration || 0,
        file_path: filePath,
        file_size: file.size,
      })

      if (dbError) {
        // Fallback in case schema uses artist column as text
        const { error: fallbackError } = await supabase.from('tracks').insert({
          user_id: user.id,
          title: title || file.name,
          artist: artist || null,
          album: album || null,
          duration: duration || 0,
          file_path: filePath,
          file_size: file.size,
        })
        if (fallbackError) {
          throw new Error(`Lỗi lưu thông tin DB: ${dbError.message}`)
        }
      }

      setProgress(100)
      setSuccess(true)

      setTimeout(() => {
        router.push('/')
        router.refresh()
      }, 1500)
    } catch (err: any) {
      let msg = err.message || 'Đã xảy ra lỗi khi upload'
      if (msg.includes('exceeded the maximum allowed size')) {
        msg = 'Lỗi Supabase Storage: File này vượt quá giới hạn file_size_limit mặc định của Bucket Supabase. Vui lòng chạy câu lệnh SQL tăng dung lượng Bucket lên 150MB trong Supabase SQL Editor!'
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const [isDragging, setIsDragging] = useState(false)

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
      const droppedFile = e.dataTransfer.files[0]
      handleFileChange(droppedFile)
    }
  }

  return (
    <div className="max-w-xl mx-auto glass-panel p-8 rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Upload className="w-5 h-5 text-[var(--primary-spotify)]" />
          Upload Bài Hát Cá Nhân
        </h2>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--primary-spotify)] bg-[var(--primary-spotify)]/10 px-2.5 py-1 rounded-full border border-[var(--primary-spotify)]/20">
          Studio High-Res
        </span>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 text-[var(--primary-spotify)] rounded-xl text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Upload thành công! Đang chuyển về Trang chủ...</span>
        </div>
      )}

      <form onSubmit={handleUpload} className="flex flex-col gap-4">
        {/* Dropzone with Drag & Drop support */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
            isDragging
              ? 'border-[var(--primary-spotify)] bg-[var(--primary-spotify)]/15 scale-[1.02] shadow-xl shadow-[var(--theme-glow-shadow)]'
              : 'border-white/10 hover:border-[var(--primary-spotify)] bg-black/30 hover:bg-black/50'
          }`}
        >
          <input
            type="file"
            accept=".mp3,.wav,.m4a,.flac"
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
            className="hidden"
            id="audio-upload"
          />
          <label htmlFor="audio-upload" className="cursor-pointer flex flex-col items-center gap-3">
            <div className="w-14 h-14 bg-gradient-to-tr from-[var(--primary-spotify)]/20 to-[var(--theme-secondary)]/20 rounded-full flex items-center justify-center text-[var(--primary-spotify)] border border-[var(--primary-spotify)]/30">
              <Music className="w-7 h-7" />
            </div>
            {file ? (
              <div>
                <p className="text-sm font-bold text-white">{file.name}</p>
                <p className="text-xs text-[var(--primary-spotify)] mt-0.5">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB • {duration ? `${Math.floor(duration/60)}m ${duration%60}s` : 'Phân tích xong'}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-slate-200">Nhấp hoặc kéo thả file âm thanh vào đây</p>
                <p className="text-xs text-slate-400 mt-1">Hỗ trợ .mp3, .wav, .m4a, .flac (Tối đa 150MB)</p>
              </div>
            )}
          </label>
        </div>

        {file && (
          <div className="flex flex-col gap-3.5 mt-2">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Tên bài hát *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full glass-input rounded-xl px-3.5 py-2.5 text-xs text-white outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Nghệ sĩ</label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Tên nghệ sĩ"
                className="w-full glass-input rounded-xl px-3.5 py-2.5 text-xs text-white outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Album</label>
              <input
                type="text"
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                placeholder="Tên album"
                className="w-full glass-input rounded-xl px-3.5 py-2.5 text-xs text-white outline-none"
              />
            </div>

            {loading && (
              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden mt-1">
                <div
                  className="bg-[var(--primary-spotify)] h-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[var(--primary-spotify)] text-black font-extrabold py-3 rounded-full transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-50 shadow-lg shadow-[var(--theme-glow-shadow)]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang Tải Lên...
                </>
              ) : (
                'Tải Nhạc Lên Thư Viện'
              )}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
