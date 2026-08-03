'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Upload, Music, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
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

    // Validate size (< 50MB)
    if (selectedFile.size > 50 * 1024 * 1024) {
      setError('Dung lượng file tối đa là 50MB')
      return
    }

    setFile(selectedFile)
    setTitle(selectedFile.name.replace(/\.[^/.]+$/, ''))

    try {
      // Extract metadata using music-metadata-browser
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

      // Upload file to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('music-files')
        .upload(filePath, file)

      if (uploadError) {
        throw new Error(`Lỗi upload storage: ${uploadError.message}`)
      }

      setProgress(70)

      // Insert record to tracks table
      const { error: dbError } = await supabase.from('tracks').insert({
        user_id: user.id,
        title: title || file.name,
        artist: artist || null,
        album: album || null,
        duration: duration || 0,
        file_path: filePath,
      })

      if (dbError) {
        throw new Error(`Lỗi lưu thông tin DB: ${dbError.message}`)
      }

      setProgress(100)
      setSuccess(true)

      setTimeout(() => {
        router.push('/')
        router.refresh()
      }, 1500)
    } catch (err: any) {
      setError(err.message || 'Đã xảy ra lỗi khi upload')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto bg-[#181818] p-6 rounded-xl border border-[#282828] shadow-2xl">
      <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Upload className="w-5 h-5 text-[#1DB954]" />
        Upload Bài Hát Cá Nhân
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 text-[#1DB954] rounded-lg text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Upload thành công! Đang chuyển về Trang chủ...</span>
        </div>
      )}

      <form onSubmit={handleUpload} className="flex flex-col gap-4">
        {/* Dropzone */}
        <div className="border-2 border-dashed border-[#383838] hover:border-[#1DB954] rounded-lg p-6 text-center transition-colors cursor-pointer bg-[#121212]">
          <input
            type="file"
            accept=".mp3,.wav,.m4a,.flac"
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
            className="hidden"
            id="audio-upload"
          />
          <label htmlFor="audio-upload" className="cursor-pointer flex flex-col items-center gap-2">
            <div className="w-12 h-12 bg-[#282828] rounded-full flex items-center justify-center text-[#1DB954]">
              <Music className="w-6 h-6" />
            </div>
            {file ? (
              <div>
                <p className="text-sm font-semibold text-white">{file.name}</p>
                <p className="text-xs text-gray-400">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-gray-200">Nhấp hoặc kéo thả file âm thanh vào đây</p>
                <p className="text-xs text-gray-400 mt-1">Hỗ trợ .mp3, .wav, .m4a, .flac (Tối đa 50MB)</p>
              </div>
            )}
          </label>
        </div>

        {file && (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Tên bài hát *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-[#121212] border border-[#282828] focus:border-[#1DB954] rounded-md px-3 py-2 text-sm text-white outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Nghệ sĩ</label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Nhập tên nghệ sĩ (tùy chọn)"
                className="w-full bg-[#121212] border border-[#282828] focus:border-[#1DB954] rounded-md px-3 py-2 text-sm text-white outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Album</label>
              <input
                type="text"
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                placeholder="Nhập tên album (tùy chọn)"
                className="w-full bg-[#121212] border border-[#282828] focus:border-[#1DB954] rounded-md px-3 py-2 text-sm text-white outline-none"
              />
            </div>

            {loading && (
              <div className="w-full bg-[#121212] rounded-full h-2 overflow-hidden">
                <div
                  className="bg-[#1DB954] h-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold py-2.5 rounded-full transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang Upload...
                </>
              ) : (
                'Tải Nhạc Lên Thư Viện'
              )}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
