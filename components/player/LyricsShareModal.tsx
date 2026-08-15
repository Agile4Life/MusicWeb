'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Share2,
  Download,
  Copy,
  Check,
  Sparkles,
  Palette,
  RefreshCw,
} from 'lucide-react'
import { Track } from '@/types'
import { LyricLine } from '@/lib/lrcParser'
import { toast } from '@/components/ui/ToastContext'
import { useTheme } from '@/components/theme/ThemeContext'
import {
  LYRIC_CARD_THEMES,
  generateLyricCardBlob,
  generateLyricCardDataUrl,
  toggleContiguousLyricLine,
} from '@/lib/lyricsShareCanvas'

export interface LyricsShareModalProps {
  isOpen: boolean
  onClose: () => void
  track: Track
  lyrics: LyricLine[]
  initialActiveIndex?: number
}

function getInitialThemeForApp(themeId?: string): string {
  if (!themeId) return 'dominant'
  if (['slate', 'forest', 'mint', 'lime'].includes(themeId)) return 'emerald'
  if (['gold', 'autumn', 'solar', 'retro'].includes(themeId)) return 'sunset'
  if (['sakura', 'ruby', 'cherry', 'wine'].includes(themeId)) return 'cyberpunk'
  if (['winter', 'violet'].includes(themeId)) return 'midnight'
  return 'dominant'
}

export const LyricsShareModal: React.FC<LyricsShareModalProps> = ({
  isOpen,
  onClose,
  track,
  lyrics,
  initialActiveIndex = 0,
}) => {
  const [mounted, setMounted] = useState(false)
  const { currentTheme } = useTheme()
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0])
  const [selectedThemeId, setSelectedThemeId] = useState<string>(() =>
    getInitialThemeForApp(currentTheme?.id)
  )
  const [themeCategoryFilter, setThemeCategoryFilter] = useState<'all' | 'cover' | 'gradient' | 'solid'>('all')
  const [cardOnly, setCardOnly] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [mobileTab, setMobileTab] = useState<'select' | 'preview'>('select')
  const listRef = useRef<HTMLDivElement | null>(null)
  const activeLineRef = useRef<HTMLDivElement | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Initialize selected lines ONCE when modal opens (Static mode: do not reset on audio sync)
  useEffect(() => {
    if (isOpen) {
      if (!initializedRef.current) {
        initializedRef.current = true
        if (currentTheme?.id) {
          setSelectedThemeId(getInitialThemeForApp(currentTheme.id))
        }
        if (lyrics.length > 0) {
          let initIndex = 0
          if (initialActiveIndex >= 0 && initialActiveIndex < lyrics.length) {
            initIndex = initialActiveIndex
          }
          setSelectedIndices([initIndex])
          setMobileTab('select')

          setTimeout(() => {
            if (activeLineRef.current && listRef.current) {
              const target = activeLineRef.current.offsetTop - listRef.current.clientHeight * 0.35
              listRef.current.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
            }
          }, 100)
        }
      }
    } else {
      initializedRef.current = false
    }
  }, [isOpen, lyrics])

  // Update card preview whenever selected lines, theme, or cardOnly mode changes
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
      cardOnly,
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
  }, [isOpen, selectedIndices, selectedThemeId, cardOnly, track, lyrics])

  if (!isOpen) return null

  const toggleLine = (index: number) => {
    const result = toggleContiguousLyricLine(selectedIndices, index, 5)
    if (result.reason === 'min_required') {
      toast('Vui lòng chọn ít nhất 1 câu hát', 'warning', 'Chia sẻ lời bài hát')
      return
    }
    setSelectedIndices(result.nextIndices)
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
        cardOnly,
      })

      const fileName = `musicweb-${cardOnly ? 'card' : 'story'}-${(track.title || 'lyric')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')}.png`
      const file = new File([blob], fileName, { type: 'image/png' })

      const shareUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${track?.id ? `/?track=${encodeURIComponent(track.id)}` : ''}`
          : ''

      // Auto-copy track link to clipboard so user can immediately paste it as a Link Sticker on Instagram Story
      if (navigator.clipboard && shareUrl) {
        try {
          await navigator.clipboard.writeText(shareUrl)
        } catch {
          // Ignore clipboard permission errors during share
        }
      }

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${track.title} - ${track.artist || 'MusicWeb'}`,
          text: `"${selectedLines.join(' / ')}" - Nghe trên MusicWeb: ${shareUrl}`,
          url: shareUrl,
        })
        toast(
          'Đã sao chép sẵn link bài hát! Bạn có thể dán vào Nhãn dán Liên kết (Link Sticker) trên Story.',
          'success',
          'Chia sẻ'
        )
      } else {
        await handleDownload()
        toast('Đã tải ảnh về thiết bị và sao chép sẵn link bài hát!', 'info', 'Tải ảnh')
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
        cardOnly,
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `musicweb-${cardOnly ? 'card' : 'story'}-${(track.title || 'lyric')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast(
        cardOnly ? 'Đã lưu ảnh Card nổi (Nền trong suốt) về máy!' : 'Đã lưu ảnh Story 9:16 về máy!',
        'success',
        'Tải ảnh thành công'
      )
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
        cardOnly,
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

  if (!isOpen || !mounted || typeof window === 'undefined' || !document?.body) {
    return null
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lyrics-share-modal-title"
      className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-xl flex items-center justify-center p-0 sm:p-4 md:p-6 pb-4 sm:pb-6 animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-5xl h-full sm:h-[86vh] max-h-none sm:max-h-[760px] bg-[#0b0f19] border-0 sm:border sm:border-white/10 rounded-none sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100 select-none">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-white/[0.08] bg-black/50 backdrop-blur-2xl shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-[var(--primary-spotify,#06b6d4)]/15 border border-[var(--primary-spotify,#06b6d4)]/30 flex items-center justify-center text-[var(--spotify-glow,#22d3ee)] shadow-[0_0_15px_var(--theme-glow-shadow,rgba(6,182,212,0.25))] shrink-0">
              <Share2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="lyrics-share-modal-title" className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2 truncate">
                Chia sẻ câu hát
                <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--primary-spotify,#06b6d4)]/10 text-[var(--spotify-glow,#22d3ee)] border border-[var(--primary-spotify,#06b6d4)]/20 shrink-0">
                  Story 9:16
                </span>
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                {track.title} • {track.artist || 'Nghệ sĩ chưa xác định'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/15 active:scale-95 text-slate-300 hover:text-white flex items-center justify-center transition-all border border-white/10 shrink-0 ml-2"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Tab Segmented Switcher (Visible on mobile only < md) */}
        <div className="flex md:hidden items-center p-2 bg-black/60 border-b border-white/[0.08] shrink-0">
          <div className="grid grid-cols-2 w-full p-1 bg-white/[0.05] rounded-xl border border-white/10">
            <button
              onClick={() => setMobileTab('select')}
              className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                mobileTab === 'select'
                  ? 'bg-[var(--primary-spotify,#06b6d4)] text-black shadow-md shadow-[var(--theme-glow-shadow)] font-extrabold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>1. Chọn câu hát</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${mobileTab === 'select' ? 'bg-black/20 text-black' : 'bg-white/10 text-[var(--spotify-glow,#22d3ee)]'}`}>
                {selectedIndices.length}/5
              </span>
            </button>

            <button
              onClick={() => setMobileTab('preview')}
              className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                mobileTab === 'preview'
                  ? 'bg-[var(--primary-spotify,#06b6d4)] text-black shadow-md shadow-[var(--theme-glow-shadow)] font-extrabold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>2. Xem trước Card</span>
            </button>
          </div>
        </div>

            {/* Modal Content 2-Column Studio (Responsive Desktop + Mobile Tabs) */}
            <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden relative">
              {/* 🌟 Unified Ambient Glassmorphic Background across entire Studio (Desktop & Mobile) */}
              <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden select-none">
                {track.cover_url ? (
                  <img
                    src={track.cover_url}
                    alt=""
                    className="w-full h-full object-cover blur-3xl opacity-45 scale-125 transform-gpu transition-all duration-700"
                  />
                ) : (
                  <div className="w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[var(--theme-gradient-1,rgba(6,182,212,0.25))] via-[#0a0d14] to-[#07090e]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-[#07090e]/65 via-[#07090e]/80 to-[#07090e]" />
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'radial-gradient(circle at 75% 40%, var(--theme-gradient-1, rgba(6,182,212,0.25)), transparent 65%)',
                  }}
                />
              </div>

              {/* Left Column: Line Selector */}
              <div
                className={`flex-1 flex-col min-h-0 border-b md:border-b-0 md:border-r border-white/[0.08] bg-black/20 backdrop-blur-md relative overflow-hidden z-10 ${
                  mobileTab === 'select' ? 'flex' : 'hidden md:flex'
                }`}
              >
                {/* Selector Top Toolbar (Desktop) */}
                <div className="relative z-20 px-5 py-3.5 border-b border-white/[0.08] hidden md:flex items-center justify-between bg-black/50 backdrop-blur-2xl shrink-0 shadow-lg">
              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--spotify-glow,#22d3ee)] animate-pulse shadow-[0_0_10px_var(--spotify-glow,#22d3ee)]" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-100">
                  Chọn câu hát chia sẻ
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400 font-semibold">
                  (1 - 5 câu liên tiếp)
                </span>
                <span
                  className={`text-xs font-mono font-bold px-3 py-1 rounded-full border shadow-md transition-all ${
                    selectedIndices.length >= 5
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                      : 'bg-[var(--primary-spotify,#06b6d4)]/20 border-[var(--primary-spotify,#06b6d4)]/40 text-[var(--spotify-glow,#22d3ee)] shadow-[0_0_15px_var(--theme-glow-shadow,rgba(6,182,212,0.25))]'
                  }`}
                >
                  {selectedIndices.length}/5 câu
                </span>
              </div>
            </div>

            {/* Top & Bottom Fade Overlays for smooth scrolling */}
            <div className="pointer-events-none absolute inset-x-0 top-0 md:top-[53px] h-8 bg-gradient-to-b from-[#07090e] to-transparent z-10" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#07090e] to-transparent z-10" />

            {/* Scrollable Lyric Lines List (Immersive Typography & Touch Scroll) */}
            <div
              ref={listRef}
              className="relative z-10 flex-1 overflow-y-auto overscroll-y-contain px-4 sm:px-8 md:px-10 pt-4 md:pt-6 pb-24 md:pb-20 space-y-2.5 sm:space-y-3 no-scrollbar"
              style={{
                WebkitOverflowScrolling: 'touch',
                scrollBehavior: 'smooth',
              }}
            >
              {lyrics.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
                  <Sparkles className="w-12 h-12 text-[var(--spotify-glow,#22d3ee)]/60 mb-3 animate-pulse" />
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
                      className={`cursor-pointer rounded-2xl select-none group/line relative transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] ${
                        isSelected
                          ? 'py-3 sm:py-4 px-4 sm:px-6 bg-white/[0.1] border border-[var(--spotify-glow,#22d3ee)]/45 backdrop-blur-2xl shadow-[0_14px_40px_rgba(0,0,0,0.5),0_0_28px_var(--theme-glow-shadow,rgba(6,182,212,0.3))] scale-[1.01] sm:scale-[1.02] sm:-translate-y-0.5'
                          : 'py-2 sm:py-2.5 px-3 sm:px-5 bg-transparent border border-transparent hover:bg-white/[0.05] hover:border-white/15 hover:shadow-[0_8px_25px_rgba(0,0,0,0.3)] hover:-translate-y-0.5 hover:scale-[1.01] opacity-60 hover:opacity-100'
                      }`}
                    >
                      {/* Lyrics Text with Large Rich Typography */}
                      <p
                        className={`leading-snug transition-all duration-300 ${
                          isSelected
                            ? 'text-base sm:text-lg md:text-xl font-black text-white bg-clip-text bg-gradient-to-r from-white via-[var(--theme-neon-from,#cffafe)] to-[var(--spotify-glow,#22d3ee)] drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]'
                            : 'text-sm sm:text-base md:text-lg font-semibold text-slate-300 group-hover/line:text-white'
                        }`}
                      >
                        {line.text}
                      </p>
                    </div>
                  )
                })
              )}
            </div>

            {/* Mobile Bottom Floating Action: Proceed to Preview */}
            <div className="md:hidden p-3 bg-black/60 backdrop-blur-xl border-t border-white/10 z-20 shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
              <button
                onClick={() => setMobileTab('preview')}
                disabled={selectedIndices.length === 0}
                className="w-full py-3.5 px-4 rounded-xl font-extrabold text-sm text-black flex items-center justify-center gap-2 shadow-lg active:scale-98"
                style={{
                  background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                  boxShadow: '0 8px 20px var(--theme-glow-shadow, rgba(6,182,212,0.25))',
                }}
              >
                <span>Xem trước Card ({selectedIndices.length} câu)</span>
                <Sparkles className="w-4 h-4 text-black" />
              </button>
            </div>
          </div>

          {/* Right Column: Live Card Preview & Actions (Optimized for Desktop & Mobile) */}
          <div
            className={`w-full md:w-[400px] lg:w-[440px] flex-col min-h-0 bg-black/40 backdrop-blur-2xl border-t md:border-t-0 md:border-l border-white/[0.08] p-3 sm:p-5 overflow-y-auto no-scrollbar justify-between relative z-10 gap-3 ${
              mobileTab === 'preview' ? 'flex flex-1 h-full' : 'hidden md:flex'
            }`}
          >
            {/* Format Switcher: Full Story 9:16 vs Standalone Card Only (Transparent PNG) */}
            <div className="shrink-0 space-y-2">
              <div className="grid grid-cols-2 p-1 bg-white/[0.05] border border-white/10 rounded-2xl text-[11px] font-bold">
                <button
                  onClick={() => setCardOnly(false)}
                  className={`py-1.5 px-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                    !cardOnly
                      ? 'bg-[var(--primary-spotify,#06b6d4)] text-black shadow-md font-extrabold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>🖼️ Nền Story 9:16</span>
                </button>
                <button
                  onClick={() => setCardOnly(true)}
                  className={`py-1.5 px-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                    cardOnly
                      ? 'bg-[var(--primary-spotify,#06b6d4)] text-black shadow-md font-extrabold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>🔲 Bỏ nền ngoài (Chỉ Card)</span>
                </button>
              </div>

              {/* Background Style Selector */}
              <div className="flex items-center justify-between pt-0.5">
                <div className="flex items-center gap-2">
                  <Palette className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    {cardOnly ? 'Tông màu Card' : 'Tùy chọn nền Card'}
                  </span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-[var(--spotify-glow,#22d3ee)] truncate max-w-[140px]">
                  {LYRIC_CARD_THEMES.find((t) => t.id === selectedThemeId)?.name}
                </span>
              </div>

              {/* Category Filter Tabs */}
              <div className="grid grid-cols-4 p-0.5 bg-white/[0.04] border border-white/10 rounded-xl text-[10px] font-bold shrink-0">
                <button
                  onClick={() => setThemeCategoryFilter('all')}
                  className={`py-1 rounded-lg transition-all ${
                    themeCategoryFilter === 'all'
                      ? 'bg-white/15 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Tất cả
                </button>
                <button
                  onClick={() => setThemeCategoryFilter('cover')}
                  className={`py-1 rounded-lg transition-all ${
                    themeCategoryFilter === 'cover'
                      ? 'bg-white/15 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Ảnh bìa
                </button>
                <button
                  onClick={() => setThemeCategoryFilter('gradient')}
                  className={`py-1 rounded-lg transition-all ${
                    themeCategoryFilter === 'gradient'
                      ? 'bg-white/15 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Gradient
                </button>
                <button
                  onClick={() => setThemeCategoryFilter('solid')}
                  className={`py-1 rounded-lg transition-all ${
                    themeCategoryFilter === 'solid'
                      ? 'bg-white/15 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Đơn sắc
                </button>
              </div>

              {/* Theme Swatches Horizontal Scroll List */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-2.5 shrink-0 -mx-1 px-1">
                {LYRIC_CARD_THEMES.filter(
                  (t) => themeCategoryFilter === 'all' || t.category === themeCategoryFilter
                ).map((theme) => {
                  const isActive = selectedThemeId === theme.id
                  const isSolid = theme.category === 'solid'
                  const isCover = theme.category === 'cover'

                  return (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedThemeId(theme.id)}
                      className={`h-8 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all duration-200 relative border active:scale-95 text-xs font-bold shrink-0 ${
                        isActive
                          ? 'border-white shadow-[0_0_16px_rgba(255,255,255,0.35)] ring-2 ring-[var(--spotify-glow,#22d3ee)]/60'
                          : 'border-white/15 opacity-75 hover:opacity-100 hover:border-white/40'
                      }`}
                      style={{
                        background: isSolid
                          ? theme.solidColor || theme.background[0]
                          : isCover
                          ? track.cover_url
                            ? `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.7)), url(${track.cover_url}) center/cover`
                            : 'linear-gradient(135deg, #1e293b, #0f172a)'
                          : `linear-gradient(135deg, ${theme.background[0]}, ${theme.background[1]})`,
                        color: theme.textColor,
                      }}
                      title={theme.name}
                    >
                      <span className="truncate whitespace-nowrap drop-shadow">{theme.name}</span>
                      {isActive && <Check className="w-3.5 h-3.5 shrink-0 drop-shadow" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Lyric Card Preview Container (Aspect Responsive Plaque) */}
            <div className="flex-1 min-h-[220px] max-h-full flex items-center justify-center py-2 px-1 overflow-hidden shrink min-w-0">
              <div
                className={`relative h-full max-h-[38vh] sm:max-h-[420px] ${
                  cardOnly ? 'aspect-[1010/1220] max-w-[340px]' : 'aspect-[9/16]'
                } rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_25px_var(--theme-glow-shadow,rgba(6,182,212,0.25))] border border-white/20 group hover:scale-[1.02] transition-all duration-300 flex items-center justify-center ${
                  cardOnly
                    ? 'bg-[radial-gradient(#ffffff18_1px,transparent_1px)] [background-size:12px_12px] bg-slate-950/80'
                    : 'bg-black/60'
                } shrink-0`}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Lyric Card Preview"
                    className="w-full h-full object-contain rounded-2xl drop-shadow-2xl"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-center">
                    <RefreshCw className="w-6 h-6 text-[var(--spotify-glow,#22d3ee)] animate-spin" />
                    <span className="text-[10px] text-slate-400 font-bold">Đang tạo thẻ câu hát...</span>
                  </div>
                )}

                {isGenerating && (
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 text-[var(--spotify-glow,#22d3ee)] animate-spin" />
                  </div>
                )}
              </div>
            </div>

            {/* Actions Bar (Docked at bottom with safe-area padding on mobile) */}
            <div className="flex flex-col gap-2 pt-2.5 border-t border-white/[0.08] shrink-0 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] sm:pb-0">
              {/* Primary Native Share Button */}
              <button
                onClick={handleShare}
                disabled={isSharing || selectedIndices.length === 0}
                className="w-full py-3 sm:py-2.5 px-4 rounded-xl font-extrabold text-xs sm:text-sm text-black flex items-center justify-center gap-2 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.97] shadow-lg disabled:opacity-50 disabled:pointer-events-none"
                style={{
                  background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                  boxShadow: '0 8px 24px var(--theme-glow-shadow, rgba(6,182,212,0.3))',
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
                  className="py-2.5 px-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] hover:-translate-y-0.5 active:scale-[0.96] text-xs font-bold text-white border border-white/10 flex items-center justify-center gap-2 transition-all shadow-sm hover:shadow-md disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Download className="w-3.5 h-3.5 text-[var(--spotify-glow,#22d3ee)]" />
                  <span>Tải ảnh PNG</span>
                </button>

                <button
                  onClick={handleCopyImage}
                  disabled={selectedIndices.length === 0}
                  className="py-2.5 px-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] hover:-translate-y-0.5 active:scale-[0.96] text-xs font-bold text-white border border-white/10 flex items-center justify-center gap-2 transition-all shadow-sm hover:shadow-md disabled:opacity-40 disabled:pointer-events-none"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 animate-in zoom-in-75" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[var(--spotify-glow,#22d3ee)]" />
                  )}
                  <span>{copied ? 'Đã chép' : 'Sao chép ảnh'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
