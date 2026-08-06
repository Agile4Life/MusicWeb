'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useLanguage } from './LanguageContext'
import { Language } from '@/lib/i18n'
import { Globe, ChevronDown, Check } from 'lucide-react'

interface LanguageSelectorProps {
  variant?: 'pill' | 'select' | 'dropdown'
  className?: string
}

const SVG_FLAGS: Record<Language, React.ReactNode> = {
  vi: (
    <svg className="w-5 h-3.5 rounded-sm object-cover shadow-sm shrink-0 border border-white/10" viewBox="0 0 30 20">
      <rect width="30" height="20" fill="#da251d" />
      <polygon fill="#ffff00" points="15,4 16.5,8.5 21.2,8.5 17.4,11.3 18.9,15.8 15,13 11.1,15.8 12.6,11.3 8.8,8.5 13.5,8.5" />
    </svg>
  ),
  en: (
    <svg className="w-5 h-3.5 rounded-sm object-cover shadow-sm shrink-0 border border-white/10" viewBox="0 0 60 30">
      <clipPath id="s"><path d="M0,0 v30 h60 v-30 z"/></clipPath>
      <clipPath id="t"><path d="M0,0 L60,30 M60,0 L0,30"/></clipPath>
      <g clipPath="url(#s)">
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6"/>
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#t)" stroke="#cc0000" strokeWidth="4"/>
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10"/>
        <path d="M30,0 v30 M0,15 h60" stroke="#cc0000" strokeWidth="6"/>
      </g>
    </svg>
  ),
  zh: (
    <svg className="w-5 h-3.5 rounded-sm object-cover shadow-sm shrink-0 border border-white/10" viewBox="0 0 30 20">
      <rect width="30" height="20" fill="#de2910" />
      <polygon fill="#ffde00" points="5,3 5.9,5.9 8.8,5.9 6.4,7.6 7.3,10.5 5,8.8 2.7,10.5 3.6,7.6 1.2,5.9 4.1,5.9" />
    </svg>
  ),
  ja: (
    <svg className="w-5 h-3.5 rounded-sm object-cover shadow-sm shrink-0 border border-white/20" viewBox="0 0 30 20">
      <rect width="30" height="20" fill="#ffffff" />
      <circle cx="15" cy="10" r="6" fill="#bc002d" />
    </svg>
  ),
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
        className={`flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-xs font-semibold text-white transition-all backdrop-blur-xl active:scale-95 shadow-md ${
          isOpen ? 'border-[var(--spotify-glow,#22d3ee)]/50 shadow-[0_0_12px_var(--theme-glow-shadow)]' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          {variant === 'select' && <Globe className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)] shrink-0" />}
          {SVG_FLAGS[currentOption.code]}
          <span>{currentOption.nativeName}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-[var(--spotify-glow,#22d3ee)]' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-[#0d1017]/98 backdrop-blur-2xl border border-white/10 shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 mb-1 flex items-center justify-between">
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
                    {SVG_FLAGS[opt.code]}
                    <div className="flex flex-col items-start leading-tight">
                      <span className="font-semibold">{opt.nativeName}</span>
                      {opt.name !== opt.nativeName && (
                        <span className="text-[10px] text-slate-400 font-normal">{opt.name}</span>
                      )}
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
