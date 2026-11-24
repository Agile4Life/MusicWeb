'use client'

import { LyricsView } from '@/components/player/LyricsView'

export default function LyricsPage() {
  return (
    <div className="w-full h-[calc(100dvh-14.5rem)] lg:h-[calc(100dvh-12.5rem)] flex flex-col min-h-0 bg-[var(--bg-space,#07080c)] relative rounded-2xl overflow-hidden">
      <LyricsView hideDesktopControls />
    </div>
  )
}
