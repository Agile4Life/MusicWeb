import type { Metadata, Viewport } from 'next'
import './globals.css'

import { SessionProvider } from '@/components/auth/SessionProvider'
import { ThemeProvider } from '@/components/theme/ThemeContext'
import { CursorSpotlight } from '@/components/theme/CursorSpotlight'

export const metadata: Metadata = {
  title: 'MusicWeb • Trình Nghe Nhạc Cá Nhân Độc Bản',
  description: 'Trải nghiệm nghe nhạc high-quality cá nhân với giao diện glassmorphic hiện đại, mượt mà.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MusicWeb',
  },
}

export const viewport: Viewport = {
  themeColor: '#07080c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="vi" className="font-sans h-full antialiased dark">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg-space,#07080c)] text-slate-100 selection:bg-[var(--primary-spotify,#1DB954)] selection:text-black">
        <SessionProvider>
          <ThemeProvider>
            <CursorSpotlight />
            {children}
          </ThemeProvider>
        </SessionProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function(err) {
                    console.warn('Service worker registration failed:', err);
                  });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  )
}
