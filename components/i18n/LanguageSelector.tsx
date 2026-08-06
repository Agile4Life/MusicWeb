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

  return (
    <div ref={dropdownRef} className={`relative inline-block select-none ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-2.5 px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white transition-all backdrop-blur-xl active:scale-95 shadow-md ${
          isOpen ? 'border-[var(--spotify-glow,#22d3ee)]/50 shadow-[0_0_12px_var(--theme-glow-shadow)]' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          {variant === 'select' && <Globe className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)] shrink-0" />}
          <span className="text-base leading-none">{currentOption.flag}</span>
          <span>{currentOption.nativeName}</span>
          <span className="text-slate-400 font-normal">({currentOption.name})</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-[var(--spotify-glow,#22d3ee)]' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-[#0d1017]/98 backdrop-blur-2xl border border-white/10 shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 mb-1 flex items-center justify-between">
            <span>Ngôn ngữ / Language</span>
            <Globe className="w-3 h-3 text-[var(--primary-spotify,#06b6d4)]" />
          </div>

          <div className="flex flex-col gap-1">
            {options.map((opt) => {
              const isSelected = opt.code === language
              return (
                <button
                  key={opt.code}
                  type="button"
                  onClick={() => {
                    setLanguage(opt.code)
                    setIsOpen(false)
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                    isSelected
                      ? 'text-[var(--spotify-glow,#22d3ee)] bg-white/10 font-bold border border-white/10'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg leading-none">{opt.flag}</span>
                    <div className="flex flex-col items-start">
                      <span className="font-semibold">{opt.nativeName}</span>
                      <span className="text-[10px] text-slate-400 font-normal">{opt.name}</span>
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)] shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
