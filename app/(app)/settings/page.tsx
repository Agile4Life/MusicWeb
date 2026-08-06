'use client'

import React, { useState } from 'react'
import { ThemeSelector } from '@/components/theme/ThemeSelector'
import { LanguageSelector } from '@/components/i18n/LanguageSelector'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { createClient } from '@/lib/supabase/client'
import { Settings, Sliders, Volume2, HardDrive, ShieldCheck, Sparkles, Globe } from 'lucide-react'

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
    <div className="p-4 sm:p-6 md:p-8 flex flex-col gap-6 md:gap-8 max-w-5xl mx-auto w-full select-none pb-32 md:pb-8">
      {/* Settings Header */}
      <div className="flex flex-col gap-1 border-b border-white/[0.05] pb-4">
        <h1 className="text-2xl font-extrabold text-white tracking-tight">{t('settings_title')}</h1>
        <p className="text-xs text-slate-400">
          {t('settings_desc')}
        </p>
      </div>

      {/* Theme Selection Section */}
      <div className="bg-[#0d1017] p-6 rounded-2xl border border-white/[0.06]">
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
    </div>
  )
}

