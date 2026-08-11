'use client'

import React, { useState } from 'react'
import { PlayerProvider } from '@/components/player/PlayerContext'
import { PlaylistProvider } from '@/components/playlist/PlaylistContext'
import { SearchProvider } from '@/components/search/SearchContext'
import { ToastProvider } from '@/components/ui/ToastContext'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { PlayerBar } from '@/components/player/PlayerBar'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { CurrentUserProvider } from '@/components/auth/CurrentUserContext'
import { MobileHeaderNav } from '@/components/navigation/MobileHeaderNav'
import { TopBar } from '@/components/navigation/TopBar'
import { QueueDrawer } from '@/components/player/QueueDrawer'
import { AlbumCardEffects } from '@/components/common/AlbumCardEffects'
import { NowPlayingOverlay } from '@/components/player/NowPlayingOverlay'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [isScrolled, setIsScrolled] = useState(false)

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop
    const scrolled = scrollTop > 0
    if (scrolled !== isScrolled) {
      setIsScrolled(scrolled)
    }
  }

  return (
    <AuthGuard>
      <CurrentUserProvider>
        <ToastProvider>
          <PlayerProvider>
            <PlaylistProvider>
              <SearchProvider>
                <AlbumCardEffects />
                <div className="h-screen w-screen flex flex-col bg-[var(--bg-space,#07090e)] overflow-hidden font-sans p-1.5 xs:p-2 md:p-3 gap-1.5 md:gap-3">
                  {/* Mobile Header (Smartphone view) */}
                  <MobileHeaderNav />

                  <div className="flex-1 flex min-h-0 relative gap-1.5 md:gap-3">
                    {/* Desktop Left Sidebar */}
                    <Sidebar isScrolled={isScrolled} />

                    {/* Main Content Area */}
                    <main className="flex-1 bg-[#10131c]/90 rounded-2xl border border-white/[0.05] panel-theme-hover overflow-hidden flex flex-col relative">
                      <TopBar />
                      <div
                        onScroll={handleScroll}
                        className="flex-1 overflow-y-auto min-h-0 relative main-content-scroll"
                      >
                        {children}
                      </div>
                    </main>

                    {/* Right Playback Queue Sidebar */}
                    <QueueDrawer />
                  </div>

                  {/* Player Bar (Desktop Bar + Mobile Floating Player) */}
                  <PlayerBar isScrolled={isScrolled} />
                  <NowPlayingOverlay />
                </div>
              </SearchProvider>
            </PlaylistProvider>
          </PlayerProvider>
        </ToastProvider>
      </CurrentUserProvider>
    </AuthGuard>
  )
}


