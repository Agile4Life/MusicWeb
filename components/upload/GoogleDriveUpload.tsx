'use client'

import React, { useState, useRef } from 'react'
import { uploadToGoogleDrive } from '@/lib/googleDriveUpload'
import { Upload, CheckCircle2, AlertCircle, Loader2, FileUp, HardDrive } from 'lucide-react'

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`
  }
  return `${mb.toFixed(1)} MB`
}

export function GoogleDriveUpload() {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadedBytes, setUploadedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState(0)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setSelectedFile(file)
      setError(null)
      setUploadedFileId(null)
      setProgress(0)
      setStatusText(null)
    }
  }

  const handleStartUpload = async () => {
    if (!selectedFile) return

    setIsUploading(true)
    setError(null)
    setUploadedFileId(null)
    setProgress(0)
    setStatusText('Đang khởi tạo Upload Session từ Cloudflare Worker...')

    try {
      const result = await uploadToGoogleDrive({
        file: selectedFile,
        onProgress: ({ percent, uploadedBytes, totalBytes }) => {
          setProgress(percent)
          setUploadedBytes(uploadedBytes)
          setTotalBytes(totalBytes)
          setStatusText(`Đang upload trực tiếp lên Google Drive... ${percent}%`)
        },
      })

      if (!result.success) {
        throw new Error(result.error || 'Upload thất bại')
      }

      setProgress(100)
      setStatusText('✅ Upload hoàn tất thành công lên Google Drive!')
      if (result.fileId) {
        setUploadedFileId(result.fileId)
      }
    } catch (err: any) {
      setError(err.message || 'Đã xảy ra lỗi trong quá trình upload')
      setStatusText(null)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto glass-panel p-6 rounded-3xl border border-white/10 shadow-2xl bg-slate-900/80 text-white">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-blue-500/20 text-blue-400 rounded-2xl flex items-center justify-center border border-blue-500/30">
          <HardDrive className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Upload File Dung Lượng Lớn</h2>
          <p className="text-xs text-slate-400">
            Sử dụng Cloudflare Worker + Resumable Upload API (Hỗ trợ file hàng GB)
          </p>
        </div>
      </div>

      {/* Select File Box */}
      <div
        onClick={() => !isUploading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer mb-5 ${
          isUploading
            ? 'border-slate-700 opacity-60 cursor-not-allowed'
            : 'border-white/20 hover:border-blue-400 bg-black/40 hover:bg-black/60'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          disabled={isUploading}
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="flex flex-col items-center gap-2">
          <FileUp className="w-8 h-8 text-blue-400" />
          {selectedFile ? (
            <div>
              <p className="text-sm font-bold text-emerald-400">{selectedFile.name}</p>
              <p className="text-xs text-slate-400 mt-1">
                Kích thước: {formatFileSize(selectedFile.size)}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold text-white">Bấm để chọn file bất kỳ từ máy tính</p>
              <p className="text-xs text-slate-400 mt-1">MP3, WAV, MP4, MKV, ZIP... (Không giới hạn)</p>
            </div>
          )}
        </div>
      </div>

      {/* Action Button */}
      {selectedFile && !isUploading && progress !== 100 && (
        <button
          onClick={handleStartUpload}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-2xl transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 text-sm"
        >
          <Upload className="w-4 h-4" /> Bắt Đầu Upload Lên Google Drive
        </button>
      )}

      {/* Uploading Status */}
      {isUploading && (
        <div className="space-y-3">
          <div className="flex justify-between items-center text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              {statusText}
            </span>
            <span>{progress}%</span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden border border-white/10">
            <div
              className="bg-gradient-to-r from-blue-500 to-emerald-400 h-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="text-right text-xs text-slate-400 font-mono">
            {formatFileSize(uploadedBytes)} / {formatFileSize(totalBytes)}
          </div>
        </div>
      )}

      {/* Success Banner */}
      {uploadedFileId && (
        <div className="mt-4 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-200">
            <p className="font-bold text-emerald-400">Upload thành công lên Google Drive!</p>
            <p className="text-slate-400 mt-1 font-mono">File ID: {uploadedFileId}</p>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="mt-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-xs text-red-400">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
