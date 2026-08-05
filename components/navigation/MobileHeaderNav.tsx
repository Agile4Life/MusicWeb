'use client'

import React, { useState, useEffect } from 'react'
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
  Mic2,
  Cloud,
  Headphones,
  Menu,
  X,
  Heart,
  History,
  Settings,
  Trash2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Playlist } from '@/types'
import { isAdmin, getValidUserId } from '@/lib/accessControl'
import { useSession, signOut } from 'next-auth/react'

export function MobileHeaderNav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const [supabaseUser, setSupabaseUser] = useState<any>(null)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [creating, setCreating] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const user = supabaseUser || (nextAuthSession?.user ? {
    id: nextAuthSession.user.email,
    email: nextAuthSession.user.email,
    user_metadata: { full_name: nextAuthSession.user.name, avatar_url: nextAuthSession.user.image }
  } : null)

  const loadPlaylists = async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser()
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

    const { data } = await supabase
      .from('playlists')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (data) setPlaylists(data)
  }

  useEffect(() => {
    loadPlaylists()

    const handleCustomUpdate = () => {
      loadPlaylists()
    }
    window.addEventListener('playlist-updated', handleCustomUpdate)
    return () => {
      window.removeEventListener('playlist-updated', handleCustomUpdate)
    }
  }, [nextAuthSession])

  // Close drawer on route change
  useEffect(() => {
    setIsDrawerOpen(false)
  }, [pathname])

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
      setIsDrawerOpen(false)
      router.push(`/playlist/${data.id}`)
    } else if (error) {
      alert('Lỗi tạo playlist: ' + error.message)
    }
  }

  const handleDeletePlaylist = async (e: React.MouseEvent, playlistId: string, playlistName: string) => {
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
    <>
      {/* 📱 TOP MOBILE HEADER */}
      <header className="md:hidden sticky top-0 z-40 bg-[#090a0f]/95 backdrop-blur-xl border-b border-white/10 px-4 py-3 flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="p-2 text-slate-300 active:text-white bg-white/5 active:bg-white/15 rounded-xl transition-colors"
            aria-label="Mở menu navigation"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link
            href="/"
            onClick={() => window.dispatchEvent(new Event('musicweb-tab-home'))}
            className="flex items-center gap-2.5"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-400 via-teal-400 to-blue-600 p-0.5 shadow-md shadow-cyan-500/20">
              <div className="w-full h-full bg-[#080c14] rounded-[10px] flex items-center justify-center">
                <Headphones className="w-4 h-4 text-cyan-400" />
              </div>
            </div>
            <span className="font-extrabold text-base tracking-tight text-white flex items-center gap-1">
              Music<span className="text-[var(--primary-spotify)]">Web</span>
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {user && (
            <div className="text-[10px] font-mono px-2 py-1 rounded-md bg-white/5 border border-white/10 text-slate-300">
              {isAdmin(user?.email) ? '⚡ Admin' : '🎧 Listener'}
            </div>
          )}
        </div>
      </header>

      {/* 📱 SLIDE-OVER MOBILE DRAWER */}
      {isDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setIsDrawerOpen(false)}
          />

          {/* Drawer Content */}
          <div className="relative w-4/5 max-w-sm bg-[#090a0f] border-r border-white/10 p-4 flex flex-col gap-4 z-10 h-full overflow-y-auto animate-in slide-in-from-left duration-300 select-none">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-400 via-teal-400 to-blue-600 p-0.5">
                  <div className="w-full h-full bg-[#080c14] rounded-[10px] flex items-center justify-center">
                    <Headphones className="w-4 h-4 text-cyan-400" />
                  </div>
                </div>
                <span className="font-extrabold text-base text-white">Menu Navigation</span>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Links */}
            <div className="flex flex-col gap-1">
              <Link
                href="/"
                onClick={() => window.dispatchEvent(new Event('musicweb-tab-home'))}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                  pathname === '/' ? 'bg-[var(--primary-spotify)] text-black font-extrabold' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <Home className="w-4 h-4" />
                <span>Trang chủ</span>
              </Link>

              <Link
                href="/favorites"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                  pathname === '/favorites' ? 'bg-[var(--primary-spotify)] text-black font-extrabold' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <Heart className="w-4 h-4" />
                <span>Bài hát yêu thích</span>
              </Link>

              <Link
                href="/history"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                  pathname === '/history' ? 'bg-[var(--primary-spotify)] text-black font-extrabold' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <History className="w-4 h-4" />
                <span>Lịch sử nghe</span>
              </Link>

              {isAdmin(user?.email) && (
                <Link
                  href="/upload"
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    pathname === '/upload' ? 'bg-[var(--primary-spotify)] text-black font-extrabold' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload nhạc (Admin)</span>
                </Link>
              )}

              <Link
                href="/settings"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                  pathname === '/settings' ? 'bg-[var(--primary-spotify)] text-black font-extrabold' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>Cài Đặt & Giao Diện</span>
              </Link>
            </div>

            {/* Playlists Section */}
            <div className="flex-1 flex flex-col min-h-0 border-t border-white/10 pt-3">
              <div className="flex items-center justify-between px-1 mb-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Thư viện Playlist
                </span>
                <button
                  onClick={handleCreatePlaylist}
                  disabled={creating}
                  className="p-1 bg-white/10 hover:bg-[var(--primary-spotify)] hover:text-black rounded-lg transition-colors text-slate-300"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
                {user ? (
                  playlists.length > 0 ? (
                    playlists.map((pl) => (
                      <Link
                        key={pl.id}
                        href={`/playlist/${pl.id}`}
                        className={`flex items-center justify-between p-2 rounded-xl text-xs ${
                          pathname === `/playlist/${pl.id}`
                            ? 'bg-white/15 text-white font-bold'
                            : 'text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <Music className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate">{pl.name}</span>
                        </div>
                        <button
                          onClick={(e) => handleDeletePlaylist(e, pl.id, pl.name)}
                          className="p-1 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </Link>
                    ))
                  ) : (
                    <p className="text-[11px] text-slate-500 italic p-2">Chưa có playlist nào</p>
                  )
                ) : (
                  <p className="text-[11px] text-slate-500 italic p-2">Đăng nhập để xem playlist</p>
                )}
              </div>
            </div>

            {/* Profile / Logout */}
            <div className="border-t border-white/10 pt-3 mt-auto">
              {user ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate">
                    <p className="text-xs font-bold text-white truncate">{user.email}</p>
                    <p className="text-[10px] text-slate-400">
                      {isAdmin(user?.email) ? '⚡ Admin' : '🎧 Người nghe'}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="w-full bg-[var(--primary-spotify)] text-black font-extrabold py-2.5 rounded-full text-xs text-center block"
                >
                  Đăng nhập ngay
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 📱 BOTTOM MOBILE NAVIGATION BAR */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#080a10]/95 backdrop-blur-2xl border-t border-white/10 px-2 pt-1.5 pb-safe flex items-center justify-around select-none">
        <Link
          href="/"
          onClick={() => window.dispatchEvent(new Event('musicweb-tab-home'))}
          className={`flex flex-col items-center gap-0.5 p-1 rounded-xl transition-all active:scale-95 ${
            pathname === '/' ? 'text-[var(--primary-spotify)] font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px]">Trang chủ</span>
        </Link>

        <Link
          href="/#drive"
          onClick={() => {
            window.dispatchEvent(new Event('musicweb-tab-drive'))
          }}
          className={`flex flex-col items-center gap-0.5 p-1 rounded-xl transition-all active:scale-95 text-cyan-300 font-bold`}
        >
          <Cloud className="w-5 h-5 text-cyan-400" />
          <span className="text-[10px]">Drive</span>
        </Link>

        <Link
          href="/favorites"
          className={`flex flex-col items-center gap-0.5 p-1 rounded-xl transition-all active:scale-95 ${
            pathname === '/favorites' ? 'text-rose-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Heart className="w-5 h-5" />
          <span className="text-[10px]">Yêu thích</span>
        </Link>

        <Link
          href="/history"
          className={`flex flex-col items-center gap-0.5 p-1 rounded-xl transition-all active:scale-95 ${
            pathname === '/history' ? 'text-cyan-400 font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <History className="w-5 h-5" />
          <span className="text-[10px]">Lịch sử</span>
        </Link>

        <button
          onClick={() => setIsDrawerOpen(true)}
          className={`flex flex-col items-center gap-0.5 p-1 rounded-xl transition-all active:scale-95 text-slate-400 hover:text-white`}
        >
          <ListMusic className="w-5 h-5" />
          <span className="text-[10px]">Playlist</span>
        </button>
      </nav>
    </>
  )
}
