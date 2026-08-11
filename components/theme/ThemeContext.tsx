'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'

export type ThemeId = 'slate' | 'gold' | 'sakura' | 'summer' | 'autumn' | 'winter' | 'retro' | 'ruby'

export interface ThemeConfig {
  id: ThemeId
  name: string
  subtitle: string
  icon: string
  accentColor: string
  glowColor: string
  secondaryColor: string
  bgSpace: string
  glowShadow: string
  gradient1: string
  gradient2: string
  gradient3: string
  neonFrom: string
  neonTo: string
  dots: [string, string, string]
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  slate: {
    id: 'slate',
    name: 'Emerald Synth',
    subtitle: 'Mặc định Spotify',
    icon: '⚡',
    accentColor: '#1DB954',
    glowColor: '#1ed760',
    secondaryColor: '#06B6D4',
    bgSpace: '#07090E',
    glowShadow: 'rgba(29, 185, 84, 0.35)',
    gradient1: 'rgba(29, 185, 84, 0.22)',
    gradient2: 'rgba(6, 182, 212, 0.12)',
    gradient3: 'rgba(16, 185, 129, 0.10)',
    neonFrom: '#A7F3D0',
    neonTo: '#1DB954',
    dots: ['#1DB954', '#06B6D4', '#07090E'],
  },
  gold: {
    id: 'gold',
    name: 'Neon Gold',
    subtitle: 'Sang trọng & rực rỡ',
    icon: '👑',
    accentColor: '#F59E0B',
    glowColor: '#FBBF24',
    secondaryColor: '#EF4444',
    bgSpace: '#0B0803',
    glowShadow: 'rgba(245, 158, 11, 0.35)',
    gradient1: 'rgba(245, 158, 11, 0.25)',
    gradient2: 'rgba(239, 68, 68, 0.12)',
    gradient3: 'rgba(251, 191, 36, 0.10)',
    neonFrom: '#FEF3C7',
    neonTo: '#F59E0B',
    dots: ['#F59E0B', '#FBBF24', '#0B0803'],
  },
  sakura: {
    id: 'sakura',
    name: 'Sakura Cyber',
    subtitle: 'Hồng Cyberpunk',
    icon: '🌸',
    accentColor: '#EC4899',
    glowColor: '#F472B6',
    secondaryColor: '#A855F7',
    bgSpace: '#0D0514',
    glowShadow: 'rgba(236, 72, 153, 0.35)',
    gradient1: 'rgba(236, 72, 153, 0.25)',
    gradient2: 'rgba(168, 85, 247, 0.15)',
    gradient3: 'rgba(244, 114, 182, 0.10)',
    neonFrom: '#FBCFE8',
    neonTo: '#EC4899',
    dots: ['#EC4899', '#A855F7', '#0D0514'],
  },
  summer: {
    id: 'summer',
    name: 'Cyber Cyan',
    subtitle: 'Đại dương vô tận',
    icon: '🌊',
    accentColor: '#06B6D4',
    glowColor: '#22D3EE',
    secondaryColor: '#3B82F6',
    bgSpace: '#030A14',
    glowShadow: 'rgba(6, 182, 212, 0.35)',
    gradient1: 'rgba(6, 182, 212, 0.25)',
    gradient2: 'rgba(59, 130, 246, 0.15)',
    gradient3: 'rgba(34, 211, 238, 0.10)',
    neonFrom: '#BAE6FD',
    neonTo: '#06B6D4',
    dots: ['#06B6D4', '#3B82F6', '#030A14'],
  },
  autumn: {
    id: 'autumn',
    name: 'Autumn Sunset',
    subtitle: 'Hoàng hôn cháy bỏng',
    icon: '🍂',
    accentColor: '#EA580C',
    glowColor: '#FB923C',
    secondaryColor: '#E11D48',
    bgSpace: '#100603',
    glowShadow: 'rgba(234, 88, 12, 0.35)',
    gradient1: 'rgba(234, 88, 12, 0.25)',
    gradient2: 'rgba(225, 29, 72, 0.15)',
    gradient3: 'rgba(251, 146, 60, 0.10)',
    neonFrom: '#FFEDD5',
    neonTo: '#EA580C',
    dots: ['#EA580C', '#FB923C', '#100603'],
  },
  winter: {
    id: 'winter',
    name: 'Galaxy Indigo',
    subtitle: 'Vũ trụ huyền bí',
    icon: '🌌',
    accentColor: '#6366F1',
    glowColor: '#818CF8',
    secondaryColor: '#8B5CF6',
    bgSpace: '#060714',
    glowShadow: 'rgba(99, 102, 241, 0.35)',
    gradient1: 'rgba(99, 102, 241, 0.25)',
    gradient2: 'rgba(139, 92, 246, 0.15)',
    gradient3: 'rgba(129, 140, 248, 0.10)',
    neonFrom: '#E0E7FF',
    neonTo: '#6366F1',
    dots: ['#6366F1', '#8B5CF6', '#060714'],
  },
  ruby: {
    id: 'ruby',
    name: 'Blood Crimson',
    subtitle: 'Đỏ Ruby rực rỡ',
    icon: '💎',
    accentColor: '#E11D48',
    glowColor: '#F43F5E',
    secondaryColor: '#F59E0B',
    bgSpace: '#120407',
    glowShadow: 'rgba(225, 29, 72, 0.35)',
    gradient1: 'rgba(225, 29, 72, 0.25)',
    gradient2: 'rgba(244, 63, 94, 0.15)',
    gradient3: 'rgba(245, 158, 11, 0.10)',
    neonFrom: '#FFE4E6',
    neonTo: '#E11D48',
    dots: ['#E11D48', '#F43F5E', '#120407'],
  },
  retro: {
    id: 'retro',
    name: 'Vintage Amber',
    subtitle: 'Cổ điển ấm áp',
    icon: '📻',
    accentColor: '#D97706',
    glowColor: '#F59E0B',
    secondaryColor: '#78350F',
    bgSpace: '#0D0A06',
    glowShadow: 'rgba(217, 119, 6, 0.35)',
    gradient1: 'rgba(217, 119, 6, 0.25)',
    gradient2: 'rgba(120, 53, 15, 0.15)',
    gradient3: 'rgba(245, 158, 11, 0.10)',
    neonFrom: '#FEF3C7',
    neonTo: '#D97706',
    dots: ['#D97706', '#F59E0B', '#0D0A06'],
  },
}

export type CursorStyle = 'lottie' | 'virtual-singer' | 'default'

interface ThemeContextType {
  currentTheme: ThemeConfig
  setTheme: (id: ThemeId) => void
  cursorStyle: CursorStyle
  setCursorStyle: (style: CursorStyle) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>('summer')
  const [cursorStyle, setCursorStyleState] = useState<CursorStyle>('lottie')

  useEffect(() => {
    const savedTheme = localStorage.getItem('musicweb-theme') as ThemeId
    if (savedTheme && THEMES[savedTheme]) {
      setThemeId(savedTheme)
      applyTheme(THEMES[savedTheme])
    } else {
      applyTheme(THEMES.summer)
    }

    const savedCursor = localStorage.getItem('musicweb-cursor-style') as CursorStyle
    if (savedCursor && ['lottie', 'virtual-singer', 'default'].includes(savedCursor)) {
      applyCursorStyle(savedCursor)
    } else {
      applyCursorStyle('lottie')
    }
  }, [])

  const applyCursorStyle = (style: CursorStyle) => {
    setCursorStyleState(style)
    document.documentElement.setAttribute('data-cursor', style)
  }

  const setCursorStyle = (style: CursorStyle) => {
    localStorage.setItem('musicweb-cursor-style', style)
    applyCursorStyle(style)
  }

  const applyTheme = (theme: ThemeConfig) => {
    const root = document.documentElement
    root.style.setProperty('--primary-spotify', theme.accentColor)
    root.style.setProperty('--spotify-green', theme.accentColor)
    root.style.setProperty('--spotify-glow', theme.glowColor)
    root.style.setProperty('--primary-glow', theme.glowColor)
    root.style.setProperty('--theme-secondary', theme.secondaryColor)
    root.style.setProperty('--bg-space', theme.bgSpace)
    root.style.setProperty('--theme-glow-shadow', theme.glowShadow)
    root.style.setProperty('--theme-gradient-1', theme.gradient1)
    root.style.setProperty('--theme-gradient-2', theme.gradient2)
    root.style.setProperty('--theme-gradient-3', theme.gradient3)
    root.style.setProperty('--theme-neon-from', theme.neonFrom)
    root.style.setProperty('--theme-neon-to', theme.neonTo)
  }

  const setTheme = (id: ThemeId) => {
    if (THEMES[id]) {
      setThemeId(id)
      localStorage.setItem('musicweb-theme', id)
      applyTheme(THEMES[id])
    }
  }

  return (
    <ThemeContext.Provider value={{ currentTheme: THEMES[themeId], setTheme, cursorStyle, setCursorStyle }}>
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
