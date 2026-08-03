'use client'

import React from 'react'
import { useTheme, THEMES, ThemeId } from './ThemeContext'
import { Palette, Check } from 'lucide-react'

export function ThemeSelector() {
  const { currentTheme, setTheme } = useTheme()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-base font-bold text-white">
        <Palette className="w-5 h-5 text-[var(--primary-spotify)]" />
        <span>Chủ đề màu sắc</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
        {Object.values(THEMES).map((theme) => {
          const isSelected = currentTheme.id === theme.id

          return (
            <button
              key={theme.id}
              onClick={() => setTheme(theme.id as ThemeId)}
              className={`relative flex flex-col items-center justify-center p-4 rounded-2xl transition-all duration-200 cursor-pointer select-none text-center ${
                isSelected
                  ? 'bg-white/10 border-2 shadow-xl'
                  : 'bg-white/[0.03] border border-white/10 hover:bg-white/5 hover:border-white/20'
              }`}
              style={{
                borderColor: isSelected ? theme.accentColor : undefined,
                boxShadow: isSelected ? `0 0 20px ${theme.accentColor}33` : undefined,
              }}
            >
              {/* Color dots preview */}
              <div className="flex items-center gap-1.5 mb-3">
                {theme.dots.map((color, idx) => (
                  <span
                    key={idx}
                    className="w-3.5 h-3.5 rounded-full border border-black/20 shadow-sm"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>

              {/* Title & Icon */}
              <div className="flex items-center gap-1.5 font-extrabold text-sm text-white mb-0.5">
                <span>{theme.icon}</span>
                <span>{theme.name}</span>
              </div>

              {/* Subtitle */}
              <span className="text-[11px] font-medium text-slate-400">{theme.subtitle}</span>

              {/* Active checkmark badge */}
              {isSelected && (
                <div
                  className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-black shadow-md"
                  style={{ backgroundColor: theme.accentColor }}
                >
                  <Check className="w-3 h-3 stroke-[3]" />
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
