'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'

export type ThemeId = 'slate' | 'gold' | 'sakura' | 'summer' | 'autumn' | 'winter' | 'retro'

export interface ThemeConfig {
  id: ThemeId
  name: string
  subtitle: string
  icon: string
  accentColor: string
  glowColor: string
  gradientFrom: string
  gradientTo: string
  dots: [string, string, string]
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  slate: {
    id: 'slate',
    name: 'Slate',
    subtitle: 'Mặc định',
    icon: '☐',
    accentColor: '#1DB954',
    glowColor: '#1ed760',
    gradientFrom: '#1DB954',
    gradientTo: '#10B981',
    dots: ['#64748b', '#ffffff', '#0f172a'],
  },
  gold: {
    id: 'gold',
    name: 'Gold',
    subtitle: 'Cổ điển',
    icon: '⚡',
    accentColor: '#f59e0b',
    glowColor: '#fbbf24',
    gradientFrom: '#f59e0b',
    gradientTo: '#d97706',
    dots: ['#f59e0b', '#fbbf24', '#451a03'],
  },
  sakura: {
    id: 'sakura',
    name: 'Sakura',
    subtitle: 'Xuân',
    icon: '🌸',
    accentColor: '#ec4899',
    glowColor: '#f472b6',
    gradientFrom: '#ec4899',
    gradientTo: '#e11d48',
    dots: ['#ec4899', '#f472b6', '#4c0519'],
  },
  summer: {
    id: 'summer',
    name: 'Summer',
    subtitle: 'Hạ',
    icon: '☀️',
    accentColor: '#06b6d4',
    glowColor: '#22d3ee',
    gradientFrom: '#06b6d4',
    gradientTo: '#3b82f6',
    dots: ['#06b6d4', '#22d3ee', '#083344'],
  },
  autumn: {
    id: 'autumn',
    name: 'Autumn',
    subtitle: 'Thu',
    icon: '🍂',
    accentColor: '#ea580c',
    glowColor: '#fb923c',
    gradientFrom: '#ea580c',
    gradientTo: '#ef4444',
    dots: ['#ea580c', '#fb923c', '#431407'],
  },
  winter: {
    id: 'winter',
    name: 'Winter',
    subtitle: 'Đông',
    icon: '★',
    accentColor: '#6366f1',
    glowColor: '#818cf8',
    gradientFrom: '#6366f1',
    gradientTo: '#8b5cf6',
    dots: ['#6366f1', '#a5b4fc', '#1e1b4b'],
  },
  retro: {
    id: 'retro',
    name: 'Retro',
    subtitle: 'Máy đọc sách',
    icon: '📜',
    accentColor: '#a16207',
    glowColor: '#eab308',
    gradientFrom: '#a16207',
    gradientTo: '#854d0e',
    dots: ['#57534e', '#78716c', '#fef3c7'],
  },
}

interface ThemeContextType {
  currentTheme: ThemeConfig
  setTheme: (id: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>('slate')

  useEffect(() => {
    const savedTheme = localStorage.getItem('musicweb-theme') as ThemeId
    if (savedTheme && THEMES[savedTheme]) {
      setThemeId(savedTheme)
      applyTheme(THEMES[savedTheme])
    } else {
      applyTheme(THEMES.slate)
    }
  }, [])

  const applyTheme = (theme: ThemeConfig) => {
    const root = document.documentElement
    root.style.setProperty('--primary-spotify', theme.accentColor)
    root.style.setProperty('--spotify-green', theme.accentColor)
    root.style.setProperty('--spotify-glow', theme.glowColor)
    root.style.setProperty('--primary-glow', theme.glowColor)
  }

  const setTheme = (id: ThemeId) => {
    if (THEMES[id]) {
      setThemeId(id)
      localStorage.setItem('musicweb-theme', id)
      applyTheme(THEMES[id])
    }
  }

  return (
    <ThemeContext.Provider value={{ currentTheme: THEMES[themeId], setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
