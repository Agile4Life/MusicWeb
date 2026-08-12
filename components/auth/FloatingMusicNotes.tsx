'use client'

import React, { useEffect, useState } from 'react'
import { Music, Headphones, Disc, Radio, Volume2, Sparkles, Mic2, ListMusic } from 'lucide-react'

interface NoteItem {
  id: number
  type: number
  top: number
  left: number
  size: number
  rotate: number
  opacity: number
  duration: number
  delay: number
  glow: boolean
}

export function FloatingMusicNotes() {
  const [notes, setNotes] = useState<NoteItem[]>([])

  useEffect(() => {
    // Generate ~30 organic, random floating music icons across background
    const generated: NoteItem[] = []
    for (let i = 0; i < 30; i++) {
      generated.push({
        id: i,
        type: i % 8,
        top: Math.floor(Math.random() * 92), // 0% to 92%
        left: Math.floor(Math.random() * 92), // 0% to 92%
        size: Math.floor(Math.random() * 28) + 16, // 16px to 44px
        rotate: Math.floor(Math.random() * 90) - 45, // -45deg to 45deg
        opacity: Math.random() * 0.09 + 0.03, // 0.03 to 0.12 subtle background texture
        duration: Math.floor(Math.random() * 6) + 4, // 4s to 10s
        delay: Math.floor(Math.random() * 5), // 0s to 5s
        glow: Math.random() > 0.5,
      })
    }
    setNotes(generated)
  }, [])

  const renderIcon = (type: number, size: number, glow: boolean) => {
    const colorClass = glow
      ? 'text-[var(--spotify-glow,#22d3ee)] drop-shadow-[0_0_8px_var(--theme-glow-shadow)]'
      : 'text-slate-400'

    switch (type) {
      case 0:
        return <Music style={{ width: size, height: size }} className={colorClass} />
      case 1:
        return <Headphones style={{ width: size, height: size }} className={colorClass} />
      case 2:
        return <Disc style={{ width: size, height: size }} className={`${colorClass} animate-spin-slow`} />
      case 3:
        return <Radio style={{ width: size, height: size }} className={colorClass} />
      case 4:
        return <Volume2 style={{ width: size, height: size }} className={colorClass} />
      case 5:
        return <Sparkles style={{ width: size, height: size }} className={colorClass} />
      case 6:
        return <Mic2 style={{ width: size, height: size }} className={colorClass} />
      case 7:
      default:
        return <ListMusic style={{ width: size, height: size }} className={colorClass} />
    }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none">
      {/* Dynamic Ambient Theme Light Blobs */}
      <div
        style={{
          background: 'radial-gradient(500px circle at 20% 30%, color-mix(in srgb, var(--spotify-glow, #22d3ee) 5%, transparent), transparent 70%)',
        }}
        className="absolute inset-0 pointer-events-none"
      />
      <div
        style={{
          background: 'radial-gradient(600px circle at 80% 70%, color-mix(in srgb, var(--primary-spotify, #06b6d4) 3.5%, transparent), transparent 70%)',
        }}
        className="absolute inset-0 pointer-events-none"
      />

      {/* Random Floating Music Icons */}
      {notes.map((note) => (
        <div
          key={note.id}
          style={{
            top: `${note.top}%`,
            left: `${note.left}%`,
            transform: `rotate(${note.rotate}deg)`,
            opacity: note.opacity,
            animationDuration: `${note.duration}s`,
            animationDelay: `${note.delay}s`,
          }}
          className="absolute transition-all ease-in-out animate-float"
        >
          {renderIcon(note.type, note.size, note.glow)}
        </div>
      ))}
    </div>
  )
}
