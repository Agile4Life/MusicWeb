import React from 'react'
import { PlayerProvider } from '@/components/player/PlayerContext'
import { ThemeProvider } from '@/components/theme/ThemeContext'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { PlayerBar } from '@/components/player/PlayerBar'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { MobileHeaderNav } from '@/components/navigation/MobileHeaderNav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <PlayerProvider>
        <div className="h-screen w-screen flex flex-col bg-[var(--bg-space,#07080c)] overflow-hidden font-sans">
          {/* Mobile Header (Smartphone view) */}
          <MobileHeaderNav />

          <div className="flex-1 flex min-h-0 relative">
            {/* Desktop Left Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <main className="flex-1 bg-[#12141d]/80 backdrop-blur-xl rounded-2xl my-1 md:my-2 mx-1 md:mx-0 md:mr-2 border border-white/5 overflow-y-auto flex flex-col relative pb-32 md:pb-0">
              {children}
            </main>
          </div>

          {/* Player Bar (Desktop Bar + Mobile Floating Player) */}
          <PlayerBar />
        </div>
      </PlayerProvider>
    </AuthGuard>
  )
}
