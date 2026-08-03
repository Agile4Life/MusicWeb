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
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Playlist } from '@/types'

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [user, setUser] = useState<any>(null)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    async function loadUserAndPlaylists() {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      setUser(currentUser)

      if (currentUser) {
        const { data } = await supabase
          .from('playlists')
          .select('*')
          .eq('user_id', currentUser.id)
          .order('created_at', { ascending: false })

        if (data) setPlaylists(data)
      }
    }

    loadUserAndPlaylists()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    router.push('/login')
    router.refresh()
  }

  const handleCreatePlaylist = async () => {
    if (!user) {
      router.push('/login')
      return
    }

    setCreating(true)
    const newName = `Playlist #${playlists.length + 1}`
    const { data, error } = await supabase
      .from('playlists')
      .insert({
        user_id: user.id,
        name: newName,
        description: 'Playlist cá nhân',
      })
      .select()
      .single()

    setCreating(false)

    if (data && !error) {
      setPlaylists([data, ...playlists])
      router.push(`/playlist/${data.id}`)
    }
  }

  return (
    <aside className="w-72 bg-[#090a0f]/90 backdrop-blur-2xl flex flex-col gap-3 p-3 h-full select-none text-slate-300 border-r border-white/5">
      {/* App Branding */}
      <div className="glass-panel rounded-2xl p-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#1DB954] via-[#10B981] to-[#06B6D4] p-0.5 shadow-lg shadow-emerald-500/20 group-hover:scale-105 transition-transform">
            <div className="w-full h-full bg-[#0d0e15] rounded-[10px] flex items-center justify-center">
              <Disc className="w-5 h-5 text-[#1DB954] animate-spin-slow" />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold text-lg tracking-tight text-white flex items-center gap-1">
              Music<span className="text-[#1DB954]">Web</span>
            </span>
            <span className="text-[10px] text-emerald-400/80 font-mono tracking-wider uppercase">
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
              ? 'bg-gradient-to-r from-emerald-500/20 to-transparent text-white border-l-2 border-[#1DB954] shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Home className={`w-4 h-4 ${pathname === '/' ? 'text-[#1DB954]' : ''}`} />
          <span>Trang chủ</span>
        </Link>

        <Link
          href="/upload"
          className={`flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ${
            pathname === '/upload'
              ? 'bg-gradient-to-r from-emerald-500/20 to-transparent text-white border-l-2 border-[#1DB954] shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Upload className={`w-4 h-4 ${pathname === '/upload' ? 'text-[#1DB954]' : ''}`} />
          <span>Upload Nhạc</span>
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
            className="p-1.5 bg-white/5 hover:bg-[#1DB954] hover:text-black rounded-lg transition-all text-slate-300 shadow-sm"
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
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center text-slate-400 group-hover:text-[#1DB954] shrink-0 transition-colors">
                    <Music className="w-4 h-4" />
                  </div>
                  <div className="truncate flex-1">
                    <p className="text-xs font-semibold text-white truncate">{pl.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">Playlist cá nhân</p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl text-center my-auto">
                <Sparkles className="w-6 h-6 text-emerald-400 mx-auto mb-2 opacity-80" />
                <p className="text-xs font-bold text-white mb-1">Tạo playlist đầu tiên</p>
                <p className="text-[11px] text-slate-400 mb-3">Sắp xếp các bài hát yêu thích của bạn</p>
                <button
                  onClick={handleCreatePlaylist}
                  className="bg-[#1DB954] hover:bg-emerald-400 text-black font-bold text-xs px-4 py-2 rounded-full transition-transform hover:scale-105 shadow-md shadow-emerald-500/20"
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
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-500 p-0.5 shrink-0">
                <div className="w-full h-full bg-[#0d0e15] rounded-full flex items-center justify-center text-emerald-400">
                  <UserCheck className="w-4 h-4" />
                </div>
              </div>
              <div className="truncate">
                <p className="text-[10px] text-emerald-400 font-mono">Đã kết nối</p>
                <p className="text-xs font-bold text-white truncate">{user.email}</p>
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
              className="flex-1 text-center py-2 bg-[#1DB954] text-black text-xs font-bold rounded-full hover:scale-105 transition-transform shadow-md shadow-emerald-500/20"
            >
              Đăng nhập
            </Link>
          </div>
        )}
      </div>
    </aside>
  )
}
