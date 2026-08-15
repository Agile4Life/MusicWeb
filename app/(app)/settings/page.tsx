'use client'

import React, { useState } from 'react'
import { ThemeSelector } from '@/components/theme/ThemeSelector'
import { LanguageSelector } from '@/components/i18n/LanguageSelector'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { getValidUserId } from '@/lib/accessControl'
import { Volume2, Globe, Bell, Mail, Sparkles } from 'lucide-react'

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

export default function SettingsPage() {
  const { t } = useLanguage()
  const supabase = createClient()
  const { userEmail } = useCurrentUser()
  const [autoPlayNext, setAutoPlayNext] = useState(true)

  React.useEffect(() => {
    if (!userEmail) return
    const userId = getValidUserId({ email: userEmail })
    supabase
      .from('user_settings')
      .select('auto_play')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data) {
          setAutoPlayNext(data.auto_play ?? true)
        }
      })
  }, [supabase, userEmail])

  const saveSettings = async (updates: { auto_play?: boolean }) => {
    if (!userEmail) return
    const userId = getValidUserId({ email: userEmail })
    await supabase.from('user_settings').upsert({
      user_id: userId,
      auto_play: updates.auto_play ?? autoPlayNext,
      updated_at: new Date().toISOString(),
    })
  }

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-4 sm:gap-6 lg:gap-8 max-w-5xl mx-auto w-full select-none pb-36 lg:pb-8">
      {/* Settings Header */}
      <div className="flex flex-col gap-1 border-b border-white/[0.05] pb-4">
        <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">{t('settings_title')}</h1>
        <p className="text-xs text-slate-400">
          {t('settings_desc')}
        </p>
      </div>

      {/* Theme Selection Section */}
      <div className="bg-[var(--elevation-1-bg)] p-4 sm:p-6 rounded-2xl border border-white/[0.06]">
        <ThemeSelector />
      </div>

      {/* Language Selection Section */}
      <div className="bg-[var(--elevation-1-bg)] p-6 rounded-2xl border border-white/[0.06] flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-white/[0.05] pb-3">
          <Globe className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
          <span>{t('language_title')}</span>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
          <div>
            <p className="text-xs font-bold text-white">{t('language_title')}</p>
            <p className="text-[11px] text-slate-400">{t('language_desc')}</p>
          </div>
          <LanguageSelector variant="select" />
        </div>
      </div>

      {/* Playback Options */}
      <div className="bg-[var(--elevation-1-bg)] p-6 rounded-2xl border border-white/[0.06] flex flex-col gap-5">
        <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-white/[0.05] pb-3">
          <Volume2 className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
          <span>{t('audio_playback_title')}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-xs font-bold text-white">{t('auto_play')}</p>
            <p className="text-[11px] text-slate-400">{t('auto_play_desc')}</p>
          </div>
          <button
            onClick={() => {
              const value = !autoPlayNext
              setAutoPlayNext(value)
              void saveSettings({ auto_play: value })
            }}
            className={`w-11 h-6 rounded-full p-1 transition-colors ${
              autoPlayNext ? 'bg-[var(--primary-spotify,#06b6d4)]' : 'bg-white/20'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-black transition-transform ${
                autoPlayNext ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 🔔 Notifications / Thông báo từ Tác giả */}
      <div className="bg-[var(--elevation-1-bg)] p-6 rounded-2xl border border-white/[0.06] flex flex-col gap-4 relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.05] pb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Bell className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
            <span>Notifications / Thông báo</span>
          </div>
          {checkIsAdmin(userEmail) && (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-400/40">
              Admin Mode
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3 pt-1">
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-medium">
            Trần Phong cảm ơn tất cả mọi người đã trải nghiệm web đầu tay của Phong, nếu có thắc mắc hay feedback và cần Phong thêm tính năng gì mọi người hãy liên hệ mình qua Instagram hoặc Facebook hoặc Gmail:
          </p>

          <div className="flex flex-wrap items-center gap-3.5 pt-1">
            {/* Facebook Icon Only */}
            <a
              href="https://www.facebook.com/phong.trancongtuan"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/20 hover:scale-110 transition-all shadow-lg"
              title="Facebook: phong.trancongtuan"
            >
              <FacebookIcon className="w-5 h-5 fill-current" />
            </a>

            {/* Instagram Icon Only */}
            <a
              href="https://www.instagram.com/phongtct/"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-pink-600/10 hover:bg-pink-600/20 text-pink-400 border border-pink-500/20 hover:scale-110 transition-all shadow-lg"
              title="Instagram: phongtct"
            >
              <InstagramIcon className="w-5 h-5" />
            </a>

            {/* Gmail Raw Text */}
            <a
              href="mailto:tranphong16012006@gmail.com"
              className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-300 border border-white/10 text-xs font-mono transition-all flex items-center gap-2 hover:border-cyan-500/30"
            >
              <Mail className="w-4 h-4 text-cyan-400" />
              <span>tranphong16012006@gmail.com</span>
            </a>
          </div>

          <div className="pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-white/[0.05] mt-1">
            <span className="text-[11px] text-slate-400">
              {checkIsAdmin(userEmail)
                ? 'Bạn có quyền Admin: Có thể chỉnh sửa nội dung và xuất bản thông báo cho toàn bộ người dùng'
                : 'Pop-up thông báo hiển thị ở giữa màn hình khi truy cập web'}
            </span>
            <div className="flex items-center gap-2">
              {checkIsAdmin(userEmail) && (
                <button
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent('musicweb:open-welcome-modal', { detail: { editMode: true } })
                    )
                  }}
                  className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-md shadow-cyan-500/20"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>✏️ Chỉnh sửa thông báo</span>
                </button>
              )}

              <button
                onClick={() => {
                  try {
                    localStorage.removeItem('musicweb_announcement_dismissed_v')
                    localStorage.removeItem('musicweb_hide_welcome_modal')
                  } catch {}
                  window.dispatchEvent(new CustomEvent('musicweb:open-welcome-modal'))
                }}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 border border-white/15 text-xs font-medium flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              >
                <span>Xem lại pop-up</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
