import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Inter, JetBrains_Mono, Fraunces, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

import { SessionProvider } from '@/components/auth/SessionProvider'
import { ThemeProvider } from '@/components/theme/ThemeContext'
import { LanguageProvider } from '@/components/i18n/LanguageContext'
import { CustomCursor } from '@/components/theme/CustomCursor'
import { LiquidGlassFilterDefs } from '@/components/theme/LiquidGlassFilterDefs'
import { WebIntroSplash } from '@/components/ui/WebIntroSplash'

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
})

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'vietnamese'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
})

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin', 'vietnamese'],
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Music',
  description: 'Trải nghiệm nghe nhạc high-quality cá nhân với giao diện hiện đại, mượt mà.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Music',
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
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${fraunces.variable} ${ibmPlexMono.variable} font-sans h-full antialiased dark`}
    >
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="icon" type="image/png" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Permanent+Marker&family=Rock+Salt&family=Sedgwick+Ave&display=swap"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var root = document.documentElement;
                  var savedStyle = localStorage.getItem('musicweb-theme-style');
                  var style = ["classic","liquid-glass","minimal-flat"].indexOf(savedStyle) >= 0 ? savedStyle : 'classic';
                  root.setAttribute('data-theme-style', style);
                  var savedCursor = localStorage.getItem('musicweb-cursor-style');
                  if (savedCursor) root.setAttribute('data-cursor', savedCursor);
                  var themes = {
                    slate: ['#1DB954', '#1ed760', '#06B6D4', '#07090E', '223', '33%', '29, 185, 84', '30, 215, 96'],
                    gold: ['#F59E0B', '#FBBF24', '#EF4444', '#0B0803', '38', '56%', '245, 158, 11', '251, 191, 36'],
                    sakura: ['#EC4899', '#F472B6', '#A855F7', '#0D0514', '270', '60%', '236, 72, 153', '244, 114, 182'],
                    summer: ['#06B6D4', '#22D3EE', '#3B82F6', '#030A14', '213', '74%', '6, 182, 212', '34, 211, 238'],
                    autumn: ['#EA580C', '#FB923C', '#E11D48', '#100603', '14', '69%', '234, 88, 12', '251, 146, 60'],
                    winter: ['#6366F1', '#818CF8', '#8B5CF6', '#060714', '236', '60%', '99, 102, 241', '129, 140, 248'],
                    ruby: ['#E11D48', '#F43F5E', '#F59E0B', '#120407', '345', '64%', '225, 29, 72', '244, 63, 94'],
                    retro: ['#D97706', '#F59E0B', '#78350F', '#0D0A06', '34', '37%', '217, 119, 6', '245, 158, 11'],
                    mint: ['#10B981', '#34D399', '#06B6D4', '#071410', '160', '60%', '16, 185, 129', '52, 211, 153'],
                    violet: ['#8B5CF6', '#A78BFA', '#EC4899', '#100A1C', '265', '65%', '139, 92, 246', '167, 139, 250'],
                    ocean: ['#0EA5E9', '#38BDF8', '#3B82F6', '#060E1A', '199', '75%', '14, 165, 233', '56, 189, 248'],
                    cherry: ['#F472B6', '#F472B6', '#FB7185', '#14080A', '330', '65%', '244, 114, 182', '244, 114, 182'],
                    forest: ['#22C55E', '#4ADE80', '#15803D', '#050D06', '142', '60%', '34, 197, 94', '74, 222, 128'],
                    solar: ['#F97316', '#FB923C', '#DC2626', '#140904', '24', '75%', '249, 115, 22', '251, 146, 60'],
                    ice: ['#38BDF8', '#7DD3FC', '#E0F2FE', '#06111A', '201', '80%', '56, 189, 248', '125, 211, 252'],
                    lime: ['#84CC16', '#A3E635', '#EAB308', '#0B1004', '84', '75%', '132, 204, 22', '163, 230, 53'],
                    wine: ['#9F1239', '#E11D48', '#7E22CE', '#12050D', '340', '70%', '159, 18, 57', '225, 29, 72'],
                    aurora: ['#22D3EE', '#22D3EE', '#6366F1', '#0A0E1A', '224', '45%', '34, 211, 238', '34, 211, 238']
                  };
                  var savedTheme = localStorage.getItem('musicweb-theme');
                  var t = themes[savedTheme] || themes.aurora;
                  root.style.setProperty('--primary-spotify', t[0]);
                  root.style.setProperty('--spotify-green', t[0]);
                  root.style.setProperty('--spotify-glow', t[1]);
                  root.style.setProperty('--primary-glow', t[1]);
                  root.style.setProperty('--theme-secondary', t[2]);
                  root.style.setProperty('--bg-space', t[3]);
                  root.style.setProperty('--bg-page', t[3]);
                  root.style.setProperty('--base-h', t[4]);
                  root.style.setProperty('--base-s', t[5]);
                  root.style.setProperty('--primary-spotify-rgb', t[6]);
                  root.style.setProperty('--spotify-glow-rgb', t[7]);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--bg-space,#0A0E1A)] text-slate-100 selection:bg-[var(--primary-spotify,#22D3EE)] selection:text-black font-sans">
        <SessionProvider>
          <LanguageProvider>
            <ThemeProvider>
              <LiquidGlassFilterDefs />
              <WebIntroSplash />
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
