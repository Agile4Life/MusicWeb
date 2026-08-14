'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { useSession } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/ToastContext'
import {
  RECEIPT_THEMES,
  ReceiptTrackItem,
  generateReceiptDataUrl,
  generateReceiptBlob,
} from '@/lib/receiptCanvas'
import { fetchReceiptTracks, ReceiptDataSource } from '@/lib/receiptTracks'
import {
  Receipt,
  ListMusic,
  History,
  Heart,
  Download,
  Share2,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  Layers,
  Palette,
  User,
} from 'lucide-react'

interface ReceiptifyViewProps {
  isOpen?: boolean
  onClose?: () => void
  isPageMode?: boolean
}

type DataSourceType = 'queue' | 'history' | 'favorites' | 'playlist'

export const ReceiptifyView: React.FC<ReceiptifyViewProps> = ({
  isOpen = true,
  onClose,
  isPageMode = false,
}) => {
  const { currentTrack, queue } = usePlayer()
  const { playlists } = usePlaylists()
  const { username } = useCurrentUser()
  const { data: nextAuthSession } = useSession()
  const supabase = createClient()

  const [dataSource, setDataSource] = useState<DataSourceType>('queue')
  const [mobileTab, setMobileTab] = useState<'custom' | 'preview'>('custom')
  const [trackLimit, setTrackLimit] = useState<number>(10)
  const [selectedThemeId, setSelectedThemeId] = useState<string>('classic')
  const [customerName, setCustomerName] = useState<string>('')
  const [fetchedTracks, setFetchedTracks] = useState<ReceiptTrackItem[]>([])
  const [isLoadingTracks, setIsLoadingTracks] = useState(false)

  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [copied, setCopied] = useState(false)

  // Initialize customer name
  useEffect(() => {
    const defaultName = nextAuthSession?.user?.name || username || 'PHONG TCT'
    setCustomerName((prev) => (prev ? prev : defaultName))
  }, [nextAuthSession?.user?.name, username])

  // Fetch / extract tracks based on data source
  const loadTracksForSource = useCallback(
    async (source: DataSourceType) => {
      setIsLoadingTracks(true)
      try {
        const {
          data: { user: currentUser },
        } = await supabase.auth.getUser()

        const items = await fetchReceiptTracks({
          supabase,
          source,
          currentUser,
          nextAuthSession,
          currentTrack,
          queue,
          playlists,
          limit: 50,
        })
        setFetchedTracks(items)
      } catch (err) {
        console.error('Failed to load tracks for receipt:', err)
        toast('Không thể tải danh sách bài hát cho hóa đơn', 'error')
      } finally {
        setIsLoadingTracks(false)
      }
    },
    [currentTrack, queue, nextAuthSession, playlists, supabase]
  )

  // Load tracks whenever data source changes or modal opens
  useEffect(() => {
    if (isOpen) {
      loadTracksForSource(dataSource)
    }
  }, [isOpen, dataSource, loadTracksForSource])

  // Realtime update when listening_history or favorite_tracks change
  useEffect(() => {
    if (!isOpen || (dataSource !== 'history' && dataSource !== 'favorites')) return

    const tableToListen = dataSource === 'history' ? 'listening_history' : 'favorite_tracks'
    const channel = supabase
      .channel(`receipt-realtime-${dataSource}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tableToListen },
        () => {
          loadTracksForSource(dataSource)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [isOpen, dataSource, loadTracksForSource, supabase])

  // Generate Receipt preview image
  useEffect(() => {
    if (!isOpen || fetchedTracks.length === 0) return

    let cancelled = false
    setIsGenerating(true)

    const sliceTracks = fetchedTracks.slice(0, trackLimit)
    if (sliceTracks.length === 0) {
      setIsGenerating(false)
      return
    }

    const playlistName = (playlists[0]?.name || 'PLAYLIST').toUpperCase()
    const labelMap: Record<DataSourceType, string> = {
      queue: 'NOW PLAYING QUEUE',
      history: 'RECENT LISTENING HISTORY',
      favorites: 'TOP FAVORITES RECEIPT',
      playlist: `${playlistName} RECEIPT`,
    }

    generateReceiptDataUrl({
      title: 'MUSICWEB STORE',
      periodLabel: labelMap[dataSource] || 'TOP TRACKS RECEIPT',
      userName: customerName || 'CUSTOMER',
      tracks: sliceTracks,
      themeId: selectedThemeId,
    })
      .then((url) => {
        if (!cancelled) {
          setPreviewUrl(url)
          setIsGenerating(false)
        }
      })
      .catch((err) => {
        console.error('Error generating receipt preview:', err)
        if (!cancelled) setIsGenerating(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, fetchedTracks, trackLimit, selectedThemeId, customerName, dataSource, playlists])

  // Handle Download PNG (Fast, bulletproof download using live preview Data URL)
  const handleDownload = async () => {
    try {
      const sliceTracks = fetchedTracks.slice(0, trackLimit)
      if (sliceTracks.length === 0) {
        toast('Chưa có bài hát để tải hóa đơn', 'warning')
        return
      }

      let downloadUrl = previewUrl
      let isBlobUrl = false

      if (!downloadUrl) {
        const playlistName = (playlists[0]?.name || 'PLAYLIST').toUpperCase()
        const labelMap: Record<DataSourceType, string> = {
          queue: 'NOW PLAYING QUEUE',
          history: 'RECENT LISTENING HISTORY',
          favorites: 'TOP FAVORITES RECEIPT',
          playlist: `${playlistName} RECEIPT`,
        }

        const blob = await generateReceiptBlob({
          title: 'MUSICWEB STORE',
          periodLabel: labelMap[dataSource] || 'TOP TRACKS RECEIPT',
          userName: customerName || 'CUSTOMER',
          tracks: sliceTracks,
          themeId: selectedThemeId,
        })
        downloadUrl = URL.createObjectURL(blob)
        isBlobUrl = true
      }

      const safeName = (customerName || 'receipt').toLowerCase().replace(/[^a-z0-9]/gi, '_')
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `musicweb-receipt-${safeName}-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)

      if (isBlobUrl) {
        URL.revokeObjectURL(downloadUrl)
      }

      toast('Đã tải ảnh hóa đơn về máy thành công!', 'success', 'Tải về')
    } catch (err) {
      console.error('Download receipt error:', err)
      toast('Lỗi khi tải ảnh hóa đơn', 'error')
    }
  }

  // Handle Copy to Clipboard
  const handleCopy = async () => {
    try {
      const sliceTracks = fetchedTracks.slice(0, trackLimit)
      if (sliceTracks.length === 0) {
        toast('Chưa có bài hát để sao chép', 'warning')
        return
      }

      const playlistName = (playlists[0]?.name || 'PLAYLIST').toUpperCase()
      const labelMap: Record<DataSourceType, string> = {
        queue: 'NOW PLAYING QUEUE',
        history: 'RECENT LISTENING HISTORY',
        favorites: 'TOP FAVORITES RECEIPT',
        playlist: `${playlistName} RECEIPT`,
      }

      const blob = await generateReceiptBlob({
        title: 'MUSICWEB STORE',
        periodLabel: labelMap[dataSource] || 'TOP TRACKS RECEIPT',
        userName: customerName || 'CUSTOMER',
        tracks: sliceTracks,
        themeId: selectedThemeId,
      })

      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof window.ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': blob,
          }),
        ])
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
        toast('Đã sao chép ảnh hóa đơn vào bộ nhớ tạm!', 'success', 'Sao chép')
      } else {
        await handleDownload()
      }
    } catch (err) {
      console.error('Clipboard copy error:', err)
      await handleDownload()
    }
  }

  // Handle Native Share / Instagram Story
  const handleShare = async () => {
    setIsSharing(true)
    try {
      const sliceTracks = fetchedTracks.slice(0, trackLimit)
      if (sliceTracks.length === 0) {
        toast('Chưa có bài hát để chia sẻ', 'warning')
        return
      }

      const playlistName = (playlists[0]?.name || 'PLAYLIST').toUpperCase()
      const labelMap: Record<DataSourceType, string> = {
        queue: 'NOW PLAYING QUEUE',
        history: 'RECENT LISTENING HISTORY',
        favorites: 'TOP FAVORITES RECEIPT',
        playlist: `${playlistName} RECEIPT`,
      }

      const blob = await generateReceiptBlob({
        title: 'MUSICWEB STORE',
        periodLabel: labelMap[dataSource] || 'TOP TRACKS RECEIPT',
        userName: customerName || 'CUSTOMER',
        tracks: sliceTracks,
        themeId: selectedThemeId,
      })

      const file = new File([blob], 'musicweb-receipt.png', { type: 'image/png' })
      const shareUrl = typeof window !== 'undefined' ? window.location.origin : 'https://phongtctmusic.vercel.app'

      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Hóa đơn âm nhạc - ${customerName}`,
          text: `Xem hóa đơn âm nhạc của ${customerName} trên MusicWeb! 🧾🎵`,
          files: [file],
        })
        toast('Đã mở chia sẻ hóa đơn lên Story!', 'success')
      } else {
        // Desktop or browsers without Web Share API: Download PNG and copy
        await handleDownload()
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Share error:', err)
        await handleDownload()
      }
    } finally {
      setIsSharing(false)
    }
  }

  const sliceTracks = fetchedTracks.slice(0, trackLimit)

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full">
      {/* Mobile Tab Segmented Switcher (Visible on mobile only < md) */}
      <div className="flex md:hidden items-center p-2 bg-black/60 border-b border-white/[0.08] shrink-0">
        <div className="grid grid-cols-2 w-full p-1 bg-white/[0.05] rounded-xl border border-white/10">
          <button
            onClick={() => setMobileTab('custom')}
            className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              mobileTab === 'custom'
                ? 'bg-[var(--primary-spotify,#06b6d4)] text-black shadow-md shadow-[var(--theme-glow-shadow)] font-extrabold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>1. Tùy chỉnh</span>
          </button>

          <button
            onClick={() => setMobileTab('preview')}
            className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              mobileTab === 'preview'
                ? 'bg-[var(--primary-spotify,#06b6d4)] text-black shadow-md shadow-[var(--theme-glow-shadow)] font-extrabold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>2. Xem trước ({sliceTracks.length} bài)</span>
          </button>
        </div>
      </div>

      {/* Main Content Studio (Balanced 2-Column Desktop + Mobile Tabs) */}
      <div className="flex-1 flex flex-col md:flex-row gap-4 lg:gap-6 min-h-0 relative">
        {/* 🛠️ LEFT STUDIO PANEL: Controls & Customizations */}
        <div
          className={`w-full md:w-[380px] lg:w-[420px] flex-col bg-white/[0.03] border border-white/[0.08] rounded-2xl sm:rounded-3xl p-4 sm:p-5 lg:p-6 space-y-5 lg:space-y-6 shadow-xl backdrop-blur-xl shrink-0 overflow-y-auto no-scrollbar justify-between ${
            mobileTab === 'custom' ? 'flex flex-1' : 'hidden md:flex'
          }`}
        >
          <div className="space-y-5 lg:space-y-6">
            {/* Data Source Selector */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <ListMusic className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Nguồn bài hát
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-slate-400">
                  {dataSource === 'queue' ? 'Hàng đợi' : dataSource === 'history' ? 'Lịch sử' : 'Yêu thích'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setDataSource('queue')}
                  className={`py-2.5 px-3 rounded-xl font-bold text-xs flex flex-col items-center gap-1.5 transition-all duration-200 border ${
                    dataSource === 'queue'
                      ? 'bg-amber-400/15 border-amber-400/50 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.25)] ring-1 ring-amber-400/40'
                      : 'bg-white/[0.04] border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  <span>Hàng đợi</span>
                </button>

                <button
                  onClick={() => setDataSource('history')}
                  className={`py-2.5 px-3 rounded-xl font-bold text-xs flex flex-col items-center gap-1.5 transition-all duration-200 border ${
                    dataSource === 'history'
                      ? 'bg-amber-400/15 border-amber-400/50 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.25)] ring-1 ring-amber-400/40'
                      : 'bg-white/[0.04] border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  <History className="w-4 h-4" />
                  <span>Lịch sử</span>
                </button>

                <button
                  onClick={() => setDataSource('favorites')}
                  className={`py-2.5 px-3 rounded-xl font-bold text-xs flex flex-col items-center gap-1.5 transition-all duration-200 border ${
                    dataSource === 'favorites'
                      ? 'bg-amber-400/15 border-amber-400/50 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.25)] ring-1 ring-amber-400/40'
                      : 'bg-white/[0.04] border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  <Heart className="w-4 h-4" />
                  <span>Yêu thích</span>
                </button>
              </div>
            </div>

            {/* Track Limit Selector */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Số lượng bài in trên hóa đơn
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-amber-300">
                  {sliceTracks.length} bài
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[5, 10, 15, 20].map((num) => (
                  <button
                    key={num}
                    onClick={() => setTrackLimit(num)}
                    className={`py-2.5 rounded-xl font-extrabold text-xs transition-all duration-200 border ${
                      trackLimit === num
                        ? 'bg-amber-400 text-black border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.35)] scale-105'
                        : 'bg-white/[0.04] border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.08]'
                    }`}
                  >
                    Top {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Paper Theme Selector */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <Palette className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Chủ đề giấy in
                  </span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-amber-300">
                  {RECEIPT_THEMES.find((t) => t.id === selectedThemeId)?.name}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {RECEIPT_THEMES.map((theme) => {
                  const isActive = selectedThemeId === theme.id
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedThemeId(theme.id)}
                      className={`h-12 rounded-xl flex items-center justify-center p-2 transition-all duration-200 relative border font-bold text-xs ${
                        isActive
                          ? 'border-white scale-105 shadow-[0_0_18px_rgba(255,255,255,0.4)] ring-2 ring-amber-400/60'
                          : 'border-white/15 opacity-75 hover:opacity-100 hover:border-white/40'
                      }`}
                      style={{
                        background: `linear-gradient(135deg, ${theme.paperGrad[0]}, ${theme.paperGrad[1]})`,
                        color: theme.textColor,
                      }}
                    >
                      <span className="truncate px-1">{theme.name}</span>
                      {isActive && <Check className="w-3.5 h-3.5 ml-1 shrink-0 drop-shadow" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Customer Name Input */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <User className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Tên người nghe trên hóa đơn
                </span>
              </div>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nhập tên của bạn..."
                maxLength={28}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 placeholder:text-slate-500 transition-all"
              />
            </div>
          </div>

          {/* Mobile Bottom Floating Action: Proceed to Preview */}
          <div className="md:hidden pt-4 border-t border-white/10 shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
            <button
              onClick={() => setMobileTab('preview')}
              disabled={sliceTracks.length === 0}
              className="w-full py-3.5 px-4 rounded-xl font-extrabold text-sm text-black flex items-center justify-center gap-2 shadow-lg active:scale-98"
              style={{
                background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                boxShadow: '0 8px 20px rgba(245, 158, 11, 0.3)',
              }}
            >
              <span>Xem trước Hóa đơn ({sliceTracks.length} bài)</span>
              <Sparkles className="w-4 h-4 text-black" />
            </button>
          </div>
        </div>

        {/* 🖼️ RIGHT SHOWCASE PANEL: Thermal Paper Preview Pedestal & Action Buttons */}
        <div
          className={`flex-1 flex-col bg-white/[0.02] border border-white/[0.08] rounded-2xl sm:rounded-3xl p-4 sm:p-5 lg:p-6 relative shadow-2xl backdrop-blur-xl justify-between min-h-0 ${
            mobileTab === 'preview' ? 'flex' : 'hidden md:flex'
          }`}
        >
          {/* Ambient Glow Pedestal in Background */}
          <div
            className="absolute inset-0 pointer-events-none rounded-2xl sm:rounded-3xl overflow-hidden"
            style={{
              background: 'radial-gradient(circle at 50% 40%, rgba(251, 191, 36, 0.12), transparent 70%)',
            }}
          />

          {/* Scrollable Thermal Receipt Preview Pedestal */}
          <div className="flex-1 overflow-y-auto max-h-[460px] lg:max-h-[500px] flex flex-col items-center justify-start py-2 px-1 no-scrollbar relative z-10 min-h-[300px]">
            <div className="relative w-full max-w-[340px] sm:max-w-[380px] transition-all duration-300 flex items-center justify-center">
              {isLoadingTracks ? (
                <div className="w-64 h-80 flex flex-col items-center justify-center gap-3 text-slate-400 bg-black/40 rounded-xl border border-white/10 p-6">
                  <RefreshCw className="w-7 h-7 text-amber-400 animate-spin" />
                  <span className="text-xs font-bold">Đang tải danh sách bài hát...</span>
                </div>
              ) : previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Music Receipt Preview"
                  className="w-full h-auto object-contain rounded-xl transition-all duration-300 drop-shadow-[0_25px_60px_rgba(0,0,0,0.9)] border border-white/20"
                />
              ) : (
                <div className="w-64 h-80 flex flex-col items-center justify-center gap-3 text-slate-400 bg-black/40 rounded-xl border border-white/10 p-6">
                  <Receipt className="w-8 h-8 text-amber-400/50" />
                  <span className="text-xs font-bold">Chưa có bài hát để tạo hóa đơn</span>
                </div>
              )}

              {isGenerating && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center rounded-xl">
                  <RefreshCw className="w-6 h-6 text-amber-400 animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action Buttons Bar */}
          <div className="flex flex-col gap-2.5 pt-4 mt-2 border-t border-white/[0.08] shrink-0 relative z-10 pb-1 sm:pb-0">
            {/* Primary Share Action Button */}
            <button
              onClick={handleShare}
              disabled={isSharing || sliceTracks.length === 0}
              className="w-full py-3.5 px-4 rounded-xl font-extrabold text-sm text-black flex items-center justify-center gap-2.5 shadow-[0_0_25px_rgba(245,158,11,0.35)] hover:shadow-[0_0_35px_rgba(245,158,11,0.55)] hover:scale-[1.01] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              style={{
                background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              }}
            >
              {isSharing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-black" />
                  <span>Đang xử lý chia sẻ...</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4 text-black" />
                  <span>Chia sẻ hóa đơn lên Story</span>
                </>
              )}
            </button>

            {/* Secondary Actions: Copy to Clipboard & Download PNG */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={handleCopy}
                disabled={sliceTracks.length === 0}
                className="py-3 px-4 rounded-xl font-bold text-xs text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 hover:border-white/20 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400 font-bold">Đã sao chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-amber-300" />
                    <span>Sao chép ảnh</span>
                  </>
                )}
              </button>

              <button
                onClick={handleDownload}
                disabled={sliceTracks.length === 0}
                className="py-3 px-4 rounded-xl font-bold text-xs text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 hover:border-white/20 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                <Download className="w-4 h-4 text-amber-300" />
                <span>Tải ảnh PNG</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
