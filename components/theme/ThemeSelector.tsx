'use client'

import React from 'react'
import { useTheme, THEMES, ThemeId, CursorStyle } from './ThemeContext'
import { Palette, Check, MousePointer } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageContext'

export function ThemeSelector() {
  const { currentTheme, setTheme, cursorStyle, setCursorStyle } = useTheme()
  const { t } = useLanguage()

  const cursorOptions: { id: CursorStyle; name: string; desc: string }[] = [
    { id: 'lottie', name: 'Lottie Synth', desc: 'Con trỏ phát sáng động' },
    { id: 'virtual-singer', name: 'VirtualSinger', desc: 'Hatsune Miku Anime' },
    { id: 'default', name: 'Hệ thống (Default)', desc: 'Con trỏ mặc định' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Color Themes Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Palette className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
          <span>{t('color_theme')}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Object.values(THEMES).map((theme) => {
            const isSelected = currentTheme.id === theme.id

            return (
              <button
                key={theme.id}
                onClick={() => setTheme(theme.id as ThemeId)}
                className={`relative flex flex-col items-start p-3.5 rounded-2xl transition-all cursor-pointer text-left border ${
                  isSelected
                    ? 'bg-white/[0.08] border-white/20'
                    : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05] hover:border-white/10'
                }`}
              >
                {/* Color dots preview */}
                <div className="flex items-center gap-1.5 mb-2.5">
                  {theme.dots.map((color, idx) => (
                    <span
                      key={idx}
                      className="w-3.5 h-3.5 rounded-full border border-black/20"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>

                {/* Title */}
                <p className="font-bold text-xs text-white mb-0.5">{theme.name}</p>
                <p className="text-[11px] text-slate-400">{t(`theme_${theme.id}_sub`, theme.subtitle)}</p>

                {/* Active checkmark */}
                {isSelected && (
                  <div
                    className="absolute top-3 right-3 w-4 h-4 rounded-full flex items-center justify-center text-black"
                    style={{ backgroundColor: theme.accentColor }}
                  >
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Cursor Style Section */}
      <div className="flex flex-col gap-4 pt-4 border-t border-white/[0.08]">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <MousePointer className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
          <span>Kiểu con trỏ chuột (Cursor Style)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {cursorOptions.map((item) => {
            const isSelected = cursorStyle === item.id

            return (
              <button
                key={item.id}
                onClick={() => setCursorStyle(item.id)}
                className={`relative flex flex-col items-start p-3.5 rounded-2xl transition-all cursor-pointer text-left border ${
                  isSelected
                    ? 'bg-white/[0.08] border-white/20'
                    : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05] hover:border-white/10'
                }`}
              >
                {/* Cursor Preview Icon */}
                <div className="mb-2.5">
                  {item.id === 'lottie' && (
                    <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center shadow-[0_0_12px_rgba(6,182,212,0.35)]">
                      <MousePointer className="w-4 h-4 text-cyan-400 fill-cyan-400/20" />
                    </div>
                  )}

                  {item.id === 'virtual-singer' && (
                    <div className="w-8 h-8 rounded-xl bg-pink-500/15 border border-pink-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(236,72,153,0.3)]">
                      <img
                        src="/cursors/virtual-singer/static/Normal.png"
                        alt="VirtualSinger Cursor"
                        className="w-6 h-6 object-contain pointer-events-none select-none"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </div>
                  )}

                  {item.id === 'default' && (
                    <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
                      <MousePointer className="w-4 h-4 text-slate-300" />
                    </div>
                  )}
                </div>

                <p className="font-bold text-xs text-white mb-0.5">{item.name}</p>
                <p className="text-[11px] text-slate-400">{item.desc}</p>

                {isSelected && (
                  <div
                    className="absolute top-3 right-3 w-4 h-4 rounded-full flex items-center justify-center text-black"
                    style={{ backgroundColor: currentTheme.accentColor }}
                  >
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

