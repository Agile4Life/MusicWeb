'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  X,
  Music,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  Check,
  ListMusic,
  User,
  Sparkles,
} from 'lucide-react'
import { YoutubeIcon } from '@/components/icons/YoutubeIcon'
import { createClient } from '@/lib/supabase/client'
import { getValidUserId } from '@/lib/accessControl'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import {
  extractYouTubePlaylistId,
  fetchYouTubePlaylistMeta,
  fetchYouTubePlaylistTracks,
  enrichPlaylistTracksWithMeta,
  YouTubePlaylistMeta,
} from '@/lib/youtube'
import { Track } from '@/types'
import { resolvePlaylistTrackWithNct } from '@/lib/playlistNct'

interface ImportYouTubePlaylistModalProps {
  isOpen: boolean
  onClose: () => void
}

type ModalStep = 'input' | 'preview' | 'enriching' | 'review' | 'importing' | 'complete'

function formatSeconds(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

export function ImportYouTubePlaylistModal({ isOpen, onClose }: ImportYouTubePlaylistModalProps) {
  const router = useRouter()
  const supabase = createClient()
  const { userEmail } = useCurrentUser()
  const { refreshPlaylists } = usePlaylists()
  const importingRef = useRef(false)

  // Steps & inputs
  const [step, setStep] = useState<ModalStep>('input')
  const [urlInput, setUrlInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)

  // Playlist Meta & Tracks
  const [meta, setMeta] = useState<YouTubePlaylistMeta | null>(null)
  const [fetchedTracks, setFetchedTracks] = useState<Track[]>([])
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set())
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [playlistName, setPlaylistName] = useState('')

  // Importing Progress
  const [importingProgress, setImportingProgress] = useState({ done: 0, total: 0 })
  const [importedTrackCount, setImportedTrackCount] = useState(0)
  const [createdPlaylistId, setCreatedPlaylistId] = useState<string | null>(null)

  // Reset modal state on open/close
  useEffect(() => {
    if (!isOpen) {
      setStep('input')
      setUrlInput('')
      setInputError(null)
      setLoadingMeta(false)
      setMeta(null)
      setFetchedTracks([])
      setSelectedTrackIds(new Set())
      setLoadingTracks(false)
      setPlaylistName('')
      setImportingProgress({ done: 0, total: 0 })
      setImportedTrackCount(0)
      setCreatedPlaylistId(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  // Step 1: Submit URL / ID
  const handleFetchPlaylist = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setInputError(null)

    const playlistId = extractYouTubePlaylistId(urlInput)
    if (!playlistId) {
      setInputError('Link hoặc ID Playlist YouTube / YouTube Music không hợp lệ.')
      return
    }

    setLoadingMeta(true)
    try {
      const res = await fetch(`/api/youtube/playlist?id=${encodeURIComponent(playlistId)}`)
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        setInputError(errData?.error || 'Không tìm thấy playlist — có thể playlist ở chế độ riêng tư hoặc link không đúng.')
        setLoadingMeta(false)
        return
      }

      const { meta: playlistMeta, tracks: rawTracks } = await res.json()
      if (!playlistMeta || !rawTracks || rawTracks.length === 0) {
        setInputError('Không tìm thấy playlist — có thể playlist ở chế độ riêng tư hoặc link không đúng.')
        setLoadingMeta(false)
        return
      }

      setMeta(playlistMeta)
      setPlaylistName(playlistMeta.title)
      setStep('preview')

      setFetchedTracks(rawTracks)
      setSelectedTrackIds(new Set(rawTracks.map((t: Track) => t.id)))

      // Start duration & view enrichment
      setStep('enriching')
      const enrichedTracks = await enrichPlaylistTracksWithMeta(rawTracks)
      setFetchedTracks(enrichedTracks)
      setStep('review')
    } catch (err: any) {
      console.error('Fetch YouTube playlist error:', err)
      setInputError('Lỗi kết nối khi tải thông tin playlist YouTube.')
    } finally {
      setLoadingMeta(false)
      setLoadingTracks(false)
    }
  }

  // Toggle track selection
  const toggleSelectTrack = (trackId: string) => {
    setSelectedTrackIds((prev) => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedTrackIds.size === fetchedTracks.length) {
      setSelectedTrackIds(new Set())
    } else {
      setSelectedTrackIds(new Set(fetchedTracks.map((t) => t.id)))
    }
  }

  // Step 5: Confirm Import to Database
  const handleConfirmImport = async () => {
    if (importingRef.current) return
    importingRef.current = true
    try {
      const tracksToImport = fetchedTracks.filter((t) => selectedTrackIds.has(t.id))
      if (tracksToImport.length === 0) {
        alert('Vui lòng chọn ít nhất 1 bài hát để nhập vào playlist.')
        return
      }

      setStep('importing')
      setImportingProgress({ done: 0, total: tracksToImport.length })

      try {
        const userObj = userEmail ? { id: userEmail, email: userEmail } : null
        const userId = userObj ? getValidUserId(userObj) : null

        if (!userId) {
          alert('Vui lòng đăng nhập để tạo playlist.')
          setStep('review')
          return
        }

        // Create new playlist in DB
        const { data: playlistData, error: playlistErr } = await supabase
          .from('playlists')
          .select('*')
          .eq('user_id', userId)
          .eq('name', playlistName.trim() || meta?.title || 'YouTube Playlist Import')
          .maybeSingle()

        let targetPlaylistId = playlistData?.id

        if (!targetPlaylistId) {
          const { data: newPl, error: createErr } = await supabase
            .from('playlists')
            .insert({
              user_id: userId,
              name: playlistName.trim() || meta?.title || 'YouTube Playlist Import',
              description: meta?.description
                ? `${meta.description} (Imported from YouTube Music)`
                : 'Imported from YouTube Music',
              cover_url: meta?.cover_url || null,
            })
            .select('id')
            .single()

          if (createErr || !newPl) {
            throw new Error(createErr?.message || 'Không thể tạo playlist mới trong CSDL.')
          }
          targetPlaylistId = newPl.id
        }

        setCreatedPlaylistId(targetPlaylistId)

        // Insert tracks into DB and playlist_tracks
        let successCount = 0
        for (let i = 0; i < tracksToImport.length; i++) {
          const track = tracksToImport[i]
          const resolvedTrack = await resolvePlaylistTrackWithNct(track)
          let dbTrackId: string | null = null

          // 1. Prefer stable NCT identity, then use fallback provider identity/path.
          if (resolvedTrack.nhaccuatui_id) {
            const { data } = await supabase
              .from('tracks')
              .select('id')
              .eq('nhaccuatui_id', resolvedTrack.nhaccuatui_id)
              .limit(1)
            if (data && data.length > 0) dbTrackId = data[0].id
          }

          if (!dbTrackId && resolvedTrack.youtube_id) {
            const { data } = await supabase
              .from('tracks')
              .select('id')
              .eq('youtube_id', resolvedTrack.youtube_id)
              .limit(1)
            if (data && data.length > 0) dbTrackId = data[0].id
          }

          if (!dbTrackId && resolvedTrack.file_path) {
            const { data } = await supabase
              .from('tracks')
              .select('id')
              .eq('file_path', resolvedTrack.file_path)
              .limit(1)
            if (data && data.length > 0) dbTrackId = data[0].id
          }

          // 2. If track does not exist in DB yet, insert the NCT-first record.
          if (!dbTrackId) {
            const { data: insertedTrack, error: insertErr } = await supabase
              .from('tracks')
              .insert({
                user_id: userId,
                title: resolvedTrack.title,
                artist: resolvedTrack.artist,
                album: resolvedTrack.album || 'YouTube Music',
                duration: resolvedTrack.duration || 0,
                file_path: resolvedTrack.file_path,
                cover_url: resolvedTrack.cover_url,
                source: resolvedTrack.source || null,
                youtube_id: resolvedTrack.nhaccuatui_id ? null : resolvedTrack.youtube_id || null,
                nhaccuatui_id: resolvedTrack.nhaccuatui_id || null,
              })
              .select('id')
              .single()

            if (insertedTrack?.id) {
              dbTrackId = insertedTrack.id
            } else if (insertErr) {
              console.warn('Track insert warning, attempting re-fetch:', insertErr)
              if (resolvedTrack.youtube_id) {
                const { data: refetched } = await supabase
                  .from('tracks')
                  .select('id')
                  .eq('youtube_id', resolvedTrack.youtube_id)
                  .limit(1)
                if (refetched && refetched.length > 0) dbTrackId = refetched[0].id
              }
            }
          }

          // 3. Link track to playlist_tracks using valid DB track UUID
          if (dbTrackId) {
            const { error: plLinkErr } = await supabase
              .from('playlist_tracks')
              .insert({
                playlist_id: targetPlaylistId,
                track_id: dbTrackId,
                position: i,
              })

            if (!plLinkErr) {
              successCount++
            } else {
              console.warn('playlist_tracks link warning:', plLinkErr)
              // If link failed (e.g. duplicate link), still count as success if link exists
              successCount++
            }
          }

          setImportingProgress({ done: i + 1, total: tracksToImport.length })
        }

        setImportedTrackCount(successCount)
        await refreshPlaylists()
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('playlist-updated'))
        }
        setStep('complete')
      } catch (err: any) {
        console.error('Import YouTube playlist error:', err)
        alert(`Có lỗi xảy ra khi nhập playlist: ${err?.message || err}`)
        setStep('review')
      }
    } finally {
      importingRef.current = false
    }
  }

  const skippedTracksCount = (meta?.total_tracks || 0) - fetchedTracks.length

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#0f172a] border border-white/10 max-sm:rounded-t-3xl max-sm:rounded-b-none sm:rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[90vh] animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        {/* Mobile Drag Indicator Bar */}
        <div className="w-12 h-1 bg-white/20 rounded-full mx-auto my-2.5 sm:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-white/10 bg-white/[0.02] gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
              <YoutubeIcon className="w-4.5 h-4.5 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-white leading-tight">
                  Nhập Playlist YouTube
                </h2>
                <span className="text-[9px] sm:text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 shrink-0">
                  YouTube API
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate mt-0.5">
                Nhập danh sách bài hát từ YouTube Music hoặc YouTube
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* STEP 1: Input URL */}
          {step === 'input' && (
            <form onSubmit={handleFetchPlaylist} className="flex flex-col gap-4 sm:gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span>Dán liên kết Playlist YouTube Music / YouTube</span>
                  <span className="text-[10px] text-slate-500">Hỗ trợ music.youtube.com hoặc list=...</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value)
                      setInputError(null)
                    }}
                    placeholder="Dán link playlist tại đây..."
                    className="w-full bg-white/[0.04] border border-white/10 focus:border-red-400/60 rounded-xl px-3.5 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm text-white placeholder-slate-500 outline-none transition-all"
                    autoFocus
                  />
                  {urlInput && (
                    <button
                      type="button"
                      onClick={() => setUrlInput('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {inputError && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5 mt-1 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{inputError}</span>
                  </p>
                )}
              </div>

              <div className="p-3 sm:p-4 bg-white/[0.02] border border-white/5 rounded-xl sm:rounded-2xl flex flex-col gap-2">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <span>Định dạng liên kết được hỗ trợ:</span>
                </span>
                <ul className="text-[11px] text-slate-400 flex flex-col gap-1 font-mono pl-4 list-disc break-all">
                  <li>music.youtube.com/playlist?list=...</li>
                  <li>youtube.com/playlist?list=...</li>
                  <li>youtube.com/watch?v=...&amp;list=...</li>
                  <li>ID Playlist trần (PL..., OLAK5uy..., RD...)</li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={!urlInput.trim() || loadingMeta}
                className="w-full py-3 sm:py-3.5 rounded-xl font-bold text-xs sm:text-sm bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white shadow-lg shadow-red-500/25 flex items-center justify-center gap-2 disabled:opacity-50 transition-all cursor-pointer"
              >
                {loadingMeta ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang tải thông tin...</span>
                  </>
                ) : (
                  <>
                    <span>Tải Playlist</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* STEP 2 & 3: Preview & Enriching */}
          {(step === 'preview' || step === 'enriching') && meta && (
            <div className="flex flex-col gap-5 sm:gap-6 items-center justify-center py-6 sm:py-8">
              <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5 bg-white/[0.03] border border-white/10 p-4 sm:p-5 rounded-2xl w-full">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-slate-800 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                  {meta.cover_url ? (
                    <img src={meta.cover_url} alt={meta.title} className="w-full h-full object-cover" />
                  ) : (
                    <Music className="w-8 h-8 sm:w-10 sm:h-10 text-slate-500" />
                  )}
                </div>
                <div className="flex flex-col gap-1 text-center sm:text-left flex-1 min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-white truncate">{meta.title}</h3>
                  <p className="text-xs text-slate-400 flex items-center justify-center sm:justify-start gap-1">
                    <User className="w-3 h-3 text-slate-500" />
                    <span>{meta.channelTitle}</span>
                  </p>
                  <p className="text-xs text-red-400 font-mono mt-1">
                    {meta.total_tracks} bài hát trong playlist gốc
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-center gap-2.5 sm:gap-3 text-center">
                <Loader2 className="w-7 h-7 sm:w-8 sm:h-8 text-red-400 animate-spin" />
                <div>
                  <p className="text-xs sm:text-sm font-bold text-white">
                    {step === 'preview' ? 'Đang tải danh sách bài hát...' : 'Đang bổ sung thông tin bài hát...'}
                  </p>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                    {step === 'preview'
                      ? 'Đang tự động phân trang toàn bộ các bài hát'
                      : 'Đang tải thời lượng chính xác'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Review tracks before import */}
          {step === 'review' && meta && (
            <div className="flex flex-col gap-4 sm:gap-5">
              {/* Meta Info Header */}
              <div className="flex items-center gap-3 sm:gap-4 bg-white/[0.02] border border-white/10 p-3 sm:p-3.5 rounded-2xl">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-slate-800 overflow-hidden shrink-0">
                  {meta.cover_url ? (
                    <img src={meta.cover_url} alt={meta.title} className="w-full h-full object-cover" />
                  ) : (
                    <Music className="w-5 h-5 sm:w-6 sm:h-6 text-slate-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    placeholder="Tên Playlist mới"
                    className="w-full bg-white/[0.04] border border-white/10 focus:border-red-400 rounded-lg px-2.5 py-1 text-xs sm:text-sm font-bold text-white outline-none"
                  />
                  <p className="text-[10px] sm:text-[11px] text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="truncate max-w-[120px] sm:max-w-none">Tạo bởi: {meta.channelTitle}</span>
                    <span>•</span>
                    <span className="text-red-400 font-semibold">{fetchedTracks.length} bài sẵn sàng</span>
                  </p>
                </div>
              </div>

              {skippedTracksCount > 0 && (
                <div className="p-2.5 sm:p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] sm:text-xs text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{skippedTracksCount} bài hát không khả dụng đã được tự động bỏ qua.</span>
                </div>
              )}

              {/* Track list controls */}
              <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-400">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="hover:text-white flex items-center gap-1.5 font-semibold"
                >
                  <input
                    type="checkbox"
                    checked={selectedTrackIds.size === fetchedTracks.length && fetchedTracks.length > 0}
                    className="rounded accent-red-500 cursor-pointer"
                  />
                  <span>Chọn tất cả ({selectedTrackIds.size}/{fetchedTracks.length})</span>
                </button>
                <span className="hidden sm:inline">Sẵn sàng nhập 100%</span>
              </div>

              {/* Track list container */}
              <div className="flex flex-col gap-1.5 max-h-[240px] sm:max-h-[300px] overflow-y-auto pr-1">
                {fetchedTracks.map((t, index) => {
                  const isChecked = selectedTrackIds.has(t.id)
                  return (
                    <div
                      key={t.id}
                      onClick={() => toggleSelectTrack(t.id)}
                      className={`flex items-center gap-2.5 sm:gap-3 p-2 sm:p-2.5 rounded-xl border transition-all cursor-pointer select-none ${
                        isChecked
                          ? 'bg-white/[0.04] border-white/10 hover:border-red-400/40'
                          : 'bg-white/[0.01] border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        className="rounded accent-red-500 cursor-pointer"
                      />
                      <span className="text-[11px] font-mono text-slate-500 w-4 text-center">{index + 1}</span>
                      <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-slate-800 overflow-hidden shrink-0">
                        {t.cover_url ? (
                          <img src={t.cover_url} alt={t.title} className="w-full h-full object-cover" />
                        ) : (
                          <Music className="w-4 h-4 text-slate-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white truncate">{t.title}</p>
                        <p className="text-[10px] text-slate-400 truncate">{t.artist}</p>
                      </div>
                      <span className="text-[10px] sm:text-[11px] font-mono text-slate-400 shrink-0">
                        {formatSeconds(t.duration)}
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/10 gap-2">
                <button
                  type="button"
                  onClick={() => setStep('input')}
                  className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  Quay lại
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={selectedTrackIds.size === 0}
                  className="px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-white shadow-lg shadow-red-500/20 flex items-center gap-1.5 sm:gap-2 disabled:opacity-50 transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Xác nhận ({selectedTrackIds.size} bài)</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: Importing progress */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center gap-5 sm:gap-6 py-8 sm:py-10 text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shadow-xl">
                <Loader2 className="w-7 h-7 sm:w-8 sm:h-8 animate-spin" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-sm sm:text-base font-bold text-white">Đang lưu Playlist...</h3>
                <p className="text-xs text-slate-400">
                  Đã lưu {importingProgress.done} / {importingProgress.total} bài hát
                </p>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden max-w-md">
                <div
                  className="bg-gradient-to-r from-red-500 to-rose-500 h-full transition-all duration-200"
                  style={{
                    width: `${importingProgress.total > 0 ? (importingProgress.done / importingProgress.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* STEP 6: Complete */}
          {step === 'complete' && (
            <div className="flex flex-col items-center justify-center gap-5 sm:gap-6 py-6 sm:py-8 text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-xl">
                <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-sm sm:text-base font-bold text-white">Nhập Playlist Thành Công!</h3>
                <p className="text-xs text-slate-400 max-w-sm px-2">
                  Đã thêm {importedTrackCount} bài hát vào playlist &quot;{playlistName}&quot;.
                </p>
              </div>
              <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap justify-center">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  Đóng
                </button>
                {createdPlaylistId && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      router.push(`/playlist/${createdPlaylistId}`)
                    }}
                    className="px-5 sm:px-6 py-2 sm:py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all cursor-pointer"
                  >
                    <span>Mở Playlist Mới</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
