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
  DiscAlbum,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Playlist } from '@/types'
import { isAdmin, getValidUserId } from '@/lib/accessControl'
import { useSession, signOut } from 'next-auth/react'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'

export function Sidebar() {
  const { t } = useLanguage()
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const { userEmail } = useCurrentUser()
  const { playlists, loading: creating, createPlaylist, deletePlaylist } = usePlaylists()

  const user = userEmail
    ? {
        id: userEmail,
        email: userEmail,
        user_metadata: nextAuthSession?.user
          ? { full_name: nextAuthSession.user.name, avatar_url: nextAuthSession.user.image }
          : {},
      }
    : null

  const handleLogout = async () => {
    await supabase.auth.signOut()
    await signOut({ callbackUrl: '/login' })
    window.location.href = '/login'
  }

  const handleCreatePlaylist = async () => {
    if (!user) {
      router.push('/login')
      return
    }

    const created = await createPlaylist()
    if (created && created.id) {
      router.push(`/playlist/${created.id}`)
    }
  }

  const handleDeletePlaylistFromSidebar = async (e: React.MouseEvent, playlistId: string, playlistName: string) => {
    e.preventDefault()
    e.stopPropagation()

    const deleted = await deletePlaylist(playlistId, playlistName)
    if (deleted && pathname === `/playlist/${playlistId}`) {
      router.push('/')
    }
  }

  return (
    <aside className="hidden md:flex w-64 bg-[#090b10] flex-col justify-between p-3.5 h-full select-none text-slate-300 rounded-2xl border border-white/[0.05] shrink-0">
      <div className="flex flex-col gap-5 min-h-0 flex-1">
        {/* App Branding Header */}
        <div className="px-1 py-1 flex justify-start">
          <Link
            href="/"
            onClick={() => window.dispatchEvent(new Event('musicweb-tab-home'))}
            className="inline-flex items-center gap-2.5 px-3 py-2 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] hover:border-[var(--spotify-glow)]/30 transition-all duration-200 group shadow-md backdrop-blur-xl w-fit shrink-0"
          >
            <div
              style={{
                color: 'var(--spotify-glow, #22d3ee)',
                backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
              }}
              className="w-9 h-9 rounded-xl border flex items-center justify-center group-hover:scale-105 transition-all shadow-md shrink-0"
            >
              <Headphones className="w-4.5 h-4.5" />
            </div>
            <div className="flex items-center justify-center h-9 shrink-0">
              <img
                src="/phong-signature.png"
                alt="Phong's Music Signature"
                className="h-8 w-auto object-contain signature-img-invert translate-y-[1.5px] group-hover:scale-105 transition-transform"
              />
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
            prefetch={false}
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
            href="/albums"
            prefetch={false}
            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-colors duration-150 ${
              pathname === '/albums' || pathname.startsWith('/album/')
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <DiscAlbum className={`w-4 h-4 ${pathname === '/albums' || pathname.startsWith('/album/') ? 'text-[var(--primary-spotify,#06b6d4)]' : ''}`} />
            <span>{t('albums')}</span>
          </Link>

          <Link
            href="/drive"
            prefetch={false}
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
            prefetch={false}
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
            prefetch={false}
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
              prefetch={false}
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
            prefetch={false}
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
              <ListMusic style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-3.5 h-3.5" />
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

