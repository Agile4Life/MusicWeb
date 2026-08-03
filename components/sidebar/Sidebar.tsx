'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Home,
  Library,
  Upload,
  Plus,
  Music,
  LogOut,
  LogIn,
  UserPlus,
  Compass,
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

        if (data) {
          setPlaylists(data)
        }
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
    <aside className="w-64 bg-black flex flex-col gap-2 p-2 h-full select-none text-gray-300">
      {/* Upper Nav Box */}
      <div className="bg-[#121212] rounded-lg p-4 flex flex-col gap-4">
        <Link href="/" className="flex items-center gap-2 text-white font-bold text-xl px-2">
          <div className="bg-[#1DB954] text-black p-1.5 rounded-full">
            <Music className="w-5 h-5 fill-current" />
          </div>
          <span>MusicWeb</span>
        </Link>

        <nav className="flex flex-col gap-2 mt-2">
          <Link
            href="/"
            className={`flex items-center gap-4 px-3 py-2 rounded-md font-medium text-sm transition-colors hover:text-white ${
              pathname === '/' ? 'text-white bg-[#282828]' : 'text-gray-400'
            }`}
          >
            <Home className="w-5 h-5" />
            <span>Trang chủ</span>
          </Link>

          <Link
            href="/upload"
            className={`flex items-center gap-4 px-3 py-2 rounded-md font-medium text-sm transition-colors hover:text-white ${
              pathname === '/upload' ? 'text-white bg-[#282828]' : 'text-gray-400'
            }`}
          >
            <Upload className="w-5 h-5" />
            <span>Upload Nhạc</span>
          </Link>
        </nav>
      </div>

      {/* Library & Playlist Box */}
      <div className="bg-[#121212] rounded-lg p-4 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between text-gray-400 mb-4 px-2">
          <div className="flex items-center gap-2 hover:text-white transition-colors cursor-pointer">
            <Library className="w-5 h-5" />
            <span className="font-semibold text-sm">Thư viện của bạn</span>
          </div>
          <button
            onClick={handleCreatePlaylist}
            disabled={creating}
            className="p-1 hover:bg-[#282828] hover:text-white rounded-full transition-colors"
            title="Tạo playlist mới"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Playlists List */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
          {user ? (
            playlists.length > 0 ? (
              playlists.map((pl) => (
                <Link
                  key={pl.id}
                  href={`/playlist/${pl.id}`}
                  className={`flex items-center gap-3 p-2 rounded-md hover:bg-[#1a1a1a] transition-colors ${
                    pathname === `/playlist/${pl.id}` ? 'bg-[#282828] text-white' : 'text-gray-400'
                  }`}
                >
                  <div className="w-10 h-10 bg-[#282828] rounded flex items-center justify-center text-gray-400 shrink-0">
                    <Music className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <p className="text-sm font-medium text-white truncate">{pl.name}</p>
                    <p className="text-xs text-gray-400 truncate">Playlist • Cá nhân</p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="p-4 bg-[#181818] rounded-lg text-center my-2">
                <p className="text-sm font-semibold text-white mb-1">Tạo playlist đầu tiên</p>
                <p className="text-xs text-gray-400 mb-3">Rất dễ dàng, chúng tôi sẽ giúp bạn</p>
                <button
                  onClick={handleCreatePlaylist}
                  className="bg-white text-black font-semibold text-xs px-4 py-2 rounded-full hover:scale-105 transition-transform"
                >
                  Tạo playlist
                </button>
              </div>
            )
          ) : (
            <div className="p-4 bg-[#181818] rounded-lg text-center my-2">
              <p className="text-xs text-gray-400 mb-3">Đăng nhập để xem và quản lý playlist của bạn</p>
              <Link
                href="/login"
                className="bg-white text-black font-semibold text-xs px-4 py-2 rounded-full inline-block hover:scale-105 transition-transform"
              >
                Đăng nhập
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* User Auth Footer */}
      <div className="bg-[#121212] rounded-lg p-3">
        {user ? (
          <div className="flex items-center justify-between px-2">
            <div className="truncate pr-2">
              <p className="text-xs text-gray-400">Tài khoản</p>
              <p className="text-xs font-semibold text-white truncate">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 hover:bg-[#282828] text-gray-400 hover:text-red-400 rounded-lg transition-colors"
              title="Đăng xuất"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-1">
            <Link
              href="/register"
              className="flex-1 text-center py-2 text-xs font-semibold text-gray-300 hover:text-white transition-colors"
            >
              Đăng ký
            </Link>
            <Link
              href="/login"
              className="flex-1 text-center py-2 bg-white text-black text-xs font-bold rounded-full hover:scale-105 transition-transform"
            >
              Đăng nhập
            </Link>
          </div>
        )}
      </div>
    </aside>
  )
}
