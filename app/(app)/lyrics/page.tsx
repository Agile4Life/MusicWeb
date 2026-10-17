'use client'

import React from 'react'
import { LyricsView } from '@/components/player/LyricsView'

export default function LyricsPage() {
  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-[var(--bg-space,#07080c)] relative rounded-2xl overflow-hidden">
      <LyricsView />
    </div>
  )
}
