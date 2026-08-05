import React from 'react'

export function AppLogoIcon({ className = 'w-5 h-5 text-cyan-400' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Headphones Arc */}
      <path d="M3 14v-3a9 9 0 0 1 18 0v3" />
      {/* Left Earcup */}
      <path d="M2 14a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4z" fill="currentColor" fillOpacity="0.2" />
      {/* Right Earcup */}
      <path d="M17 14a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-4z" fill="currentColor" fillOpacity="0.2" />
      {/* Center Soundwave Equalizer Lines */}
      <path d="M9 12.5v2" strokeWidth="2.5" />
      <path d="M12 10.5v6" strokeWidth="2.5" />
      <path d="M15 12.5v2" strokeWidth="2.5" />
    </svg>
  )
}
