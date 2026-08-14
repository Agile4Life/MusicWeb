'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { useSession } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import { getAllValidUserIds } from '@/lib/accessControl'
import { fetchListeningHistory } from '@/lib/listeningHistory'
import { toast } from '@/components/ui/ToastContext'
import {
  RECEIPT_THEMES,
  ReceiptTrackItem,
  generateReceiptDataUrl,
  generateReceiptBlob,
} from '@/lib/receiptCanvas'
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
  isOpen: boolean
  onClose: () => void
}

type DataSourceType = 'queue' | 'history' | 'favorites' | 'playlist'

export const ReceiptifyView: React.FC<ReceiptifyViewProps> = ({ isOpen, onClose }) => {
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
    if (nextAuthSession?.user?.name) {
      setCustomerName(nextAuthSession.user.name)
    } else if (username) {
      setCustomerName(username)
    } else {
      setCustomerName('PHONG TCT')
    }
  }, [nextAuthSession?.user?.name, username])

  // Fetch / extract tracks based on data source
  const loadTracksForSource = useCallback(async (source: DataSourceType) => {
    setIsLoadingTracks(true)
    try {
      if (source === 'queue') {
        const queueTracks: Track[] = []
        if (currentTrack) queueTracks.push(currentTrack)
        if (queue && queue.length > 0) {
          queue.forEach((t) => {
            if (!queueTracks.some((existing) => existing.id === t.id)) {
              queueTracks.push(t)
            }
          })
        }
        const items: ReceiptTrackItem[] = queueTracks.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          duration: t.duration,
        }))
        setFetchedTracks(items)
      } else if (source === 'history') {
        const userIds = getAllValidUserIds(null, nextAuthSession?.user?.email || null)
        const entries = await fetchListeningHistory(supabase, userIds, 25)
        const items: ReceiptTrackItem[] = entries
          .filter((e) => Boolean(e.track))
          .map((e) => {
            const track = e.track as Track
            return {
              id: track.id,
              title: track.title,
              artist: track.artist,
              duration: track.duration,
            }
          })
        setFetchedTracks(items)
      } else if (source === 'favorites') {
        const userIds = getAllValidUserIds(null, nextAuthSession?.user?.email || null)
        let query = supabase.from('favorites').select('track:tracks(*)').order('created_at', { ascending: false }).limit(25)
        if (userIds.length > 0) {
          query = query.in('user_id', userIds)
        }
        const { data, error } = await query
        if (!error && data) {
          const items: ReceiptTrackItem[] = data
            .map((item: any) => item.track)
            .filter(Boolean)
            .map((t: Track) => ({
              id: t.id,
              title: t.title,
              artist: t.artist,
              duration: t.duration,
            }))
          setFetchedTracks(items)
        } else {
          setFetchedTracks([])
        }
      } else if (source === 'playlist') {
        const firstPlaylist = playlists[0]
        const playlistTracks: Track[] = (firstPlaylist as any)?.tracks || []
        const items: ReceiptTrackItem[] = playlistTracks.map((t: Track) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          duration: t.duration,
        }))
        setFetchedTracks(items)
      }
    } catch (err) {
      console.error('Failed to load tracks for receipt:', err)
      toast('Không thể tải danh sách bài hát cho hóa đơn', 'error')
    } finally {
      setIsLoadingTracks(false)
    }
  }, [currentTrack, queue, nextAuthSession?.user?.email, playlists, supabase])

  // Load tracks whenever data source changes or modal opens
  useEffect(() => {
    if (isOpen) {
      loadTracksForSource(dataSource)
    }
  }, [isOpen, dataSource, loadTracksForSource])

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

  // Handle Download PNG
  const handleDownload = async () => {
    try {
      const sliceTracks = fetchedTracks.slice(0, trackLimit)
      if (sliceTracks.length === 0) return

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

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `musicweb-receipt-${dataSource}-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast('Đã tải hóa đơn về máy!', 'success', 'Thành công')
    } catch (err) {
      console.error('Download receipt error:', err)
      toast('Lỗi khi tải ảnh hóa đơn', 'error')
    }
  }

  // Handle Copy to Clipboard
  const handleCopy = async () => {
    try {
      const sliceTracks = fetchedTracks.slice(0, trackLimit)
      if (sliceTracks.length === 0) return

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

      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': blob,
          }),
        ])
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
        toast('Đã sao chép hóa đơn vào bộ nhớ tạm!', 'success', 'Sao chép')
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
      if (sliceTracks.length === 0) return

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

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).catch(() => {})
      }

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Hóa đơn âm nhạc - ${customerName}`,
          text: `Xem hóa đơn âm nhạc của ${customerName} trên MusicWeb! 🧾🎵`,
          files: [file],
        })
        toast('Đã sao chép link web & mở chia sẻ Story!', 'success')
      } else if (navigator.share) {
        await navigator.share({
          title: `Hóa đơn âm nhạc - ${customerName}`,
          text: `Xem hóa đơn âm nhạc của ${customerName} trên MusicWeb! 🧾🎵`,
          url: shareUrl,
        })
      } else {
        await handleCopy()
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
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
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

      {/* Main Content Area (Responsive Desktop 2-Column + Mobile Tabs) */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden relative">
        {/* 🛠️ LEFT SIDEBAR: Controls & Customizations */}
        <div
          className={`w-full md:w-[360px] lg:w-[400px] border-b md:border-b-0 md:border-r border-white/[0.08] flex-col bg-black/30 backdrop-blur-md shrink-0 overflow-y-auto p-4 sm:p-5 space-y-5 no-scrollbar justify-between ${
            mobileTab === 'custom' ? 'flex flex-1' : 'hidden md:flex'
          }`}
        >
          <div className="space-y-5">
            {/* Data Source Selector */}
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <ListMusic className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Nguồn bài hát</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setDataSource('queue')}
                  className={`py-2.5 px-3 rounded-xl font-bold text-xs flex flex-col items-center gap-1.5 transition-all duration-200 border ${
                    dataSource === 'queue'
                      ? 'bg-[var(--primary-spotify,#06b6d4)]/20 border-[var(--primary-spotify,#06b6d4)]/50 text-[var(--spotify-glow,#22d3ee)] shadow-[0_0_15px_var(--theme-glow-shadow,rgba(6,182,212,0.25))]'
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
                      ? 'bg-[var(--primary-spotify,#06b6d4)]/20 border-[var(--primary-spotify,#06b6d4)]/50 text-[var(--spotify-glow,#22d3ee)] shadow-[0_0_15px_var(--theme-glow-shadow,rgba(6,182,212,0.25))]'
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
                      ? 'bg-[var(--primary-spotify,#06b6d4)]/20 border-[var(--primary-spotify,#06b6d4)]/50 text-[var(--spotify-glow,#22d3ee)] shadow-[0_0_15px_var(--theme-glow-shadow,rgba(6,182,212,0.25))]'
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
                  <Sparkles className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Số lượng bài hát</span>
                </div>
                <span className="text-xs font-mono font-bold text-[var(--spotify-glow,#22d3ee)]">
                  {sliceTracks.length} bài
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[5, 10, 15, 20].map((num) => (
                  <button
                    key={num}
                    onClick={() => setTrackLimit(num)}
                    className={`py-2 rounded-xl font-extrabold text-xs transition-all duration-200 border ${
                      trackLimit === num
                        ? 'bg-white text-black border-white shadow-lg scale-105'
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
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Chủ đề giấy in</span>
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
                      className={`h-11 rounded-xl flex items-center justify-center p-2 transition-all duration-200 relative border font-bold text-xs ${
                        isActive
                          ? 'border-white scale-105 shadow-[0_0_15px_rgba(255,255,255,0.35)] ring-2 ring-[var(--spotify-glow,#22d3ee)]/60'
                          : 'border-white/15 opacity-70 hover:opacity-100 hover:border-white/40'
                      }`}
                      style={{
                        background: `linear-gradient(135deg, ${theme.paperGrad[0]}, ${theme.paperGrad[1]})`,
                        color: theme.textColor,
                      }}
                    >
                      <span className="truncate">{theme.name.split(' ')[0]}</span>
                      {isActive && <Check className="w-3.5 h-3.5 ml-1 shrink-0 drop-shadow" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Customer Name Input */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <User className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Tên trên hóa đơn</span>
              </div>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nhập tên của bạn..."
                maxLength={28}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-[var(--spotify-glow,#22d3ee)] focus:ring-1 focus:ring-[var(--spotify-glow,#22d3ee)] placeholder:text-slate-500 transition-all"
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
                background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                boxShadow: '0 8px 20px var(--theme-glow-shadow, rgba(6,182,212,0.25))',
              }}
            >
              <span>Xem trước Hóa đơn ({sliceTracks.length} bài)</span>
              <Sparkles className="w-4 h-4 text-black" />
            </button>
          </div>
        </div>

        {/* 🖼️ RIGHT PREVIEW AREA: Thermal Paper Preview & Action Buttons */}
        <div
          className={`flex-1 flex-col min-h-0 bg-[#07090e]/80 p-3.5 sm:p-6 overflow-hidden ${
            mobileTab === 'preview' ? 'flex' : 'hidden md:flex'
          }`}
        >
          {/* Scrollable Receipt Preview Container */}
          <div className="flex-1 overflow-y-auto flex items-center justify-center py-2 no-scrollbar">
            <div className="relative max-h-[58vh] sm:max-h-[460px] w-auto max-w-[340px] sm:max-w-none rounded-xl overflow-hidden shadow-[0_25px_60px_rgba(0,0,0,0.85)] border border-white/15 group hover:scale-[1.01] transition-all duration-300 flex items-center justify-center bg-black/40">
              {isLoadingTracks ? (
                <div className="w-64 h-80 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <RefreshCw className="w-7 h-7 text-[var(--spotify-glow,#22d3ee)] animate-spin" />
                  <span className="text-xs font-bold">Đang tải bài hát...</span>
                </div>
              ) : previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Music Receipt Preview"
                  className="w-full h-auto max-h-[58vh] sm:max-h-[460px] object-contain rounded-xl transition-all duration-300 drop-shadow-2xl"
                />
              ) : (
                <div className="w-64 h-80 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <Receipt className="w-8 h-8 text-[var(--spotify-glow,#22d3ee)]/50" />
                  <span className="text-xs font-bold">Chưa có bài hát để tạo hóa đơn</span>
                </div>
              )}

              {isGenerating && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center">
                  <RefreshCw className="w-6 h-6 text-[var(--spotify-glow,#22d3ee)] animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Bottom Actions Bar */}
          <div className="flex flex-col gap-2.5 pt-3 border-t border-white/[0.08] shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:pb-0">
            {/* Primary Share Action */}
            <button
              onClick={handleShare}
              disabled={isSharing || sliceTracks.length === 0}
              className="w-full py-3.5 px-4 rounded-xl font-extrabold text-sm text-black flex items-center justify-center gap-2.5 shadow-[0_0_25px_var(--theme-glow-shadow,rgba(6,182,212,0.4))] hover:shadow-[0_0_35px_var(--theme-glow-shadow,rgba(6,182,212,0.6))] hover:scale-[1.01] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              style={{
                background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
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

            {/* Secondary Actions: Copy & Download */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleCopy}
                disabled={sliceTracks.length === 0}
                className="py-2.5 px-3 rounded-xl font-bold text-xs text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 hover:border-white/20 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400">Đã sao chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-300" />
                    <span>Sao chép ảnh</span>
                  </>
                )}
              </button>

              <button
                onClick={handleDownload}
                disabled={sliceTracks.length === 0}
                className="py-2.5 px-3 rounded-xl font-bold text-xs text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 hover:border-white/20 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <Download className="w-4 h-4 text-slate-300" />
                <span>Tải ảnh PNG</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
