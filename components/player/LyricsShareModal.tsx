'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Track } from '@/types'
import { LyricLine } from '@/lib/lrcParser'
import {
  LYRIC_CARD_THEMES,
  generateLyricCardBlob,
  generateLyricCardDataUrl,
} from '@/lib/lyricsShareCanvas'
import { toast } from '@/components/ui/ToastContext'
import {
  X,
  Share2,
  Download,
  Copy,
  Check,
  Sparkles,
  Palette,
  CheckCircle2,
  Circle,
  RefreshCw,
  Sliders,
} from 'lucide-react'

export interface LyricsShareModalProps {
  isOpen: boolean
  onClose: () => void
  track: Track
  lyrics: LyricLine[]
  initialActiveIndex?: number
}

export const LyricsShareModal: React.FC<LyricsShareModalProps> = ({
  isOpen,
  onClose,
  track,
  lyrics,
  initialActiveIndex = -1,
}) => {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  const [selectedThemeId, setSelectedThemeId] = useState<string>('dominant')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const activeLineRef = useRef<HTMLDivElement | null>(null)

  // Initialize selected lines when modal opens
  useEffect(() => {
    if (isOpen && lyrics.length > 0) {
      let initIndex = 0
      if (initialActiveIndex >= 0 && initialActiveIndex < lyrics.length) {
        initIndex = initialActiveIndex
      }
      setSelectedIndices([initIndex])

      setTimeout(() => {
        if (activeLineRef.current && listRef.current) {
          const target = activeLineRef.current.offsetTop - listRef.current.clientHeight * 0.35
          listRef.current.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
        }
      }, 100)
    }
  }, [isOpen, lyrics, initialActiveIndex])

  // Update card preview whenever selected lines or theme changes
  useEffect(() => {
    if (!isOpen || selectedIndices.length === 0 || lyrics.length === 0) return

    let cancelled = false
    setIsGenerating(true)

    const selectedLines = selectedIndices
      .map((i) => lyrics[i]?.text)
      .filter(Boolean)

    if (selectedLines.length === 0) {
      setIsGenerating(false)
      return
    }

    generateLyricCardDataUrl({
      title: track.title,
      artist: track.artist,
      coverUrl: track.cover_url,
      selectedLines,
      themeId: selectedThemeId,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setPreviewUrl(dataUrl)
          setIsGenerating(false)
        }
      })
      .catch((err) => {
        console.error('Failed to generate preview:', err)
        if (!cancelled) setIsGenerating(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, selectedIndices, selectedThemeId, track, lyrics])

  if (!isOpen) return null

  const toggleLine = (index: number) => {
    if (selectedIndices.includes(index)) {
      if (selectedIndices.length <= 1) {
        toast('Vui lòng chọn ít nhất 1 câu hát', 'warning', 'Chia sẻ lời bài hát')
        return
      }
      setSelectedIndices((prev) => prev.filter((i) => i !== index))
    } else {
      if (selectedIndices.length >= 5) {
        toast('Tối đa được chọn 5 câu hát', 'warning', 'Giới hạn chia sẻ')
        return
      }
      setSelectedIndices((prev) => [...prev, index].sort((a, b) => a - b))
    }
  }

  const handleShare = async () => {
    if (selectedIndices.length === 0) return
    setIsSharing(true)

    try {
      const selectedLines = selectedIndices.map((i) => lyrics[i].text)
      const blob = await generateLyricCardBlob({
        title: track.title,
        artist: track.artist,
        coverUrl: track.cover_url,
        selectedLines,
        themeId: selectedThemeId,
      })

      const fileName = `musicweb-${(track.title || 'lyric')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')}.png`
      const file = new File([blob], fileName, { type: 'image/png' })

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${track.title} - ${track.artist || 'MusicWeb'}`,
          text: `"${selectedLines.join(' / ')}" - Nghe trên MusicWeb`,
        })
        toast('Đã mở bảng chia sẻ!', 'success', 'Chia sẻ')
      } else {
        await handleDownload()
        toast('Đã tự động tải ảnh 9:16 về thiết bị của bạn', 'info', 'Tải ảnh')
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Share error:', err)
        toast('Không thể chia sẻ ảnh. Hãy thử tải về!', 'error', 'Lỗi chia sẻ')
      }
    } finally {
      setIsSharing(false)
    }
  }

  const handleDownload = async () => {
    if (selectedIndices.length === 0) return
    try {
      const selectedLines = selectedIndices.map((i) => lyrics[i].text)
      const blob = await generateLyricCardBlob({
        title: track.title,
        artist: track.artist,
        coverUrl: track.cover_url,
        selectedLines,
        themeId: selectedThemeId,
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `musicweb-${(track.title || 'lyric')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast('Đã lưu ảnh Story 9:16 về máy!', 'success', 'Tải ảnh thành công')
    } catch (err) {
      console.error('Download error:', err)
      toast('Có lỗi xảy ra khi tải ảnh', 'error', 'Lỗi tải ảnh')
    }
  }

  const handleCopyImage = async () => {
    if (selectedIndices.length === 0) return
    try {
      const selectedLines = selectedIndices.map((i) => lyrics[i].text)
      const blob = await generateLyricCardBlob({
        title: track.title,
        artist: track.artist,
        coverUrl: track.cover_url,
        selectedLines,
        themeId: selectedThemeId,
      })

      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ])
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
        toast('Đã sao chép ảnh vào bộ nhớ tạm!', 'success', 'Sao chép')
      } else {
        await handleDownload()
      }
    } catch (err) {
      console.error('Clipboard copy error:', err)
      await handleDownload()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lyrics-share-modal-title"
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-2 sm:p-4 md:p-6 animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-5xl h-[92vh] max-h-[860px] bg-[#0b0f19] border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100 select-none">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] bg-black/40 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 id="lyrics-share-modal-title" className="text-base font-extrabold text-white flex items-center gap-2">
                Chia sẻ câu hát
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  Story 9:16
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {track.title} • {track.artist || 'Nghệ sĩ chưa xác định'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/15 active:scale-95 text-slate-300 hover:text-white flex items-center justify-center transition-all border border-white/10"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content 2-Column Studio */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Left Column: Line Selector (Styled identically to immersive LyricsView) */}
          <div className="flex-1 flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-white/[0.08] bg-[#07090e] relative overflow-hidden">
            {/* Ambient Background Glow matching Track Cover */}
            <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden opacity-25">
              {track.cover_url ? (
                <img
                  src={track.cover_url}
                  alt=""
                  className="w-full h-full object-cover blur-3xl scale-125 transform-gpu"
                />
              ) : (
                <div className="w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-900/30 via-[#0a0d14] to-[#07090e]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-[#07090e]/80 via-[#07090e]/90 to-[#07090e]" />
            </div>

            {/* Selector Top Toolbar */}
            <div className="relative z-10 px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between bg-black/40 backdrop-blur-xl shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-200">
                  Chọn câu hát chia sẻ
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">
                  (1 - 5 câu)
                </span>
                <span
                  className={`text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-sm transition-all ${
                    selectedIndices.length >= 5
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                      : 'bg-cyan-500/15 border-cyan-500/35 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                  }`}
                >
                  {selectedIndices.length}/5 câu
                </span>
              </div>
            </div>

            {/* Scrollable Lyric Lines List (Immersive Typography) */}
            <div
              ref={listRef}
              className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-2.5 no-scrollbar"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {lyrics.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
                  <Sparkles className="w-12 h-12 text-cyan-400/50 mb-3 animate-pulse" />
                  <p className="text-base font-bold text-slate-200">Không có dữ liệu lời bài hát</p>
                  <p className="text-xs text-slate-500 mt-1">Bài hát này chưa có lời để chia sẻ</p>
                </div>
              ) : (
                lyrics.map((line, index) => {
                  const isSelected = selectedIndices.includes(index)
                  return (
                    <div
                      key={index}
                      ref={index === selectedIndices[0] ? activeLineRef : null}
                      onClick={() => toggleLine(index)}
                      className={`cursor-pointer rounded-2xl select-none group/line relative transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                        isSelected
                          ? 'py-3 sm:py-4 px-4 sm:px-6 bg-white/[0.08] border border-white/20 backdrop-blur-2xl shadow-[0_10px_30px_rgba(0,0,0,0.4),0_0_24px_rgba(6,182,212,0.2)] scale-[1.01]'
                          : 'py-2 sm:py-2.5 px-3 sm:px-5 bg-transparent border border-transparent hover:bg-white/[0.03] hover:border-white/[0.06] opacity-65 hover:opacity-100'
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        {/* Status Check Pill / Dot Indicator */}
                        <div
                          className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all ${
                            isSelected
                              ? 'bg-cyan-400 text-black shadow-[0_0_12px_#22d3ee]'
                              : 'border-2 border-slate-600 group-hover/line:border-slate-400'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>

                        {/* Lyrics Text with Rich Typography */}
                        <p
                          className={`leading-snug transition-all duration-300 flex-1 ${
                            isSelected
                              ? 'text-base sm:text-lg md:text-xl font-black text-white bg-clip-text bg-gradient-to-r from-white via-cyan-100 to-cyan-300 drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]'
                              : 'text-sm sm:text-base font-semibold text-slate-300 group-hover/line:text-white'
                          }`}
                        >
                          {line.text}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right Column: Live 9:16 Card Preview & Actions */}
          <div className="w-full md:w-[420px] lg:w-[460px] flex flex-col min-h-0 bg-[#07090e] p-4 sm:p-6 overflow-y-auto no-scrollbar">
            {/* Theme Selector */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2.5">
                <Palette className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Chủ đề màu</span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {LYRIC_CARD_THEMES.map((theme) => {
                  const isActive = selectedThemeId === theme.id
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedThemeId(theme.id)}
                      className={`h-9 rounded-xl flex items-center justify-center p-1 transition-all relative border ${
                        isActive
                          ? 'border-white scale-105 shadow-[0_0_15px_rgba(255,255,255,0.3)] ring-2 ring-cyan-400/50'
                          : 'border-white/15 opacity-70 hover:opacity-100 hover:border-white/30'
                      }`}
                      style={{
                        background: `linear-gradient(135deg, ${theme.background[0]}, ${theme.background[1]})`,
                      }}
                      title={theme.name}
                    >
                      {isActive && <Check className="w-4 h-4 text-white drop-shadow-md" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 9:16 Story Card Preview Container */}
            <div className="flex-1 flex items-center justify-center min-h-[340px] my-2">
              <div className="relative aspect-[9/16] w-full max-w-[240px] sm:max-w-[260px] rounded-2xl overflow-hidden shadow-[0_15px_40px_rgba(0,0,0,0.6)] border border-white/20 group">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Lyric Card Preview"
                    className="w-full h-full object-cover transition-all duration-300"
                  />
                ) : (
                  <div className="w-full h-full bg-slate-900 flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
                  </div>
                )}

                {isGenerating && (
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
                  </div>
                )}
              </div>
            </div>

            {/* Actions Bar */}
            <div className="flex flex-col gap-2.5 pt-3 border-t border-white/[0.08]">
              {/* Primary Native Share Button */}
              <button
                onClick={handleShare}
                disabled={isSharing || selectedIndices.length === 0}
                className="w-full py-3 px-4 rounded-2xl font-extrabold text-sm text-black flex items-center justify-center gap-2.5 transition-all duration-300 active:scale-[0.98] shadow-lg shadow-cyan-500/25 hover:shadow-cyan-400/40"
                style={{
                  background: 'linear-gradient(135deg, #22d3ee, #06b6d4)',
                }}
              >
                {isSharing ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-black" />
                ) : (
                  <Share2 className="w-4 h-4 text-black" />
                )}
                <span>Chia sẻ ngay (Story / Apps)</span>
              </button>

              {/* Secondary Download & Copy Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleDownload}
                  disabled={selectedIndices.length === 0}
                  className="py-2.5 px-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] active:scale-[0.98] text-xs font-bold text-white border border-white/10 flex items-center justify-center gap-2 transition-all"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Tải ảnh PNG</span>
                </button>

                <button
                  onClick={handleCopyImage}
                  disabled={selectedIndices.length === 0}
                  className="py-2.5 px-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] active:scale-[0.98] text-xs font-bold text-white border border-white/10 flex items-center justify-center gap-2 transition-all"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  <span>{copied ? 'Đã chép' : 'Sao chép ảnh'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
