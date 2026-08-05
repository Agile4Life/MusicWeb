'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Track, Playlist } from '@/types'
import { TrackList } from '@/components/track/TrackList'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'
import { usePlayer } from '@/components/player/PlayerContext'
import {
  Play,
  Upload,
  Search,
  Sparkles,
  Disc,
  Music,
  Flame,
  AlertTriangle,
  Globe,
  Radio,
  Loader2,
  TrendingUp,
  History,
  RotateCcw,
  Cloud,
  Shuffle,
} from 'lucide-react'
import { useSession } from 'next-auth/react'
import { getValidUserId, isAdmin as checkIsAdmin } from '@/lib/accessControl'
import { useSearchParams } from 'next/navigation'
import { extractDriveFileId, parseFilenameToTitleArtist } from '@/lib/googleDriveUpload'

export default function HomePage() {
  const supabase = createClient()
  const { playTrack, isShuffle, toggleShuffle } = usePlayer()
  const { data: nextAuthSession } = useSession()
  const searchParams = useSearchParams()

  const [tracks, setTracks] = useState<Track[]>([])
  const [recentTracks, setRecentTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSource, setSearchSource] = useState<'all' | 'youtube' | 'audius' | 'itunes' | 'spotify' | 'local'>('all')
  const [libraryTab, setLibraryTab] = useState<'all' | 'drive' | 'recent'>('all')

  useEffect(() => {
    const handleSearchEvent = (e: any) => {
      setSearchQuery(e.detail || '')
    }

    const checkHashTab = () => {
      if (window.location.hash === '#drive') {
        setLibraryTab('drive')
      } else {
        setLibraryTab('all')
      }
    }

    const handleTabHome = () => {
      setLibraryTab('all')
      if (window.location.hash === '#drive') {
        history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }

    const handleTabDrive = () => {
      setLibraryTab('drive')
    }

    window.addEventListener('musicweb-search', handleSearchEvent)
    window.addEventListener('hashchange', checkHashTab)
    window.addEventListener('popstate', checkHashTab)
    window.addEventListener('musicweb-tab-home', handleTabHome)
    window.addEventListener('musicweb-tab-drive', handleTabDrive)

    checkHashTab()
    setSearchQuery('')

    return () => {
      window.removeEventListener('musicweb-search', handleSearchEvent)
      window.removeEventListener('hashchange', checkHashTab)
      window.removeEventListener('popstate', checkHashTab)
      window.removeEventListener('musicweb-tab-home', handleTabHome)
      window.removeEventListener('musicweb-tab-drive', handleTabDrive)
    }
  }, [])

  const [loading, setLoading] = useState(true)
  const [supabaseUser, setSupabaseUser] = useState<any>(null)
  const [cleaningDuplicates, setCleaningDuplicates] = useState(false)
  const [cleanStatusText, setCleanStatusText] = useState<string | null>(null)

  // Global trending tracks for default homepage display
  const [trendingTracks, setTrendingTracks] = useState<Track[]>([])
  const [loadingTrending, setLoadingTrending] = useState(true)

  // Search results
  const [globalTracks, setGlobalTracks] = useState<{
    local: Track[]
    youtube: Track[]
    audius: Track[]
    itunes: Track[]
    spotify: Track[]
  }>({ local: [], youtube: [], audius: [], itunes: [], spotify: [] })
  const [searchingGlobal, setSearchingGlobal] = useState(false)

  const user =
    supabaseUser ||
    (nextAuthSession?.user
      ? {
          id: nextAuthSession.user.email,
          email: nextAuthSession.user.email,
          user_metadata: { full_name: nextAuthSession.user.name },
        }
      : null)

  const fetchData = async (showSkeleton = false) => {
    if (showSkeleton) setLoading(true)
    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      setSupabaseUser(currentUser)

      // Query all local tracks from database
      const { data: rawTracks, error: trackError } = await supabase
        .from('tracks')
        .select('*')
        .order('created_at', { ascending: false })

      if (!trackError && rawTracks) {
        setTracks(rawTracks.map((t: Track) => ({ ...t, source: t.source || 'local' })))
      }

      const activeUser =
        currentUser ||
        (nextAuthSession?.user
          ? {
              id: nextAuthSession.user.email,
              email: nextAuthSession.user.email,
            }
          : null)
      const userId = activeUser ? getValidUserId(activeUser) : null

      if (userId) {
        // Query user's playlists
        const { data: playlistData } = await supabase
          .from('playlists')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })

        if (playlistData) setPlaylists(playlistData)

        // Query Recently Played Songs strictly for CURRENT user_id
        const { data: historyData } = await supabase
          .from('listening_history')
          .select('id, played_at, tracks:track_id(*)')
          .eq('user_id', userId)
          .order('played_at', { ascending: false })
          .limit(100)

        if (historyData && historyData.length > 0) {
          const seen = new Set<string>()
          const recent: Track[] = []
          for (const item of historyData) {
            const tr = item.tracks as any
            if (tr && tr.id && !seen.has(tr.id)) {
              seen.add(tr.id)
              recent.push({ ...tr, source: tr.source || 'local' })
            }
          }
          setRecentTracks(recent)
        } else {
          setRecentTracks([])
        }
      } else {
        setPlaylists([])
        setRecentTracks([])
      }
    } catch (err) {
      console.error('fetchData error in page.tsx:', err)
    } finally {
      setLoading(false)
    }
  }

  // Fetch Global Trending Music automatically on mount
  useEffect(() => {
    fetchData()

    let active = true
    setLoadingTrending(true)
    fetch('/api/search?trending=true')
      .then((res) => res.json())
      .then((data) => {
        if (!active) return
        const yt = data.youtube || []
        const audius = data.audius || []
        const itunes = data.itunes || []
        const spotify = data.spotify || []

        const combined: Track[] = []
        const maxLen = Math.max(yt.length, audius.length, itunes.length, spotify.length)
        for (let i = 0; i < maxLen; i++) {
          if (spotify[i]) combined.push(spotify[i])
          if (itunes[i]) combined.push(itunes[i])
          if (audius[i]) combined.push(audius[i])
          if (yt[i]) combined.push(yt[i])
        }
        setTrendingTracks(combined)
      })
      .catch((err) => console.warn('Failed to load trending tracks:', err))
      .finally(() => {
        if (active) setLoadingTrending(false)
      })

    let timer: NodeJS.Timeout
    const debouncedFetch = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        fetchData()
      }, 800)
    }

    const channel = supabase
      .channel('home-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracks' }, () => debouncedFetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlists' }, () => debouncedFetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listening_history' }, () => debouncedFetch())
      .subscribe()

    return () => {
      active = false
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [])

  // Fast Debounced Global Search (200ms)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setGlobalTracks({ local: [], youtube: [], audius: [], itunes: [], spotify: [] })
      setSearchingGlobal(false)
      return
    }

    setSearchingGlobal(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`)
        if (res.ok) {
          const data = await res.json()
          setGlobalTracks({
            local: data.local || [],
            youtube: data.youtube || [],
            audius: data.audius || [],
            itunes: data.itunes || [],
            spotify: data.spotify || [],
          })
        }
      } catch (err) {
        console.warn('Global search error:', err)
      } finally {
        setSearchingGlobal(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleAddToPlaylist = async (playlistId: string, track: Track) => {
    let targetTrackId = track.id

    if (track.source && track.source !== 'local') {
      const activeUser = user ? { id: user.id, email: user.email } : null
      const userId = activeUser ? getValidUserId(activeUser) : null
      if (!userId) {
        alert('Vui lòng đăng nhập để thêm bài hát vào playlist!')
        return
      }

      const { data: existing } = await supabase
        .from('tracks')
        .select('id')
        .eq('file_path', track.file_path)
        .maybeSingle()

      if (existing && existing.id) {
        targetTrackId = existing.id
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('tracks')
          .insert({
            user_id: userId,
            title: track.title,
            artist: track.artist || null,
            album: track.album || null,
            duration: track.duration || 0,
            file_path: track.file_path,
            cover_url: track.cover_url || null,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (insertError || !inserted) {
          alert('Lỗi lưu bài hát vào CSDL: ' + (insertError?.message || ''))
          return
        }
        targetTrackId = inserted.id
      }
    }

    const { error: rpcError } = await Promise.resolve(
      supabase.rpc('fn_add_track_to_playlist', {
        p_playlist_id: playlistId,
        p_track_id: targetTrackId,
      })
    )

    if (!rpcError) {
      alert('Đã thêm bài hát vào playlist!')
      return
    }

    const { error } = await supabase.from('playlist_tracks').insert({
      playlist_id: playlistId,
      track_id: targetTrackId,
    })

    if (!error) {
      alert('Đã thêm bài hát vào playlist!')
    } else {
      alert(error.message || 'Lỗi thêm bài hát vào playlist')
    }
  }

  const handleDeleteTrack = async (trackId: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa bài hát này khỏi thư viện?')) return

    const trackToDelete = tracks.find((t) => t.id === trackId)
    if (!trackToDelete) return

    await supabase.from('playlist_tracks').delete().eq('track_id', trackId)
    await supabase.from('favorite_tracks').delete().eq('track_id', trackId)
    await supabase.from('listening_history').delete().eq('track_id', trackId)

    const { error: dbError } = await supabase.from('tracks').delete().eq('id', trackId)

    if (dbError) {
      alert('Lỗi xóa record DB: ' + dbError.message)
      return
    }

    if (trackToDelete.file_path && !trackToDelete.file_path.startsWith('http')) {
      await supabase.storage.from('music-files').remove([trackToDelete.file_path])
    }

    setTracks(tracks.filter((t) => t.id !== trackId))
    setRecentTracks(recentTracks.filter((t) => t.id !== trackId))
  }

  const handleCleanDuplicates = async () => {
    if (!user) return
    if (
      !confirm(
        'Tìm và xóa tất cả bài hát bị trùng (cùng tên + nghệ sĩ), chỉ giữ lại bản mới nhất?\n\nThao tác này không thể hoàn tác!'
      )
    )
      return

    setCleaningDuplicates(true)
    try {
      const seen = new Map<string, Track>()
      const toDelete: Track[] = []

      for (const track of tracks) {
        const normTitle = (track.title || '')
          .normalize('NFKC')
          .toLowerCase()
          .replace(/\.[^/.]+$/, '')
          .replace(/^\d+[\s._-]+/, '')
          .replace(/\[(mv|official|audio|hq|hd|lyrics|flac|320kbps|320)\]/gi, '')
          .replace(
            /\((official audio|lyric video|audio|official music video|official video|video|mv|320kbps|mp3|flac|hq|hd)\)/gi,
            ''
          )
          .replace(/\s+/g, ' ')
          .trim()

        const normArtist = (track.artist || '').normalize('NFKC').toLowerCase().trim()
        const key = `${normTitle}|||${normArtist}`

        if (seen.has(key)) {
          toDelete.push(track)
        } else {
          seen.set(key, track)
        }
      }

      if (toDelete.length === 0) {
        alert('Không tìm thấy bài hát trùng nào!')
        return
      }

      let deletedCount = 0
      for (const track of toDelete) {
        const { error } = await supabase.from('tracks').delete().eq('id', track.id)
        if (!error) {
          if (track.file_path && !track.file_path.startsWith('http')) {
            await supabase.storage.from('music-files').remove([track.file_path])
          }
          deletedCount++
        }
      }

      alert(`✅ Đã xóa ${deletedCount} bài trùng khỏi thư viện!`)
      await fetchData()
    } finally {
      setCleaningDuplicates(false)
    }
  }

  const handleCleanMissingDriveFiles = async () => {
    if (!user) return
    if (!confirm('Tự động quét, lấy lại tên bài hát chuẩn từ Google Drive & dọn dẹp các bài lỗi khỏi CSDL?')) return

    setCleaningDuplicates(true)
    setCleanStatusText('Đang quét...')

    try {
      let repairedCount = 0
      let deletedCount = 0
      let processedCount = 0
      const total = tracks.length

      const processTrack = async (track: Track) => {
        const fp = track.file_path || ''
        const isFolder = fp.includes('/folders/') || fp.includes('drive/folders')
        const driveFileId = extractDriveFileId(fp)

        let isInvalid = isFolder
        if (!isInvalid && driveFileId) {
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 3000)
            const checkUrl = `/api/drive-stream?id=${driveFileId}`
            const res = await fetch(checkUrl, { method: 'HEAD', signal: controller.signal })
            clearTimeout(timeoutId)
            if (res.status === 404 || res.status === 500) {
              isInvalid = true
            }
          } catch {
            // ignore network timeout
          }
        }

        if (isInvalid) {
          await supabase.from('playlist_tracks').delete().eq('track_id', track.id)
          await supabase.from('favorite_tracks').delete().eq('track_id', track.id)
          await supabase.from('listening_history').delete().eq('track_id', track.id)
          await supabase.from('tracks').delete().eq('id', track.id)
          deletedCount++
          processedCount++
          setCleanStatusText(`Đang dọn (${processedCount}/${total})...`)
          return
        }

        const needsTitleFix =
          !track.title ||
          /^Bài hát \d+$/i.test(track.title.trim()) ||
          track.artist === 'Chưa rõ nghệ sĩ' ||
          track.album === 'Google Drive' ||
          track.album === 'Google Drive Sync'

        if (needsTitleFix && driveFileId) {
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 3000)
            const viewRes = await fetch(`https://drive.google.com/file/d/${driveFileId}/view`, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              },
              cache: 'no-store',
              signal: controller.signal,
            })
            clearTimeout(timeoutId)

            if (viewRes.ok) {
              const html = await viewRes.text()
              const ogMatch =
                html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                html.match(/<title>([^<]+?)(?:\s*-\s*Google Drive)?<\/title>/i)

              if (ogMatch && ogMatch[1]) {
                const rawName = ogMatch[1].replace(/\s*-\s*Google Drive$/i, '').trim()
                if (rawName && rawName !== 'Google Drive' && !rawName.toLowerCase().includes('google drive')) {
                  const { title: newTitle, artist: newArtist } = parseFilenameToTitleArtist(rawName)
                  const updates: Partial<Track> = {}

                  if (newTitle && (/^Bài hát \d+$/i.test(track.title.trim()) || !track.title)) {
                    updates.title = newTitle
                  }
                  if (newArtist && newArtist !== 'Chưa rõ nghệ sĩ' && (track.artist === 'Chưa rõ nghệ sĩ' || !track.artist)) {
                    updates.artist = newArtist
                  }
                  if (track.album === 'Google Drive' || track.album === 'Google Drive Sync') {
                    updates.album = null
                  }

                  if (Object.keys(updates).length > 0) {
                    await supabase.from('tracks').update(updates).eq('id', track.id)
                    repairedCount++
                  }
                }
              }
            }
          } catch {
            // ignore
          }
        }

        const leadingNumRegex = /^\s*\d{1,3}[\.\_\-\:\)\s\|]+\s*/
        if (track.title && leadingNumRegex.test(track.title)) {
          const cleanTitle = track.title.replace(leadingNumRegex, '').trim()
          if (cleanTitle && cleanTitle !== track.title) {
            await supabase.from('tracks').update({ title: cleanTitle }).eq('id', track.id)
            repairedCount++
          }
        }

        processedCount++
        setCleanStatusText(`Đang dọn (${processedCount}/${total})...`)
      }

      // Concurrency worker pool (8 items in parallel)
      const concurrency = 8
      let index = 0
      const activePromises: Promise<void>[] = []

      const getNext = async (): Promise<void> => {
        if (index >= tracks.length) return
        const currentTrack = tracks[index++]
        await processTrack(currentTrack)
        return getNext()
      }

      const workers = Math.min(concurrency, tracks.length)
      for (let i = 0; i < workers; i++) {
        activePromises.push(getNext())
      }

      await Promise.all(activePromises)

      alert(
        `✅ Hoàn tất xử lý thư viện!\n- Đã sửa lại tên/nghệ sĩ chuẩn cho: ${repairedCount} bài hát cũ\n- Đã dọn dẹp: ${deletedCount} bài bị hỏng/lỗi link`
      )
      await fetchData()
    } finally {
      setCleaningDuplicates(false)
      setCleanStatusText(null)
    }
  }

  const handleTrackUpdated = (trackId: string, updates: Partial<Track>) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t)))
    setRecentTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t)))
  }

  const handleBulkUpdated = (trackIds: string[], updates: Partial<Track>) => {
    const idSet = new Set(trackIds)
    setTracks((prev) => prev.map((t) => (idSet.has(t.id) ? { ...t, ...updates } : t)))
    setRecentTracks((prev) => prev.map((t) => (idSet.has(t.id) ? { ...t, ...updates } : t)))
  }

  const handleBulkDeleted = (trackIds: string[]) => {
    const idSet = new Set(trackIds)
    setTracks((prev) => prev.filter((t) => !idSet.has(t.id)))
    setRecentTracks((prev) => prev.filter((t) => !idSet.has(t.id)))
  }

  const isAdmin = checkIsAdmin(user?.email) || user?.app_metadata?.role === 'admin'

  const isSearching = searchQuery.trim().length > 0
  let displayedTracks: Track[] = []

  const driveTracks = tracks.filter((t) => {
    const fp = t.file_path || ''
    return Boolean(
      extractDriveFileId(fp) ||
      fp.includes('drive-stream') ||
      fp.includes('drive.google.com') ||
      fp.includes('lh3.googleusercontent.com')
    )
  })

  if (isSearching) {
    if (searchSource === 'all') {
      displayedTracks = [
        ...globalTracks.spotify,
        ...globalTracks.itunes,
        ...globalTracks.youtube,
        ...globalTracks.audius,
        ...globalTracks.local,
      ]
    } else if (searchSource === 'spotify') {
      displayedTracks = globalTracks.spotify
    } else if (searchSource === 'itunes') {
      displayedTracks = globalTracks.itunes
    } else if (searchSource === 'youtube') {
      displayedTracks = globalTracks.youtube
    } else if (searchSource === 'audius') {
      displayedTracks = globalTracks.audius
    } else if (searchSource === 'local') {
      displayedTracks = globalTracks.local
    }
  } else {
    if (libraryTab === 'drive') {
      displayedTracks = driveTracks
    } else if (libraryTab === 'recent') {
      displayedTracks = recentTracks
    } else {
      displayedTracks = tracks
    }
  }

  return (
    <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      {/* High-Impact Hero Card */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 p-8 md:p-10 bg-gradient-to-r from-[var(--theme-gradient-1)] via-[#0e141a] to-[#090b10] shadow-2xl">
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-[var(--primary-spotify)]/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-[var(--theme-secondary)]/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex flex-col gap-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--primary-spotify)]/10 border border-[var(--primary-spotify)]/30 text-[var(--primary-spotify)] text-xs font-bold uppercase tracking-widest w-max shadow-sm">
              <Globe className="w-3.5 h-3.5" />
              <span>Kho Âm Nhạc Toàn Cầu & Cá Nhân</span>
            </div>

            <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight flex flex-wrap items-baseline gap-3 leading-normal py-1">
              <span className="shrink-0">Xin Chào,</span>
              {user && (
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--primary-spotify)] via-emerald-300 to-teal-200 pb-2 inline-block">
                  {user.user_metadata?.full_name || user.email?.split('@')[0]}
                </span>
              )}
            </h1>

            <p className="text-xs md:text-sm text-slate-300">
              Khám phá và nghe nhạc trực tuyến từ <strong>Spotify Global</strong>, <strong>iTunes Music</strong>, <strong>YouTube Music</strong>, <strong>Audius</strong> và <strong>Thư viện cá nhân</strong>.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {(trendingTracks.length > 0 || tracks.length > 0) && (
              <button
                onClick={() => playTrack(trendingTracks[0] || tracks[0], trendingTracks.length > 0 ? trendingTracks : tracks)}
                className="bg-[var(--primary-spotify)] text-black font-extrabold px-6 py-3.5 rounded-full flex items-center gap-2 shadow-xl shadow-[var(--theme-glow-shadow)] hover:scale-105 transition-all text-sm"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>Phát Nhạc Hot</span>
              </button>
            )}

            <Link
              href="/upload"
              className="glass-card hover:border-[var(--primary-spotify)]/50 text-white font-bold px-5 py-3.5 rounded-full flex items-center gap-2 text-sm transition-all shadow-lg"
            >
              <Upload className="w-4 h-4 text-[var(--primary-spotify)]" />
              <span>Upload Nhạc</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Global Trending Music Showcase Section */}
      {!isSearching && libraryTab !== 'drive' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-cyan-400" />
              🔥 Nhạc Hot Quốc Tế & Trending (Spotify, iTunes, Audius & YouTube)
            </h2>
            {loadingTrending && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />}
          </div>

          {loadingTrending ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-card p-3 rounded-2xl animate-pulse flex flex-col gap-2">
                  <div className="aspect-square bg-slate-800 rounded-xl" />
                  <div className="h-3 bg-slate-700 rounded w-3/4" />
                  <div className="h-2 bg-slate-800 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : trendingTracks.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {trendingTracks.slice(0, 12).map((t) => (
                <div
                  key={t.id}
                  onClick={() => playTrack(t, trendingTracks)}
                  className="glass-card p-3 rounded-2xl flex flex-col gap-2.5 cursor-pointer group hover:scale-[1.03] transition-all relative border border-white/10 hover:border-cyan-500/50"
                >
                  <div className="aspect-square bg-slate-800 rounded-xl overflow-hidden relative border border-white/10 flex items-center justify-center">
                    {t.cover_url ? (
                      <img src={t.cover_url} alt={t.title} className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-8 h-8 text-slate-500" />
                    )}

                    {/* Source Badges */}
                    <div className="absolute top-2 right-2 z-10">
                      {t.source === 'spotify' && (
                        <span className="text-[8px] font-black uppercase tracking-wider bg-emerald-600/90 text-white px-1.5 py-0.5 rounded shadow">
                          Spotify
                        </span>
                      )}
                      {t.source === 'itunes' && (
                        <span className="text-[8px] font-black uppercase tracking-wider bg-pink-600/90 text-white px-1.5 py-0.5 rounded shadow">
                          iTunes
                        </span>
                      )}
                      {t.source === 'youtube' && (
                        <span className="text-[8px] font-black uppercase tracking-wider bg-red-600/90 text-white px-1.5 py-0.5 rounded shadow">
                          YouTube
                        </span>
                      )}
                      {t.source === 'audius' && (
                        <span className="text-[8px] font-black uppercase tracking-wider bg-purple-600/90 text-white px-1.5 py-0.5 rounded shadow">
                          Audius
                        </span>
                      )}
                    </div>

                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-[2px]">
                      <div className="w-10 h-10 rounded-full bg-[var(--primary-spotify)] text-black flex items-center justify-center shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform">
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </div>
                  </div>

                  <div className="truncate">
                    <p className="text-xs font-bold text-white truncate group-hover:text-[var(--primary-spotify)] transition-colors">
                      {t.title}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {t.artist || 'Nghệ sĩ chưa xác định'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* ☁️ Drive Dedicated Showcase Section */}
      {!isSearching && (
        <div id="drive" className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-teal-400 to-blue-600 p-0.5 shadow-lg shadow-cyan-500/20">
                <div className="w-full h-full bg-[#0d0e15] rounded-[10px] flex items-center justify-center">
                  <Cloud className="w-5 h-5 text-cyan-400" />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                  Drive
                  <span className="text-[10px] font-extrabold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-full">
                    {driveTracks.length} Bài hát
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Kho nhạc độc quyền được lưu trữ trực tiếp trên Google Drive (FLAC Lossless & HQ Audio)
                </p>
              </div>
            </div>

            {driveTracks.length > 0 && (
              <button
                onClick={() => {
                  if (driveTracks.length === 0) return
                  const randomIndex = Math.floor(Math.random() * driveTracks.length)
                  if (!isShuffle) toggleShuffle()
                  playTrack(driveTracks[randomIndex], driveTracks, randomIndex)
                }}
                className="bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-black font-extrabold px-4.5 py-2.5 rounded-full flex items-center gap-2 text-xs shadow-lg shadow-cyan-500/20 hover:scale-105 transition-all"
              >
                <Shuffle className="w-4 h-4 fill-current ml-0.5" />
                <span>Phát Ngẫu Nhiên Trong Drive</span>
              </button>
            )}
          </div>

          {driveTracks.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {driveTracks.slice(0, 12).map((t) => (
                <div
                  key={t.id}
                  onClick={() => playTrack(t, driveTracks)}
                  className="glass-card p-3 rounded-2xl flex flex-col gap-2.5 cursor-pointer group hover:scale-[1.03] transition-all relative border border-white/10 hover:border-cyan-400/50"
                >
                  <div className="aspect-square bg-slate-800 rounded-xl overflow-hidden relative border border-white/10 flex items-center justify-center">
                    {t.cover_url ? (
                      <img src={t.cover_url} alt={t.title} className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-8 h-8 text-cyan-400/70" />
                    )}

                    <div className="absolute top-2 right-2 z-10">
                      <span className="text-[8px] font-black uppercase tracking-wider bg-cyan-500 text-black px-1.5 py-0.5 rounded shadow font-mono">
                        Drive
                      </span>
                    </div>

                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <div className="w-10 h-10 rounded-full bg-cyan-400 text-black flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col min-w-0">
                    <p className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors truncate">
                      {t.title}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {t.artist || 'Nghệ sĩ chưa xác định'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="glass-panel rounded-2xl p-6 text-center border border-white/10 flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Cloud className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Chưa có bài hát trong mục Drive</h3>
                <p className="text-xs text-slate-400 max-w-md mt-1">
                  Upload file từ máy hoặc dán link/Folder Google Drive để tự động lưu vào danh mục <strong>Drive</strong>.
                </p>
              </div>
              <Link
                href="/upload"
                className="bg-cyan-500 hover:bg-cyan-400 text-black font-extrabold text-xs px-4 py-2 rounded-full transition-all shadow-md"
              >
                + Thêm Bài Hát Vào Drive
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Main Tracks Table Section */}
      <div className="flex flex-col gap-4">
        {!isSearching && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar touch-pan-x pr-2 py-0.5">
              <button
                onClick={() => setLibraryTab('all')}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                  libraryTab === 'all'
                    ? 'bg-white text-black shadow-md'
                    : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                }`}
              >
                <Music className="w-3.5 h-3.5" />
                <span>Tất Cả Bài Hát ({tracks.length})</span>
              </button>

              <button
                onClick={() => setLibraryTab('drive')}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                  libraryTab === 'drive'
                    ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-black shadow-md shadow-cyan-500/20'
                    : 'bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 border border-cyan-500/30'
                }`}
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>Drive ({driveTracks.length})</span>
              </button>

              <button
                onClick={() => setLibraryTab('recent')}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                  libraryTab === 'recent'
                    ? 'bg-emerald-500 text-black shadow-md'
                    : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Vừa Nghe Gần Đây ({recentTracks.length})</span>
              </button>
            </div>
          </div>
        )}
        {isAdmin && !isSearching && (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleCleanMissingDriveFiles}
              disabled={cleaningDuplicates}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 px-3.5 py-1.5 rounded-full transition-all disabled:opacity-50"
              title="Tự động kiểm tra và xóa khỏi CSDL các bài hát đã bị xóa khỏi Google Drive"
            >
              {cleaningDuplicates ? (
                <span className="animate-spin w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full inline-block" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              {cleaningDuplicates ? (cleanStatusText || 'Đang dọn...') : 'Sửa tên & Dọn bài lỗi'}
            </button>

            {(() => {
              const seen = new Set<string>()
              const hasDupes = tracks.some((t) => {
                const key = `${t.title?.toLowerCase().trim()}|||${(t.artist || '')
                  .toLowerCase()
                  .trim()}`
                if (seen.has(key)) return true
                seen.add(key)
                return false
              })
              return hasDupes ? (
                <button
                  onClick={handleCleanDuplicates}
                  disabled={cleaningDuplicates}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-3.5 py-1.5 rounded-full transition-all disabled:opacity-50"
                >
                  {cleaningDuplicates ? (
                    <span className="animate-spin w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full inline-block" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  {cleaningDuplicates ? 'Đang dọn...' : 'Dọn bài trùng'}
                </button>
              ) : null
            })()}
          </div>
        )}
        {isSearching && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Disc className="w-5 h-5 text-[var(--primary-spotify)]" />
                Kết Quả Tìm Kiếm Toàn Cầu
              </h2>
              {searchingGlobal && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />}
            </div>
          </div>
        )}

        {/* Source Filter Pills (Shown when searching) */}
        {isSearching && (
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none touch-pan-x shrink-0 whitespace-nowrap">
            <button
              onClick={() => setSearchSource('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                searchSource === 'all'
                  ? 'bg-[var(--primary-spotify)] text-black shadow-md'
                  : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
              }`}
            >
              🌐 Tất cả ({globalTracks.local.length + globalTracks.spotify.length + globalTracks.itunes.length + globalTracks.youtube.length + globalTracks.audius.length})
            </button>

            <button
              onClick={() => setSearchSource('spotify')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                searchSource === 'spotify'
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20'
              }`}
            >
              🟢 Spotify Global ({globalTracks.spotify.length})
            </button>

            <button
              onClick={() => setSearchSource('itunes')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                searchSource === 'itunes'
                  ? 'bg-pink-600 text-white shadow-md'
                  : 'bg-pink-500/10 text-pink-300 hover:bg-pink-500/20 border border-pink-500/20'
              }`}
            >
              🎵 iTunes Global ({globalTracks.itunes.length})
            </button>

            <button
              onClick={() => setSearchSource('youtube')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                searchSource === 'youtube'
                  ? 'bg-red-500 text-white shadow-md'
                  : 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
              }`}
            >
              ▶️ YouTube ({globalTracks.youtube.length})
            </button>

            <button
              onClick={() => setSearchSource('audius')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                searchSource === 'audius'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 border border-purple-500/20'
              }`}
            >
              🎧 Audius 320k ({globalTracks.audius.length})
            </button>

            <button
              onClick={() => setSearchSource('local')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                searchSource === 'local'
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
              }`}
            >
              📁 Thư viện ({globalTracks.local.length})
            </button>
          </div>
        )}

        {loading || searchingGlobal ? (
          <TrackListSkeleton count={8} />
        ) : (
          <TrackList
            tracks={displayedTracks}
            userPlaylists={playlists}
            onAddToPlaylist={handleAddToPlaylist}
            onDeleteTrack={handleDeleteTrack}
            onTrackUpdated={handleTrackUpdated}
            isAdmin={isAdmin}
            onBulkUpdated={handleBulkUpdated}
            onBulkDeleted={handleBulkDeleted}
          />
        )}
      </div>
    </div>
  )
}
