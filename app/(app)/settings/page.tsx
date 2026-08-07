'use client'

import React, { useState } from 'react'
import { ThemeSelector } from '@/components/theme/ThemeSelector'
import { LanguageSelector } from '@/components/i18n/LanguageSelector'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { createClient } from '@/lib/supabase/client'
import { Settings, Sliders, Volume2, HardDrive, ShieldCheck, Sparkles, Globe, Bell, Mail } from 'lucide-react'

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
  const [audioQuality, setAudioQuality] = useState('high')
  const [autoPlayNext, setAutoPlayNext] = useState(true)

  React.useEffect(() => {
    supabase.auth.getUser().then(async (result: { data: { user: { id: string } | null } }) => {
      const user = result.data.user
      if (!user) return
      const { data } = await supabase
        .from('user_settings')
        .select('audio_quality, auto_play')
        .eq('user_id', user.id)
        .maybeSingle()
      if (data) {
        setAudioQuality(data.audio_quality || 'high')
        setAutoPlayNext(data.auto_play ?? true)
      }
    })
  }, [supabase])

  const saveSettings = async (updates: { audio_quality?: string; auto_play?: boolean }) => {
    const result = await supabase.auth.getUser() as { data: { user: { id: string } | null } }
    const user = result.data.user
    if (!user) return
    await supabase.from('user_settings').upsert({
      user_id: user.id,
      audio_quality: updates.audio_quality ?? audioQuality,
      auto_play: updates.auto_play ?? autoPlayNext,
      updated_at: new Date().toISOString(),
    })
  }

  const audioOptions = [
    { value: 'high', label: t('audio_high') },
    { value: 'normal', label: t('audio_normal') },
    { value: 'saver', label: t('audio_saver') },
  ]

  return (
    <div className="p-3.5 sm:p-6 md:p-8 flex flex-col gap-4 sm:gap-6 md:gap-8 max-w-5xl mx-auto w-full select-none pb-36 md:pb-8">
      {/* Settings Header */}
      <div className="flex flex-col gap-1 border-b border-white/[0.05] pb-4">
        <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">{t('settings_title')}</h1>
        <p className="text-xs text-slate-400">
          {t('settings_desc')}
        </p>
      </div>

      {/* Theme Selection Section */}
      <div className="bg-[#0d1017] p-4 sm:p-6 rounded-2xl border border-white/[0.06]">
        <ThemeSelector />
      </div>

      {/* Language Selection Section */}
      <div className="bg-[#0d1017] p-6 rounded-2xl border border-white/[0.06] flex flex-col gap-4">
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

      {/* Audio & Playback Options */}
      <div className="bg-[#0d1017] p-6 rounded-2xl border border-white/[0.06] flex flex-col gap-5">
        <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-white/[0.05] pb-3">
          <Volume2 className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
          <span>{t('audio_playback_title')}</span>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-1 border-b border-white/[0.04]">
          <div>
            <p className="text-xs font-bold text-white">{t('audio_quality')}</p>
            <p className="text-[11px] text-slate-400">{t('audio_quality_desc')}</p>
          </div>
          <CustomSelect
            options={audioOptions}
            value={audioQuality}
            onChange={(val) => {
              setAudioQuality(val)
              void saveSettings({ audio_quality: val })
            }}
          />
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-xs font-bold text-white">Tự động phát bài tiếp theo</p>
            <p className="text-[11px] text-slate-400">Tự động phát bài kế tiếp khi hết danh sách</p>
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
      <div className="bg-[#0d1017] p-6 rounded-2xl border border-white/[0.06] flex flex-col gap-4 relative overflow-hidden">
        <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-white/[0.05] pb-3">
          <Bell className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
          <span>Notifications / Thông báo</span>
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
        </div>
      </div>
    </div>
  )
}
