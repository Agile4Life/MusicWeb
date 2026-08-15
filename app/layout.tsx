import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

import { SessionProvider } from '@/components/auth/SessionProvider'
import { ThemeProvider } from '@/components/theme/ThemeContext'
import { LanguageProvider } from '@/components/i18n/LanguageContext'
import { CursorSpotlight } from '@/components/theme/CursorSpotlight'
import { CustomCursor } from '@/components/theme/CustomCursor'
import { LiquidGlassFilterDefs } from '@/components/theme/LiquidGlassFilterDefs'

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin', 'latin-ext'],
  weight: ['600', '700'],
  display: 'swap',
})

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'MusicWeb • Trình Nghe Nhạc Cá Nhân Độc Bản',
  description: 'Trải nghiệm nghe nhạc high-quality cá nhân với giao diện hiện đại, mượt mà.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MusicWeb',
  },
}

export const viewport: Viewport = {
  themeColor: '#141017',
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
    <html
      lang="vi"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans h-full antialiased dark`}
    >
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg-space,#0A0E1A)] text-slate-100 selection:bg-[var(--primary-spotify,#22D3EE)] selection:text-black font-sans">
        <SessionProvider>
          <LanguageProvider>
            <ThemeProvider>
              <LiquidGlassFilterDefs />
              <CursorSpotlight />
              <CustomCursor />
              {children}
            </ThemeProvider>
          </LanguageProvider>
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
