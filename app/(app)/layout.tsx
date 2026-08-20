'use client'

import React, { useState, useRef, useEffect } from 'react'
import { PlayerProvider } from '@/components/player/PlayerContext'
import { PlaylistProvider } from '@/components/playlist/PlaylistContext'
import { SearchProvider } from '@/components/search/SearchContext'
import { ToastProvider } from '@/components/ui/ToastContext'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { PlayerBar } from '@/components/player/PlayerBar'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { CurrentUserProvider } from '@/components/auth/CurrentUserContext'
import { MobileHeaderNav } from '@/components/navigation/MobileHeaderNav'
import { MobileScrollHeader } from '@/components/navigation/MobileScrollHeader'
import { TopBar } from '@/components/navigation/TopBar'
import { ScrollProvider, useScrollContext } from '@/components/navigation/ScrollContext'
import { QueueDrawer } from '@/components/player/QueueDrawer'
import { NowPlayingOverlay } from '@/components/player/NowPlayingOverlay'
import { mobileContentPaddingClassName } from '@/components/player/mobileLayout'
import { WelcomeAnnouncementModal } from '@/components/modals/WelcomeAnnouncementModal'
import { LiquidAmbientCanvas } from '@/components/theme/LiquidAmbientCanvas'
import { NavPreloader } from '@/components/navigation/NavPreloader'
import { MobilePageTransition } from '@/components/navigation/MobilePageTransition'
import { useGamingMode } from '@/components/theme/useGamingMode'

/** Minimal shell shown when Gaming Mode is active — only audio engine runs */
function GamingModeShell() {
  return (
    <div
      className="h-[100dvh] w-screen flex items-center justify-center bg-[var(--bg-space,#07090e)]"
      aria-hidden="true"
    >
      <div className="text-center opacity-0 pointer-events-none select-none">
        {/* Invisible — just keeps a minimal DOM alive */}
        <span>🎮</span>
      </div>
    </div>
  )
}

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const [isScrolled, setIsScrolled] = useState(false)
  const isGamingActive = useGamingMode()
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const { setScrollContainer } = useScrollContext()

  useEffect(() => {
    if (contentScrollRef.current) {
      setScrollContainer(contentScrollRef.current)
    }
  }, [setScrollContainer])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop
    const scrolled = scrollTop > 0
    if (scrolled !== isScrolled) {
      setIsScrolled(scrolled)
    }
  }

  if (isGamingActive) {
    return <GamingModeShell />
  }

  return (
    <div className="h-[100dvh] w-screen flex flex-col bg-[var(--bg-space,#07090e)] overflow-hidden font-sans p-0 sm:p-2 lg:p-3 relative">
      {/* Automatic Background Route & Data Preloader */}
      <NavPreloader />

      {/* Dynamic Liquid Ambient Canvas */}
      <LiquidAmbientCanvas />

      {/* Bottom nav and drawer only */}
      <MobileHeaderNav hideTopHeader />

      <div className="flex-1 flex min-h-0 relative gap-0 sm:gap-1.5 lg:gap-3">
        {/* Desktop Left Sidebar */}
        <Sidebar isScrolled={isScrolled} />

        {/* Main Content Area */}
        <main className="main-content-panel flex-1 rounded-none sm:rounded-t-2xl sm:rounded-b-[37px] overflow-hidden flex flex-col relative">
          <TopBar />
          <div
            ref={contentScrollRef}
            onScroll={handleScroll}
            className={`flex-1 overflow-y-auto min-h-0 relative main-content-scroll ${mobileContentPaddingClassName} lg:pb-24`}
          >
            {/* Mobile scroll header — sticky at top of scroll container */}
            <MobileScrollHeader />
            {/* Single children tree wrapped with page transition */}
            <MobilePageTransition>{children}</MobilePageTransition>
          </div>
        </main>

        {/* Right Playback Queue Sidebar */}
        <QueueDrawer />
      </div>

      {/* Player Bar (Elevation 3 - Fixed above bottom navigation on mobile) */}
      <div className="fixed lg:absolute bottom-[calc(var(--bottom-nav-height,84px)+env(safe-area-inset-bottom,0px)+12px)] lg:bottom-3 left-4 sm:left-4 lg:left-3 right-4 sm:right-4 lg:right-3 z-40 pointer-events-none">
        <PlayerBar isScrolled={isScrolled} />
      </div>
      <NowPlayingOverlay />
      <WelcomeAnnouncementModal />
    </div>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <CurrentUserProvider>
        <ToastProvider>
          <PlayerProvider>
            <PlaylistProvider>
              <SearchProvider>
                <ScrollProvider>
                  <AppLayoutInner>{children}</AppLayoutInner>
                </ScrollProvider>
              </SearchProvider>
            </PlaylistProvider>
          </PlayerProvider>
        </ToastProvider>
      </CurrentUserProvider>
    </AuthGuard>
  )
}
