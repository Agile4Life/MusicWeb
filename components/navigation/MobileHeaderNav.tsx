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
  ListMusic,
  UserCheck,
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
import { useLanguage } from '@/components/i18n/LanguageContext'

export function MobileHeaderNav() {
  const { t } = useLanguage()
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
  }, [nextAuthSession, supabase])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    await signOut({ callbackUrl: '/login' })
    setSupabaseUser(null)
    setPlaylists([])
    setIsDrawerOpen(false)
    window.location.href = '/login'
  }

  const handleCreatePlaylist = async () => {
    if (!user) {
      router.push('/login')
      setIsDrawerOpen(false)
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
      {/* 📱 Mobile Top Header Bar (< 768px) */}
      <div className="md:hidden h-14 bg-[#090b10] border-b border-white/[0.05] px-4 flex items-center justify-between select-none z-30 shrink-0 relative">
        <div className="w-9"></div>

        <Link
          href="/"
          onClick={() => window.dispatchEvent(new Event('musicweb-tab-home'))}
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] shadow-sm backdrop-blur-md hover:bg-white/[0.06] transition-all"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500/20 to-pink-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <Headphones className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center justify-center h-7 min-w-0">
            <img
              src="/phong-signature.png"
              alt="Phong's Music Signature"
              className="h-6 w-auto object-contain signature-img-invert translate-y-[1.5px]"
            />
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="p-2 text-slate-300 hover:text-white rounded-xl bg-white/[0.04] border border-white/[0.06]"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 📱 Mobile Bottom Navigation Bar (< 768px) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-[#090b10]/95 backdrop-blur-2xl border-t border-white/[0.05] px-6 flex items-center justify-around select-none">
        <Link
          href="/"
          onClick={() => window.dispatchEvent(new Event('musicweb-tab-home'))}
          className={`flex flex-col items-center gap-1 transition-colors ${
            pathname === '/' ? 'text-[var(--primary-spotify,#06b6d4)] font-bold' : 'text-slate-400'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px]">Trang chủ</span>
        </Link>

        <Link
          href="/drive"
          className={`flex flex-col items-center gap-1 transition-colors ${
            pathname === '/drive' ? 'text-[var(--spotify-glow,#22d3ee)] font-bold' : 'text-slate-400'
          }`}
        >
          <Cloud className="w-5 h-5" />
          <span className="text-[10px]">{t('drive')}</span>
        </Link>

        <Link
          href="/favorites"
          className={`flex flex-col items-center gap-1 transition-colors ${
            pathname === '/favorites' ? 'text-rose-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Heart className={`w-5 h-5 ${pathname === '/favorites' ? 'fill-current' : ''}`} />
          <span className="text-[10px]">Yêu thích</span>
        </Link>

        <Link
          href="/history"
          className={`flex flex-col items-center gap-1 transition-colors ${
            pathname === '/history' ? 'text-[var(--primary-spotify,#06b6d4)] font-bold' : 'text-slate-400'
          }`}
        >
          <History className="w-5 h-5" />
          <span className="text-[10px]">Lịch sử</span>
        </Link>

        <button
          onClick={() => setIsDrawerOpen(true)}
          className="flex flex-col items-center gap-1 text-slate-400"
        >
          <Menu className="w-5 h-5" />
          <span className="text-[10px]">Menu</span>
        </button>
      </div>

      {/* 📱 Mobile Slide Drawer Navigation */}
      {isDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex justify-end animate-in fade-in duration-200">
          <div className="w-4/5 max-w-xs h-full bg-[#0d1017] border-l border-white/10 p-5 flex flex-col justify-between overflow-y-auto select-none">
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-white/[0.05] pb-4">
                <div className="flex items-center gap-2.5">
                  <Headphones className="w-5 h-5 text-[var(--primary-spotify,#06b6d4)]" />
                  <span className="font-extrabold text-base text-white">MusicWeb</span>
                </div>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Navigation links */}
              <nav className="flex flex-col gap-1">
                <Link
                  href="/"
                  onClick={() => {
                    window.dispatchEvent(new Event('musicweb-tab-home'))
                    setIsDrawerOpen(false)
                  }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:bg-white/5"
                >
                  <Home className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
                  <span>Trang chủ</span>
                </Link>

                <Link
                  href="/drive"
                  onClick={() => setIsDrawerOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold ${
                    pathname === '/drive' ? 'bg-white/10 text-white font-bold' : 'text-slate-200 hover:bg-white/5'
                  }`}
                >
                  <Cloud className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                  <span>{t('drive')}</span>
                </Link>

                <Link
                  href="/favorites"
                  onClick={() => setIsDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:bg-white/5"
                >
                  <Heart className="w-4 h-4 text-rose-400" />
                  <span>Yêu thích</span>
                </Link>

                <Link
                  href="/history"
                  onClick={() => setIsDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:bg-white/5"
                >
                  <History className="w-4 h-4" />
                  <span>Lịch sử nghe</span>
                </Link>

                {isAdmin(user?.email) && (
                  <Link
                    href="/upload"
                    onClick={() => setIsDrawerOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:bg-white/5"
                  >
                    <Upload className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
                    <span>Upload Nhạc</span>
                  </Link>
                )}

                <Link
                  href="/settings"
                  onClick={() => setIsDrawerOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-200 hover:bg-white/5"
                >
                  <Settings className="w-4 h-4" />
                  <span>Cài đặt & Màu sắc</span>
                </Link>
              </nav>

              {/* Playlists in drawer */}
              <div className="border-t border-white/[0.05] pt-4 flex flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                    Playlist cá nhân
                  </span>
                  <button
                    onClick={handleCreatePlaylist}
                    className="p-1 text-slate-400 hover:text-white rounded"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                  {playlists.map((pl) => (
                    <Link
                      key={pl.id}
                      href={`/playlist/${pl.id}`}
                      onClick={() => setIsDrawerOpen(false)}
                      className="flex items-center justify-between p-2 rounded-xl text-xs text-slate-300 hover:bg-white/5"
                    >
                      <span className="truncate">{pl.name}</span>
                      <button
                        onClick={(e) => handleDeletePlaylist(e, pl.id, pl.name)}
                        className="p-1 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer user info */}
            <div className="border-t border-white/[0.05] pt-4">
              {user ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 truncate">
                    <div className="w-7 h-7 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-[var(--spotify-glow,#22d3ee)] shrink-0 font-bold text-xs overflow-hidden">
                      {user.user_metadata?.avatar_url ? (
                        <img
                          src={user.user_metadata.avatar_url}
                          alt={user.email}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <UserCheck className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <span className="text-xs font-bold text-white truncate">
                      {user.user_metadata?.full_name || user.email?.split('@')[0]}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="p-1.5 text-slate-400 hover:text-red-400"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setIsDrawerOpen(false)}
                  className="block text-center py-2 bg-[var(--primary-spotify,#06b6d4)] text-black text-xs font-bold rounded-xl"
                >
                  Đăng nhập
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

