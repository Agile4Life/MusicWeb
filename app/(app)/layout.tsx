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
import { NowPlayingOverlay } from '@/components/player/NowPlayingOverlay'
import { mobileContentPaddingClassName } from '@/components/player/mobileLayout'

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
                <div className="h-[100dvh] w-screen flex flex-col bg-[var(--bg-space,#07090e)] overflow-hidden font-sans p-0 sm:p-2 lg:p-3 relative">
                  {/* Mobile Header (Smartphone view) */}
                  <MobileHeaderNav />

                  <div className="flex-1 flex min-h-0 relative gap-0 sm:gap-1.5 lg:gap-3">
                    {/* Desktop Left Sidebar */}
                    <Sidebar isScrolled={isScrolled} />

                    {/* Main Content Area */}
                    <main className="main-content-panel flex-1 rounded-none sm:rounded-2xl overflow-hidden flex flex-col relative">
                      <TopBar />
                      <div
                        onScroll={handleScroll}
                        className={`flex-1 overflow-y-auto min-h-0 relative main-content-scroll ${mobileContentPaddingClassName} lg:pb-40`}
                      >
                        {children}
                      </div>
                    </main>

                    {/* Right Playback Queue Sidebar */}
                    <QueueDrawer />
                  </div>

                  {/* Player Bar (Elevation 3 - Fixed above bottom navigation on mobile) */}
                  <div className="fixed lg:absolute bottom-[calc(var(--bottom-nav-height,64px)+env(safe-area-inset-bottom,0px)+12px)] lg:bottom-3 left-2 sm:left-2 lg:left-3 right-2 sm:right-2 lg:right-3 z-40 pointer-events-none">
                    <PlayerBar isScrolled={isScrolled} />
                  </div>
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
