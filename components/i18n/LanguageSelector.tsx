'use client'

import { useState, useRef, useEffect, useLayoutEffect, useId, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useLanguage } from './LanguageContext'
import { Language } from '@/lib/i18n'
import { Globe, ChevronDown, Check } from 'lucide-react'
import { popoverPanelProps } from '@/lib/motion'

interface LanguageSelectorProps {
  variant?: 'pill' | 'select' | 'dropdown' | 'flag-only'
  className?: string
}

const renderFlag = (code: Language, isRound = false, idPrefix = 'lang') => {
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
            <clipPath id={`${idPrefix}-circle-clip-en`}>
              <circle cx="15" cy="15" r="15" />
            </clipPath>
            <g clipPath={`url(#${idPrefix}-circle-clip-en)`}>
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
          <clipPath id={`${idPrefix}-s`}><path d="M0,0 v30 h60 v-30 z"/></clipPath>
          <clipPath id={`${idPrefix}-t`}><path d="M0,0 L60,30 M60,0 L0,30"/></clipPath>
          <g clipPath={`url(#${idPrefix}-s)`}>
            <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6"/>
            <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${idPrefix}-t)`} stroke="#cc0000" strokeWidth="4"/>
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
  const prefersReducedMotion = useReducedMotion()
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [menuCoords, setMenuCoords] = useState<{ top?: number; bottom?: number; right: number }>({
    top: 0,
    right: 16,
  })
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const rawId = useId()
  const idPrefix = rawId.replace(/:/g, '')

  useEffect(() => {
    setMounted(true)
  }, [])

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const estimatedMenuHeight = variant === 'flag-only' ? 190 : 230
    const spaceBelow = window.innerHeight - rect.bottom
    const openUpward = spaceBelow < estimatedMenuHeight && rect.top > estimatedMenuHeight
    const right = Math.max(8, window.innerWidth - rect.right)
    if (openUpward) {
      setMenuCoords({ bottom: window.innerHeight - rect.top + 8, right })
    } else {
      setMenuCoords({ top: rect.bottom + 8, right })
    }
  }, [variant])

  const handleToggleMenu = () => {
    if (!isOpen) {
      updatePosition()
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }

  useLayoutEffect(() => {
    if (!isOpen) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [isOpen, updatePosition])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
      ) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    const handleScroll = (event: Event) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) {
        return
      }
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [isOpen])

  const renderPortalMenu = () => {
    if (!mounted || typeof document === 'undefined') return null
    const isFlagOnly = variant === 'flag-only'
    const openUpward = menuCoords.bottom !== undefined
    return createPortal(
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="language-selector-menu"
            ref={menuRef}
            {...popoverPanelProps(prefersReducedMotion, openUpward ? 'up' : 'down')}
            style={{
              position: 'fixed',
              top: menuCoords.top !== undefined ? `${menuCoords.top}px` : undefined,
              bottom: menuCoords.bottom !== undefined ? `${menuCoords.bottom}px` : undefined,
              right: `${menuCoords.right}px`,
              transformOrigin: openUpward ? 'bottom right' : 'top right',
            }}
            className={`${
              isFlagOnly ? 'w-44 bg-[#0e121c]/95 backdrop-blur-xl' : 'w-48 bg-[var(--elevation-3-bg)]'
            } rounded-2xl border border-white/10 shadow-2xl p-1.5 z-[90] select-none`}
          >
            <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 mb-1 flex items-center justify-between">
              <span>{isFlagOnly ? 'Ngôn ngữ' : 'Ngôn ngữ / Language'}</span>
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
                    className={`w-full flex items-center justify-between px-3 ${
                      isFlagOnly ? 'py-1.5' : 'py-2'
                    } rounded-xl text-xs font-medium active:scale-[0.98] transition-[transform,background-color,color,border-color] duration-150 ease-[var(--ease-out)] cursor-pointer ${
                      isSelected
                        ? isFlagOnly
                          ? 'bg-[var(--spotify-glow,#22d3ee)]/15 text-[var(--spotify-glow,#22d3ee)] font-bold'
                          : 'text-[var(--spotify-glow,#22d3ee)] bg-white/10 font-bold border border-white/10'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className={`flex items-center ${isFlagOnly ? 'gap-2' : 'gap-2.5'}`}>
                      {renderFlag(opt.code, false, `${idPrefix}-opt-${opt.code}`)}
                      {isFlagOnly ? (
                        <span>{opt.nativeName}</span>
                      ) : (
                        <div className="flex flex-col items-start leading-tight">
                          <span className="font-semibold">{opt.nativeName}</span>
                          {opt.name !== opt.nativeName && (
                            <span className="text-[10px] text-slate-400 font-normal">{opt.name}</span>
                          )}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <Check
                        className={`${
                          isFlagOnly ? 'w-3.5 h-3.5' : 'w-4 h-4 shrink-0'
                        } text-[var(--spotify-glow,#22d3ee)]`}
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    )
  }

  if (variant === 'flag-only') {
    return (
      <div ref={dropdownRef} className={`relative inline-block select-none ${className}`}>
        <button
          ref={triggerRef}
          type="button"
          onClick={handleToggleMenu}
          aria-expanded={isOpen}
          aria-label={`Ngôn ngữ: ${currentOption.nativeName}`}
          className="flex items-center justify-center p-0 rounded-full bg-transparent border-0 outline-none cursor-pointer transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
          title={currentOption.nativeName}
        >
          <span
            style={{
              display: 'inline-flex',
              borderRadius: '50%',
              boxShadow: isOpen
                ? '0 0 0 1.5px color-mix(in srgb, var(--spotify-glow, #22d3ee) 55%, transparent), 0 0 10px var(--theme-glow-shadow, rgba(34, 211, 238, 0.5))'
                : '0 0 0 1.5px color-mix(in srgb, var(--spotify-glow, #22d3ee) 30%, rgba(255,255,255,0.18)), 0 0 7px var(--theme-glow-shadow, rgba(34, 211, 238, 0.28))',
              transition: 'box-shadow 180ms var(--ease-out)',
            }}
          >
            {renderFlag(currentOption.code, true, `${idPrefix}-trigger`)}
          </span>
        </button>

        {renderPortalMenu()}
      </div>
    )
  }

  return (
    <div ref={dropdownRef} className={`relative inline-block select-none ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggleMenu}
        aria-expanded={isOpen}
        aria-label={`Ngôn ngữ: ${currentOption.nativeName}`}
        className={`flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-xl bg-[var(--elevation-2-bg)] hover:bg-white/[0.14] border border-white/10 text-xs font-semibold text-white transition-[transform,background-color,border-color,box-shadow] duration-150 ease-[var(--ease-out)] active:scale-[0.97] shadow-md cursor-pointer ${
          isOpen ? 'border-[var(--spotify-glow,#22d3ee)]/50 shadow-[0_0_12px_var(--theme-glow-shadow)]' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          {variant === 'select' && <Globe className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)] shrink-0" />}
          {renderFlag(currentOption.code, false, `${idPrefix}-trigger`)}
          <span>{currentOption.nativeName}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ease-[var(--ease-out)] ${
            isOpen ? 'rotate-180 text-[var(--spotify-glow,#22d3ee)]' : ''
          }`}
        />
      </button>

      {renderPortalMenu()}
    </div>
  )
}
