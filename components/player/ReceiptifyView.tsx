'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { usePlayerTrack, usePlayerQueue } from '@/components/player/PlayerContext'
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
import { fetchReceiptTracks } from '@/lib/receiptTracks'
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
  Hash,
  Palette,
  User,
  Trophy,
} from 'lucide-react'

interface ReceiptifyViewProps {
  isOpen?: boolean
  onClose?: () => void
  isPageMode?: boolean
}

type DataSourceType = 'top' | 'history' | 'favorites' | 'playlist' | 'queue'

export const ReceiptifyView: React.FC<ReceiptifyViewProps> = ({
  isOpen = true,
  isPageMode = false,
}) => {
  const { currentTrack } = usePlayerTrack()
  const { queue } = usePlayerQueue()
  const { playlists } = usePlaylists()
  const { username } = useCurrentUser()
  const { data: nextAuthSession } = useSession()
  const supabase = createClient()

  const [dataSource, setDataSource] = useState<DataSourceType>('top')
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
  const [canNativeShare, setCanNativeShare] = useState(false)

  useEffect(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
      try {
        const probe = new File([''], 'receipt.png', { type: 'image/png' })
        setCanNativeShare(navigator.canShare({ files: [probe] }))
      } catch {
        setCanNativeShare(false)
      }
    }
  }, [])

  // Initialize customer name
  useEffect(() => {
    const defaultName = nextAuthSession?.user?.name || username || 'MUSIC LOVER'
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
    if (!isOpen || (dataSource !== 'top' && dataSource !== 'history' && dataSource !== 'favorites')) return

    const tableToListen = (dataSource === 'top' || dataSource === 'history') ? 'listening_history' : 'favorite_tracks'
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
      top: 'BILLBOARD TOP TRACKS',
      history: 'RECENT LISTENING HISTORY',
      favorites: 'TOP FAVORITES RECEIPT',
      playlist: `${playlistName} RECEIPT`,
      queue: 'NOW PLAYING QUEUE',
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
          top: 'BILLBOARD TOP TRACKS',
          history: 'RECENT LISTENING HISTORY',
          favorites: 'TOP FAVORITES RECEIPT',
          playlist: `${playlistName} RECEIPT`,
          queue: 'NOW PLAYING QUEUE',
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
        top: 'BILLBOARD TOP TRACKS',
        history: 'RECENT LISTENING HISTORY',
        favorites: 'TOP FAVORITES RECEIPT',
        playlist: `${playlistName} RECEIPT`,
        queue: 'NOW PLAYING QUEUE',
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
        top: 'BILLBOARD TOP TRACKS',
        history: 'RECENT LISTENING HISTORY',
        favorites: 'TOP FAVORITES RECEIPT',
        playlist: `${playlistName} RECEIPT`,
        queue: 'NOW PLAYING QUEUE',
      }

      const blob = await generateReceiptBlob({
        title: 'MUSICWEB STORE',
        periodLabel: labelMap[dataSource] || 'TOP TRACKS RECEIPT',
        userName: customerName || 'CUSTOMER',
        tracks: sliceTracks,
        themeId: selectedThemeId,
      })

      const file = new File([blob], 'musicweb-receipt.png', { type: 'image/png' })

      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Hóa đơn âm nhạc · ${customerName}`,
          text: `Xem hóa đơn âm nhạc của ${customerName} trên MusicWeb`,
          files: [file],
        })
        toast('Đã mở chia sẻ hóa đơn!', 'success')
      } else {
        // Desktop or browsers without Web Share API: Download PNG
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
    <div className="@container flex-1 flex flex-col min-h-0 w-full">
      {/* Mobile Tab Segmented Switcher (Visible on mobile only < md) */}
      <div className="flex md:hidden items-center p-2 bg-black/60 border-b border-white/[0.08] shrink-0">
        <div className="grid grid-cols-2 w-full p-1 bg-white/[0.05] rounded-xl border border-white/10">
          <button
            onClick={() => setMobileTab('custom')}
            className={`py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              mobileTab === 'custom'
                ? 'bg-[var(--primary-spotify,#06b6d4)] text-black font-extrabold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>1. Tùy chỉnh</span>
          </button>

          <button
            onClick={() => setMobileTab('preview')}
            className={`py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              mobileTab === 'preview'
                ? 'bg-[var(--primary-spotify,#06b6d4)] text-black font-extrabold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>2. Xem trước ({sliceTracks.length} bài)</span>
          </button>
        </div>
      </div>

      {/* Main Content Studio (Responsive @container 2-Column Desktop + Mobile Tabs) */}
      <div className="flex-1 flex flex-col @[640px]:flex-row gap-4 lg:gap-6 min-h-0 relative">
        {/* LEFT STUDIO PANEL: Controls & Customizations */}
        <div
          className={`w-full @[640px]:w-[320px] xl:w-[380px] flex-col bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 sm:p-5 lg:p-6 space-y-5 lg:space-y-6 backdrop-blur-xl shrink-0 overflow-y-auto no-scrollbar justify-between ${
            mobileTab === 'custom' ? 'flex flex-1 @[640px]:flex-initial' : 'hidden md:flex'
          }`}
        >
          <div className="space-y-5 lg:space-y-6">
            {/* Data Source Selector */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <ListMusic className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Nguồn bài hát
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-slate-400">
                  {dataSource === 'top' ? 'Billboard' : dataSource === 'history' ? 'Lịch sử' : 'Yêu thích'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setDataSource('top')}
                  className={`py-2.5 px-3 rounded-xl font-bold text-xs flex flex-col items-center gap-1.5 transition-colors border cursor-pointer ${
                    dataSource === 'top'
                      ? 'bg-[var(--accent-dim,rgba(34,211,238,0.16))] border-[var(--spotify-glow,#22d3ee)] text-[var(--spotify-glow,#22d3ee)]'
                      : 'bg-white/[0.04] border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  <Trophy className="w-4 h-4" />
                  <span>Billboard</span>
                </button>

                <button
                  onClick={() => setDataSource('history')}
                  className={`py-2.5 px-3 rounded-xl font-bold text-xs flex flex-col items-center gap-1.5 transition-colors border cursor-pointer ${
                    dataSource === 'history'
                      ? 'bg-[var(--accent-dim,rgba(34,211,238,0.16))] border-[var(--spotify-glow,#22d3ee)] text-[var(--spotify-glow,#22d3ee)]'
                      : 'bg-white/[0.04] border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  <History className="w-4 h-4" />
                  <span>Lịch sử</span>
                </button>

                <button
                  onClick={() => setDataSource('favorites')}
                  className={`py-2.5 px-3 rounded-xl font-bold text-xs flex flex-col items-center gap-1.5 transition-colors border cursor-pointer ${
                    dataSource === 'favorites'
                      ? 'bg-[var(--accent-dim,rgba(34,211,238,0.16))] border-[var(--spotify-glow,#22d3ee)] text-[var(--spotify-glow,#22d3ee)]'
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
                  <Hash className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Số lượng bài in trên hóa đơn
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-[var(--spotify-glow,#22d3ee)] tabular-nums">
                  {sliceTracks.length} bài
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[5, 10, 15, 20].map((num) => (
                  <button
                    key={num}
                    onClick={() => setTrackLimit(num)}
                    className={`py-2.5 rounded-xl font-extrabold text-xs transition-colors border cursor-pointer ${
                      trackLimit === num
                        ? 'bg-[var(--primary-spotify,#06b6d4)] text-black border-transparent'
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
                  <Palette className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Chủ đề giấy in
                  </span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-[var(--spotify-glow,#22d3ee)]">
                  {RECEIPT_THEMES.find((t) => t.id === selectedThemeId)?.name}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {RECEIPT_THEMES.map((theme) => {
                  const isActive = selectedThemeId === theme.id
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedThemeId(theme.id)}
                      className={`min-h-[50px] h-auto rounded-xl flex items-center justify-center gap-1 py-2 px-2 transition-colors relative border font-bold text-[11px] leading-tight text-center cursor-pointer ${
                        isActive
                          ? 'border-[var(--spotify-glow,#22d3ee)] ring-2 ring-[var(--spotify-glow,#22d3ee)]/50'
                          : 'border-white/15 opacity-80 hover:opacity-100 hover:border-white/40'
                      }`}
                      style={{
                        background: `linear-gradient(135deg, ${theme.paperGrad[0]}, ${theme.paperGrad[1]})`,
                        color: theme.textColor,
                      }}
                    >
                      <span className="text-center leading-tight">{theme.name}</span>
                      {isActive && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Customer Name Input */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <User className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
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
                className="w-full px-4 py-3 rounded-xl bg-white/[0.06] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-[var(--spotify-glow,#22d3ee)] focus:ring-1 focus:ring-[var(--spotify-glow,#22d3ee)] placeholder:text-slate-500 transition-colors"
              />
            </div>
          </div>

          {/* Mobile Bottom Floating Action: Proceed to Preview */}
          <div className="md:hidden pt-4 border-t border-white/10 shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
            <button
              onClick={() => setMobileTab('preview')}
              disabled={sliceTracks.length === 0}
              className="w-full py-3.5 px-4 rounded-xl font-extrabold text-sm text-black flex items-center justify-center gap-2 bg-[var(--primary-spotify,#06b6d4)]"
            >
              <span>Xem trước Hóa đơn ({sliceTracks.length} bài)</span>
              <Receipt className="w-4 h-4 text-black" />
            </button>
          </div>
        </div>

        {/* RIGHT SHOWCASE PANEL: Thermal Paper Preview Pedestal & Action Buttons */}
        <div
          className={`flex-1 min-w-0 flex-col bg-white/[0.02] border border-white/[0.08] rounded-2xl p-4 sm:p-5 lg:p-6 relative backdrop-blur-xl justify-between min-h-0 ${
            mobileTab === 'preview' ? 'flex' : 'hidden md:flex'
          }`}
        >
          {/* Ambient Pedestal Tint */}
          <div
            className="absolute inset-0 pointer-events-none rounded-2xl overflow-hidden"
            style={{
              background: 'radial-gradient(circle at 50% 40%, var(--theme-gradient-1, rgba(34, 211, 238, 0.08)), transparent 70%)',
            }}
          />

          {/* Scrollable Thermal Receipt Preview Pedestal */}
          <div
            className={`flex-1 overflow-y-auto flex flex-col items-center justify-start py-2 px-1 custom-slim-scrollbar relative z-10 min-h-[260px] ${
              isPageMode ? 'lg:max-h-[calc(100vh-300px)] max-h-[500px]' : 'max-h-[460px] lg:max-h-[500px]'
            }`}
          >
            <div className="relative w-full max-w-[340px] sm:max-w-[380px] flex items-center justify-center">
              {isLoadingTracks ? (
                <div className="w-64 h-80 flex flex-col items-center justify-center gap-3 text-slate-400 bg-black/40 rounded-xl border border-white/10 p-6">
                  <RefreshCw className="w-7 h-7 text-[var(--spotify-glow,#22d3ee)] animate-spin" />
                  <span className="text-xs font-bold">Đang tải danh sách bài hát...</span>
                </div>
              ) : previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Music Receipt Preview"
                  className={`${
                    isPageMode ? 'max-h-[360px] 2xl:max-h-[460px] w-auto max-w-full' : 'w-full h-auto'
                  } object-contain rounded-xl drop-shadow-[0_18px_40px_rgba(0,0,0,0.75)] border border-white/15`}
                />
              ) : (
                <div className="w-64 h-80 flex flex-col items-center justify-center gap-3 text-slate-400 bg-black/40 rounded-xl border border-white/10 p-6">
                  <Receipt className="w-8 h-8 text-[var(--spotify-glow,#22d3ee)]/50" />
                  <span className="text-xs font-bold">Chưa có bài hát để tạo hóa đơn</span>
                </div>
              )}

              {isGenerating && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center rounded-xl">
                  <RefreshCw className="w-6 h-6 text-[var(--spotify-glow,#22d3ee)] animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action Buttons Bar */}
          <div className="flex flex-col gap-2.5 pt-4 mt-2 border-t border-white/[0.08] shrink-0 relative z-10 pb-1 sm:pb-0">
            {canNativeShare ? (
              <>
                <button
                  onClick={handleShare}
                  disabled={isSharing || sliceTracks.length === 0}
                  className="w-full py-3.5 px-4 rounded-xl font-extrabold text-sm text-black flex items-center justify-center gap-2.5 hover:brightness-110 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-[var(--primary-spotify,#06b6d4)]"
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

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    onClick={handleCopy}
                    disabled={sliceTracks.length === 0}
                    className="py-3 px-4 rounded-xl font-bold text-xs text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 hover:border-white/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                        <span className="text-[var(--spotify-glow,#22d3ee)] font-bold">Đã sao chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                        <span>Sao chép ảnh</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleDownload}
                    disabled={sliceTracks.length === 0}
                    className="py-3 px-4 rounded-xl font-bold text-xs text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 hover:border-white/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                    <span>Tải ảnh PNG</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  onClick={handleDownload}
                  disabled={sliceTracks.length === 0}
                  className="py-3 px-4 rounded-xl font-extrabold text-xs sm:text-sm text-black bg-[var(--primary-spotify,#06b6d4)] hover:brightness-110 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Download className="w-4 h-4 text-black" />
                  <span>Tải ảnh hóa đơn (PNG)</span>
                </button>

                <button
                  onClick={handleCopy}
                  disabled={sliceTracks.length === 0}
                  className="py-3 px-4 rounded-xl font-bold text-xs sm:text-sm text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 hover:border-white/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                      <span className="text-[var(--spotify-glow,#22d3ee)] font-bold">Đã sao chép ảnh</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                      <span>Sao chép vào Clipboard</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
