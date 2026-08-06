'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useLanguage } from './LanguageContext'
import { Globe, ChevronDown, Check } from 'lucide-react'

interface LanguageSelectorProps {
  variant?: 'pill' | 'select' | 'dropdown'
  className?: string
}

export function LanguageSelector({ variant = 'dropdown', className = '' }: LanguageSelectorProps) {
  const { language, setLanguage, options, currentOption } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (variant === 'select') {
    return (
      <div className={`relative flex items-center gap-2 ${className}`}>
        <Globe className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)] shrink-0" />
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as any)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-semibold text-white outline-none cursor-pointer hover:bg-white/10 transition-colors"
        >
          {options.map((opt) => (
            <option key={opt.code} value={opt.code} className="bg-[#12141d] text-white">
              {opt.flag} {opt.nativeName} ({opt.name})
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div ref={dropdownRef} className={`relative inline-block ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white transition-all backdrop-blur-md active:scale-95 shadow-sm"
      >
        <span className="text-sm">{currentOption.flag}</span>
        <span>{currentOption.nativeName}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-44 rounded-2xl bg-[#0d1017]/95 backdrop-blur-2xl border border-white/10 shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 mb-1">
            Ngôn ngữ / Language
          </div>

          {options.map((opt) => {
            const isSelected = opt.code === language
            return (
              <button
                key={opt.code}
                onClick={() => {
                  setLanguage(opt.code)
                  setIsOpen(false)
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium transition-colors ${
                  isSelected
                    ? 'text-[var(--spotify-glow,#22d3ee)] bg-white/10 font-bold'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base">{opt.flag}</span>
                  <span>{opt.nativeName}</span>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-[var(--spotify-glow,#22d3ee)]" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
