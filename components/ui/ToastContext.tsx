'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, Info, X, CheckCircle2 } from 'lucide-react'
import { EASE_OUT } from '@/lib/motion'

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

interface ToastNotificationItemProps {
  item: ToastItem
  isDesktop: boolean
  prefersReducedMotion: boolean | null
  onDismiss: (id: string) => void
}

const ToastNotificationItem = React.forwardRef<HTMLDivElement, ToastNotificationItemProps>(
  function ToastNotificationItem({ item, isDesktop, prefersReducedMotion, onDismiss }, ref) {
    const duration = item.duration ?? 3500
    const remainingRef = useRef<number>(duration)
    const startedAtRef = useRef<number | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const hoveredRef = useRef(false)
    const focusedRef = useRef(false)

    const clearTimer = useCallback(() => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }, [])

    const pause = useCallback(() => {
      if (timerRef.current !== null) {
        clearTimer()
        if (startedAtRef.current !== null) {
          remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
          startedAtRef.current = null
        }
      }
    }, [clearTimer])

    const resume = useCallback(() => {
      if (duration <= 0) return
      if (hoveredRef.current || focusedRef.current || (typeof document !== 'undefined' && document.hidden)) {
        return
      }
      if (timerRef.current !== null) return
      if (remainingRef.current <= 0) {
        onDismiss(item.id)
        return
      }
      startedAtRef.current = Date.now()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        startedAtRef.current = null
        onDismiss(item.id)
      }, remainingRef.current)
    }, [duration, item.id, onDismiss])

    useEffect(() => {
      resume()

      const handleVisibilityChange = () => {
        if (document.hidden) {
          pause()
        } else {
          resume()
        }
      }

      document.addEventListener('visibilitychange', handleVisibilityChange)
      return () => {
        clearTimer()
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }, [clearTimer, pause, resume])

    const handleManualDismiss = () => {
      clearTimer()
      onDismiss(item.id)
    }

    const isSuccess = item.type === 'success'
    const isError = item.type === 'error'
    const isInfo = item.type === 'info'
    const offsetY = isDesktop ? '24px' : '-24px'

    return (
      <motion.div
        ref={ref}
        layout="position"
        role="alert"
        data-testid="toast-notification"
        data-toast-type={item.type}
        initial={
          prefersReducedMotion
            ? { opacity: 0 }
            : { opacity: 0, transform: `translate3d(0, ${offsetY}, 0) scale(0.96)` }
        }
        animate={
          prefersReducedMotion
            ? { opacity: 1, transition: { duration: 0.16, ease: 'easeOut' } }
            : {
                opacity: 1,
                transform: 'translate3d(0, 0px, 0) scale(1)',
                transition: { duration: 0.32, ease: EASE_OUT },
              }
        }
        exit={
          prefersReducedMotion
            ? { opacity: 0, transition: { duration: 0.14, ease: 'easeOut' } }
            : {
                opacity: 0,
                transform: `translate3d(0, ${offsetY}, 0) scale(0.96)`,
                transition: { duration: 0.22, ease: EASE_OUT },
              }
        }
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch') return
          hoveredRef.current = true
          pause()
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'touch') return
          hoveredRef.current = false
          resume()
        }}
        onFocus={() => {
          focusedRef.current = true
          pause()
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            focusedRef.current = false
            resume()
          }
        }}
        className={`pointer-events-auto w-full glass-panel p-3.5 rounded-2xl shadow-xl border flex items-center justify-between gap-3 select-none ${
          isSuccess
            ? 'bg-[var(--elevation-2-bg,#0a1815)]/95 border-[var(--primary-spotify,#10b981)]/40 text-white'
            : isError
            ? 'bg-[#1c0d12]/95 border-rose-500/40 text-white'
            : isInfo
            ? 'bg-[var(--elevation-2-bg,#0b1626)]/95 border-[var(--spotify-glow,#22d3ee)]/40 text-white'
            : 'bg-[#181308]/95 border-amber-500/40 text-white'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Icon Container */}
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
              isSuccess
                ? 'bg-[var(--primary-spotify,#10b981)]/20 border-[var(--primary-spotify,#10b981)]/40 text-[var(--spotify-glow,#34d399)]'
                : isError
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                : isInfo
                ? 'bg-[var(--primary-spotify,#06b6d4)]/20 border-[var(--primary-spotify,#06b6d4)]/40 text-[var(--spotify-glow,#22d3ee)]'
                : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
            }`}
          >
            {isSuccess ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : isError ? (
              <AlertCircle className="w-5 h-5" />
            ) : (
              <Info className="w-5 h-5" />
            )}
          </div>

          {/* Content */}
          <div className="flex flex-col min-w-0 flex-1">
            {item.title ? (
              <span className="text-xs font-extrabold text-white truncate">{item.title}</span>
            ) : (
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {isSuccess ? 'Thành công' : isError ? 'Thông báo lỗi' : 'Thông báo'}
              </span>
            )}
            <p className="text-xs font-semibold text-slate-200 truncate mt-0.5">{item.message}</p>
          </div>
        </div>

        {/* Close Button */}
        <button
          type="button"
          aria-label="Đóng thông báo"
          onClick={handleManualDismiss}
          className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 active:scale-[0.97] transition-[transform,color,background-color] duration-150 ease-[var(--ease-out)] shrink-0 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>
    )
  }
)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [mounted, setMounted] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    setMounted(true)
    const mq = window.matchMedia('(min-width: 1024px)')
    const syncDesktop = () => setIsDesktop(mq.matches)
    syncDesktop()
    mq.addEventListener('change', syncDesktop)
    return () => mq.removeEventListener('change', syncDesktop)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback(
    ({ message, title, type = 'success', duration = 3500 }: { message: string; title?: string; type?: ToastType; duration?: number }) => {
      const id = Math.random().toString(36).substring(2, 9)
      const newItem: ToastItem = { id, message, title, type, duration }

      setToasts((prev) => [...prev.slice(-4), newItem]) // Keep max 5 toasts
    },
    []
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
      {mounted && typeof document !== 'undefined' && createPortal(
        <div className="fixed top-5 lg:top-auto lg:bottom-28 xl:bottom-32 right-4 sm:right-6 z-[110] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-2 sm:px-0">
          <AnimatePresence initial={false} mode="popLayout">
            {toasts.map((t) => (
              <ToastNotificationItem
                key={t.id}
                item={t}
                isDesktop={isDesktop}
                prefersReducedMotion={prefersReducedMotion}
                onDismiss={removeToast}
              />
            ))}
          </AnimatePresence>
        </div>,
        document.body
      )}
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
