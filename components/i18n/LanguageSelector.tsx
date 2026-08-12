'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useLanguage } from './LanguageContext'
import { Language } from '@/lib/i18n'
import { Globe, ChevronDown, Check } from 'lucide-react'

interface LanguageSelectorProps {
  variant?: 'pill' | 'select' | 'dropdown' | 'flag-only'
  className?: string
}

const renderFlag = (code: Language, isRound = false) => {
  if (isRound) {
    switch (code) {
      case 'vi':
        return (
          <svg className="w-6 h-6 rounded-full shrink-0 border border-white/20 shadow-sm overflow-hidden block" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="12" fill="#da251d" />
            <polygon fill="#ffff00" points="12,5 13.4,9.3 17.9,9.3 14.3,11.9 15.7,16.2 12,13.5 8.3,16.2 9.7,11.9 6.1,9.3 10.6,9.3" />
          </svg>
        )
      case 'en':
        return (
          <svg className="w-6 h-6 rounded-full shrink-0 border border-white/20 shadow-sm overflow-hidden block" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="15" fill="#00247d" />
            <clipPath id="circle-clip-en">
              <circle cx="15" cy="15" r="15" />
            </clipPath>
            <g clipPath="url(#circle-clip-en)">
              <path d="M0,0 L30,30 M30,0 L0,30" stroke="#fff" strokeWidth="4"/>
              <path d="M0,0 L30,30 M30,0 L0,30" stroke="#cc0000" strokeWidth="2.5"/>
              <path d="M15,0 v30 M0,15 h30" stroke="#fff" strokeWidth="7"/>
              <path d="M15,0 v30 M0,15 h30" stroke="#cc0000" strokeWidth="4.5"/>
            </g>
          </svg>
        )
      case 'zh':
        return (
          <svg className="w-6 h-6 rounded-full shrink-0 border border-white/20 shadow-sm overflow-hidden block" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="12" fill="#de2910" />
            <polygon fill="#ffde00" points="7,5 7.9,7.9 10.8,7.9 8.4,9.6 9.3,12.5 7,10.8 4.7,12.5 5.6,9.6 3.2,7.9 6.1,7.9" />
          </svg>
        )
      case 'ja':
      default:
        return (
          <svg className="w-6 h-6 rounded-full shrink-0 border border-white/20 shadow-sm overflow-hidden block" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="12" fill="#ffffff" />
            <circle cx="12" cy="12" r="6" fill="#bc002d" />
          </svg>
        )
    }
  }

  switch (code) {
    case 'vi':
      return (
        <svg className="w-5 h-3.5 rounded-sm object-cover shadow-sm shrink-0 border border-white/10" viewBox="0 0 30 20">
          <rect width="30" height="20" fill="#da251d" />
          <polygon fill="#ffff00" points="15,4 16.5,8.5 21.2,8.5 17.4,11.3 18.9,15.8 15,13 11.1,15.8 12.6,11.3 8.8,8.5 13.5,8.5" />
        </svg>
      )
    case 'en':
      return (
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
      )
    case 'zh':
      return (
        <svg className="w-5 h-3.5 rounded-sm object-cover shadow-sm shrink-0 border border-white/10" viewBox="0 0 30 20">
          <rect width="30" height="20" fill="#de2910" />
          <polygon fill="#ffde00" points="5,3 5.9,5.9 8.8,5.9 6.4,7.6 7.3,10.5 5,8.8 2.7,10.5 3.6,7.6 1.2,5.9 4.1,5.9" />
        </svg>
      )
    case 'ja':
    default:
      return (
        <svg className="w-5 h-3.5 rounded-sm object-cover shadow-sm shrink-0 border border-white/20" viewBox="0 0 30 20">
          <rect width="30" height="20" fill="#ffffff" />
          <circle cx="15" cy="10" r="6" fill="#bc002d" />
        </svg>
      )
  }
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

  if (variant === 'flag-only') {
    return (
      <div ref={dropdownRef} className={`relative inline-block select-none ${className}`}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={`Ngôn ngữ: ${currentOption.nativeName}`}
          className="flex items-center justify-center p-0 bg-transparent border-0 outline-none cursor-pointer transition-all active:scale-95"
          title={currentOption.nativeName}
        >
          <span
            style={{
              display: 'inline-flex',
              borderRadius: '50%',
              boxShadow: isOpen
                ? '0 0 0 1.5px color-mix(in srgb, var(--spotify-glow, #22d3ee) 55%, transparent), 0 0 10px var(--theme-glow-shadow, rgba(34, 211, 238, 0.5))'
                : '0 0 0 1.5px color-mix(in srgb, var(--spotify-glow, #22d3ee) 30%, rgba(255,255,255,0.18)), 0 0 7px var(--theme-glow-shadow, rgba(34, 211, 238, 0.28))',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            {renderFlag(currentOption.code, true)}
          </span>
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-44 rounded-2xl bg-[#0e121c]/95 border border-white/10 shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl">
            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 mb-1 flex items-center justify-between">
              <span>Ngôn ngữ</span>
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
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-[var(--spotify-glow,#22d3ee)]/15 text-[var(--spotify-glow,#22d3ee)] font-bold'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {renderFlag(opt.code, false)}
                      <span>{opt.nativeName}</span>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[var(--spotify-glow,#22d3ee)]" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={dropdownRef} className={`relative inline-block select-none ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-xl bg-[var(--elevation-2-bg)] hover:bg-white/[0.14] border border-white/10 text-xs font-semibold text-white transition-all active:scale-95 shadow-md ${
          isOpen ? 'border-[var(--spotify-glow,#22d3ee)]/50 shadow-[0_0_12px_var(--theme-glow-shadow)]' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          {variant === 'select' && <Globe className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)] shrink-0" />}
          {renderFlag(currentOption.code, false)}
          <span>{currentOption.nativeName}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-[var(--spotify-glow,#22d3ee)]' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-[var(--elevation-3-bg)] border border-white/10 shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
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
                    {renderFlag(opt.code, false)}
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
