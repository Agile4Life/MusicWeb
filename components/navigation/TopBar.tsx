'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Search, X, Music, Play, Upload, User, Loader2 } from 'lucide-react'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { useSearch } from '@/components/search/SearchContext'
import { useSession } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

import { deduplicateQueueTracks } from '@/lib/utils'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'

export function TopBar() {
  const router = useRouter()
  const pathname = usePathname()
  const { playTrack } = usePlayer()
  const { searchQuery, setSearchQuery, globalTracks, searchingGlobal, clearSearch } = useSearch()
  const { data: nextAuthSession } = useSession()
  const supabase = createClient()

  const [supabaseUser, setSupabaseUser] = useState<any>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)

  const user =
    supabaseUser ||
    (nextAuthSession?.user
      ? {
          id: nextAuthSession.user.email,
          email: nextAuthSession.user.email,
          user_metadata: {
            full_name: nextAuthSession.user.name,
            avatar_url: nextAuthSession.user.image,
          },
        }
      : null)

  const suggestions: Track[] = React.useMemo(() => {
    const combined = [
      ...(globalTracks.local || []),
      ...(globalTracks.spotify || []),
      ...(globalTracks.itunes || []),
      ...(globalTracks.youtube || []),
      ...(globalTracks.audius || []),
    ]
    return deduplicateQueueTracks(combined).slice(0, 6)
  }, [globalTracks])

  useEffect(() => {
    supabase.auth.getUser().then((res: any) => setSupabaseUser(res?.data?.user))
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('q=')) {
      const url = new URL(window.location.href)
      url.searchParams.delete('q')
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''))
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (searchQuery.trim()) {
      setShowDropdown(true)
    } else {
      setShowDropdown(false)
    }
  }, [searchQuery])

  const handleClearSearch = () => {
    clearSearch()
    setShowDropdown(false)
  }

  return (
    <header className="sticky top-0 z-20 h-14 sm:h-16 md:h-18 px-3 sm:px-4 md:px-8 py-2 md:py-3 bg-[#10131c]/90 backdrop-blur-xl border-b border-white/[0.06] flex items-center justify-between gap-2.5 sm:gap-4 select-none">
      {/* Left Slot: Spacer balancing right side so search is centered */}
      <div className="w-36 md:w-48 shrink-0 hidden sm:block" />

      {/* Center Slot: Perfectly Centered Search Input Container */}
      <div className="relative flex-1 max-w-xl mx-auto my-auto" ref={dropdownRef}>
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleClearSearch()
            }}
            onFocus={() => {
              if (searchQuery.trim()) setShowDropdown(true)
            }}
            placeholder="Tìm bài hát, nghệ sĩ từ Spotify, YouTube, Drive..."
            className="w-full bg-white/[0.04] border border-white/[0.07] focus:border-[var(--primary-spotify,#06b6d4)]/50 focus:bg-white/[0.06] rounded-full pl-9 sm:pl-10 pr-8 sm:pr-9 py-1.5 sm:py-2 text-xs text-white placeholder-slate-400 outline-none transition-all shadow-inner"
          />
          {searchingGlobal ? (
            <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin absolute right-3" />
          ) : searchQuery ? (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 p-0.5 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>

        {/* Suggestions Dropdown Popup */}
        {showDropdown && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-[#0d1017] border border-white/10 rounded-2xl p-2 shadow-2xl z-50 flex flex-col gap-1 max-h-80 overflow-y-auto">
            {searchingGlobal && suggestions.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Đang tìm kiếm...</span>
              </div>
            ) : suggestions.length > 0 ? (
              <>
                <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider px-3 py-1.5">
                  Gợi ý nhanh
                </p>
                {suggestions.map((track) => (
                  <div
                    key={track.id}
                    onClick={() => {
                      playTrack(track, suggestions)
                      setShowDropdown(false)
                    }}
                    className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-xl cursor-pointer transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                      <TrackCoverImage src={track.cover_url} alt={track.title} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white group-hover:text-[var(--spotify-glow)] truncate">
                        {track.title}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">{track.artist || 'Nghệ sĩ chưa xác định'}</p>
                    </div>
                    <div className="w-7 h-7 rounded-full bg-white/5 group-hover:bg-[var(--primary-spotify)] text-slate-400 group-hover:text-black flex items-center justify-center shrink-0 transition-colors">
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">
                Không tìm thấy kết quả phù hợp cho &quot;{searchQuery}&quot;
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Slot: User Actions */}
      <div className="shrink-0 flex items-center justify-end gap-3 my-auto sm:w-36 md:w-48">
        {user ? (
          <div className="hidden sm:flex items-center gap-2.5 py-1">
            <div className="w-8 h-8 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-[var(--primary-spotify,#06b6d4)] font-bold text-xs shrink-0">
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt={user.email}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <User className="w-4 h-4" />
              )}
            </div>
            <span className="hidden sm:inline text-xs font-bold text-white truncate max-w-[120px]">
              {user.user_metadata?.full_name || user.email?.split('@')[0]}
            </span>
          </div>
        ) : (
          <Link
            href="/login"
            className="text-xs font-bold text-black bg-white hover:bg-slate-200 px-3 py-1 sm:px-4 sm:py-1.5 rounded-full transition-colors"
          >
            Đăng nhập
          </Link>
        )}
      </div>
    </header>
  )
}
