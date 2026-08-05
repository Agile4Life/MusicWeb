'use client'

import React from 'react'
import { LyricsView } from '@/components/player/LyricsView'

export default function LyricsPage() {
  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-[#07080c] relative rounded-2xl overflow-hidden">
      <LyricsView />
    </div>
  )
}
