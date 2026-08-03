'use client'

import React, { useState } from 'react'
import { ThemeSelector } from '@/components/theme/ThemeSelector'
import { Settings, Sliders, Volume2, HardDrive, ShieldCheck, Sparkles } from 'lucide-react'

export default function SettingsPage() {
  const [audioQuality, setAudioQuality] = useState('high')
  const [autoPlayNext, setAutoPlayNext] = useState(true)

  return (
    <div className="p-6 md:p-8 flex flex-col gap-8 max-w-6xl mx-auto w-full">
      {/* Settings Page Banner */}
      <div className="flex flex-col gap-2 border-b border-white/10 pb-6">
        <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--primary-spotify)]">
          <Settings className="w-4 h-4" />
          <span>Tùy chỉnh hệ thống</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">
          Cài Đặt & Cấu Hình
        </h1>
        <p className="text-xs md:text-sm text-slate-400">
          Quản lý chủ đề màu sắc giao diện, chất lượng âm thanh và cấu hình tính năng ứng dụng.
        </p>
      </div>

      {/* 🎨 Theme Selection Section */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl border border-white/10 shadow-xl">
        <ThemeSelector />
      </div>

      {/* 🎵 Audio & Playback Options */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl border border-white/10 shadow-xl flex flex-col gap-6">
        <div className="flex items-center gap-2 text-base font-bold text-white border-b border-white/5 pb-3">
          <Volume2 className="w-5 h-5 text-[var(--primary-spotify)]" />
          <span>Âm thanh & Phát nhạc</span>
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 py-2 border-b border-white/5">
          <div>
            <p className="text-sm font-bold text-white">Chất lượng phát nhạc</p>
            <p className="text-xs text-slate-400">Chọn bitrate phát nhạc ưu tiên từ Supabase Storage</p>
          </div>
          <select
            value={audioQuality}
            onChange={(e) => setAudioQuality(e.target.value)}
            className="glass-input rounded-xl px-4 py-2 text-xs font-semibold text-white outline-none cursor-pointer"
          >
            <option value="high" className="bg-[#12141d] text-white">Rất cao (320 kbps High-Res)</option>
            <option value="normal" className="bg-[#12141d] text-white">Tiêu chuẩn (160 kbps)</option>
            <option value="saver" className="bg-[#12141d] text-white">Tiết kiệm dữ liệu (96 kbps)</option>
          </select>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-bold text-white">Tự động phát bài tiếp theo</p>
            <p className="text-xs text-slate-400">Tự động chuyển bài kế tiếp khi phát hết danh sách</p>
          </div>
          <button
            onClick={() => setAutoPlayNext(!autoPlayNext)}
            className={`w-12 h-6 rounded-full p-1 transition-colors ${
              autoPlayNext ? 'bg-[var(--primary-spotify)]' : 'bg-white/20'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-black transition-transform ${
                autoPlayNext ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 💾 Storage & Limits */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl border border-white/10 shadow-xl flex flex-col gap-4">
        <div className="flex items-center gap-2 text-base font-bold text-white border-b border-white/5 pb-3">
          <HardDrive className="w-5 h-5 text-[var(--primary-spotify)]" />
          <span>Lưu trữ & Dung lượng Storage</span>
        </div>

        <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
          <span>Dung lượng đã sử dụng trong Bucket `music-files`</span>
          <span className="text-[var(--primary-spotify)] font-mono">Tối đa 50MB / File</span>
        </div>
      </div>

      {/* 🚀 Feature Extensibility Slot for Future Updates */}
      <div className="glass-panel p-6 md:p-8 rounded-3xl border border-dashed border-white/20 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span>Khu vực cập nhật tính năng mới</span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Nơi này đã sẵn sàng để bạn tiếp tục nâng cấp thêm các tính năng như: Lời bài hát đồng bộ (Lyrics), Chia sẻ Playlist công khai, Equalizer 10-band tùy chỉnh âm sắc...
        </p>
      </div>
    </div>
  )
}
