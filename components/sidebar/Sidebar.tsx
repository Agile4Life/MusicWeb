'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Home,
  Upload,
  Plus,
  Music,
  LogOut,
  Sparkles,
  ListMusic,
  UserCheck,
  Disc,
  Settings,
  Heart,
  History,
  Trash2,
  Mic2,
  Cloud,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Playlist } from '@/types'
import { getUserRole, isAdmin, getValidUserId } from '@/lib/accessControl'
import { useSession, signOut } from 'next-auth/react'

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const [supabaseUser, setSupabaseUser] = useState<any>(null)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [creating, setCreating] = useState(false)

  // Unified user object recognizing both Supabase and NextAuth (Google) sessions
  const user = supabaseUser || (nextAuthSession?.user ? {
    id: nextAuthSession.user.email,
    email: nextAuthSession.user.email,
    user_metadata: { full_name: nextAuthSession.user.name, avatar_url: nextAuthSession.user.image }
  } : null)

  useEffect(() => {
    async function loadUserAndPlaylists() {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      setSupabaseUser(currentUser)

      const activeUser = currentUser || (nextAuthSession?.user ? {
        id: nextAuthSession.user.email,
        email: nextAuthSession.user.email,
      } : null)

      const userId = activeUser ? getValidUserId(activeUser) : null

      if (!userId) {
        setPlaylists([])
        return
      }

      // Strictly query playlists created by THIS user only
      const { data } = await supabase
        .from('playlists')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (data) setPlaylists(data)
    }

    loadUserAndPlaylists()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: string, session: any) => {
      const currentUser = session?.user ?? null
      setSupabaseUser(currentUser)
      if (currentUser) {
        loadUserAndPlaylists()
      } else {
        setPlaylists([])
      }
    })

    // Listen to local custom event for instant sync when playlists are added/edited/deleted
    const handleCustomUpdate = () => {
      loadUserAndPlaylists()
    }
    window.addEventListener('playlist-updated', handleCustomUpdate)

    // Subscribe to realtime changes in playlists
    const playlistChannel = supabase
      .channel('sidebar-playlists')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'playlists' },
        () => {
          loadUserAndPlaylists()
        }
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('playlist-updated', handleCustomUpdate)
      supabase.removeChannel(playlistChannel)
    }
  }, [nextAuthSession])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    await signOut({ callbackUrl: '/login' })
    setSupabaseUser(null)
    setPlaylists([])
    window.location.href = '/login'
  }

  const handleCreatePlaylist = async () => {
    if (!user) {
      router.push('/login')
      return
    }

    setCreating(true)
    const validUserId = getValidUserId(user)
    const newName = `Playlist #${playlists.length + 1}`

    const { data, error } = await supabase
      .from('playlists')
      .insert({
        user_id: validUserId,
        name: newName,
        description: 'Playlist cá nhân',
        is_public: false,
      })
      .select()
      .single()

    setCreating(false)

    if (data && !error) {
      setPlaylists([data, ...playlists])
      window.dispatchEvent(new Event('playlist-updated'))
      router.push(`/playlist/${data.id}`)
    } else if (error) {
      console.error('Create playlist error:', error)
      alert('Lỗi tạo playlist: ' + error.message)
    }
  }

  const handleDeletePlaylistFromSidebar = async (e: React.MouseEvent, playlistId: string, playlistName: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Bạn có chắc chắn muốn xóa playlist "${playlistName}"?`)) return

    await supabase.from('playlist_tracks').delete().eq('playlist_id', playlistId)
    const { error } = await supabase.from('playlists').delete().eq('id', playlistId)

    if (!error) {
      setPlaylists((prev) => prev.filter((p) => p.id !== playlistId))
      window.dispatchEvent(new Event('playlist-updated'))
      if (pathname === `/playlist/${playlistId}`) {
        router.push('/')
      }
    } else {
      alert('Lỗi xóa playlist: ' + error.message)
    }
  }

  return (
    <aside className="hidden md:flex w-72 bg-[#090a0f]/90 backdrop-blur-2xl flex-col gap-3 p-3 h-full select-none text-slate-300 border-r border-white/5">
      {/* App Branding */}
      <div className="glass-panel rounded-2xl p-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[var(--primary-spotify)] to-[var(--theme-secondary,#06b6d4)] p-0.5 shadow-lg shadow-[var(--theme-glow-shadow)] group-hover:scale-105 transition-transform">
            <div className="w-full h-full bg-[#0d0e15] rounded-[10px] flex items-center justify-center">
              <Disc className="w-5 h-5 text-[var(--primary-spotify)] animate-spin-slow" />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold text-lg tracking-tight text-white flex items-center gap-1">
              Music<span className="text-[var(--primary-spotify)]">Web</span>
            </span>
            <span className="text-[10px] text-[var(--primary-spotify)] font-mono tracking-wider uppercase opacity-90">
              Pro Studio
            </span>
          </div>
        </Link>
      </div>

      {/* Main Navigation */}
      <div className="glass-panel rounded-2xl p-3 flex flex-col gap-1.5">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 py-1">
          Khám phá
        </p>

        <Link
          href="/"
          className={`flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ${
            pathname === '/'
              ? 'bg-gradient-to-r from-emerald-500/20 to-transparent text-white border-l-2 border-[var(--primary-spotify)] shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Home className={`w-4 h-4 ${pathname === '/' ? 'text-[var(--primary-spotify)]' : ''}`} />
          <span>Trang chủ</span>
        </Link>

        <Link
          href="/#drive"
          onClick={() => {
            window.dispatchEvent(new Event('musicweb-tab-drive'))
          }}
          className="flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 shadow-sm"
        >
          <Cloud className="w-4 h-4 text-cyan-400" />
          <span>Drive</span>
          <span className="ml-auto text-[9px] font-black uppercase tracking-wider bg-cyan-500/30 text-cyan-200 px-1.5 py-0.2 rounded-full border border-cyan-400/30">
            Kho Nhạc
          </span>
        </Link>

        {isAdmin(user?.email) && (
          <Link
            href="/upload"
            className={`flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ${
              pathname === '/upload'
                ? 'bg-gradient-to-r from-emerald-500/20 to-transparent text-white border-l-2 border-[var(--primary-spotify)] shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Upload className={`w-4 h-4 ${pathname === '/upload' ? 'text-[var(--primary-spotify)]' : ''}`} />
            <span>Upload Nhạc</span>
          </Link>
        )}

        <Link
          href="/settings"
          className={`flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ${
            pathname === '/settings'
              ? 'bg-gradient-to-r from-emerald-500/20 to-transparent text-white border-l-2 border-[var(--primary-spotify)] shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Settings className={`w-4 h-4 ${pathname === '/settings' ? 'text-[var(--primary-spotify)]' : ''}`} />
          <span>Cài Đặt & Màu Sắc</span>
        </Link>
        <Link
          href="/favorites"
          className={`flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ${pathname === '/favorites' ? 'bg-gradient-to-r from-emerald-500/20 to-transparent text-white border-l-2 border-[var(--primary-spotify)] shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
        >
          <Heart className={`w-4 h-4 ${pathname === '/favorites' ? 'text-rose-400 fill-rose-400' : ''}`} />
          <span>Yêu thích</span>
        </Link>
        <Link
          href="/history"
          className={`flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ${pathname === '/history' ? 'bg-gradient-to-r from-emerald-500/20 to-transparent text-white border-l-2 border-[var(--primary-spotify)] shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
        >
          <History className="w-4 h-4" />
          <span>Lịch sử nghe</span>
        </Link>
      </div>

      {/* Playlists Container */}
      <div className="glass-panel rounded-2xl p-3 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-3 py-1 mb-2">
          <div className="flex items-center gap-2 text-slate-400 font-semibold text-xs tracking-wider uppercase">
            <ListMusic className="w-4 h-4 text-emerald-400" />
            <span>Thư viện Playlist</span>
          </div>
          <button
            onClick={handleCreatePlaylist}
            disabled={creating}
            className="p-1.5 bg-white/5 hover:bg-[var(--primary-spotify)] hover:text-black rounded-lg transition-all text-slate-300 shadow-sm"
            title="Tạo playlist mới"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
          {user ? (
            playlists.length > 0 ? (
              playlists.map((pl) => (
                <Link
                  key={pl.id}
                  href={`/playlist/${pl.id}`}
                  className={`flex items-center gap-3 p-2.5 rounded-xl transition-all duration-200 group ${
                    pathname === `/playlist/${pl.id}`
                      ? 'bg-white/10 text-white border border-emerald-500/30'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center text-slate-400 group-hover:text-[var(--primary-spotify)] shrink-0 transition-colors">
                    <Music className="w-4 h-4" />
                  </div>
                  <div className="truncate flex-1">
                    <p className="text-xs font-semibold text-white truncate">{pl.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">Playlist cá nhân</p>
                  </div>
                  <button
                    onClick={(e) => handleDeletePlaylistFromSidebar(e, pl.id, pl.name)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg transition-all"
                    title="Xóa playlist"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Link>
              ))
            ) : (
              <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl text-center my-auto">
                <Sparkles className="w-6 h-6 text-emerald-400 mx-auto mb-2 opacity-80" />
                <p className="text-xs font-bold text-white mb-1">Tạo playlist đầu tiên</p>
                <p className="text-[11px] text-slate-400 mb-3">Sắp xếp các bài hát yêu thích của bạn</p>
                <button
                  onClick={handleCreatePlaylist}
                  className="bg-[var(--primary-spotify)] hover:bg-emerald-400 text-black font-bold text-xs px-4 py-2 rounded-full transition-transform hover:scale-105 shadow-md shadow-emerald-500/20"
                >
                  Tạo Playlist
                </button>
              </div>
            )
          ) : (
            <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl text-center my-auto">
              <p className="text-xs text-slate-400 mb-3">Đăng nhập để xem playlist cá nhân</p>
              <Link
                href="/login"
                className="bg-white text-black font-bold text-xs px-4 py-2 rounded-full inline-block hover:scale-105 transition-transform"
              >
                Đăng nhập
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* User Auth Profile Footer */}
      <div className="glass-panel rounded-2xl p-3">
        {user ? (
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2.5 truncate">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[var(--primary-spotify)] to-[var(--theme-secondary,#06b6d4)] p-0.5 shrink-0">
                <div className="w-full h-full bg-[#0d0e15] rounded-full flex items-center justify-center text-[var(--primary-spotify)]">
                  <UserCheck className="w-4 h-4" />
                </div>
              </div>
              <div className="truncate">
                <p className="text-[10px] font-mono flex items-center gap-1">
                  {isAdmin(user?.email) ? (
                    <span className="text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                      ⚡ Admin
                    </span>
                  ) : (
                    <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                      🎧 Người nghe
                    </span>
                  )}
                </p>
                <p className="text-xs font-bold text-white truncate mt-0.5">{user.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-xl transition-colors shrink-0"
              title="Đăng xuất"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-1">
            <Link
              href="/register"
              className="flex-1 text-center py-2 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
            >
              Đăng ký
            </Link>
            <Link
              href="/login"
              className="flex-1 text-center py-2 bg-[var(--primary-spotify)] text-black text-xs font-bold rounded-full hover:scale-105 transition-transform shadow-md shadow-[var(--theme-glow-shadow)]"
            >
              Đăng nhập
            </Link>
          </div>
        )}
      </div>
    </aside>
  )
}
