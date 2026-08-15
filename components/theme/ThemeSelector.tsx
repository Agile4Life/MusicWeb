'use client'

import React from 'react'
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
                    className={`px-3 py-2 rounded-xl text-left transition-all border text-xs cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-500/20 border-cyan-400/50 text-white font-bold'
                        : 'bg-white/[0.04] border-white/[0.06] text-slate-400 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <p className="text-[11px]">{m.name}</p>
                  </button>
                )
              })}
            </div>

            {/* Live Interactive Glass Refraction Preview */}
            <div className="relative overflow-hidden rounded-2xl p-4 border border-white/20 bg-black/40 min-h-[90px] flex items-center justify-between shadow-inner">
              {/* Colorful backdrop orbs so refraction is instantly visible */}
              <div className="absolute -left-4 -top-4 w-28 h-28 rounded-full bg-cyan-400/50 blur-xl animate-pulse pointer-events-none" />
              <div className="absolute right-8 -bottom-4 w-32 h-32 rounded-full bg-pink-500/40 blur-xl pointer-events-none" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full bg-indigo-500/40 blur-lg pointer-events-none" />

              {/* Refractive Glass Lens on top */}
              <div
                className="relative z-10 w-full flex items-center justify-between p-3 rounded-xl border border-white/30 transition-all duration-300"
                style={{
                  backdropFilter: `url(#liquid-glass-${liquidGlassConfig?.refractionMode || 'standard'}) blur(16px) saturate(190%)`,
                  WebkitBackdropFilter: `url(#liquid-glass-${liquidGlassConfig?.refractionMode || 'standard'}) blur(16px) saturate(190%)`,
                  boxShadow:
                    liquidGlassConfig?.refractionMode === 'prominent'
                      ? '0 12px 32px rgba(0,0,0,0.6), inset 0 1.5px 0 rgba(255,255,255,0.7), inset 0 -1px 0 rgba(34,211,238,0.4)'
                      : liquidGlassConfig?.refractionMode === 'polar'
                      ? '0 10px 28px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.5), 0 0 20px rgba(34,211,238,0.3)'
                      : liquidGlassConfig?.refractionMode === 'shader'
                      ? '0 10px 28px rgba(0,0,0,0.5), inset 0 1.5px 0 rgba(168,85,247,0.5)'
                      : '0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.4)',
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center border border-white/30 text-white shadow">
                    <Sparkles className="w-4 h-4 text-cyan-300" />
                  </div>
                  <div>
                    <p className="font-bold text-xs text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                      Xem trước khúc xạ kính: <span className="text-cyan-300 uppercase">{liquidGlassConfig?.refractionMode || 'standard'}</span>
                    </p>
                    <p className="text-[10px] text-slate-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                      {liquidGlassConfig?.refractionMode === 'prominent'
                        ? 'Khúc xạ vát cạnh sắc nét cao & phân tán sắc sai viền mạnh'
                        : liquidGlassConfig?.refractionMode === 'polar'
                        ? 'Khúc xạ thấu kính cong tròn đa chiều'
                        : liquidGlassConfig?.refractionMode === 'shader'
                        ? 'Khúc xạ sóng lỏng hữu cơ biến thiên mượt'
                        : 'Khúc xạ tiêu chuẩn trong trẻo mềm mại'}
                    </p>
                  </div>
                </div>

                <span className="px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider bg-white/20 text-white border border-white/40 shadow-sm shrink-0">
                  LIVE FX
                </span>
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


