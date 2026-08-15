'use client'

import React, { useState, useEffect } from 'react'
import {
  Bell,
  Mail,
  X,
  Check,
  Sparkles,
  ExternalLink,
  Pencil,
  Save,
  RotateCcw,
  Eye,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { AnnouncementData, DEFAULT_ANNOUNCEMENT } from '@/lib/announcement'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { isAdmin as checkIsAdmin } from '@/lib/accessControl'
import { toast } from '@/components/ui/ToastContext'

const STORAGE_DISMISSED_VERSION = 'musicweb_announcement_dismissed_v'

function FacebookIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" {...props}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function InstagramIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  )
}

export function WelcomeAnnouncementModal() {
  const { userEmail } = useCurrentUser()
  const isAdmin = checkIsAdmin(userEmail)

  const [isOpen, setIsOpen] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [announcement, setAnnouncement] = useState<AnnouncementData>(DEFAULT_ANNOUNCEMENT)

  // Editor Mode State (Admin only)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState<AnnouncementData>(DEFAULT_ANNOUNCEMENT)

  // 1. Fetch latest announcement from server on mount
  useEffect(() => {
    setMounted(true)

    fetch('/api/announcement')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.success && json.data) {
          setAnnouncement(json.data)
          setFormData(json.data)

          // Check if disabled by Admin
          if (json.data.is_enabled === false) {
            return
          }

          // Check if user already dismissed this specific version
          const dismissedVer = localStorage.getItem(STORAGE_DISMISSED_VERSION)
          const currentVer = String(json.data.version || 1)

          if (dismissedVer !== currentVer) {
            const timer = setTimeout(() => {
              setIsOpen(true)
            }, 600)
            return () => clearTimeout(timer)
          }
        } else {
          // Fallback check
          const dismissedLegacy = localStorage.getItem('musicweb_hide_welcome_modal') === 'true'
          if (!dismissedLegacy) {
            const timer = setTimeout(() => {
              setIsOpen(true)
            }, 600)
            return () => clearTimeout(timer)
          }
        }
      })
      .catch(() => {
        const dismissedLegacy = localStorage.getItem('musicweb_hide_welcome_modal') === 'true'
        if (!dismissedLegacy) {
          const timer = setTimeout(() => {
            setIsOpen(true)
          }, 600)
          return () => clearTimeout(timer)
        }
      })
  }, [])

  // Listen for custom open event (from Settings or Admin)
  useEffect(() => {
    const handleOpen = (e: any) => {
      setDontShowAgain(false)
      setIsOpen(true)
      if (e?.detail?.editMode && isAdmin) {
        setIsEditing(true)
      }
    }
    window.addEventListener('musicweb:open-welcome-modal', handleOpen)
    return () => {
      window.removeEventListener('musicweb:open-welcome-modal', handleOpen)
    }
  }, [isAdmin])

  const handleClose = () => {
    try {
      if (dontShowAgain) {
        const ver = String(announcement.version || 1)
        localStorage.setItem(STORAGE_DISMISSED_VERSION, ver)
        localStorage.setItem('musicweb_hide_welcome_modal', 'true')
      }
    } catch {
      // ignore
    }
    setIsEditing(false)
    setIsOpen(false)
  }

  const handleStartEdit = () => {
    setFormData(announcement)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setFormData(announcement)
    setIsEditing(false)
  }

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAdmin || !userEmail) {
      toast('Chỉ tài khoản Admin mới có quyền lưu thông báo!', 'error')
      return
    }

    if (!formData.title.trim()) {
      toast('Vui lòng nhập tiêu đề thông báo!', 'error')
      return
    }
    if (!formData.content.trim()) {
      toast('Vui lòng nhập nội dung thông báo!', 'error')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/announcement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': userEmail,
        },
        body: JSON.stringify({
          ...formData,
          senderEmail: userEmail,
        }),
      })

      const json = await res.json()
      if (res.ok && json.success && json.data) {
        setAnnouncement(json.data)
        setFormData(json.data)
        setIsEditing(false)
        toast('Đã lưu và xuất bản thông báo thành công!', 'success', json.data.title)
      } else {
        toast(json?.error || 'Lỗi khi lưu thông báo', 'error')
      }
    } catch (err: any) {
      toast('Không thể kết nối đến máy chủ', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  if (!mounted || !isOpen) return null

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300 select-none">
      {/* Modal Container */}
      <div
        className="relative w-full max-w-xl bg-[var(--elevation-2-bg,#0e1322)] border border-white/15 rounded-3xl p-5 sm:p-7 shadow-2xl shadow-cyan-500/10 overflow-hidden flex flex-col gap-4 sm:gap-5 transform transition-all animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
      >
        {/* Background glow accents */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header Actions (Admin Edit Toggle & Close) */}
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30 flex-shrink-0">
              <Bell className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-400 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isEditing ? 'Trình chỉnh sửa thông báo' : announcement.badge || 'Thông báo từ Tác giả'}</span>
              </div>
              <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                {isEditing ? 'Chỉnh Sửa Thông Báo (Admin)' : announcement.title}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {isAdmin && !isEditing && (
              <button
                onClick={handleStartEdit}
                className="px-2.5 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 hover:border-cyan-400 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm"
                title="Chỉnh sửa nội dung thông báo này"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sửa</span>
              </button>
            )}

            <button
              onClick={handleClose}
              className="p-1.5 sm:p-2 rounded-full text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* --- EDIT MODE (Admin Only) --- */}
        {isEditing ? (
          <form onSubmit={handleSaveAnnouncement} className="flex flex-col gap-3.5 text-xs text-slate-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-300">Nhãn tag trên đầu:</label>
                <input
                  type="text"
                  value={formData.badge}
                  onChange={(e) => setFormData({ ...formData, badge: e.target.value })}
                  placeholder="VD: Thông báo từ Tác giả, Cập nhật mới..."
                  className="bg-white/5 border border-white/15 focus:border-cyan-400 rounded-xl px-3 py-2 text-white outline-none transition-all"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-300">Chữ nút hành động (CTA):</label>
                <input
                  type="text"
                  value={formData.cta_text || ''}
                  onChange={(e) => setFormData({ ...formData, cta_text: e.target.value })}
                  placeholder="VD: Đã hiểu & Bắt đầu, Xem ngay..."
                  className="bg-white/5 border border-white/15 focus:border-cyan-400 rounded-xl px-3 py-2 text-white outline-none transition-all"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-300">Tiêu đề thông báo:</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="VD: Chào mừng bạn đến với MusicWeb 🎵"
                className="bg-white/5 border border-white/15 focus:border-cyan-400 rounded-xl px-3 py-2 text-white font-bold outline-none transition-all"
                required
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-slate-300">Nội dung thông báo:</label>
              <textarea
                rows={4}
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Nhập nội dung thông báo gửi đến người dùng..."
                className="bg-white/5 border border-white/15 focus:border-cyan-400 rounded-xl p-3 text-white leading-relaxed outline-none transition-all resize-none"
                required
              />
            </div>

            {/* Social Contact Links Editor */}
            <div className="flex flex-col gap-2 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
              <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider">
                Kênh liên hệ (Tùy chọn):
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="url"
                  value={formData.facebook_url || ''}
                  onChange={(e) => setFormData({ ...formData, facebook_url: e.target.value })}
                  placeholder="Link Facebook..."
                  className="bg-white/5 border border-white/10 focus:border-blue-400 rounded-xl px-2.5 py-1.5 text-xs text-white outline-none"
                />
                <input
                  type="url"
                  value={formData.instagram_url || ''}
                  onChange={(e) => setFormData({ ...formData, instagram_url: e.target.value })}
                  placeholder="Link Instagram..."
                  className="bg-white/5 border border-white/10 focus:border-pink-400 rounded-xl px-2.5 py-1.5 text-xs text-white outline-none"
                />
                <input
                  type="email"
                  value={formData.contact_email || ''}
                  onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                  placeholder="Email liên hệ..."
                  className="bg-white/5 border border-white/10 focus:border-cyan-400 rounded-xl px-2.5 py-1.5 text-xs text-white outline-none"
                />
              </div>
            </div>

            {/* Enable/Disable switch */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div>
                <p className="text-xs font-semibold text-white">Hiển thị thông báo khi vào web</p>
                <p className="text-[10px] text-slate-400">Tắt nếu bạn muốn ẩn thông báo này tạm thời</p>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, is_enabled: !formData.is_enabled })}
                className="cursor-pointer"
              >
                {formData.is_enabled !== false ? (
                  <ToggleRight className="w-8 h-8 text-cyan-400" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-slate-500" />
                )}
              </button>
            </div>

            {/* Editor Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/[0.07]">
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 font-semibold text-xs transition-all cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs tracking-wide shadow-lg shadow-cyan-500/25 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang lưu...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Lưu & Xuất Bản</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          /* --- VIEW MODE --- */
          <>
            {/* Body Content */}
            <div className="flex flex-col gap-3.5 text-xs sm:text-sm text-slate-300 leading-relaxed font-medium bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06]">
              <div className="whitespace-pre-line text-slate-200">
                {announcement.content}
              </div>

              {/* Social Contact Links */}
              {(announcement.facebook_url || announcement.instagram_url || announcement.contact_email) && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.06]">
                  {/* Facebook */}
                  {announcement.facebook_url && (
                    <a
                      href={announcement.facebook_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 border border-blue-500/30 hover:scale-[1.03] active:scale-95 transition-all text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                      title="Facebook"
                    >
                      <FacebookIcon className="w-3.5 h-3.5 fill-current" />
                      <span>Facebook</span>
                      <ExternalLink className="w-3 h-3 opacity-60 ml-0.5" />
                    </a>
                  )}

                  {/* Instagram */}
                  {announcement.instagram_url && (
                    <a
                      href={announcement.instagram_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-xl bg-pink-600/15 hover:bg-pink-600/25 text-pink-400 border border-pink-500/30 hover:scale-[1.03] active:scale-95 transition-all text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                      title="Instagram"
                    >
                      <InstagramIcon className="w-3.5 h-3.5" />
                      <span>Instagram</span>
                      <ExternalLink className="w-3 h-3 opacity-60 ml-0.5" />
                    </a>
                  )}

                  {/* Gmail */}
                  {announcement.contact_email && (
                    <a
                      href={`mailto:${announcement.contact_email}`}
                      className="px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:scale-[1.03] active:scale-95 text-xs font-mono transition-all flex items-center gap-1.5 shadow-sm"
                      title={`Gửi Email đến ${announcement.contact_email}`}
                    >
                      <Mail className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                      <span className="truncate">{announcement.contact_email}</span>
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-white/[0.07]">
              {/* Checkbox: Don't show again */}
              <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-400 hover:text-slate-200 transition-colors select-none py-1">
                <div
                  onClick={() => setDontShowAgain(!dontShowAgain)}
                  className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                    dontShowAgain
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
                {announcement.cta_text || 'Đã hiểu & Bắt đầu'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default WelcomeAnnouncementModal
