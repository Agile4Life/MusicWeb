'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'

export type ThemeId =
  | 'slate'
  | 'gold'
  | 'sakura'
  | 'summer'
  | 'autumn'
  | 'winter'
  | 'retro'
  | 'ruby'
  | 'mint'
  | 'violet'
  | 'ocean'
  | 'cherry'
  | 'forest'
  | 'solar'
  | 'ice'
  | 'lime'
  | 'wine'
  | 'aurora'

export interface ThemeConfig {
  id: ThemeId
  name: string
  subtitle: string
  icon: string
  accentColor: string
  glowColor: string
  secondaryColor: string
  bgSpace: string
  baseH: string
  baseS: string
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
    baseH: '223',
    baseS: '33%',
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
    baseH: '38',
    baseS: '56%',
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
    baseH: '270',
    baseS: '60%',
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
    baseH: '213',
    baseS: '74%',
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
    baseH: '14',
    baseS: '69%',
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
    baseH: '236',
    baseS: '60%',
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
    baseH: '345',
    baseS: '64%',
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
    baseH: '34',
    baseS: '37%',
    glowShadow: 'rgba(217, 119, 6, 0.35)',
    gradient1: 'rgba(217, 119, 6, 0.25)',
    gradient2: 'rgba(120, 53, 15, 0.15)',
    gradient3: 'rgba(245, 158, 11, 0.10)',
    neonFrom: '#FEF3C7',
    neonTo: '#D97706',
    dots: ['#D97706', '#F59E0B', '#0D0A06'],
  },
  mint: {
    id: 'mint',
    name: 'Mint Frost',
    subtitle: 'Tươi mát & thanh lịch',
    icon: '🌿',
    accentColor: '#10B981',
    glowColor: '#34D399',
    secondaryColor: '#06B6D4',
    bgSpace: '#071410',
    baseH: '160',
    baseS: '60%',
    glowShadow: 'rgba(16, 185, 129, 0.35)',
    gradient1: 'rgba(16, 185, 129, 0.25)',
    gradient2: 'rgba(6, 182, 212, 0.15)',
    gradient3: 'rgba(52, 211, 153, 0.10)',
    neonFrom: '#A7F3D0',
    neonTo: '#10B981',
    dots: ['#10B981', '#06B6D4', '#071410'],
  },
  violet: {
    id: 'violet',
    name: 'Royal Violet',
    subtitle: 'Hoàng gia quyến rũ',
    icon: '🔮',
    accentColor: '#8B5CF6',
    glowColor: '#A78BFA',
    secondaryColor: '#EC4899',
    bgSpace: '#100A1C',
    baseH: '265',
    baseS: '65%',
    glowShadow: 'rgba(139, 92, 246, 0.35)',
    gradient1: 'rgba(139, 92, 246, 0.25)',
    gradient2: 'rgba(236, 72, 153, 0.15)',
    gradient3: 'rgba(167, 139, 250, 0.10)',
    neonFrom: '#DDD6FE',
    neonTo: '#8B5CF6',
    dots: ['#8B5CF6', '#EC4899', '#100A1C'],
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean Breeze',
    subtitle: 'Làn gió đại dương',
    icon: '🌬️',
    accentColor: '#0EA5E9',
    glowColor: '#38BDF8',
    secondaryColor: '#3B82F6',
    bgSpace: '#060E1A',
    baseH: '199',
    baseS: '75%',
    glowShadow: 'rgba(14, 165, 233, 0.35)',
    gradient1: 'rgba(14, 165, 233, 0.25)',
    gradient2: 'rgba(59, 130, 246, 0.15)',
    gradient3: 'rgba(56, 189, 248, 0.10)',
    neonFrom: '#BAE6FD',
    neonTo: '#0EA5E9',
    dots: ['#0EA5E9', '#3B82F6', '#060E1A'],
  },
  cherry: {
    id: 'cherry',
    name: 'Cherry Blossom',
    subtitle: 'Anh đào dịu dàng',
    icon: '🌸',
    accentColor: '#F472B6',
    glowColor: '#F472B6',
    secondaryColor: '#FB7185',
    bgSpace: '#14080A',
    baseH: '330',
    baseS: '65%',
    glowShadow: 'rgba(244, 114, 182, 0.35)',
    gradient1: 'rgba(244, 114, 182, 0.25)',
    gradient2: 'rgba(251, 113, 133, 0.15)',
    gradient3: 'rgba(251, 207, 232, 0.10)',
    neonFrom: '#FBCFE8',
    neonTo: '#F472B6',
    dots: ['#F472B6', '#FB7185', '#14080A'],
  },
  forest: {
    id: 'forest',
    name: 'Forest Night',
    subtitle: 'Rừng đêm huyền bí',
    icon: '🌲',
    accentColor: '#22C55E',
    glowColor: '#4ADE80',
    secondaryColor: '#15803D',
    bgSpace: '#050D06',
    baseH: '142',
    baseS: '60%',
    glowShadow: 'rgba(34, 197, 94, 0.35)',
    gradient1: 'rgba(34, 197, 94, 0.25)',
    gradient2: 'rgba(21, 128, 61, 0.15)',
    gradient3: 'rgba(74, 222, 128, 0.10)',
    neonFrom: '#BBF7D0',
    neonTo: '#22C55E',
    dots: ['#22C55E', '#15803D', '#050D06'],
  },
  solar: {
    id: 'solar',
    name: 'Solar Flare',
    subtitle: 'Ngọn lửa mặt trời',
    icon: '☀️',
    accentColor: '#F97316',
    glowColor: '#FB923C',
    secondaryColor: '#DC2626',
    bgSpace: '#140904',
    baseH: '24',
    baseS: '75%',
    glowShadow: 'rgba(249, 115, 22, 0.35)',
    gradient1: 'rgba(249, 115, 22, 0.25)',
    gradient2: 'rgba(220, 38, 38, 0.15)',
    gradient3: 'rgba(251, 146, 60, 0.10)',
    neonFrom: '#FFEDD5',
    neonTo: '#F97316',
    dots: ['#F97316', '#DC2626', '#140904'],
  },
  ice: {
    id: 'ice',
    name: 'Ice Blue',
    subtitle: 'Băng giá tinh khôi',
    icon: '❄️',
    accentColor: '#38BDF8',
    glowColor: '#7DD3FC',
    secondaryColor: '#E0F2FE',
    bgSpace: '#06111A',
    baseH: '201',
    baseS: '80%',
    glowShadow: 'rgba(56, 189, 248, 0.35)',
    gradient1: 'rgba(56, 189, 248, 0.25)',
    gradient2: 'rgba(224, 242, 254, 0.15)',
    gradient3: 'rgba(125, 211, 252, 0.10)',
    neonFrom: '#E0F2FE',
    neonTo: '#38BDF8',
    dots: ['#E0F2FE', '#38BDF8', '#06111A'],
  },
  lime: {
    id: 'lime',
    name: 'Neon Lime',
    subtitle: 'Chanh dây điện quang',
    icon: '🍋',
    accentColor: '#84CC16',
    glowColor: '#A3E635',
    secondaryColor: '#EAB308',
    bgSpace: '#0B1004',
    baseH: '84',
    baseS: '75%',
    glowShadow: 'rgba(132, 204, 22, 0.35)',
    gradient1: 'rgba(132, 204, 22, 0.25)',
    gradient2: 'rgba(234, 179, 8, 0.15)',
    gradient3: 'rgba(163, 230, 53, 0.10)',
    neonFrom: '#ECFCCB',
    neonTo: '#84CC16',
    dots: ['#EAB308', '#84CC16', '#0B1004'],
  },
  wine: {
    id: 'wine',
    name: 'Deep Wine',
    subtitle: 'Rượu vang sâu lắng',
    icon: '🍷',
    accentColor: '#9F1239',
    glowColor: '#E11D48',
    secondaryColor: '#7E22CE',
    bgSpace: '#12050D',
    baseH: '340',
    baseS: '70%',
    glowShadow: 'rgba(159, 18, 57, 0.35)',
    gradient1: 'rgba(159, 18, 57, 0.25)',
    gradient2: 'rgba(126, 34, 206, 0.15)',
    gradient3: 'rgba(225, 29, 72, 0.10)',
    neonFrom: '#FFE4E6',
    neonTo: '#9F1239',
    dots: ['#9F1239', '#7E22CE', '#12050D'],
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora Teal',
    subtitle: 'Cực quang phương Bắc',
    icon: '🌌',
    accentColor: '#14B8A6',
    glowColor: '#2DD4BF',
    secondaryColor: '#22D3EE',
    bgSpace: '#051212',
    baseH: '174',
    baseS: '65%',
    glowShadow: 'rgba(20, 184, 166, 0.35)',
    gradient1: 'rgba(20, 184, 166, 0.25)',
    gradient2: 'rgba(34, 211, 238, 0.15)',
    gradient3: 'rgba(45, 212, 191, 0.10)',
    neonFrom: '#CCFBF1',
    neonTo: '#14B8A6',
    dots: ['#14B8A6', '#22D3EE', '#051212'],
  },
}

import { CURSOR_CONFIGS } from '@/lib/cursors'

export type CursorStyle = string

interface ThemeContextType {
  currentTheme: ThemeConfig
  setTheme: (id: ThemeId) => void
  cursorStyle: CursorStyle
  setCursorStyle: (style: CursorStyle) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>('summer')
  const [cursorStyle, setCursorStyleState] = useState<CursorStyle>('default')

  useEffect(() => {
    const savedTheme = localStorage.getItem('musicweb-theme') as ThemeId
    if (savedTheme && THEMES[savedTheme]) {
      setThemeId(savedTheme)
      applyTheme(THEMES[savedTheme])
    } else {
      applyTheme(THEMES.summer)
    }

    const savedCursor = localStorage.getItem('musicweb-cursor-style') as CursorStyle
    if (savedCursor && CURSOR_CONFIGS.some((c) => c.id === savedCursor)) {
      applyCursorStyle(savedCursor)
    } else {
      applyCursorStyle('default')
    }
  }, [])

  const applyCursorStyle = (style: CursorStyle) => {
    setCursorStyleState(style)
    const root = document.documentElement
    root.setAttribute('data-cursor', style)
    if (style !== 'lottie' && style !== 'default') {
      root.style.setProperty('--cursor-normal', `url('/cursors/${style}/static/Normal.png') 0 0, auto`)
      root.style.setProperty('--cursor-link', `url('/cursors/${style}/static/Link.png') 4 0, pointer`)
      root.style.setProperty('--cursor-text', `url('/cursors/${style}/static/Text.png') 4 9, text`)
      root.style.setProperty('--cursor-unavailable', `url('/cursors/${style}/static/Unavailable.png') 0 0, not-allowed`)
      root.style.setProperty('--cursor-working', `url('/cursors/${style}/static/Working.png') 0 0, wait`)
    } else {
      root.style.removeProperty('--cursor-normal')
      root.style.removeProperty('--cursor-link')
      root.style.removeProperty('--cursor-text')
      root.style.removeProperty('--cursor-unavailable')
      root.style.removeProperty('--cursor-working')
    }
  }

  const setCursorStyle = (style: CursorStyle) => {
    localStorage.setItem('musicweb-cursor-style', style)
    applyCursorStyle(style)
  }

  const applyTheme = (theme: ThemeConfig) => {
    const root = document.documentElement
    root.style.setProperty('--base-h', theme.baseH)
    root.style.setProperty('--base-s', theme.baseS)
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
