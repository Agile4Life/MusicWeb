'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Sparkles,
  FileText,
  Clock,
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Rewind,
  Trash2,
  CheckCircle2,
  Loader2,
  Plus,
  Minus,
  PenTool,
} from 'lucide-react'
import type { Track } from '@/types'
import type { LrclibResponse } from '@/lib/lrclib'
import {
  EditableLyricLine,
  formatLrcTimestamp,
  hasLrcTimestamps,
  nudgeLineTimestamp,
  parseEditableLyricLines,
  serializeEditableLyricLines,
  stampLineAtIndex,
  stripAllLrcTimestamps,
} from '@/lib/customLyrics'
import {
  LYRICS_UPDATED_EVENT,
  setCustomLyricsInPrimaryCache,
} from '@/lib/lyricsFlow'
import {
  usePlaybackProgress,
  usePlayerControls,
  usePlayerTrack,
} from './PlayerContext'
import { toast } from '@/components/ui/ToastContext'

export interface AdminLyricsEditorModalProps {
  isOpen: boolean
  onClose: () => void
  track: Track
  initialLyrics?: string | null
  onSaved?: (data: LrclibResponse | null, rawLyrics: string | null) => void
}

type EditorTab = 'text' | 'sync'

export function AdminLyricsEditorModal({
  isOpen,
  onClose,
  track,
  initialLyrics,
  onSaved,
}: AdminLyricsEditorModalProps) {
  const { currentTime, duration } = usePlaybackProgress()
  const { isPlaying } = usePlayerTrack()
  const { togglePlay, seek } = usePlayerControls()

  const [activeTab, setActiveTab] = useState<EditorTab>('text')
  const [rawText, setRawText] = useState<string>(() =>
    (initialLyrics ?? track.lyrics ?? '').trim(),
  )
  const [syncLines, setSyncLines] = useState<EditableLyricLine[]>(() =>
    parseEditableLyricLines((initialLyrics ?? track.lyrics ?? '').trim()),
  )
  const [selectedLineIdx, setSelectedLineIdx] = useState<number>(0)
  const [isSaving, setIsSaving] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const syncListRef = useRef<HTMLDivElement | null>(null)
  const lineRowRefs = useRef<(HTMLDivElement | null)[]>([])

  const switchToTab = useCallback(
    (tab: EditorTab) => {
      if (tab === 'sync') {
        const parsed = parseEditableLyricLines(rawText)
        setSyncLines(parsed)
        setSelectedLineIdx((prev) =>
          parsed.length > 0 ? Math.min(Math.max(0, prev), parsed.length - 1) : 0,
        )
      } else if (activeTab === 'sync') {
        setRawText(serializeEditableLyricLines(syncLines))
      }
      setActiveTab(tab)
    },
    [activeTab, rawText, syncLines],
  )

  // Scroll selected line into view in Sync tab
  useEffect(() => {
    if (activeTab !== 'sync') return
    const rowEl = lineRowRefs.current[selectedLineIdx]
    const container = syncListRef.current
    if (rowEl && container) {
      const targetTop =
        rowEl.offsetTop - container.clientHeight * 0.35 + rowEl.clientHeight / 2
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      })
    }
  }, [selectedLineIdx, activeTab])

  const handleStampCurrentLine = useCallback(() => {
    setSyncLines((prev) => {
      if (prev.length === 0) return prev
      const idx = Math.min(Math.max(0, selectedLineIdx), prev.length - 1)
      const next = stampLineAtIndex(prev, idx, currentTime)
      setRawText(serializeEditableLyricLines(next))
      return next
    })
    setSelectedLineIdx((prev) =>
      syncLines.length > 0 ? Math.min(syncLines.length - 1, prev + 1) : 0,
    )
  }, [currentTime, selectedLineIdx, syncLines.length])

  // Keyboard shortcut in Sync tab: Space or Enter stamps current line
  useEffect(() => {
    if (!isOpen || activeTab !== 'sync') return

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return

      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault()
        handleStampCurrentLine()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedLineIdx((prev) =>
          syncLines.length > 0 ? Math.min(syncLines.length - 1, prev + 1) : 0,
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedLineIdx((prev) => Math.max(0, prev - 1))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, activeTab, handleStampCurrentLine, syncLines.length])

  // Insert current [mm:ss.xx] at cursor line in textarea
  const handleInsertTimestampInTextarea = useCallback(() => {
    const el = textareaRef.current
    const stamp = formatLrcTimestamp(currentTime)
    if (!el) {
      setRawText((prev) => `${stamp} ${prev}`)
      return
    }

    const start = el.selectionStart ?? 0
    const text = rawText
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const lineEndIdx = text.indexOf('\n', start)
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx

    const currentLine = text.slice(lineStart, lineEnd)
    const cleanedLine = currentLine.replace(
      /^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*/,
      '',
    )
    const updatedLine = `${stamp} ${cleanedLine}`
    const nextText = text.slice(0, lineStart) + updatedLine + text.slice(lineEnd)
    setRawText(nextText)

    requestAnimationFrame(() => {
      el.focus()
      const nextLinePos =
        lineEndIdx === -1 ? nextText.length : lineStart + updatedLine.length + 1
      el.setSelectionRange(nextLinePos, nextLinePos)
    })
  }, [currentTime, rawText])

  const handleStripTimestamps = useCallback(() => {
    const stripped = stripAllLrcTimestamps(
      activeTab === 'sync' ? serializeEditableLyricLines(syncLines) : rawText,
    )
    setRawText(stripped)
    setSyncLines(parseEditableLyricLines(stripped))
    toast('Đã xóa toàn bộ mốc thời gian LRC', 'info')
  }, [activeTab, rawText, syncLines])

  const handleNudgeLine = useCallback((idx: number, delta: number) => {
    setSyncLines((prev) => {
      const next = nudgeLineTimestamp(prev, idx, delta)
      setRawText(serializeEditableLyricLines(next))
      return next
    })
  }, [])

  const handleStampSingleLine = useCallback(
    (idx: number) => {
      setSyncLines((prev) => {
        const next = stampLineAtIndex(prev, idx, currentTime)
        setRawText(serializeEditableLyricLines(next))
        return next
      })
      setSelectedLineIdx(idx)
    },
    [currentTime],
  )

  const handleSave = async (clearCustom = false) => {
    if (isSaving) return
    const finalLyrics = clearCustom
      ? ''
      : (activeTab === 'sync'
          ? serializeEditableLyricLines(syncLines)
          : rawText
        ).trim()

    if (!clearCustom && !finalLyrics) {
      toast('Vui lòng nhập nội dung lời bài hát trước khi lưu.', 'error')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/lyrics/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track,
          lyrics: clearCustom ? null : finalLyrics,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        toast(json?.error || 'Không thể lưu lời bài hát. Vui lòng thử lại.', 'error')
        return
      }

      const savedData: LrclibResponse | null = json.data || null
      const savedRaw: string | null = json.rawLyrics ?? null

      // Update primary lyrics cache
      setCustomLyricsInPrimaryCache(track, savedData)

      // Broadcast live update to LyricsView and MobileFullviewPlayer
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(LYRICS_UPDATED_EVENT, {
            detail: {
              trackId: track.id,
              track: { ...track, lyrics: savedRaw },
              rawLyrics: savedRaw,
              data: savedData,
            },
          }),
        )
      }

      toast(
        clearCustom
          ? 'Đã xóa lời tùy chỉnh và khôi phục chế độ tự động.'
          : 'Đã lưu lời bài hát thành công!',
        'success',
      )
      onSaved?.(savedData, savedRaw)
      onClose()
    } catch {
      toast('Lỗi kết nối khi lưu lời bài hát.', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen || typeof document === 'undefined') return null

  const effectiveText =
    activeTab === 'sync' ? serializeEditableLyricLines(syncLines) : rawText
  const isSyncedFormat = hasLrcTimestamps(effectiveText)
  const lineCount = effectiveText
    .split('\n')
    .filter((l) => l.trim().length > 0).length

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-lyrics-editor-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl bg-[#0b0e17]/95 border border-white/15 shadow-[0_25px_80px_rgba(0,0,0,0.85)] overflow-hidden text-slate-100"
      >
        {/* Top Ambient Highlight */}
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-500 via-[var(--spotify-glow,#22d3ee)] to-indigo-500" />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10 bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center shrink-0 text-cyan-300 shadow-inner">
              <PenTool className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2
                  id="admin-lyrics-editor-title"
                  className="text-sm sm:text-base font-extrabold text-white truncate"
                >
                  Viết & Căn Chỉnh Lời Bài Hát (Admin)
                </h2>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    isSyncedFormat
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/35'
                      : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                  }`}
                >
                  {isSyncedFormat ? 'Synced LRC' : 'Plain Text'}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">
                {track.title} —{' '}
                <span className="text-slate-300 font-medium">
                  {track.artist || 'Nghệ sĩ chưa xác định'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all cursor-pointer"
            title="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs + Mini Audio Control Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-b border-white/10 bg-black/30 shrink-0">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 bg-white/[0.04] p-1 rounded-2xl border border-white/10 self-start">
            <button
              type="button"
              onClick={() => switchToTab('text')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'text'
                  ? 'bg-cyan-500 text-slate-950 shadow-md'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>1. Soạn thảo ({lineCount} câu)</span>
            </button>
            <button
              type="button"
              onClick={() => switchToTab('sync')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'sync'
                  ? 'bg-cyan-500 text-slate-950 shadow-md'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>2. Căn nhịp LRC trực tiếp</span>
            </button>
          </div>

          {/* Live Playback Mini Controls */}
          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-2xl px-3 py-1.5 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => seek(Math.max(0, currentTime - 3))}
              className="p-1 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              title="Tua lùi 3 giây"
            >
              <Rewind className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="w-7 h-7 rounded-full bg-cyan-400 hover:bg-cyan-300 text-slate-950 flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
              title={isPlaying ? 'Tạm dừng' : 'Phát nhạc để căn lời'}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => seek(Math.min(duration || 9999, currentTime + 3))}
              className="p-1 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              title="Tua tiến 3 giây"
            >
              <FastForward className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-xs font-bold text-cyan-300 pl-1">
              {formatLrcTimestamp(currentTime)}
            </span>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4 sm:p-5">
          {activeTab === 'text' ? (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              {/* Text Editor Quick Actions */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-slate-400">
                  Nhập/dán lời bài hát (mỗi câu 1 dòng). Có thể dán sẵn mã{' '}
                  <code className="text-cyan-300 bg-white/5 px-1.5 py-0.5 rounded">
                    [00:12.34]
                  </code>{' '}
                  hoặc chuyển sang tab <b>Căn nhịp LRC</b>.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleInsertTimestampInTextarea}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-bold transition-all cursor-pointer"
                    title="Chèn thời gian phát hiện tại vào đầu dòng đang đặt con trỏ"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Chèn {formatLrcTimestamp(currentTime)}</span>
                  </button>
                  {isSyncedFormat && (
                    <button
                      type="button"
                      onClick={handleStripTimestamps}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 text-xs font-semibold transition-all cursor-pointer"
                      title="Xóa toàn bộ mốc [mm:ss.xx] để về văn bản thuần"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Xóa mốc giờ</span>
                    </button>
                  )}
                </div>
              </div>

              <textarea
                ref={textareaRef}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={
                  'Nhập hoặc dán lời bài hát tại đây...\n\nVí dụ văn bản thường:\nCơn mưa ngang qua mang em đi xa\nCơn mưa ngang qua khiến em nhạt nhòa\n\nHoặc định dạng LRC đồng bộ thời gian:\n[00:15.20] Cơn mưa ngang qua mang em đi xa\n[00:19.80] Cơn mưa ngang qua khiến em nhạt nhòa'
                }
                className="flex-1 min-h-[280px] w-full rounded-2xl bg-black/50 border border-white/15 focus:border-cyan-400/60 focus:outline-none p-4 text-sm text-slate-100 placeholder:text-slate-500 font-mono leading-relaxed resize-none select-text"
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              {/* Live Sync Action Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/25">
                <div className="text-xs text-slate-300">
                  <span className="font-bold text-cyan-300">Mẹo căn nhịp nhanh:</span>{' '}
                  Bấm phát nhạc và nhấn phím{' '}
                  <kbd className="px-1.5 py-0.5 rounded bg-black/50 border border-white/20 text-white font-mono text-[11px]">
                    Space
                  </kbd>{' '}
                  (hoặc nút bên phải) ngay khi ca sĩ bắt đầu hát câu đang chọn.
                </div>
                <button
                  type="button"
                  onClick={handleStampCurrentLine}
                  disabled={syncLines.length === 0}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 font-extrabold text-xs shadow-lg shadow-cyan-500/20 active:scale-95 transition-all shrink-0 cursor-pointer disabled:opacity-40"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>
                    Gắn mốc {formatLrcTimestamp(currentTime)} & Xuống câu tiếp
                  </span>
                </button>
              </div>

              {syncLines.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-14 text-center">
                  <FileText className="w-10 h-10 text-slate-600 mb-2" />
                  <p className="text-sm font-bold text-slate-300">
                    Chưa có câu hát nào để căn nhịp
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Hãy quay lại tab &ldquo;1. Soạn thảo&rdquo; để nhập hoặc dán lời bài hát trước.
                  </p>
                </div>
              ) : (
                <div
                  ref={syncListRef}
                  className="flex-1 min-h-[260px] overflow-y-auto rounded-2xl bg-black/40 border border-white/10 p-2 sm:p-3 space-y-1.5"
                >
                  {syncLines.map((line, idx) => {
                    const isSelected = idx === selectedLineIdx
                    const hasTime = line.time !== null

                    return (
                      <div
                        key={idx}
                        ref={(el) => {
                          lineRowRefs.current[idx] = el
                        }}
                        onClick={() => setSelectedLineIdx(idx)}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-cyan-500/15 border-cyan-400/50 shadow-[0_0_20px_rgba(34,211,238,0.12)]'
                            : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span className="text-[11px] font-mono text-slate-500 w-6 shrink-0">
                            #{String(idx + 1).padStart(2, '0')}
                          </span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (line.time !== null) {
                                seek(line.time)
                              } else {
                                handleStampSingleLine(idx)
                              }
                            }}
                            className={`text-xs font-mono font-bold px-2 py-0.5 rounded-lg border shrink-0 transition-colors cursor-pointer ${
                              hasTime
                                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30'
                                : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
                            }`}
                            title={
                              hasTime
                                ? 'Bấm để tua nhạc tới mốc này nghe thử'
                                : 'Bấm để gắn mốc thời gian hiện tại'
                            }
                          >
                            {hasTime ? formatLrcTimestamp(line.time!) : '[--:--.--]'}
                          </button>

                          <p
                            className={`text-xs sm:text-sm truncate ${
                              isSelected ? 'font-bold text-white' : 'font-medium text-slate-200'
                            }`}
                          >
                            {line.text}
                          </p>
                        </div>

                        {/* Line Fine-Tune Controls */}
                        <div className="flex items-center gap-1 shrink-0">
                          {hasTime && (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleNudgeLine(idx, -0.2)
                                }}
                                className="p-1 rounded-lg bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white text-[10px] font-mono transition-colors cursor-pointer"
                                title="Sớm hơn 0.2 giây"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleNudgeLine(idx, 0.2)
                                }}
                                className="p-1 rounded-lg bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white text-[10px] font-mono transition-colors cursor-pointer"
                                title="Muộn hơn 0.2 giây"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleStampSingleLine(idx)
                            }}
                            className="px-2 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 text-[11px] font-bold transition-colors cursor-pointer"
                            title="Gắn mốc thời gian hiện tại cho dòng này"
                          >
                            Gắn mốc
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-white/10 bg-white/[0.02] shrink-0 flex-wrap">
          <div>
            {(Boolean(initialLyrics?.trim()) || Boolean(track.lyrics?.trim())) && (
              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all cursor-pointer disabled:opacity-40"
                title="Xóa lời bài hát tùy chỉnh của Admin và quay về tự động tìm lời"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa lời tùy chỉnh</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-bold transition-all cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={isSaving || lineCount === 0}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 hover:from-cyan-300 hover:to-teal-300 text-slate-950 font-extrabold text-xs shadow-lg shadow-cyan-500/25 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Lưu lời bài hát</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
