'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Track, Playlist } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { getValidUserId } from '@/lib/accessControl'
import { useSession } from 'next-auth/react'
import { Cloud, Play, Shuffle, Music, Sparkles, Upload, FolderSync } from 'lucide-react'
import { TrackList } from '@/components/track/TrackList'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'
import { extractDriveFileId } from '@/lib/googleDriveUpload'
import { STATIC_DRIVE_TRACKS } from '@/lib/driveTracksMap'
import { addTrackToPlaylist } from '@/lib/trackPersistence'
import { toast } from '@/components/ui/ToastContext'
import { useLanguage } from '@/components/i18n/LanguageContext'

export default function DrivePage() {
  const { t } = useLanguage()
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const { playTrack, isShuffle, toggleShuffle } = usePlayer()

  const [driveTracks, setDriveTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [supabaseUser, setSupabaseUser] = useState<any>(null)

  const fetchSeqRef = useRef(0)
  const isFetchingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  
  const userFavTrackIdsRef = useRef<Set<string>>(new Set())
  const supabaseUserRef = useRef<any>(null)
  const searchQueryRef = useRef(searchQuery)

  useEffect(() => {
    supabaseUserRef.current = supabaseUser
  }, [supabaseUser])

  useEffect(() => {
    searchQueryRef.current = searchQuery
  }, [searchQuery])

  const fetchDriveTracks = useCallback(async () => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    const mySeq = ++fetchSeqRef.current

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller
    const signal = controller.signal

    setLoading(true)
    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      setSupabaseUser(currentUser)

      const activeUser =
        currentUser ||
        (nextAuthSession?.user
          ? {
              id: nextAuthSession.user.email,
              email: nextAuthSession.user.email,
            }
          : null)
      const userId = activeUser ? getValidUserId(activeUser) : null

      let userFavSet = new Set<string>()
      try {
        const favRes = await fetch('/api/favorites/status', { signal })
        if (favRes.ok) {
          const favData = await favRes.json()
          if (Array.isArray(favData.trackIds)) {
            userFavSet = new Set(favData.trackIds)
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') throw err
      }

      try {
        const plRes = await fetch('/api/playlists')
        if (plRes.ok) {
          const plData = await plRes.json()
          if (plData.playlists) setPlaylists(plData.playlists)
        }
      } catch {}

      // Fetch all tracks from DB and filter Drive tracks
      let filteredDb: Track[] = []
      try {
        const { data: rawTracks, error: trackError } = await supabase
        .from('tracks')
        .select('*')
        .order('created_at', { ascending: false })
        .abortSignal(signal)

        if (!trackError && rawTracks) {
          filteredDb = rawTracks.filter((tr: Track) => {
            const fp = tr.file_path || ''
            return Boolean(
              extractDriveFileId(fp) ||
              fp.includes('drive-stream') ||
              fp.includes('drive.google.com') ||
              fp.includes('lh3.googleusercontent.com')
            )
          })
        }
      } catch (dbErr) {
        console.warn('DB fetch error in drive page:', dbErr)
      }

      // Convert static preloaded Drive tracks
      const staticTracks: Track[] = STATIC_DRIVE_TRACKS.map((st) => ({
        id: st.id,
        user_id: 'system_drive',
        title: st.title,
        artist: st.artist,
        album: st.album || null,
        duration: st.duration || 0,
        file_path: st.file_path,
        drive_file_id: st.drive_file_id || undefined,
        cover_url: st.cover_url || null,
        source: 'local' as const,
        created_at: '2026-01-01T00:00:00.000Z',
      }))

      // Merge DB tracks + static preloaded tracks
      const combinedRaw = [...filteredDb, ...staticTracks]
      const uniqueDriveTracks: Track[] = []
      const seenDriveKeys = new Set<string>()

      for (const tr of combinedRaw) {
        const driveId = tr.drive_file_id || extractDriveFileId(tr.file_path || '')
        const normTitle = (tr.title || '').trim().toLowerCase().normalize('NFKC')
        const normArtist = (tr.artist || '').trim().toLowerCase().normalize('NFKC')
        const key = driveId ? `drive_${driveId}` : `title_${normTitle}|||${normArtist}`

        if (!seenDriveKeys.has(key)) {
          seenDriveKeys.add(key)
          uniqueDriveTracks.push(tr)
        }
      }

      setDriveTracks(
        uniqueDriveTracks.map((t: Track) => ({
          ...t,
          source: t.source || 'local',
          is_favorite: userFavSet.has(t.id),
        }))
      )
      
      if (mySeq === fetchSeqRef.current) {
        userFavTrackIdsRef.current = userFavSet
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      console.error('Error fetching drive tracks:', err)
    } finally {
      isFetchingRef.current = false
      if (mySeq === fetchSeqRef.current) setLoading(false)
    }
  }, [nextAuthSession, supabase])

  useEffect(() => {
    fetchDriveTracks()

    let timer: NodeJS.Timeout
    const debouncedFetch = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        fetchDriveTracks()
      }, 800)
    }

    const channel = supabase
      .channel('drive-page-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracks' }, (payload: any) => {
        if (searchQueryRef.current.trim()) return

        if (payload.eventType === 'INSERT') {
          const newTrack = payload.new as Track
          
          const fp = newTrack.file_path || ''
          const isDrive = Boolean(
            extractDriveFileId(fp) ||
            fp.includes('drive-stream') ||
            fp.includes('drive.google.com') ||
            fp.includes('lh3.googleusercontent.com')
          )
          
          if (!isDrive) return

          setDriveTracks(prev => {
            if (prev.some(t => t.id === newTrack.id)) return prev
            
            const normTitle = (newTrack.title || '').trim().toLowerCase().normalize('NFKC')
            const normArtist = (newTrack.artist || '').trim().toLowerCase().normalize('NFKC')
            const driveId = newTrack.drive_file_id || extractDriveFileId(fp)
            const key = driveId ? `drive_${driveId}` : `title_${normTitle}|||${normArtist}`
            
            if (prev.some(t => {
              const tDriveId = t.drive_file_id || extractDriveFileId(t.file_path || '')
              const tNormTitle = (t.title || '').trim().toLowerCase().normalize('NFKC')
              const tNormArtist = (t.artist || '').trim().toLowerCase().normalize('NFKC')
              const tKey = tDriveId ? `drive_${tDriveId}` : `title_${tNormTitle}|||${tNormArtist}`
              return tKey === key
            })) {
              return prev
            }
            
            return [{ ...newTrack, source: newTrack.source || 'local', is_favorite: userFavTrackIdsRef.current.has(newTrack.id) }, ...prev]
          })
        } else if (payload.eventType === 'UPDATE') {
          setDriveTracks(prev => prev.map(t => t.id === payload.new.id ? { ...t, ...payload.new } : t))
        } else if (payload.eventType === 'DELETE') {
          setDriveTracks(prev => prev.filter(t => t.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [fetchDriveTracks, supabase])

  const filteredTracks = searchQuery.trim()
    ? driveTracks.filter(
        (t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (t.artist && t.artist.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : driveTracks

  const handleAddToPlaylist = async (playlistId: string, track: Track) => {
    const result = await addTrackToPlaylist(playlistId, track)
    toast(result.message, result.success ? 'success' : 'error', track.title)
  }

  const handlePlayAll = () => {
    if (filteredTracks.length === 0) return
    if (isShuffle) {
      const randomIndex = Math.floor(Math.random() * filteredTracks.length)
      playTrack(filteredTracks[randomIndex], filteredTracks, randomIndex)
    } else {
      playTrack(filteredTracks[0], filteredTracks, 0)
    }
  }

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-4 sm:gap-6 lg:gap-8 max-w-7xl mx-auto w-full select-none pb-36 lg:pb-8">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] p-4 sm:p-6 md:p-8 bg-gradient-to-r from-[#0b1320] via-[#0d1627] to-[#070b12] shadow-2xl">
        {/* Glow backdrop */}
        <div
          style={{
            background: 'radial-gradient(400px circle at 80% 20%, rgba(34,211,238,0.15), transparent 70%)',
          }}
          className="absolute inset-0 pointer-events-none"
        />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
          <div className="flex items-center gap-3.5 sm:gap-5">
            <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl bg-[var(--spotify-glow,#22d3ee)]/10 border border-[var(--spotify-glow,#22d3ee)]/30 flex items-center justify-center text-[var(--spotify-glow,#22d3ee)] shadow-2xl shrink-0">
              <Cloud className="w-7 h-7 sm:w-10 sm:h-10" />
            </div>

            <div className="flex flex-col gap-1 sm:gap-1.5">
              <span className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-widest text-[var(--spotify-glow,#22d3ee)]">
                Google Drive Storage
              </span>
              <h1 className="text-xl sm:text-3xl font-black text-white tracking-tight">
                {t('drive')}
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 max-w-xl">
                Kho lưu trữ bài hát độc quyền được đồng bộ trực tiếp từ Google Drive. Phát nhạc Lossless & High-Quality chất lượng nguyên bản.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {driveTracks.length > 0 && (
              <>
                <button
                  onClick={handlePlayAll}
                  style={{
                    background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                    boxShadow: '0 4px 16px var(--theme-glow-shadow, rgba(6,182,212,0.4))',
                  }}
                  className="px-5 py-3 rounded-full text-black font-extrabold text-xs flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Phát Tất Cả ({driveTracks.length})</span>
                </button>

                <button
                  onClick={toggleShuffle}
                  className={`p-3 rounded-full border transition-all ${
                    isShuffle
                      ? 'bg-[var(--spotify-glow,#22d3ee)]/20 border-[var(--spotify-glow,#22d3ee)] text-[var(--spotify-glow,#22d3ee)] shadow-lg'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                  title="Phát ngẫu nhiên"
                >
                  <Shuffle className="w-4.5 h-4.5" />
                </button>
              </>
            )}

            <Link
              href="/upload"
              className="px-4 py-3 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 text-white font-bold text-xs flex items-center gap-2 transition-all"
            >
              <Upload className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
              <span>Thêm Nhạc Vào Drive</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Main Track List Container */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <span>Danh Sách Bài Hát Drive</span>
            <span className="text-xs text-slate-400 font-normal">({filteredTracks.length} bài hát)</span>
          </h2>
        </div>

        {loading ? (
          <TrackListSkeleton count={8} />
        ) : filteredTracks.length > 0 ? (
          <TrackList
            tracks={filteredTracks}
            userPlaylists={playlists}
            onAddToPlaylist={handleAddToPlaylist}
            onTrackUpdated={fetchDriveTracks}
          />
        ) : (
          <div className="glass-panel rounded-3xl p-12 text-center border border-white/10 flex flex-col items-center justify-center gap-4 py-16">
            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-500">
              <Cloud className="w-8 h-8 text-slate-400" />
            </div>
            <div className="flex flex-col gap-1 max-w-md">
              <h3 className="text-base font-bold text-white">Chưa có bài hát Google Drive nào</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Tải lên nhạc từ máy hoặc dán liên kết Drive công khai để lưu trực tiếp vào không gian Google Drive Sync của bạn.
              </p>
            </div>
            <Link
              href="/upload"
              style={{
                background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
              }}
              className="px-6 py-3 rounded-full text-black font-extrabold text-xs shadow-lg hover:scale-105 transition-all mt-2"
            >
              + Đóng Góp Nhạc Vào Drive
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
