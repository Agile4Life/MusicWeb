import React from 'react'
import { PlayerProvider } from '@/components/player/PlayerContext'
import { ThemeProvider } from '@/components/theme/ThemeContext'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { PlayerBar } from '@/components/player/PlayerBar'
import { AuthGuard } from '@/components/auth/AuthGuard'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <PlayerProvider>
        <div className="h-screen w-screen flex flex-col bg-[var(--bg-space,#07080c)] overflow-hidden font-sans">
          <div className="flex-1 flex min-h-0">
            {/* Left Sidebar */}
            <Sidebar />

            {/* Main View Area */}
            <main className="flex-1 bg-[#12141d]/80 backdrop-blur-xl rounded-2xl my-2 mr-2 border border-white/5 overflow-y-auto flex flex-col relative">
              {children}
            </main>
          </div>

          {/* Fixed Player Bar at Bottom */}
          <PlayerBar />
        </div>
      </PlayerProvider>
    </AuthGuard>
  )
}

