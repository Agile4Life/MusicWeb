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
  ListMusic,
  UserCheck,
  Cloud,
  Headphones,
  Settings,
  Heart,
  History,
  Trash2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Playlist } from '@/types'
import { isAdmin, getValidUserId } from '@/lib/accessControl'
import { useSession, signOut } from 'next-auth/react'
import { useLanguage } from '@/components/i18n/LanguageContext'

export function Sidebar() {
  const { t } = useLanguage()
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const [supabaseUser, setSupabaseUser] = useState<any>(null)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [creating, setCreating] = useState(false)

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

    const handleCustomUpdate = () => {
      loadUserAndPlaylists()
    }
    window.addEventListener('playlist-updated', handleCustomUpdate)

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
  }, [nextAuthSession, supabase])

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
    <aside className="hidden md:flex w-64 bg-[#090b10] flex-col justify-between p-3.5 h-full select-none text-slate-300 rounded-2xl border border-white/[0.05] shrink-0">
      <div className="flex flex-col gap-5 min-h-0 flex-1">
        {/* App Branding Header */}
        <div className="px-2 pt-1.5 pb-0.5">
          <Link
            href="/"
            onClick={() => window.dispatchEvent(new Event('musicweb-tab-home'))}
            className="flex items-center gap-3 group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 via-pink-500/10 to-purple-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-all shadow-[0_0_12px_rgba(6,182,212,0.15)]">
              <Headphones className="w-5 h-5" />
            </div>
            <div className="flex flex-col justify-center leading-none">
              <span className="font-graffiti text-xl tracking-wider graffiti-text-gradient group-hover:brightness-110 transition-all">
                Phong
              </span>
              <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase -mt-0.5">
                Music<span className="text-cyan-400">Web</span>
              </span>
            </div>
          </Link>
        </div>

        {/* Main Navigation List */}
        <nav className="flex flex-col gap-1">
          <p className="text-[11px] font-mono tracking-wider text-slate-500 uppercase px-2.5 py-1">
            Khám phá
          </p>

          <Link
            href="/"
            onClick={() => window.dispatchEvent(new Event('musicweb-tab-home'))}
            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-colors duration-150 ${
              pathname === '/'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Home className={`w-4 h-4 ${pathname === '/' ? 'text-[var(--primary-spotify,#06b6d4)]' : ''}`} />
            <span>{t('home')}</span>
          </Link>

          <Link
            href="/drive"
            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-colors duration-150 ${
              pathname === '/drive'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Cloud className={`w-4 h-4 ${pathname === '/drive' ? 'text-[var(--spotify-glow,#22d3ee)]' : ''}`} />
            <span>{t('drive')}</span>
          </Link>

          <Link
            href="/favorites"
            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-colors duration-150 ${
              pathname === '/favorites'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Heart className={`w-4 h-4 ${pathname === '/favorites' ? 'text-rose-400 fill-rose-400' : ''}`} />
            <span>{t('favorites')}</span>
          </Link>

          <Link
            href="/history"
            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-colors duration-150 ${
              pathname === '/history'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <History className={`w-4 h-4 ${pathname === '/history' ? 'text-[var(--primary-spotify,#06b6d4)]' : ''}`} />
            <span>{t('history')}</span>
          </Link>

          {isAdmin(user?.email) && (
            <Link
              href="/upload"
              className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-colors duration-150 ${
                pathname === '/upload'
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <Upload className={`w-4 h-4 ${pathname === '/upload' ? 'text-[var(--primary-spotify,#06b6d4)]' : ''}`} />
              <span>{t('upload')}</span>
            </Link>
          )}

          <Link
            href="/settings"
            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-colors duration-150 ${
              pathname === '/settings'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Settings className={`w-4 h-4 ${pathname === '/settings' ? 'text-[var(--primary-spotify,#06b6d4)]' : ''}`} />
            <span>{t('settings')}</span>
          </Link>
        </nav>

        {/* Playlists Container */}
        <div className="flex-1 flex flex-col min-h-0 pt-2 border-t border-white/[0.05]">
          <div className="flex items-center justify-between px-2.5 py-1.5 mb-1">
            <div className="flex items-center gap-2 text-slate-500 font-mono text-[11px] tracking-wider uppercase">
              <ListMusic className="w-3.5 h-3.5 text-cyan-400" />
              <span>Playlist</span>
            </div>
            <button
              onClick={handleCreatePlaylist}
              disabled={creating}
              className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="Tạo playlist mới"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 pr-1">
            {user ? (
              playlists.length > 0 ? (
                playlists.map((pl) => (
                  <Link
                    key={pl.id}
                    href={`/playlist/${pl.id}`}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-colors group ${
                      pathname === `/playlist/${pl.id}`
                        ? 'bg-white/10 text-white font-bold'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/5 flex items-center justify-center text-slate-400 shrink-0">
                      <Music className="w-3.5 h-3.5" />
                    </div>
                    <span className="truncate flex-1 font-medium">{pl.name}</span>
                    <button
                      onClick={(e) => handleDeletePlaylistFromSidebar(e, pl.id, pl.name)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 rounded transition-opacity"
                      title="Xóa playlist"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </Link>
                ))
              ) : (
                <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl text-center my-auto">
                  <p className="text-xs font-semibold text-slate-300 mb-1">Chưa có playlist</p>
                  <button
                    onClick={handleCreatePlaylist}
                    className="text-[11px] font-bold text-[var(--spotify-glow,#22d3ee)] hover:underline mt-1 inline-block"
                  >
                    + Tạo playlist đầu tiên
                  </button>
                </div>
              )
            ) : (
              <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl text-center my-auto">
                <p className="text-[11px] text-slate-400 mb-2">Đăng nhập để tạo playlist</p>
                <Link
                  href="/login"
                  className="bg-white text-black font-bold text-[11px] px-3 py-1 rounded-full inline-block"
                >
                  Đăng nhập
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* User Auth Profile Footer */}
      <div className="pt-3 border-t border-white/[0.05]">
        {user ? (
          <div className="flex items-center justify-between px-2 py-1">
            <div className="flex items-center gap-2.5 truncate min-w-0">
              <div className="w-8 h-8 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-[var(--primary-spotify,#06b6d4)] shrink-0 font-bold text-xs overflow-hidden">
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt={user.email}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <UserCheck className="w-4 h-4" />
                )}
              </div>
              <div className="truncate min-w-0">
                <p className="text-[11px] font-bold text-white truncate">{user.user_metadata?.full_name || user.email?.split('@')[0]}</p>
                <p className="text-[10px] font-mono text-slate-400 truncate">
                  {isAdmin(user?.email) ? 'Admin' : 'Listener'}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors shrink-0"
              title="Đăng xuất"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-1">
            <Link
              href="/login"
              className="flex-1 text-center py-1.5 bg-[var(--primary-spotify,#06b6d4)] text-black font-bold text-xs rounded-xl"
            >
              Đăng nhập
            </Link>
          </div>
        )}
      </div>
    </aside>
  )
}

