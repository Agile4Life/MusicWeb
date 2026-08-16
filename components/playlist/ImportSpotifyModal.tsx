'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  X,
  Search,
  Music,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  Check,
  ListMusic,
  User,
  Sparkles,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getValidUserId } from '@/lib/accessControl'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import {
  extractSpotifyPlaylistId,
  fetchSpotifyPlaylistMeta,
  fetchSpotifyPlaylistTracks,
  SpotifyPlaylistMeta,
  SpotifyPlaylistTrack,
} from '@/lib/spotify'
import {
  matchPlaylistToYouTube,
  matchSingleTrack,
  PlaylistImportResult,
} from '@/lib/playlist-import'
import { searchYouTubeTracks } from '@/lib/youtube'
import { Track } from '@/types'
import { resolvePlaylistTrackWithNct } from '@/lib/playlistNct'

interface ImportSpotifyModalProps {
  isOpen: boolean
  onClose: () => void
}

type ModalStep = 'input' | 'preview' | 'matching' | 'review' | 'importing' | 'complete'

function formatSeconds(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

export function ImportSpotifyModal({ isOpen, onClose }: ImportSpotifyModalProps) {
  const router = useRouter()
  const supabase = createClient()
  const { userEmail } = useCurrentUser()
  const { refreshPlaylists } = usePlaylists()

  // Steps & basic inputs
  const [step, setStep] = useState<ModalStep>('input')
  const [urlInput, setUrlInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)

  // Playlist Meta & Tracks
  const [meta, setMeta] = useState<SpotifyPlaylistMeta | null>(null)
  const [spotifyTracks, setSpotifyTracks] = useState<SpotifyPlaylistTrack[]>([])
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [playlistName, setPlaylistName] = useState('')

  // Matching & Progress
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [importResults, setImportResults] = useState<PlaylistImportResult[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const importingRef = useRef(false)
  const matchingRef = useRef(false)
  const loadingMetaRef = useRef(false)

  // Review & Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'all' | 'high' | 'low' | 'none'>('all')

  // Manual Re-match Modal State
  const [manualMatchTrack, setManualMatchTrack] = useState<SpotifyPlaylistTrack | null>(null)
  const [manualSearchQuery, setManualSearchQuery] = useState('')
  const [manualCandidates, setManualCandidates] = useState<Track[]>([])
  const [searchingManual, setSearchingManual] = useState(false)

  // Final Import Result
  const [importingProgress, setImportingProgress] = useState({ done: 0, total: 0 })
  const [createdPlaylistId, setCreatedPlaylistId] = useState<string | null>(null)
  const [importedTrackCount, setImportedTrackCount] = useState(0)
  const prevIsOpenRef = useRef(false)

  // Reset / sync state only on transition from closed to open
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setStep('input')
      setUrlInput('')
      setInputError(null)
      setMeta(null)
      setSpotifyTracks([])
      setImportResults([])
      setSelectedIds(new Set())
      setManualMatchTrack(null)
      setCreatedPlaylistId(null)
      setImportedTrackCount(0)
      setImportingProgress({ done: 0, total: 0 })
    } else if (!isOpen && prevIsOpenRef.current) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen])

  if (!isOpen) return null

  // STAGE 4.1: Handle URL input submission
  const handleParseAndFetchMeta = async (e?: React.FormEvent) => {
    if (loadingMetaRef.current) return
    loadingMetaRef.current = true
    try {
      if (e) e.preventDefault()
      setInputError(null)

      const playlistId = extractSpotifyPlaylistId(urlInput)
      if (!playlistId) {
        setInputError('Không nhận diện được link playlist Spotify. Vui lòng kiểm tra lại đường dẫn!')
        return
      }

      setLoadingMeta(true)
      try {
        const playlistMeta = await fetchSpotifyPlaylistMeta(playlistId)
        if (!playlistMeta) {
          setInputError(
            'Không thể truy cập playlist Spotify này. Playlist có thể ở chế độ Riêng tư (Private) hoặc không tồn tại. Spotify API chỉ có thể lấy dữ liệu từ link playlist Công khai (Public).'
          )
          return
        }

        setMeta(playlistMeta)
        setPlaylistName(playlistMeta.name)
        setStep('preview')

        // Auto start fetching track list
        setLoadingTracks(true)
        const tracks = await fetchSpotifyPlaylistTracks(playlistId)
        setSpotifyTracks(tracks)
        if (tracks.length > 0) {
          setMeta((prev) => (prev ? { ...prev, total_tracks: tracks.length } : prev))
        }
        setLoadingTracks(false)
      } catch (err) {
        console.error('Fetch meta error:', err)
        setInputError('Lỗi kết nối khi tải dữ liệu từ Spotify. Vui lòng thử lại sau.')
      } finally {
        setLoadingMeta(false)
      }
    } finally {
      loadingMetaRef.current = false
    }
  }

  // STAGE 4.3: Start batch YouTube matching
  const handleStartMatching = async () => {
    if (matchingRef.current) return
    matchingRef.current = true
    try {
      if (spotifyTracks.length === 0) return
      setStep('matching')
      setProgress({ done: 0, total: spotifyTracks.length })

      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const results = await matchPlaylistToYouTube(
          spotifyTracks,
          (done, total) => {
            setProgress({ done, total })
          },
          4,
          controller.signal
        )

        // Filter out empty items if canceled early
        const finalResults = results.filter(Boolean)
        setImportResults(finalResults)

        // Pre-select high & low confidence matches by default
        const initialSelected = new Set<string>()
        finalResults.forEach((r) => {
          if (r.matchedTrack && (r.matchConfidence === 'high' || r.matchConfidence === 'low')) {
            initialSelected.add(r.spotify_id)
          }
        })
        setSelectedIds(initialSelected)
        setStep('review')
      } catch (err) {
        console.error('Matching error:', err)
        setStep('review')
      } finally {
        abortControllerRef.current = null
      }
    } finally {
      matchingRef.current = false
    }
  }

  // Cancel matching progress
  const handleCancelMatching = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  // Selection Toggles in Review step
  const toggleSelectTrack = (spotifyId: string) => {
    const next = new Set(selectedIds)
    if (next.has(spotifyId)) {
      next.delete(spotifyId)
    } else {
      next.add(spotifyId)
    }
    setSelectedIds(next)
  }

  const handleSelectAll = () => {
    const allIds = new Set(importResults.filter((r) => r.matchedTrack).map((r) => r.spotify_id))
    setSelectedIds(allIds)
  }

  const handleDeselectAll = () => {
    setSelectedIds(new Set())
  }

  // Manual Search Dialog Handlers
  const handleOpenManualSearch = (spotifyTrack: SpotifyPlaylistTrack) => {
    setManualMatchTrack(spotifyTrack)
    setManualSearchQuery(`${spotifyTrack.title} ${spotifyTrack.artist}`)
    setManualCandidates([])
    handleRunManualSearch(`${spotifyTrack.title} ${spotifyTrack.artist}`)
  }

  const handleRunManualSearch = async (query: string) => {
    if (!query.trim()) return
    setSearchingManual(true)
    try {
      const results = await searchYouTubeTracks(query, 8)
      setManualCandidates(results)
    } catch (err) {
      console.error('Manual search error:', err)
    } finally {
      setSearchingManual(false)
    }
  }

  const handlePickManualCandidate = (candidate: Track) => {
    if (!manualMatchTrack) return

    setImportResults((prev) =>
      prev.map((item) => {
        if (item.spotify_id === manualMatchTrack.spotify_id) {
          return {
            ...item,
            matchedTrack: candidate,
            matchConfidence: 'high',
          }
        }
        return item
      })
    )

    // Ensure it gets checked
    setSelectedIds((prev) => new Set(prev).add(manualMatchTrack.spotify_id))
    setManualMatchTrack(null)
  }

  // STAGE 4.5: Save playlist & tracks into Supabase DB
  const handleConfirmImport = async () => {
    if (importingRef.current) return
    importingRef.current = true
    try {
      const tracksToImport = importResults.filter(
        (r) => selectedIds.has(r.spotify_id) && r.matchedTrack !== null
      )

      if (tracksToImport.length === 0) {
        alert('Chưa có bài hát nào được chọn để thêm vào playlist!')
        return
      }

      setStep('importing')
      setImportingProgress({ done: 0, total: tracksToImport.length })

      // 1. Create Playlist row
      const finalPlName = playlistName.trim() || meta?.name || 'Spotify Playlist Import'
      const createRes = await fetch('/api/playlists/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalPlName,
          description: meta?.description
            ? `${meta.description} (Imported from Spotify)`
            : 'Imported from Spotify',
          coverUrl: meta?.cover_url || null,
          isPublic: false,
        }),
      })
      const createResult = await createRes.json()
      if (!createRes.ok || !createResult.playlist) {
        throw new Error(createResult.error || 'Không thể tạo playlist mới trong CSDL.')
      }

      const targetPlaylistId = createResult.playlist.id
      setCreatedPlaylistId(targetPlaylistId)

      // 2. Insert tracks and link in playlist_tracks
      let successCount = 0
      for (let i = 0; i < tracksToImport.length; i++) {
        const item = tracksToImport[i]
        const matched = item.matchedTrack!
        const candidate: Track = {
          ...matched,
          artist: matched.artist || item.spotifyTrack.artist,
          album: item.spotifyTrack.album || matched.album,
        }
        const resolvedTrack = await resolvePlaylistTrackWithNct(candidate)

        const filePath =
          resolvedTrack.file_path ||
          (resolvedTrack.nhaccuatui_id
            ? `nct:${resolvedTrack.nhaccuatui_id}`
            : resolvedTrack.youtube_id
              ? `https://www.youtube.com/watch?v=${resolvedTrack.youtube_id}`
              : item.spotify_id
                ? `spotify:${item.spotify_id}`
                : `ext:${Date.now()}-${i}`)

        const res = await fetch('/api/playlist-tracks/import-track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playlistId: targetPlaylistId,
            position: i + 1,
            track: {
              title: resolvedTrack.title || item.spotifyTrack.title,
              artist: resolvedTrack.artist || item.spotifyTrack.artist,
              album: resolvedTrack.album || item.spotifyTrack.album || 'Spotify Import',
              duration: resolvedTrack.duration || item.spotifyTrack.duration || 0,
              filePath,
              coverUrl: resolvedTrack.cover_url || item.spotifyTrack.cover_url,
              source: resolvedTrack.source || (resolvedTrack.nhaccuatui_id ? 'nhaccuatui' : resolvedTrack.youtube_id ? 'youtube' : 'spotify'),
              youtubeId: resolvedTrack.youtube_id || null,
              spotifyId: resolvedTrack.nhaccuatui_id ? null : resolvedTrack.spotify_id || item.spotify_id,
              nhaccuatuiId: resolvedTrack.nhaccuatui_id || null,
            },
          }),
        })
        if (res.ok) successCount++
        setImportingProgress({ done: i + 1, total: tracksToImport.length })
      }

      setImportedTrackCount(successCount)
      await refreshPlaylists()
      window.dispatchEvent(new Event('playlist-updated'))
      setStep('complete')
    } catch (err: any) {
      console.error('Import DB error:', err)
      alert('Có lỗi xảy ra trong quá trình lưu dữ liệu: ' + err?.message)
      setStep('review')
    } finally {
      importingRef.current = false
    }
  }

  // Filtered results for Review tab
  const highCount = importResults.filter((r) => r.matchConfidence === 'high').length
  const lowCount = importResults.filter((r) => r.matchConfidence === 'low').length
  const noneCount = importResults.filter((r) => r.matchConfidence === 'none').length

  const filteredResults = importResults.filter((r) => {
    if (activeTab === 'high') return r.matchConfidence === 'high'
    if (activeTab === 'low') return r.matchConfidence === 'low'
    if (activeTab === 'none') return r.matchConfidence === 'none'
    return true
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-sm:rounded-t-3xl max-sm:rounded-b-none sm:max-w-2xl max-h-[92vh] sm:max-h-[85vh] bg-[#0f121a] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        
        {/* Mobile Drag Indicator Bar */}
        <div className="w-12 h-1 bg-white/20 rounded-full mx-auto my-2.5 sm:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-white/[0.08] bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[var(--primary-spotify,#06b6d4)]/10 border border-[var(--primary-spotify,#06b6d4)]/20 flex items-center justify-center text-[var(--primary-spotify,#06b6d4)] shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white truncate">
                Nhập Playlist từ Spotify
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Tự động tìm kiếm & thêm nhạc vào playlist cho bạn
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors shrink-0 ml-2"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">

          {/* STEP 1: INPUT LINK */}
          {step === 'input' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Đường dẫn (URL) / ID Playlist Spotify Public
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleParseAndFetchMeta()}
                    placeholder="https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/10 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[var(--primary-spotify,#06b6d4)] transition-colors pr-10"
                  />
                  {loadingMeta ? (
                    <div className="absolute right-3 top-3.5 text-[var(--primary-spotify,#06b6d4)]">
                      <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                  ) : urlInput ? (
                    <button
                      onClick={() => setUrlInput('')}
                      className="absolute right-3 top-3.5 text-slate-500 hover:text-slate-300"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              </div>

              {inputError && (
                <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 text-red-300 text-xs leading-relaxed">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{inputError}</span>
                </div>
              )}

              <div className="p-4 bg-white/[0.02] border border-white/[0.05] rounded-xl text-xs space-y-2 text-slate-400">
                <p className="font-semibold text-slate-300">Định dạng URL được hỗ trợ:</p>
                <ul className="list-disc pl-4 space-y-1.5 font-mono text-[11px] text-slate-400 break-all">
                  <li className="break-all">https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...</li>
                  <li className="break-all">spotify:playlist:37i9dQZF1DXcBWIGoYBM5M</li>
                  <li className="break-all">37i9dQZF1DXcBWIGoYBM5M (Mã 22 ký tự base62)</li>
                </ul>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => handleParseAndFetchMeta()}
                  disabled={loadingMeta || !urlInput.trim()}
                  className="w-full sm:w-auto sm:ml-auto px-6 py-3 bg-[var(--primary-spotify,#06b6d4)] hover:brightness-110 active:scale-[0.98] disabled:opacity-50 text-black font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-[var(--theme-glow-shadow)]"
                >
                  {loadingMeta ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Đang tải thông tin...</span>
                    </>
                  ) : (
                    <>
                      <span>Tiếp tục</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: PREVIEW & FETCH TRACKS */}
          {step === 'preview' && meta && (
            <div className="space-y-5 sm:space-y-6">
              <div className="flex items-center sm:items-start gap-3 sm:gap-4 p-3.5 sm:p-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
                {meta.cover_url ? (
                  <img
                    src={meta.cover_url}
                    alt={meta.name}
                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover border border-white/10 shrink-0 shadow-md"
                  />
                ) : (
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-500 shrink-0">
                    <Music className="w-7 h-7 sm:w-8 sm:h-8" />
                  </div>
                )}

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-[10px] sm:text-[11px] font-mono text-[var(--primary-spotify,#06b6d4)] font-semibold uppercase">
                    <span>Spotify Playlist Public</span>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-white truncate">{meta.name}</h3>
                  <p className="text-xs text-slate-400 line-clamp-2">
                    {meta.description || 'Không có mô tả'}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] sm:text-xs text-slate-400">
                    <span className="flex items-center gap-1 truncate max-w-[140px]">
                      <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">{meta.owner}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <ListMusic className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      {spotifyTracks.length > 0 ? spotifyTracks.length : meta.total_tracks} bài hát
                    </span>
                  </div>
                </div>
              </div>

              {/* Editable Name */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Tên Playlist mới trên MusicWeb:
                </label>
                <input
                  type="text"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-xs sm:text-sm text-white focus:outline-none focus:border-[var(--primary-spotify,#06b6d4)]"
                />
              </div>

              {/* Tracks Loading State */}
              {loadingTracks ? (
                <div className="p-6 sm:p-8 text-center bg-white/[0.02] border border-white/[0.05] rounded-xl space-y-3">
                  <Loader2 className="w-7 h-7 text-[var(--primary-spotify,#06b6d4)] animate-spin mx-auto" />
                  <p className="text-xs text-slate-300 font-medium">
                    Đang lấy toàn bộ danh sách {meta.total_tracks} bài hát từ Spotify...
                  </p>
                </div>
              ) : (
                <div className="p-3.5 bg-[var(--primary-spotify,#06b6d4)]/10 border border-[var(--primary-spotify,#06b6d4)]/20 rounded-xl flex items-center justify-between gap-2 text-xs text-[var(--primary-spotify,#06b6d4)]">
                  <span>Đã tải thành công {spotifyTracks.length} bài hát sẵn sàng ghép nối.</span>
                  <Check className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)] shrink-0" />
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 pt-2">
                <button
                  onClick={() => setStep('input')}
                  className="w-full sm:w-auto px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white border border-white/10 sm:border-transparent rounded-xl text-center"
                >
                  Quay lại
                </button>
                <button
                  onClick={handleStartMatching}
                  disabled={loadingTracks || spotifyTracks.length === 0}
                  className="w-full sm:w-auto px-5 py-3 sm:py-2.5 bg-[var(--primary-spotify,#06b6d4)] hover:brightness-110 disabled:opacity-50 text-black font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-[var(--theme-glow-shadow)] active:scale-[0.98]"
                >
                  <span>Bắt đầu thêm nhạc</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: MATCHING PROGRESS */}
          {step === 'matching' && (
            <div className="py-6 sm:py-8 space-y-6 text-center">
              <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                <Loader2 className="w-20 h-20 text-[var(--primary-spotify,#06b6d4)] animate-spin" />
                <Music className="w-8 h-8 text-white absolute" />
              </div>

              <div className="space-y-1.5 px-2">
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Đang tìm kiếm & thêm vào playlist cho bạn...
                </h3>
                <p className="text-xs text-slate-400">
                  Đã hoàn tất {progress.done} / {progress.total} bài hát
                </p>
              </div>

              {/* Progress bar */}
              <div className="max-w-md mx-auto space-y-1.5 px-2">
                <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--primary-spotify,#06b6d4)] to-[var(--theme-secondary,#3b82f6)] transition-all duration-300 rounded-full"
                    style={{
                      width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                  <span>
                    {Math.round(progress.total > 0 ? (progress.done / progress.total) * 100 : 0)}%
                  </span>
                  <span>{progress.done} / {progress.total}</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleCancelMatching}
                  className="w-full sm:w-auto px-4 py-2.5 border border-white/10 hover:bg-white/10 text-xs font-semibold text-slate-300 rounded-xl transition-colors"
                >
                  Dừng & Duyệt kết quả hiện tại
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: REVIEW MATCHES */}
          {step === 'review' && (
            <div className="space-y-3 sm:space-y-4">
              {/* Filter Tabs Header - Horizontal scroll on mobile */}
              <div className="space-y-2 pb-2 border-b border-white/[0.08]">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1.5">
                  <button
                    onClick={() => setActiveTab('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                      activeTab === 'all'
                        ? 'bg-[var(--primary-spotify,#06b6d4)] text-black shadow-sm'
                        : 'bg-white/[0.04] text-slate-400 hover:text-white border border-white/5'
                    }`}
                  >
                    Tất cả ({importResults.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('high')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                      activeTab === 'high'
                        ? 'bg-[var(--primary-spotify,#06b6d4)] text-black shadow-sm'
                        : 'bg-white/[0.04] text-slate-400 hover:text-white border border-white/5'
                    }`}
                  >
                    Khớp tốt ({highCount})
                  </button>
                  <button
                    onClick={() => setActiveTab('low')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                      activeTab === 'low'
                        ? 'bg-amber-500 text-black shadow-sm'
                        : 'bg-white/[0.04] text-slate-400 hover:text-white border border-white/5'
                    }`}
                  >
                    Cơ bản ({lowCount})
                  </button>
                  <button
                    onClick={() => setActiveTab('none')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                      activeTab === 'none'
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'bg-white/[0.04] text-slate-400 hover:text-white border border-white/5'
                    }`}
                  >
                    Chưa khớp ({noneCount})
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs px-1">
                  <div className="text-slate-400 font-medium text-[11px] sm:text-xs">
                    Đã chọn <span className="text-[var(--primary-spotify,#06b6d4)] font-bold">{selectedIds.size}</span> / {importResults.length} bài
                  </div>
                  <div className="flex items-center gap-3 text-[11px] sm:text-xs">
                    <button
                      onClick={handleSelectAll}
                      className="text-[var(--primary-spotify,#06b6d4)] hover:underline font-semibold"
                    >
                      Chọn tất cả
                    </button>
                    <span className="text-slate-600">•</span>
                    <button
                      onClick={handleDeselectAll}
                      className="text-slate-400 hover:underline font-medium"
                    >
                      Bỏ chọn tất cả
                    </button>
                  </div>
                </div>
              </div>

              {/* Track List */}
              <div className="max-h-[300px] sm:max-h-[360px] overflow-y-auto space-y-2 pr-1">
                {filteredResults.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    Không có bài hát nào trong nhóm này.
                  </div>
                ) : (
                  filteredResults.map((item) => {
                    const isSelected = selectedIds.has(item.spotify_id)
                    const durDiff = item.matchedTrack
                      ? Math.abs((item.matchedTrack.duration || 0) - item.spotifyTrack.duration)
                      : null

                    return (
                      <div
                        key={item.spotify_id}
                        className={`p-3 rounded-xl border transition-all space-y-2 ${
                          isSelected
                            ? 'bg-white/[0.04] border-white/15'
                            : 'bg-white/[0.01] border-white/[0.05] opacity-60'
                        }`}
                      >
                        {/* Row 1: Spotify Track info + Checkbox */}
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectTrack(item.spotify_id)}
                            className="w-4 h-4 mt-0.5 accent-[var(--primary-spotify,#06b6d4)] rounded cursor-pointer shrink-0"
                          />

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs sm:text-sm font-bold text-white truncate">
                                {item.spotifyTrack.title}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                {formatSeconds(item.spotifyTrack.duration)}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 truncate">
                              {item.spotifyTrack.artist} • {item.spotifyTrack.album}
                            </p>
                          </div>
                        </div>

                        {/* Row 2: YouTube Match Info & Search button */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.04] text-xs pl-7">
                          <div className="min-w-0 flex-1">
                            {item.matchConfidence === 'high' && item.matchedTrack && (
                              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold rounded-md shrink-0">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Khớp tốt (±{durDiff}s)
                                </span>
                                <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded-md shrink-0 ${item.matchedTrack.source === 'nhaccuatui' ? 'bg-[var(--primary-spotify,#06b6d4)]/10 border border-[var(--primary-spotify,#06b6d4)]/30 text-[var(--primary-spotify,#06b6d4)]' : 'bg-white/5 border border-white/10 text-slate-300'}`}>
                                  {item.matchedTrack.source === 'nhaccuatui' ? 'NCT' : 'YouTube'}
                                </span>
                                <span className="text-[10px] text-slate-400 truncate max-w-[180px] sm:max-w-[240px]">
                                  {item.matchedTrack.title}
                                </span>
                              </div>
                            )}

                            {item.matchConfidence === 'low' && item.matchedTrack && (
                              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-semibold rounded-md shrink-0">
                                  <AlertTriangle className="w-3 h-3" />
                                  Cơ bản (±{durDiff}s)
                                </span>
                                <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded-md shrink-0 ${item.matchedTrack.source === 'nhaccuatui' ? 'bg-[var(--primary-spotify,#06b6d4)]/10 border border-[var(--primary-spotify,#06b6d4)]/30 text-[var(--primary-spotify,#06b6d4)]' : 'bg-white/5 border border-white/10 text-slate-300'}`}>
                                  {item.matchedTrack.source === 'nhaccuatui' ? 'NCT' : 'YouTube'}
                                </span>
                                <span className="text-[10px] text-slate-400 truncate max-w-[180px] sm:max-w-[240px]">
                                  {item.matchedTrack.title}
                                </span>
                              </div>
                            )}

                            {item.matchConfidence === 'none' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-semibold rounded-md">
                                <XCircle className="w-3 h-3" />
                                Không khớp YouTube
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => handleOpenManualSearch(item.spotifyTrack)}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0 flex items-center gap-1 text-[11px]"
                            title="Tìm video thủ công trên YouTube"
                          >
                            <Search className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Đổi video</span>
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Bottom bar */}
              <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 pt-3 border-t border-white/[0.08]">
                <button
                  onClick={() => setStep('preview')}
                  className="w-full sm:w-auto px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white border border-white/10 sm:border-transparent rounded-xl text-center"
                >
                  Quay lại
                </button>
                <button
                  onClick={handleConfirmImport}
                  disabled={selectedIds.size === 0}
                  className="w-full sm:w-auto px-5 py-3 sm:py-2.5 bg-[var(--primary-spotify,#06b6d4)] hover:brightness-110 disabled:opacity-50 text-black font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-[var(--theme-glow-shadow)] active:scale-[0.98]"
                >
                  <span>Tạo Playlist ({selectedIds.size} bài)</span>
                  <Check className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: IMPORTING */}
          {step === 'importing' && (
            <div className="py-10 sm:py-12 space-y-6 text-center">
              <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 text-[var(--primary-spotify,#06b6d4)] animate-spin mx-auto" />
              <div className="space-y-1">
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Đang lưu Playlist vào cơ sở dữ liệu...
                </h3>
                <p className="text-xs text-slate-400">
                  Đã xử lý {importingProgress.done} / {importingProgress.total} bài hát
                </p>
              </div>
            </div>
          )}

          {/* STEP 6: COMPLETE */}
          {step === 'complete' && (
            <div className="py-6 sm:py-8 space-y-5 sm:space-y-6 text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto shadow-lg shadow-emerald-500/10">
                <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10" />
              </div>

              <div className="space-y-2">
                <h3 className="text-lg sm:text-xl font-bold text-white">Nhập Playlist thành công!</h3>
                <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                  Đã thêm thành công <strong className="text-emerald-400">{importedTrackCount}</strong> bài hát vào playlist{' '}
                  <strong className="text-white">"{playlistName}"</strong>.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-3">
                <button
                  onClick={onClose}
                  className="w-full sm:w-auto px-4 py-2.5 border border-white/10 hover:bg-white/10 text-xs font-semibold text-slate-300 rounded-xl"
                >
                  Đóng
                </button>
                {createdPlaylistId && (
                  <button
                    onClick={() => {
                      onClose()
                      router.push(`/playlist/${createdPlaylistId}`)
                    }}
                    className="w-full sm:w-auto px-5 py-3 sm:py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                  >
                    <span>Mở Playlist ngay</span>
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* MANUAL MATCHING SUB-MODAL */}
      {manualMatchTrack && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="w-full max-sm:rounded-t-3xl max-sm:rounded-b-none sm:max-w-lg max-h-[85vh] bg-[#141824] border border-white/15 rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4 text-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200">
            
            {/* Mobile handle indicator */}
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto my-1 sm:hidden shrink-0" />

            <div className="flex items-start justify-between border-b border-white/10 pb-3 shrink-0">
              <div className="min-w-0 pr-2">
                <h4 className="text-xs sm:text-sm font-bold text-white truncate">
                  Tìm video cho: {manualMatchTrack.title}
                </h4>
                <p className="text-[11px] text-slate-400 truncate">{manualMatchTrack.artist}</p>
              </div>
              <button
                onClick={() => setManualMatchTrack(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-2 shrink-0">
              <input
                type="text"
                value={manualSearchQuery}
                onChange={(e) => setManualSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRunManualSearch(manualSearchQuery)}
                placeholder="Từ khóa tìm kiếm YouTube..."
                className="flex-1 px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-[var(--primary-spotify,#06b6d4)]"
              />
              <button
                onClick={() => handleRunManualSearch(manualSearchQuery)}
                disabled={searchingManual}
                className="px-4 py-2.5 bg-[var(--primary-spotify,#06b6d4)] hover:brightness-110 text-black font-bold text-xs rounded-xl flex items-center gap-1.5 shrink-0"
              >
                {searchingManual ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>Tìm</span>
              </button>
            </div>

            {/* Candidates list */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {searchingManual ? (
                <div className="p-6 text-center text-xs text-slate-400 space-y-2">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--primary-spotify,#06b6d4)]" />
                  <span>Đang tìm kết quả...</span>
                </div>
              ) : manualCandidates.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Chưa có kết quả tìm kiếm nào.
                </div>
              ) : (
                manualCandidates.map((cand) => (
                  <div
                    key={cand.id}
                    onClick={() => handlePickManualCandidate(cand)}
                    className="p-2.5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 rounded-xl cursor-pointer flex items-center gap-3 transition-colors group"
                  >
                    {cand.cover_url && (
                      <img
                        src={cand.cover_url}
                        alt={cand.title}
                        className="w-12 h-9 rounded object-cover border border-white/10 shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="font-semibold text-white truncate group-hover:text-[var(--primary-spotify,#06b6d4)]">
                        {cand.title}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {cand.artist} • {formatSeconds(cand.duration)}
                      </p>
                    </div>
                    <button className="px-3 py-1.5 bg-[var(--primary-spotify,#06b6d4)]/20 text-[var(--primary-spotify,#06b6d4)] text-[11px] font-bold rounded-lg group-hover:bg-[var(--primary-spotify,#06b6d4)] group-hover:text-black transition-colors shrink-0">
                      Chọn
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
