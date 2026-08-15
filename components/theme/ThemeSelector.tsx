'use client'

import React, { useState } from 'react'
import { useTheme, THEMES, ThemeId, ThemeStyle } from './ThemeContext'
import { Palette, Check, MousePointer, Sparkles, Sliders, Eye, Waves } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { CURSOR_CONFIGS } from '@/lib/cursors'
import { RefractionMode } from '@/lib/theme/liquidGlassFilters'

export function ThemeSelector() {
  const {
    currentTheme,
    setTheme,
    cursorStyle,
    setCursorStyle,
    themeStyle,
    setThemeStyle,
    liquidGlassConfig,
    setLiquidGlassConfig,
  } = useTheme()
  const { t } = useLanguage()

  const refractionModes: { id: RefractionMode; name: string; desc: string }[] = [
    { id: 'standard', name: 'Standard (Mượt mà)', desc: 'Khúc xạ tự nhiên dịu mắt' },
    { id: 'polar', name: 'Polar (Tỏa tròn)', desc: 'Khúc xạ đối xứng tâm' },
    { id: 'prominent', name: 'Prominent (Sắc nét)', desc: 'Độ bẻ cong viền mạnh mẽ' },
    { id: 'shader', name: 'Shader SDF (Chất lỏng)', desc: 'Hiệu ứng sóng lỏng procedural' },
  ]

  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0, rotateX: 0, rotateY: 0 })
  const [isPreviewHovered, setIsPreviewHovered] = useState(false)

  const handlePreviewMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (liquidGlassConfig?.elasticInteraction === false) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    setPreviewOffset({
      x: x * 18,
      y: y * 18,
      rotateX: -y * 16,
      rotateY: x * 16,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Interface Style Engine (Liquid Glass vs Classic Dark) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Sparkles className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
          <span>Phong Cách Giao Diện (Interface Style Engine)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Liquid Glass Option */}
          <button
            onClick={() => setThemeStyle('liquid-glass')}
            style={
              themeStyle === 'liquid-glass'
                ? {
                    boxShadow: 'var(--shadow-2), 0 0 0 2px var(--primary-spotify, #06b6d4)',
                    transform: 'scale(1.02)',
                  }
                : undefined
            }
            className={`relative flex items-center gap-3.5 p-4 rounded-2xl transition-all cursor-pointer text-left border ${
              themeStyle === 'liquid-glass'
                ? 'border-transparent shadow-lg bg-gradient-to-br from-white/[0.12] to-white/[0.04] backdrop-blur-xl'
                : 'border-white/[0.06] bg-[var(--elevation-2-bg)] hover:bg-white/[0.06] hover:border-white/15'
            }`}
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400/30 via-indigo-500/20 to-pink-500/30 border border-white/30 flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.3)]">
              <Waves className="w-5 h-5 text-cyan-300 animate-pulse" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <p className="font-bold text-xs text-white">Liquid Glass (Apple VisionOS)</p>
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold bg-cyan-400/20 text-cyan-300 border border-cyan-400/30">
                  NEW
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Khúc xạ quang học, sắc sai viền & nền cực quang sống động</p>
            </div>
            {themeStyle === 'liquid-glass' && (
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center text-black"
                style={{ backgroundColor: currentTheme.accentColor }}
              >
                <Check className="w-2.5 h-2.5 stroke-[3]" />
              </div>
            )}
          </button>

          {/* Classic Dark Option */}
          <button
            onClick={() => setThemeStyle('classic')}
            style={
              themeStyle === 'classic'
                ? {
                    boxShadow: 'var(--shadow-2), 0 0 0 2px var(--primary-spotify, #06b6d4)',
                    transform: 'scale(1.02)',
                  }
                : undefined
            }
            className={`relative flex items-center gap-3.5 p-4 rounded-2xl transition-all cursor-pointer text-left border ${
              themeStyle === 'classic'
                ? 'border-transparent shadow-lg bg-[var(--elevation-2-bg)]'
                : 'border-white/[0.06] bg-[var(--elevation-2-bg)] hover:bg-white/[0.06] hover:border-white/15'
            }`}
          >
            <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center">
              <Sliders className="w-5 h-5 text-slate-300" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-xs text-white">Classic Dark (Nguyên Bản)</p>
              <p className="text-[11px] text-slate-400">Giao diện tối phẳng chuẩn Spotify & độ tương phản cao</p>
            </div>
            {themeStyle === 'classic' && (
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center text-black"
                style={{ backgroundColor: currentTheme.accentColor }}
              >
                <Check className="w-2.5 h-2.5 stroke-[3]" />
              </div>
            )}
          </button>
        </div>

        {/* Liquid Glass Fine-tuning options */}
        {themeStyle === 'liquid-glass' && (
          <div className="flex flex-col gap-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] mt-1">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-cyan-400" />
                Kiểu Khúc Xạ Thủy Tinh (Refraction Mode):
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {refractionModes.map((m) => {
                const isSelected = (liquidGlassConfig?.refractionMode || 'standard') === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => setLiquidGlassConfig({ refractionMode: m.id })}
                    className={`relative p-2.5 rounded-xl text-left transition-all border text-xs cursor-pointer flex flex-col gap-1 select-none ${
                      isSelected
                        ? 'bg-cyan-500/25 border-cyan-400 text-white font-bold shadow-[0_0_16px_rgba(6,182,212,0.35)] scale-[1.02]'
                        : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[11px] font-semibold">{m.name}</span>
                      {isSelected && (
                        <div className="w-3.5 h-3.5 rounded-full bg-cyan-400 text-black flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] text-slate-400 font-normal">
                      {m.id === 'prominent'
                        ? 'Vát cạnh & Tách màu'
                        : m.id === 'polar'
                        ? 'Thấu kính cong'
                        : m.id === 'shader'
                        ? 'Sóng lỏng biến thiên'
                        : 'Thủy tinh trong trẻo'}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Live Interactive Glass Refraction Preview */}
            <div
              onMouseMove={handlePreviewMouseMove}
              onMouseEnter={() => setIsPreviewHovered(true)}
              onMouseLeave={() => {
                setIsPreviewHovered(false)
                setPreviewOffset({ x: 0, y: 0, rotateX: 0, rotateY: 0 })
              }}
              className="relative overflow-hidden rounded-2xl p-4 border border-white/20 bg-black/60 min-h-[96px] flex items-center justify-between shadow-inner cursor-pointer"
            >
              {/* Colorful backdrop orbs so refraction is instantly visible */}
              <div
                className={`absolute -left-4 -top-4 w-32 h-32 rounded-full blur-xl pointer-events-none transition-all duration-500 ${
                  liquidGlassConfig?.refractionMode === 'prominent'
                    ? 'bg-rose-500/70 scale-125'
                    : liquidGlassConfig?.refractionMode === 'shader'
                    ? 'bg-purple-500/70 scale-120 animate-pulse'
                    : liquidGlassConfig?.refractionMode === 'polar'
                    ? 'bg-cyan-400/70 scale-110'
                    : 'bg-cyan-400/40'
                }`}
              />
              <div
                className={`absolute right-6 -bottom-4 w-36 h-36 rounded-full blur-xl pointer-events-none transition-all duration-500 ${
                  liquidGlassConfig?.refractionMode === 'prominent'
                    ? 'bg-cyan-400/70 scale-125'
                    : liquidGlassConfig?.refractionMode === 'shader'
                    ? 'bg-pink-500/70 scale-120'
                    : liquidGlassConfig?.refractionMode === 'polar'
                    ? 'bg-indigo-500/70'
                    : 'bg-purple-500/40'
                }`}
              />

              {/* Refractive Glass Lens on top with Spring Elastic Physics */}
              <div
                className={`relative z-10 w-full flex items-center justify-between p-3.5 rounded-xl border ${
                  liquidGlassConfig?.refractionMode === 'prominent'
                    ? 'border-t-white/90 border-l-rose-500/70 border-r-cyan-400/70 border-b-white/20 bg-white/[0.14] shadow-[0_16px_40px_rgba(0,0,0,0.8),inset_0_2px_0_rgba(255,255,255,0.9),inset_2px_0_0_rgba(244,63,94,0.5),inset_-2px_0_0_rgba(6,182,212,0.5)]'
                    : liquidGlassConfig?.refractionMode === 'polar'
                    ? 'border-cyan-400/60 bg-radial-gradient bg-white/[0.12] shadow-[0_14px_36px_rgba(0,0,0,0.7),inset_0_2px_1px_rgba(255,255,255,0.7),0_0_25px_rgba(34,211,238,0.35)]'
                    : liquidGlassConfig?.refractionMode === 'shader'
                    ? 'border-purple-400/60 bg-gradient-to-r from-purple-500/20 via-cyan-500/20 to-pink-500/20 shadow-[0_14px_36px_rgba(0,0,0,0.7),inset_0_2px_0.5px_rgba(255,255,255,0.8),0_0_25px_rgba(168,85,247,0.35)]'
                    : 'border-white/30 bg-white/[0.08] shadow-[0_10px_28px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.5)]'
                }`}
                style={{
                  backdropFilter: 'blur(24px) saturate(200%)',
                  WebkitBackdropFilter: 'blur(24px) saturate(200%)',
                  transform:
                    isPreviewHovered && liquidGlassConfig?.elasticInteraction !== false
                      ? `perspective(700px) rotateX(${previewOffset.rotateX}deg) rotateY(${previewOffset.rotateY}deg) translate3d(${previewOffset.x}px, ${previewOffset.y}px, 0) scale3d(1.02, 1.02, 1.02)`
                      : 'perspective(700px) rotateX(0deg) rotateY(0deg) translate3d(0,0,0) scale3d(1, 1, 1)',
                  transition: isPreviewHovered
                    ? 'transform 0.08s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease'
                    : 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-md border transition-all duration-300 ${
                      liquidGlassConfig?.refractionMode === 'prominent'
                        ? 'bg-gradient-to-br from-rose-500 to-cyan-500 border-white/40 shadow-rose-500/30'
                        : liquidGlassConfig?.refractionMode === 'polar'
                        ? 'bg-cyan-500 border-cyan-300 shadow-cyan-500/40'
                        : liquidGlassConfig?.refractionMode === 'shader'
                        ? 'bg-gradient-to-br from-purple-500 to-pink-500 border-purple-300 shadow-purple-500/40'
                        : 'bg-white/20 border-white/30'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-black text-xs text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] tracking-wide">
                        KIỂU KHÚC XẠ: <span className="text-cyan-300 uppercase">{liquidGlassConfig?.refractionMode || 'standard'}</span>
                      </p>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-cyan-400/20 text-cyan-300 border border-cyan-400/40">
                        Đang áp dụng
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] mt-0.5">
                      {liquidGlassConfig?.refractionMode === 'prominent'
                        ? '💎 Vát cạnh tinh thể 3D + Sắc sai quang phổ RGB (Đỏ/Lam)'
                        : liquidGlassConfig?.refractionMode === 'polar'
                        ? '🎯 Thấu kính cong tròn đa chiều + Quầng sáng hội tụ'
                        : liquidGlassConfig?.refractionMode === 'shader'
                        ? '🌊 Sóng lỏng hữu cơ biến thiên + Ánh sáng cực quang di chuyển'
                        : '✨ Khúc xạ tiêu chuẩn trong trẻo mềm mại (VisionOS Glass)'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-white/[0.06] text-xs text-slate-300">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={liquidGlassConfig?.chromaticAberration !== false}
                  onChange={(e) => setLiquidGlassConfig({ chromaticAberration: e.target.checked })}
                  className="rounded accent-cyan-400"
                />
                <span>Sắc sai viền kính (Aberration)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={liquidGlassConfig?.elasticInteraction !== false}
                  onChange={(e) => setLiquidGlassConfig({ elasticInteraction: e.target.checked })}
                  className="rounded accent-cyan-400"
                />
                <span>Tương tác đàn hồi (Elastic Motion)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={liquidGlassConfig?.ambientCanvas !== false}
                  onChange={(e) => setLiquidGlassConfig({ ambientCanvas: e.target.checked })}
                  className="rounded accent-cyan-400"
                />
                <span>Nền cực quang động (Ambient Mesh)</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Color Themes Section */}
      <div className="flex flex-col gap-4 pt-4 border-t border-white/[0.08]">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Palette className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
          <span>{t('color_theme')}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Object.values(THEMES).map((theme) => {
            const isSelected = currentTheme.id === theme.id

            return (
              <button
                key={theme.id}
                onClick={() => setTheme(theme.id as ThemeId)}
                style={
                  isSelected
                    ? {
                        boxShadow: 'var(--shadow-2), 0 0 0 2px var(--primary-spotify, #06b6d4)',
                        transform: 'scale(1.02)',
                      }
                    : undefined
                }
                className={`relative flex flex-col items-start p-3.5 rounded-2xl transition-all cursor-pointer text-left border bg-[var(--elevation-2-bg)] ${
                  isSelected
                    ? 'border-transparent shadow-lg z-10 font-semibold'
                    : 'border-white/[0.06] shadow-[var(--shadow-1)] hover:bg-white/[0.06] hover:border-white/15 hover:-translate-y-0.5'
                }`}
              >
                {/* Color dots preview */}
                <div className="flex items-center gap-1.5 mb-2.5">
                  {theme.dots.map((color, idx) => (
                    <span
                      key={idx}
                      className="w-3.5 h-3.5 rounded-full border border-black/20"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>

                {/* Title */}
                <p className="font-bold text-xs text-white mb-0.5">{theme.name}</p>
                <p className="text-[11px] text-slate-400">{t(`theme_${theme.id}_sub`, theme.subtitle)}</p>

                {/* Active checkmark */}
                {isSelected && (
                  <div
                    className="absolute top-3 right-3 w-4 h-4 rounded-full flex items-center justify-center text-black"
                    style={{ backgroundColor: theme.accentColor }}
                  >
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Cursor Style Section */}
      <div className="flex flex-col gap-4 pt-4 border-t border-white/[0.08]">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <MousePointer className="w-4 h-4 text-[var(--primary-spotify,#06b6d4)]" />
          <span>Kiểu con trỏ chuột (Cursor Style)</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {CURSOR_CONFIGS.map((item) => {
            const isSelected = cursorStyle === item.id

            return (
              <button
                key={item.id}
                onClick={() => setCursorStyle(item.id)}
                style={
                  isSelected
                    ? {
                        boxShadow: 'var(--shadow-2), 0 0 0 2px var(--primary-spotify, #06b6d4)',
                        transform: 'scale(1.02)',
                      }
                    : undefined
                }
                className={`relative flex flex-col items-start p-3.5 rounded-2xl transition-all cursor-pointer text-left border bg-[var(--elevation-2-bg)] ${
                  isSelected
                    ? 'border-transparent shadow-lg z-10 font-semibold'
                    : 'border-white/[0.06] shadow-[var(--shadow-1)] hover:bg-white/[0.06] hover:border-white/15 hover:-translate-y-0.5'
                }`}
              >
                {/* Cursor Preview Icon */}
                <div className="mb-2.5">
                  {item.id === 'lottie' ? (
                    <div className={`w-8 h-8 rounded-xl ${item.bgClass} border ${item.borderClass} flex items-center justify-center ${item.shadowClass}`}>
                      <MousePointer className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)] fill-[var(--spotify-glow,#22d3ee)]/20" />
                    </div>
                  ) : item.id === 'default' ? (
                    <div className={`w-8 h-8 rounded-xl ${item.bgClass} border ${item.borderClass} flex items-center justify-center`}>
                      <MousePointer className="w-4 h-4 text-slate-300" />
                    </div>
                  ) : (
                    <div className={`w-8 h-8 rounded-xl ${item.bgClass} border ${item.borderClass} flex items-center justify-center ${item.shadowClass}`}>
                      <img
                        src={`/cursors/${item.id}/static/Normal.png`}
                        alt={`${item.name} Cursor`}
                        className="w-6 h-6 object-contain pointer-events-none select-none"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </div>
                  )}
                </div>

                <p className="font-bold text-xs text-white mb-0.5">{item.name}</p>
                <p className="text-[11px] text-slate-400">{item.desc}</p>

                {isSelected && (
                  <div
                    className="absolute top-3 right-3 w-4 h-4 rounded-full flex items-center justify-center text-black"
                    style={{ backgroundColor: currentTheme.accentColor }}
                  >
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}


