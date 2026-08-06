'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Track, Playlist } from '@/types'
import { TrackList } from '@/components/track/TrackList'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'
import { usePlayer } from '@/components/player/PlayerContext'
import { deduplicateQueueTracks } from '@/lib/utils'
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
  const [libraryTab, setLibraryTab] = useState<'all' | 'drive' | 'recent'>('recent')

  useEffect(() => {
    const handleSearchEvent = (e: any) => {
      const q = e.detail || ''
      setSearchQuery(q)
      if (!q) {
        lastSearchQueryRef.current = ''
      }
    }

    const checkHashTab = () => {
      if (window.location.hash === '#drive') {
        setLibraryTab('drive')
      } else {
        setLibraryTab('recent')
      }
    }

    const handleTabHome = () => {
      setLibraryTab('recent')
      setSearchQuery('')
      lastSearchQueryRef.current = ''
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
      if (userId) {
        const { data: userFavs } = await supabase
          .from('favorite_tracks')
          .select('track_id')
          .eq('user_id', userId)
        if (userFavs) {
          userFavSet = new Set(userFavs.map((f: any) => f.track_id))
        }
      }

      // Query all tracks from database
      const { data: rawTracks, error: trackError } = await supabase
        .from('tracks')
        .select('*')
        .order('created_at', { ascending: false })

      if (!trackError && rawTracks) {
        // Drive tracks are shared publicly for everyone to view;
        // Non-drive personal uploads are filtered by user_id.
        const visibleTracks = rawTracks.filter((t: Track) => {
          const fp = t.file_path || ''
          const isDrive = Boolean(
            extractDriveFileId(fp) ||
            fp.includes('drive-stream') ||
            fp.includes('drive.google.com') ||
            fp.includes('lh3.googleusercontent.com')
          )
          if (isDrive) return true
          if (userId && t.user_id === userId) return true
          if (!t.user_id || (t as any).is_public) return true
          return false
        })

        const uniqueVisibleTracks: Track[] = []
        const seenTrackKeys = new Set<string>()

        for (const tr of visibleTracks) {
          const driveId = extractDriveFileId(tr.file_path || '')
          const normTitle = (tr.title || '').trim().toLowerCase().normalize('NFKC')
          const normArtist = (tr.artist || '').trim().toLowerCase().normalize('NFKC')
          const key = driveId ? `drive_${driveId}` : `title_${normTitle}|||${normArtist}`

          if (!seenTrackKeys.has(key)) {
            seenTrackKeys.add(key)
            uniqueVisibleTracks.push(tr)
          }
        }

        setTracks(
          uniqueVisibleTracks.map((t: Track) => ({
            ...t,
            source: t.source || 'local',
            is_favorite: userFavSet.has(t.id),
          }))
        )
      }

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracks' }, () => {
        if (!searchQueryRef.current.trim()) debouncedFetch()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlists' }, () => {
        if (!searchQueryRef.current.trim()) debouncedFetch()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listening_history' }, () => {
        if (!searchQueryRef.current.trim()) debouncedFetch()
      })
      .subscribe()

    return () => {
      active = false
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [])

  const searchQueryRef = React.useRef(searchQuery)
  const lastSearchQueryRef = React.useRef('')

  useEffect(() => {
    searchQueryRef.current = searchQuery
  }, [searchQuery])

  // Fast Debounced Global Search (200ms)
  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (!trimmed) {
      setGlobalTracks({ local: [], youtube: [], audius: [], itunes: [], spotify: [] })
      setSearchingGlobal(false)
      lastSearchQueryRef.current = ''
      return
    }

    if (trimmed === lastSearchQueryRef.current) {
      return
    }
    lastSearchQueryRef.current = trimmed

    const timer = setTimeout(async () => {
      setSearchingGlobal(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
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
    if (!isAdmin) {
      alert('Chỉ có tài khoản Admin mới có quyền thêm bài hát vào Playlist!')
      return
    }
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
      displayedTracks = deduplicateQueueTracks([
        ...globalTracks.spotify,
        ...globalTracks.itunes,
        ...globalTracks.youtube,
        ...globalTracks.audius,
        ...globalTracks.local,
      ])
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
    <div className="p-4 sm:p-6 md:p-8 flex flex-col gap-6 md:gap-8 max-w-7xl mx-auto w-full pb-32 md:pb-8 select-none">
      {/* High-Impact Clean Hero Card */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] p-6 sm:p-8 md:p-10 bg-[#0d1017]">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex flex-col gap-2 max-w-xl">
            <h1 className="text-2xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Xin chào{user ? `, ${user.user_metadata?.full_name || user.email?.split('@')[0]}` : ''}
            </h1>
            <p className="text-xs md:text-sm text-slate-400 leading-relaxed">
              Khám phá âm nhạc từ Spotify Global, iTunes, YouTube Music, Audius và kho lưu trữ cá nhân.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {(trendingTracks.length > 0 || tracks.length > 0) && (
              <button
                onClick={() => playTrack(trendingTracks[0] || tracks[0], trendingTracks.length > 0 ? trendingTracks : tracks)}
                style={{
                  background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                  boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                }}
                className="text-black font-bold px-5 py-2.5 rounded-full flex items-center gap-2 text-xs transition-all hover:brightness-110 active:scale-95 border border-white/20"
              >
                <Play className="w-4 h-4 fill-current text-black" />
                <span>Phát nhạc hot</span>
              </button>
            )}

            {isAdmin && (
              <Link
                href="/upload"
                className="bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold px-4 py-2.5 rounded-full flex items-center gap-2 text-xs transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Global Trending Music Showcase Section */}
      {!isSearching && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <TrendingUp style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-4 h-4" />
              <span>Trending & Hot Songs</span>
            </h2>
            {loadingTrending && <Loader2 style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-3.5 h-3.5 animate-spin" />}
          </div>

          {loadingTrending ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white/[0.02] border border-white/[0.04] p-3 rounded-2xl animate-pulse flex flex-col gap-2">
                  <div className="aspect-square bg-slate-800 rounded-xl" />
                  <div className="h-3 bg-slate-700 rounded w-3/4" />
                  <div className="h-2 bg-slate-800 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : trendingTracks.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {trendingTracks.slice(0, 12).map((t) => (
                <div
                  key={t.id}
                  onClick={() => playTrack(t, trendingTracks)}
                  className="bg-white/[0.02] hover:bg-white/[0.06] p-3 rounded-2xl flex flex-col gap-2 cursor-pointer group hover:-translate-y-1.5 transition-all duration-300 border border-white/[0.04] hover:border-[var(--spotify-glow)]/40 shadow-sm"
                >
                  <div className="aspect-square bg-slate-800 rounded-xl overflow-hidden relative border border-white/10 flex items-center justify-center">
                    {t.cover_url ? (
                      <img src={t.cover_url} alt={t.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <Music className="w-7 h-7 text-slate-500 group-hover:scale-110 transition-transform duration-300" />
                    )}

                    {/* Source Badges */}
                    <div className="absolute top-2 right-2 z-10">
                      {t.source === 'spotify' && (
                        <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-emerald-500/90 text-black px-1.5 py-0.5 rounded shadow">
                          Spotify
                        </span>
                      )}
                      {t.source === 'itunes' && (
                        <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-pink-500/90 text-white px-1.5 py-0.5 rounded shadow">
                          iTunes
                        </span>
                      )}
                      {t.source === 'youtube' && (
                        <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-red-500/90 text-white px-1.5 py-0.5 rounded shadow">
                          YT
                        </span>
                      )}
                      {t.source === 'audius' && (
                        <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-purple-500/90 text-white px-1.5 py-0.5 rounded shadow">
                          Audius
                        </span>
                      )}
                    </div>

                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300">
                      <div
                        style={{
                          background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                          boxShadow: '0 4px 12px var(--theme-glow-shadow, rgba(6,182,212,0.4))',
                        }}
                        className="w-10 h-10 rounded-full text-black flex items-center justify-center border border-white/20 transform group-hover:scale-100 scale-75 transition-all duration-300"
                      >
                        <Play className="w-5 h-5 fill-current text-black ml-0.5" />
                      </div>
                    </div>
                  </div>

                  <div className="truncate">
                    <p className="text-xs font-bold text-white truncate group-hover:text-[var(--spotify-glow,#22d3ee)] transition-colors">
                      {t.title}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {t.artist || 'Nghệ sĩ chưa xác định'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Main Tracks Table Section */}
      <div className="flex flex-col gap-4">
        {!isSearching && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar touch-pan-x pr-2 py-0.5">
              <button
                onClick={() => setLibraryTab('recent')}
                style={{
                  background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                  boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                }}
                className="px-4 py-2 rounded-full text-xs font-extrabold text-black border border-white/20 transition-all flex items-center gap-1.5 shrink-0"
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
                <Search className="w-5 h-5 text-cyan-400" />
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
                  ? 'bg-white text-black shadow-md'
                  : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
              }`}
            >
              Tất cả ({globalTracks.local.length + globalTracks.spotify.length + globalTracks.itunes.length + globalTracks.youtube.length + globalTracks.audius.length})
            </button>

            <button
              onClick={() => setSearchSource('spotify')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                searchSource === 'spotify'
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20'
              }`}
            >
              Spotify ({globalTracks.spotify.length})
            </button>

            <button
              onClick={() => setSearchSource('itunes')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                searchSource === 'itunes'
                  ? 'bg-pink-600 text-white shadow-md'
                  : 'bg-pink-500/10 text-pink-300 hover:bg-pink-500/20 border border-pink-500/20'
              }`}
            >
              iTunes ({globalTracks.itunes.length})
            </button>

            <button
              onClick={() => setSearchSource('youtube')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                searchSource === 'youtube'
                  ? 'bg-red-500 text-white shadow-md'
                  : 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
              }`}
            >
              YouTube ({globalTracks.youtube.length})
            </button>

            <button
              onClick={() => setSearchSource('audius')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                searchSource === 'audius'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 border border-purple-500/20'
              }`}
            >
              Audius ({globalTracks.audius.length})
            </button>

            <button
              onClick={() => setSearchSource('local')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                searchSource === 'local'
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
              }`}
            >
              Thư viện ({globalTracks.local.length})
            </button>
          </div>
        )}

        {(isSearching ? searchingGlobal : loading) ? (
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
