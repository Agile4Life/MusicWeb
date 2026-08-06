'use client'

import React from 'react'
import { useTheme, THEMES, ThemeId } from './ThemeContext'
import { Palette, Check } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageContext'

export function ThemeSelector() {
  const { currentTheme, setTheme } = useTheme()
  const { t } = useLanguage()

  return (
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
  )
}

