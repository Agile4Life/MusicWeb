'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { CheckCircle2, AlertCircle, Info, X, ListMusic, Sparkles } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: string
  message: string
  title?: string
  type: ToastType
  duration?: number
}

interface ToastContextType {
  showToast: (options: { message: string; title?: string; type?: ToastType; duration?: number }) => void
  showSuccess: (message: string, title?: string) => void
  showError: (message: string, title?: string) => void
  showInfo: (message: string, title?: string) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

/** Global helper to fire toast via CustomEvent from anywhere */
export function toast(message: string, type: ToastType = 'success', title?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('musicweb-toast', {
        detail: { message, type, title },
      })
    )
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    ({ message, title, type = 'success', duration = 3500 }: { message: string; title?: string; type?: ToastType; duration?: number }) => {
      const id = Math.random().toString(36).substring(2, 9)
      const newItem: ToastItem = { id, message, title, type, duration }

      setToasts((prev) => [...prev.slice(-4), newItem]) // Keep max 5 toasts

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id)
        }, duration)
      }
    },
    [removeToast]
  )

  const showSuccess = useCallback(
    (message: string, title?: string) => showToast({ message, title, type: 'success' }),
    [showToast]
  )

  const showError = useCallback(
    (message: string, title?: string) => showToast({ message, title, type: 'error' }),
    [showToast]
  )

  const showInfo = useCallback(
    (message: string, title?: string) => showToast({ message, title, type: 'info' }),
    [showToast]
  )

  useEffect(() => {
    const handleToastEvent = (e: Event) => {
      const customEv = e as CustomEvent<{ message: string; type?: ToastType; title?: string }>
      if (customEv.detail && customEv.detail.message) {
        showToast({
          message: customEv.detail.message,
          type: customEv.detail.type || 'success',
          title: customEv.detail.title,
        })
      }
    }

    window.addEventListener('musicweb-toast', handleToastEvent)
    return () => {
      window.removeEventListener('musicweb-toast', handleToastEvent)
    }
  }, [showToast])

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showInfo }}>
      {children}

      {/* Floating Toast Notification Container */}
      <div className="fixed top-5 right-4 sm:right-6 z-[99999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-2 sm:px-0">
        {toasts.map((t) => {
          const isSuccess = t.type === 'success'
          const isError = t.type === 'error'
          const isInfo = t.type === 'info'

          return (
            <div
              key={t.id}
              className={`pointer-events-auto w-full glass-panel p-3.5 rounded-2xl shadow-2xl border flex items-center justify-between gap-3 transition-all duration-300 animate-in slide-in-from-top-5 fade-in select-none ${
                isSuccess
                  ? 'bg-[#0a1815]/95 border-emerald-500/40 text-white shadow-emerald-950/40'
                  : isError
                  ? 'bg-[#1c0d12]/95 border-rose-500/40 text-white shadow-rose-950/40'
                  : isInfo
                  ? 'bg-[#0b1626]/95 border-cyan-500/40 text-white shadow-cyan-950/40'
                  : 'bg-[#181308]/95 border-amber-500/40 text-white shadow-amber-950/40'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {/* Icon Container */}
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                    isSuccess
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                      : isError
                      ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                      : isInfo
                      ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400'
                      : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                  }`}
                >
                  {isSuccess ? (
                    <ListMusic className="w-5 h-5 animate-pulse" />
                  ) : isError ? (
                    <AlertCircle className="w-5 h-5" />
                  ) : isInfo ? (
                    <Sparkles className="w-5 h-5" />
                  ) : (
                    <Info className="w-5 h-5" />
                  )}
                </div>

                {/* Content */}
                <div className="flex flex-col min-w-0 flex-1">
                  {t.title ? (
                    <span className="text-xs font-extrabold text-white truncate">{t.title}</span>
                  ) : (
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      {isSuccess ? 'Thành công' : isError ? 'Thông báo lỗi' : 'Thông báo'}
                    </span>
                  )}
                  <p className="text-xs font-semibold text-slate-200 truncate mt-0.5">{t.message}</p>
                </div>
              </div>

              {/* Close Button */}
              <button
                onClick={() => removeToast(t.id)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
