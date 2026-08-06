import React from 'react'
import { PlayerProvider } from '@/components/player/PlayerContext'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { PlayerBar } from '@/components/player/PlayerBar'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { MobileHeaderNav } from '@/components/navigation/MobileHeaderNav'
import { TopBar } from '@/components/navigation/TopBar'
import { QueueDrawer } from '@/components/player/QueueDrawer'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <PlayerProvider>
        <div className="h-screen w-screen flex flex-col bg-[var(--bg-space,#07090e)] overflow-hidden font-sans p-2 md:p-3 gap-2 md:gap-3">
          {/* Mobile Header (Smartphone view) */}
          <MobileHeaderNav />

          <div className="flex-1 flex min-h-0 relative gap-2 md:gap-3">
            {/* Desktop Left Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <main className="flex-1 bg-[#10131c]/90 rounded-2xl border border-white/[0.05] overflow-y-auto flex flex-col relative pb-32 md:pb-0">
              <TopBar />
              {children}
            </main>

            {/* Right Playback Queue Sidebar */}
            <QueueDrawer />
          </div>

          {/* Player Bar (Desktop Bar + Mobile Floating Player) */}
          <PlayerBar />
        </div>
      </PlayerProvider>
    </AuthGuard>
  )
}

