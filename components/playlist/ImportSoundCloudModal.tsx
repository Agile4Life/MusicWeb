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
  Cloud,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getValidUserId } from '@/lib/accessControl'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { Track, SoundCloudPlaylist } from '@/types'

interface ImportSoundCloudModalProps {
  isOpen: boolean
  onClose: () => void
  initialUrl?: string
  initialPlaylist?: SoundCloudPlaylist | null
  initialTracks?: Track[]
}

type ModalStep = 'input' | 'fetching' | 'review' | 'importing' | 'complete'

function formatSeconds(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

const EMPTY_TRACKS: Track[] = []

export function ImportSoundCloudModal({
  isOpen,
  onClose,
  initialUrl = '',
  initialPlaylist = null,
  initialTracks = EMPTY_TRACKS,
}: ImportSoundCloudModalProps) {
  const router = useRouter()
  const supabase = createClient()
  const { userEmail } = useCurrentUser()
  const { refreshPlaylists } = usePlaylists()
  const importingRef = useRef(false)

  // Steps & inputs
  const [step, setStep] = useState<ModalStep>('input')
  const [urlInput, setUrlInput] = useState(initialUrl)
  const [inputError, setInputError] = useState<string | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)

  // Playlist Meta & Tracks
  const [playlistMeta, setPlaylistMeta] = useState<SoundCloudPlaylist | null>(initialPlaylist)
  const [fetchedTracks, setFetchedTracks] = useState<Track[]>(initialTracks)
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(
    new Set(initialTracks.map((t) => t.id))
  )
  const [playlistName, setPlaylistName] = useState(initialPlaylist?.title || '')

  // Importing Progress
  const [importingProgress, setImportingProgress] = useState({ done: 0, total: 0 })
  const [importedTrackCount, setImportedTrackCount] = useState(0)
  const [createdPlaylistId, setCreatedPlaylistId] = useState<string | null>(null)
  const prevIsOpenRef = useRef(false)

  // Reset / sync modal state only on transition from closed to open
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      if (initialPlaylist && initialTracks.length > 0) {
        setPlaylistMeta(initialPlaylist)
        setFetchedTracks(initialTracks)
        setSelectedTrackIds(new Set(initialTracks.map((t) => t.id)))
        setPlaylistName(initialPlaylist.title)
        setStep('review')
      } else if (initialUrl) {
        setUrlInput(initialUrl)
        setStep('input')
      } else {
        setStep('input')
        setUrlInput('')
        setInputError(null)
        setPlaylistMeta(null)
        setFetchedTracks([])
        setSelectedTrackIds(new Set())
        setPlaylistName('')
      }
      setImportingProgress({ done: 0, total: 0 })
      setImportedTrackCount(0)
      setCreatedPlaylistId(null)
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen, initialPlaylist, initialTracks, initialUrl])

  if (!isOpen) return null

  // Step 1: Submit URL / Shortlink
  const handleFetchPlaylist = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setInputError(null)

    const cleanUrl = urlInput.trim()
    if (!cleanUrl) {
      setInputError('Vui lòng dán link Playlist hoặc Set từ SoundCloud.')
      return
    }

    if (!cleanUrl.includes('soundcloud.com')) {
      setInputError('Link không hợp lệ. Vui lòng dán link playlist SoundCloud (ví dụ: https://soundcloud.com/.../sets/...)')
      return
    }

    setLoadingMeta(true)
    setStep('fetching')

    try {
      const res = await fetch(`/api/soundcloud/playlists?url=${encodeURIComponent(cleanUrl)}`)
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        setInputError(
          errData?.error ||
            'Không tìm thấy playlist — có thể playlist ở chế độ riêng tư hoặc link không đúng.'
        )
        setStep('input')
        setLoadingMeta(false)
        return
      }

      const data = await res.json()
      const pl: SoundCloudPlaylist = data.playlist
      const tracks: Track[] = data.tracks || []

      if (!pl || tracks.length === 0) {
        setInputError('Không tìm thấy bài hát nào trong playlist này.')
        setStep('input')
        setLoadingMeta(false)
        return
      }

      setPlaylistMeta(pl)
      setPlaylistName(pl.title || 'SoundCloud Playlist')
      setFetchedTracks(tracks)
      setSelectedTrackIds(new Set(tracks.map((t) => t.id)))
      setStep('review')
    } catch (err: any) {
      console.error('Fetch SoundCloud playlist error:', err)
      setInputError('Lỗi kết nối khi tải thông tin playlist từ SoundCloud.')
      setStep('input')
    } finally {
      setLoadingMeta(false)
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

  // Step 4: Confirm Import to Database
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

      const userObj = userEmail ? { id: userEmail, email: userEmail } : null
      const userId = userObj ? getValidUserId(userObj) : null

      if (!userId) {
        alert('Vui lòng đăng nhập để tạo playlist cá nhân!')
        setStep('review')
        return
      }

      // 1. Create new playlist in DB
      const finalPlName = playlistName.trim() || playlistMeta?.title || 'SoundCloud Playlist'
      const { data: newPl, error: createErr } = await supabase
        .from('playlists')
        .insert({
          user_id: userId,
          name: finalPlName,
          description: playlistMeta?.user?.username
            ? `Playlist từ ${playlistMeta.user.username} (SoundCloud)`
            : 'Imported from SoundCloud',
          cover_url: playlistMeta?.artwork_url || tracksToImport[0]?.cover_url || null,
          is_public: false,
        })
        .select('id')
        .single()

      if (createErr || !newPl) {
        throw new Error(createErr?.message || 'Không thể tạo playlist mới trong CSDL.')
      }

      const targetPlaylistId = newPl.id
      setCreatedPlaylistId(targetPlaylistId)

      // 2. Insert tracks and link to playlist_tracks in order
      let successCount = 0

      for (let i = 0; i < tracksToImport.length; i++) {
        const track = tracksToImport[i]
        let dbTrackId: string | null = null

        const rawScId = track.soundcloud_id || (track.id?.startsWith('sc-') ? track.id.slice(3) : null)
        const permalink = track.soundcloud_permalink_url || track.file_path || ''

        // Check if track exists in tracks table
        if (permalink) {
          const { data } = await supabase
            .from('tracks')
            .select('id')
            .eq('file_path', permalink)
            .limit(1)
          if (data && data.length > 0 && data[0].id) dbTrackId = data[0].id
        }

        if (!dbTrackId && rawScId) {
          const { data } = await supabase
            .from('tracks')
            .select('id')
            .eq('file_path', `soundcloud:${rawScId}`)
            .limit(1)
          if (data && data.length > 0 && data[0].id) dbTrackId = data[0].id
        }

        // Insert track if not exists
        if (!dbTrackId) {
          const fallbackPath = permalink || (rawScId ? `soundcloud:${rawScId}` : `sc:${Date.now()}`)
          const { data: insertedTrack } = await supabase
            .from('tracks')
            .insert({
              user_id: userId,
              title: track.title || 'SoundCloud Track',
              artist: track.artist || 'SoundCloud Artist',
              album: track.album || playlistMeta?.title || 'SoundCloud Single',
              duration: track.duration || 0,
              file_path: fallbackPath,
              cover_url: track.cover_url || null,
              source: 'soundcloud',
              created_at: new Date().toISOString(),
            })
            .select('id')
            .single()

          if (insertedTrack && insertedTrack.id) {
            dbTrackId = insertedTrack.id
          }
        }

        // Add to playlist_tracks
        if (dbTrackId) {
          const { error: linkErr } = await supabase.from('playlist_tracks').insert({
            playlist_id: targetPlaylistId,
            track_id: dbTrackId,
            position: i + 1,
          })

          if (!linkErr) {
            successCount++
          }
        }

        setImportingProgress({ done: i + 1, total: tracksToImport.length })
      }

      setImportedTrackCount(successCount)
      await refreshPlaylists()
      window.dispatchEvent(new Event('playlist-updated'))
      setStep('complete')
    } catch (err: any) {
      console.error('Confirm import SoundCloud playlist error:', err)
      alert(`Đã xảy ra lỗi khi tạo playlist: ${err.message}`)
      setStep('review')
    } finally {
      importingRef.current = false
    }
  }

  const handleGoToPlaylist = () => {
    onClose()
    if (createdPlaylistId) {
      router.push(`/playlist/${createdPlaylistId}`)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-gradient-to-b from-[var(--elevation-2-bg,#1c1512)] to-[var(--bg-space,#0f0e0d)] border border-[var(--spotify-glow,#ff5500)]/30 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[var(--spotify-glow,#ff7700)] to-[var(--primary-spotify,#ff5500)] text-black flex items-center justify-center shadow-[0_0_15px_var(--theme-glow-shadow,rgba(255,85,0,0.4))]">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                Nhập Playlist từ SoundCloud
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--spotify-glow,#ff5500)]/20 text-[var(--spotify-glow,#ff7700)] border border-[var(--spotify-glow,#ff5500)]/40">
                  Full Audio
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Tự động trích xuất toàn bộ bài hát chất lượng cao từ SoundCloud
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            disabled={step === 'importing'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 custom-slim-scrollbar">
          {/* STEP 1: Input URL */}
          {step === 'input' && (
            <form onSubmit={handleFetchPlaylist} className="flex flex-col gap-5 py-2">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-slate-200">
                  Dán link Playlist / Set hoặc Profile từ SoundCloud:
                </label>
                <div className="relative w-full">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://soundcloud.com/.../sets/... hoặc link on.soundcloud.com/..."
                    className="w-full bg-white/[0.04] border border-white/10 focus:border-[var(--spotify-glow,#ff5500)]/60 rounded-2xl px-4 py-3.5 text-xs sm:text-sm text-white placeholder-slate-500 outline-none transition-all shadow-inner"
                    autoFocus
                  />
                  {urlInput && (
                    <button
                      type="button"
                      onClick={() => setUrlInput('')}
                      className="absolute right-3.5 top-3.5 text-slate-400 hover:text-white p-0.5 rounded-full hover:bg-white/10"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {inputError && (
                  <div className="flex items-center gap-1.5 text-xs text-rose-400 mt-1 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{inputError}</span>
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-2xl bg-[var(--spotify-glow,#ff5500)]/10 border border-[var(--spotify-glow,#ff5500)]/20 flex items-start gap-2.5 text-xs text-slate-300">
                <Sparkles className="w-4 h-4 text-[var(--spotify-glow,#ff7700)] shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <strong className="text-white font-bold">Hỗ trợ đầy đủ các định dạng link:</strong>
                  <ul className="list-disc list-inside text-slate-400 space-y-0.5 text-[11px]">
                    <li>Link Playlist/Set: <code>soundcloud.com/user/sets/playlist-name</code></li>
                    <li>Link rút gọn trên mobile: <code>on.soundcloud.com/...</code></li>
                    <li>Hỗ trợ trích xuất toàn bộ bài hát (bao gồm playlist 20 - 100+ bài).</li>
                  </ul>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={!urlInput.trim() || loadingMeta}
                  className="px-6 py-2.5 rounded-xl font-bold text-xs text-black bg-gradient-to-r from-[var(--spotify-glow,#ff7700)] to-[var(--primary-spotify,#ff3300)] shadow-[0_4px_15px_var(--theme-glow-shadow,rgba(255,85,0,0.3))] hover:scale-105 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
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
            </form>
          )}

          {/* STEP 2: Fetching State */}
          {step === 'fetching' && (
            <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-[var(--spotify-glow,#ff5500)]/20 border-t-[var(--spotify-glow,#ff5500)] animate-spin flex items-center justify-center" />
                <Cloud className="w-6 h-6 text-[var(--spotify-glow,#ff7700)] absolute inset-0 m-auto animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white mb-1">
                  Đang phân giải Playlist SoundCloud...
                </h3>
                <p className="text-xs text-slate-400 max-w-sm">
                  Hệ thống đang trích xuất danh sách bài hát và luồng phát âm thanh gốc.
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: Review & Customization */}
          {step === 'review' && playlistMeta && (
            <div className="flex flex-col gap-4">
              {/* Header Box */}
              <div className="p-3 sm:p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center gap-3.5">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-slate-900 border border-white/10 shrink-0">
                  {playlistMeta.artwork_url ? (
                    <img
                      src={playlistMeta.artwork_url}
                      alt={playlistMeta.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-[var(--spotify-glow,#ff5500)]/20 text-[var(--spotify-glow,#ff7700)]">
                      <Cloud className="w-8 h-8" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                    <User className="w-3 h-3" />
                    <span className="truncate">{playlistMeta.user?.username || 'SoundCloud'}</span>
                  </div>

                  <input
                    type="text"
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    placeholder="Tên playlist trong thư viện..."
                    className="w-full bg-black/40 border border-white/10 focus:border-[var(--spotify-glow,#ff5500)]/60 rounded-lg px-2.5 py-1 text-xs sm:text-sm font-bold text-white outline-none"
                  />

                  <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                    <span>Tổng số: <strong className="text-white">{fetchedTracks.length}</strong> bài</span>
                    <span>Đã chọn: <strong className="text-[var(--spotify-glow,#ff7700)]">{selectedTrackIds.size}</strong> bài</span>
                  </div>
                </div>
              </div>

              {/* Selection Bar */}
              <div className="flex items-center justify-between px-1 text-xs">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="font-bold text-[var(--spotify-glow,#ff7700)] hover:underline"
                >
                  {selectedTrackIds.size === fetchedTracks.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả bài hát'}
                </button>
                <span className="text-[11px] text-slate-500">
                  Thứ tự bài hát được giữ nguyên gốc
                </span>
              </div>

              {/* Tracks List */}
              <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto pr-1 custom-slim-scrollbar border border-white/[0.06] rounded-xl p-1.5 bg-black/20">
                {fetchedTracks.map((tr, idx) => {
                  const isSelected = selectedTrackIds.has(tr.id)
                  return (
                    <div
                      key={tr.id}
                      onClick={() => toggleSelectTrack(tr.id)}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-[var(--primary-spotify)]/15 border border-[var(--primary-spotify)]/30 text-white'
                          : 'hover:bg-white/[0.04] text-slate-400 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${
                            isSelected
                              ? 'bg-[var(--primary-spotify)] border-[var(--primary-spotify)] text-black'
                              : 'border-slate-500 bg-black/40'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>

                        <span className="text-[11px] text-slate-500 w-4 text-center shrink-0">
                          {idx + 1}
                        </span>

                        <div className="w-8 h-8 rounded-md bg-slate-900 overflow-hidden shrink-0 border border-white/10">
                          {tr.cover_url ? (
                            <img src={tr.cover_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-600 bg-white/5">
                              <Music className="w-3.5 h-3.5" />
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-white truncate">
                            {tr.title}
                          </span>
                          <span className="text-[10px] text-slate-400 truncate">
                            {tr.artist}
                          </span>
                        </div>
                      </div>

                      <span className="text-[11px] text-slate-500 font-mono shrink-0 ml-2">
                        {formatSeconds(tr.duration)}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setStep('input')}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white"
                >
                  ← Đổi link khác
                </button>

                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={selectedTrackIds.size === 0}
                  className="px-6 py-2.5 rounded-xl font-bold text-xs text-black bg-gradient-to-r from-[var(--spotify-glow,#ff7700)] to-[var(--primary-spotify,#ff3300)] shadow-[0_4px_15px_var(--theme-glow-shadow,rgba(255,85,0,0.3))] hover:scale-105 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Tạo Playlist ({selectedTrackIds.size} bài)</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Importing Progress */}
          {step === 'importing' && (
            <div className="py-10 flex flex-col items-center justify-center gap-5 text-center">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-[var(--spotify-glow,#ff5500)]/20 border-t-[var(--spotify-glow,#ff5500)] animate-spin flex items-center justify-center" />
                <Cloud className="w-6 h-6 text-[var(--spotify-glow,#ff7700)] absolute inset-0 m-auto animate-pulse" />
              </div>

              <div className="flex flex-col gap-1">
                <h3 className="text-base font-bold text-white">
                  Đang nhập bài hát vào thư viện...
                </h3>
                <p className="text-xs text-slate-400">
                  Đang lưu {importingProgress.done} / {importingProgress.total} bài hát
                </p>
              </div>

              {/* Progress Bar */}
              <div className="w-full max-w-md bg-white/10 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-[var(--spotify-glow,#ff7700)] to-[var(--primary-spotify,#ff3300)] h-full transition-all duration-300"
                  style={{
                    width: `${Math.round((importingProgress.done / (importingProgress.total || 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* STEP 5: Complete */}
          {step === 'complete' && (
            <div className="py-8 flex flex-col items-center justify-center gap-5 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.3)]">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div className="flex flex-col gap-1.5">
                <h3 className="text-lg font-black text-white">
                  Nhập Playlist thành công!
                </h3>
                <p className="text-xs text-slate-300 max-w-sm">
                  Đã thêm thành công <strong className="text-emerald-400 font-bold">{importedTrackCount}</strong> bài hát vào playlist <strong className="text-white font-bold">"{playlistName}"</strong> của bạn.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-300 bg-white/10 hover:bg-white/20 transition-all"
                >
                  Đóng
                </button>
                <button
                  onClick={handleGoToPlaylist}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-600 shadow-[0_4px_15px_rgba(16,185,129,0.3)] hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                  <ListMusic className="w-4 h-4" />
                  <span>Xem Playlist vừa tạo</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
