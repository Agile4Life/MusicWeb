'use client'

import React, { useEffect, useState } from 'react'
import { Share, PlusSquare, X } from 'lucide-react'
import { useTheme } from '@/components/theme/ThemeContext'
import {
  IOS_PWA_PROMPT_STORAGE_KEY,
  isStandaloneDisplayMode,
  shouldShowIOSInstallPrompt,
} from '@/lib/pwaManifestConfig'

export function IOSInstallPrompt() {
  const { themeStyle } = useTheme()
  const isMinimalFlat = themeStyle === 'minimal-flat'
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const dismissedValue = localStorage.getItem(IOS_PWA_PROMPT_STORAGE_KEY)
      const standalone = isStandaloneDisplayMode(window)
      const show = shouldShowIOSInstallPrompt({
        ua: window.navigator.userAgent,
        maxTouchPoints: window.navigator.maxTouchPoints,
        isStandalone: standalone,
        isDismissed: dismissedValue === 'true',
      })
      if (show) {
        const timer = window.setTimeout(() => setVisible(true), 1200)
        return () => window.clearTimeout(timer)
      }
    } catch {
      // Ignore storage access errors in private browsing
    }
  }, [])

  const handleDismiss = () => {
    setVisible(false)
    try {
      localStorage.setItem(IOS_PWA_PROMPT_STORAGE_KEY, 'true')
    } catch {
      // Ignore storage errors
    }
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="Hướng dẫn cài đặt ứng dụng iOS"
      className="lg:hidden fixed left-4 right-4 bottom-[calc(var(--bottom-nav-height,84px)+env(safe-area-inset-bottom,0px)+76px)] z-[45] select-none animate-in fade-in slide-in-from-bottom-3 duration-300"
    >
      <div
        className={`relative p-3.5 flex items-start gap-3 ${
          isMinimalFlat
            ? 'rounded-[16px] bg-[#1D1720] border border-[rgba(232,169,79,0.32)] shadow-[0_18px_42px_rgba(0,0,0,0.72)] text-[#F4ECE1]'
            : 'rounded-2xl bg-[#0f1420]/95 backdrop-blur-xl border border-white/15 shadow-2xl text-white'
        }`}
      >
        <div
          className={`w-10 h-10 shrink-0 flex items-center justify-center overflow-hidden ${
            isMinimalFlat
              ? 'rounded-[10px] bg-[#251E29] border border-[rgba(244,236,230,0.14)]'
              : 'rounded-xl bg-white/10 border border-white/15'
          }`}
        >
          <img
            src="/apple-touch-icon.png"
            alt="MusicWeb Icon"
            className="w-full h-full object-cover"
          />
        </div>

        <div className="flex-1 min-w-0 pr-5">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] font-mono uppercase tracking-[0.14em] ${
                isMinimalFlat ? 'text-[#E8A94F]' : 'text-cyan-400'
              }`}
            >
              iOS Web App
            </span>
          </div>
          <p
            className={`text-sm leading-snug mt-0.5 ${
              isMinimalFlat ? 'font-serif font-medium text-[#F4ECE1]' : 'font-bold text-white'
            }`}
          >
            Trải nghiệm toàn màn hình trên iPhone
          </p>
          <p
            className={`text-xs leading-relaxed mt-1 flex flex-wrap items-center gap-1 ${
              isMinimalFlat ? 'text-[#B9AC9C]' : 'text-slate-300'
            }`}
          >
            <span>Nhấn nút Chia sẻ</span>
            <span
              className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] ${
                isMinimalFlat
                  ? 'bg-[#251E29] text-[#E8A94F] border border-[rgba(244,236,230,0.1)]'
                  : 'bg-white/10 text-cyan-300'
              }`}
            >
              <Share className="w-3 h-3" />
            </span>
            <span>rồi chọn</span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${
                isMinimalFlat
                  ? 'bg-[#251E29] text-[#F4ECE1] border border-[rgba(244,236,230,0.1)]'
                  : 'bg-white/10 text-white'
              }`}
            >
              <PlusSquare className="w-3 h-3 text-[#E8A94F]" />
              <span>Thêm vào MH chính</span>
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Đóng hướng dẫn cài đặt"
          className={`absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
            isMinimalFlat
              ? 'text-[#8B8090] hover:text-[#F4ECE1] hover:bg-[#251E29]'
              : 'text-slate-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
