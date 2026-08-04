import type { Metadata } from 'next'
import './globals.css'

import { SessionProvider } from '@/components/auth/SessionProvider'

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
      <body className="min-h-full flex flex-col bg-[#08090D] text-slate-100 selection:bg-[#1DB954] selection:text-black">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
