'use client'

import React, { useState, useEffect } from 'react'
import { Bell, Mail, X, Check, Sparkles, ExternalLink } from 'lucide-react'

const STORAGE_KEY = 'musicweb_hide_welcome_modal'

function FacebookIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" {...props}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function InstagramIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  )
}

export function WelcomeAnnouncementModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const isHidden = localStorage.getItem(STORAGE_KEY) === 'true'
      if (!isHidden) {
        // Small timeout so initial page render is smooth before modal pops in
        const timer = setTimeout(() => {
          setIsOpen(true)
        }, 500)
        return () => clearTimeout(timer)
      }
    } catch {
      // LocalStorage might fail in private browsing
    }
  }, [])

  // Listen for custom open event (e.g. from Settings)
  useEffect(() => {
    const handleOpen = () => {
      setDontShowAgain(false)
      setIsOpen(true)
    }
    window.addEventListener('musicweb:open-welcome-modal', handleOpen)
    return () => {
      window.removeEventListener('musicweb:open-welcome-modal', handleOpen)
    }
  }, [])

  const handleClose = () => {
    try {
      if (dontShowAgain) {
        localStorage.setItem(STORAGE_KEY, 'true')
      }
    } catch {
      // ignore
    }
    setIsOpen(false)
  }

  if (!mounted || !isOpen) return null

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300 select-none">
      {/* Modal Container */}
      <div
        className="relative w-full max-w-lg bg-[var(--elevation-2-bg,#0e1322)] border border-white/15 rounded-3xl p-6 sm:p-7 shadow-2xl shadow-cyan-500/10 overflow-hidden flex flex-col gap-5 transform transition-all animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Background glow accents */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors z-10"
          aria-label="Đóng"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header with badge */}
        <div className="flex items-center gap-3 pr-8">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30 flex-shrink-0">
            <Bell className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-400 uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Thông báo từ Tác giả</span>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
              Chào mừng bạn đến với MusicWeb 🎵
            </h2>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex flex-col gap-4 text-xs sm:text-sm text-slate-300 leading-relaxed font-medium bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
          <p>
            <strong className="text-white font-semibold">Phong</strong> cảm ơn tất cả mọi người đã trải nghiệm web đầu tay của Phong! Nếu có thắc mắc, feedback đóng góp hoặc cần Phong bổ sung tính năng gì, mọi người hãy liên hệ trực tiếp với mình qua các kênh bên dưới nhé:
          </p>

          {/* Social Contact Links */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {/* Facebook */}
            <a
              href="https://www.facebook.com/phong.trancongtuan"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 border border-blue-500/30 hover:scale-[1.03] active:scale-95 transition-all text-xs font-semibold flex items-center gap-2 shadow-sm"
              title="Facebook: Trần Công Tuấn Phong"
            >
              <FacebookIcon className="w-4 h-4 fill-current" />
              <span>Facebook</span>
              <ExternalLink className="w-3 h-3 opacity-60 ml-0.5" />
            </a>

            {/* Instagram */}
            <a
              href="https://www.instagram.com/phongtct/"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-xl bg-pink-600/15 hover:bg-pink-600/25 text-pink-400 border border-pink-500/30 hover:scale-[1.03] active:scale-95 transition-all text-xs font-semibold flex items-center gap-2 shadow-sm"
              title="Instagram: @phongtct"
            >
              <InstagramIcon className="w-4 h-4" />
              <span>Instagram</span>
              <ExternalLink className="w-3 h-3 opacity-60 ml-0.5" />
            </a>

            {/* Gmail */}
            <a
              href="mailto:tranphong16012006@gmail.com"
              className="px-3.5 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:scale-[1.03] active:scale-95 text-xs font-mono transition-all flex items-center gap-2 shadow-sm w-full sm:w-auto"
              title="Gửi Email cho Trần Phong"
            >
              <Mail className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              <span className="truncate">tranphong16012006@gmail.com</span>
            </a>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-white/[0.07]">
          {/* Checkbox: Don't show again */}
          <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-400 hover:text-slate-200 transition-colors select-none py-1">
            <div
              onClick={() => setDontShowAgain(!dontShowAgain)}
              className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${dontShowAgain
                  ? 'bg-cyan-500 border-cyan-400 text-black font-bold shadow-sm shadow-cyan-500/50'
                  : 'border-white/30 bg-white/5 hover:border-white/50'
                }`}
            >
              {dontShowAgain && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
            <span onClick={() => setDontShowAgain(!dontShowAgain)}>Không hiển thị lại thông báo này</span>
          </label>

          {/* Primary CTA */}
          <button
            onClick={handleClose}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs sm:text-sm tracking-wide shadow-lg shadow-cyan-500/25 active:scale-[0.98] transition-all text-center cursor-pointer"
          >
            Đã hiểu & Bắt đầu
          </button>
        </div>
      </div>
    </div>
  )
}
export default WelcomeAnnouncementModal
