import type { Metadata } from 'next'
import './globals.css'

import { SessionProvider } from '@/components/auth/SessionProvider'
import { ThemeProvider } from '@/components/theme/ThemeContext'
import { CursorSpotlight } from '@/components/theme/CursorSpotlight'

export const metadata: Metadata = {
  title: 'MusicWeb • Trình Nghe Nhạc Cá Nhân Độc Bản',
  description: 'Trải nghiệm nghe nhạc high-quality cá nhân với giao diện glassmorphic hiện đại, mượt mà.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="vi" className="font-sans h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-[var(--bg-space,#07080c)] text-slate-100 selection:bg-[var(--primary-spotify,#1DB954)] selection:text-black">
        <SessionProvider>
          <ThemeProvider>
            <CursorSpotlight />
            {children}
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  )
}


