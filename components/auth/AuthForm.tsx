'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import { Lock, Mail, Loader2, AlertCircle, CheckCircle2, Disc, Eye, EyeOff } from 'lucide-react'

interface AuthFormProps {
  mode: 'login' | 'register'
}

declare global {
  interface Window {
    google?: any
  }
}

function translateAuthError(err: any): string {
  if (!err) return 'Đã xảy ra lỗi không xác định'

  let errorMessage = ''
  let errStatus = err.status || err.code || ''
  let errName = err.name || ''

  if (typeof err === 'string') {
    errorMessage = err
  } else if (err && typeof err.message === 'string' && err.message !== '{}') {
    errorMessage = err.message
  } else if (err && typeof err.error_description === 'string') {
    errorMessage = err.error_description
  } else {
    try {
      errorMessage = JSON.stringify(err)
    } catch {
      errorMessage = String(err)
    }
  }

  const msg = errorMessage.toLowerCase()

  if (msg === '{}' || errName === 'AuthRetryableFetchError' || errStatus === 500) {
    return 'Lỗi 500 từ Supabase Auth Server (Dữ liệu tài khoản bị hỏng do SQL Insert trực tiếp vào auth.users). Vui lòng vào Supabase Dashboard > Auth > Users để xóa tài khoản hỏng này và bấm "Add User" hoặc tạo tài khoản mới bằng trang Đăng Ký!'
  }

  if (msg.includes('invalid login credentials')) return 'Email hoặc mật khẩu không chính xác'
  if (msg.includes('user already registered') || msg.includes('already exists')) return 'Email này đã được đăng ký tài khoản'
  if (msg.includes('password should be at least')) return 'Mật khẩu phải có ít nhất 6 ký tự'
  if (msg.includes('invalid email')) return 'Định dạng email không hợp lệ'
  if (msg.includes('email not confirmed')) return 'Tài khoản chưa được xác nhận email. Hãy kiểm tra hộp thư hoặc tắt "Confirm email" trong Supabase Dashboard.'
  if (msg.includes('over_email_send_rate_limit') || msg.includes('email rate limit exceeded')) return 'Gửi email xác nhận bị quá giới hạn (Rate Limit). Vui lòng vào Supabase Dashboard > Auth > Providers > Email và tắt "Confirm email" để tạo tài khoản & đăng nhập ngay!'

  return errorMessage && errorMessage !== '{}'
    ? errorMessage
    : `Lỗi xác thực (${errName || 'AuthError'} ${errStatus ? 'Code: ' + errStatus : ''})`
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const cardRef = useRef<HTMLDivElement | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawError, setRawError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Mouse spotlight coordinates
  const [cursorPos, setCursorPos] = useState({ x: -500, y: -500 })
  const [cardCursorPos, setCardCursorPos] = useState({ x: -500, y: -500 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY })

      if (cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect()
        setCardCursorPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        })
      }
    }

    const handleFocus = () => {
      setLoading(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setRawError(null)
    setSuccessMsg(null)

    if (password.length < 6) {
      setError('Mật khẩu phải có ít nhất 6 ký tự')
      setLoading(false)
      return
    }

    try {
      if (mode === 'register') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        })

        if (signUpError) throw signUpError

        if (data.session) {
          setSuccessMsg('Đăng ký thành công! Đang chuyển hướng...')
          setTimeout(() => {
            window.location.href = '/'
          }, 1000)
        } else {
          setSuccessMsg(
            'Đăng ký thành công! Bạn có thể đăng nhập ngay hoặc kiểm tra email nếu yêu cầu xác nhận.'
          )
          setTimeout(() => {
            router.push('/login')
          }, 2500)
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (signInError) throw signInError

        setSuccessMsg('Đăng nhập thành công! Đang chuyển hướng...')
        setTimeout(() => {
          window.location.href = '/'
        }, 800)
      }
    } catch (err: any) {
      console.error('Auth action failed:', err)
      setError(translateAuthError(err))
      try {
        setRawError(
          typeof err === 'object'
            ? JSON.stringify(
                {
                  name: err.name,
                  message: err.message,
                  status: err.status,
                  code: err.code,
                  error_description: err.error_description,
                },
                null,
                2
              )
            : String(err)
        )
      } catch {
        setRawError(String(err))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError(null)
    setRawError(null)
    setSuccessMsg(null)
    try {
      await signIn('google', { callbackUrl: '/' })
    } catch (err: any) {
      console.error('Google sign-in error:', err)
      setError(translateAuthError(err))
    } finally {
      setTimeout(() => setLoading(false), 3000)
    }
  }

  return (
    <div className="min-h-screen w-screen bg-[#07080c] flex items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Dynamic Cursor Background Spotlight */}
      <div
        className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-300"
        style={{
          background: `radial-gradient(700px circle at ${cursorPos.x}px ${cursorPos.y}px, rgba(29, 185, 84, 0.16), rgba(6, 182, 212, 0.06) 40%, transparent 80%)`,
        }}
      />

      {/* Grid Pattern overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

      {/* Auth Card Container */}
      <div
        ref={cardRef}
        className="w-full max-w-md glass-panel p-8 rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden z-10 transition-transform duration-200"
      >
        {/* Dynamic Card Internal Cursor Spotlight */}
        <div
          className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300"
          style={{
            background: `radial-gradient(350px circle at ${cardCursorPos.x}px ${cardCursorPos.y}px, rgba(30, 215, 96, 0.22), transparent 75%)`,
          }}
        />

        <div className="flex flex-col items-center gap-3 mb-8 text-center relative z-10">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[var(--primary-spotify)] to-[var(--theme-secondary,#06b6d4)] p-0.5 shadow-xl shadow-[var(--theme-glow-shadow)]">
            <div className="w-full h-full bg-[#0d0e15] rounded-[14px] flex items-center justify-center">
              <Disc className="w-7 h-7 text-[var(--primary-spotify)] animate-spin-slow" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {mode === 'login' ? 'Đăng nhập vào MusicWeb' : 'Tạo tài khoản MusicWeb'}
          </h1>
          <p className="text-xs text-slate-400">Không gian nghe nhạc cá nhân high-quality</p>
        </div>

        {error && (
          <div className="mb-4 p-3.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl text-xs flex flex-col gap-2 relative z-10">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">{error}</span>
            </div>
            {rawError && (
              <details className="mt-1 pt-2 border-t border-red-500/20 text-[11px] font-mono text-red-300">
                <summary className="cursor-pointer hover:underline text-[10px] uppercase font-bold tracking-wider text-red-400/90">
                  ▶ Chi tiết kỹ thuật lỗi (Debug Log)
                </summary>
                <pre className="mt-2 p-2.5 bg-black/60 rounded-xl overflow-x-auto whitespace-pre-wrap select-text text-[10px] text-red-300 border border-red-500/20">
                  {rawError}
                </pre>
              </details>
            )}
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 text-[var(--primary-spotify)] rounded-xl text-xs flex items-center gap-2 relative z-10">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 relative z-10">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full glass-input rounded-xl pl-10 pr-3 py-2.5 text-xs text-white outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">Mật khẩu</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full glass-input rounded-xl pl-10 pr-10 py-2.5 text-xs text-white outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-3 text-slate-400 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[var(--primary-spotify)] text-black font-extrabold py-3 rounded-full transition-transform active:scale-95 flex items-center justify-center gap-2 mt-2 disabled:opacity-50 shadow-lg shadow-[var(--theme-glow-shadow)]"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === 'login' ? (
              'Đăng nhập'
            ) : (
              'Tạo tài khoản'
            )}
          </button>
          {mode === 'login' && (
            <Link href="/reset-password" className="text-center text-xs text-slate-400 hover:text-white hover:underline">
              Quên mật khẩu?
            </Link>
          )}
        </form>

        {/* Divider */}
        <div className="my-5 flex items-center gap-3 relative z-10">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Hoặc</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Google Sign In Button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full bg-white hover:bg-slate-100 text-slate-900 font-extrabold py-3 rounded-full transition-all flex items-center justify-center gap-3 shadow-lg shadow-white/10 relative z-10 hover:scale-[1.02] active:scale-95 disabled:opacity-50 text-xs mt-2"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Đăng nhập bằng Google</span>
        </button>

        <div className="mt-6 text-center text-xs text-slate-400 border-t border-white/10 pt-4 relative z-10">
          {mode === 'login' ? (
            <p>
              Chưa có tài khoản?{' '}
              <Link href="/register" className="text-[var(--primary-spotify)] font-bold hover:underline">
                Đăng ký ngay
              </Link>
            </p>
          ) : (
            <p>
              Đã có tài khoản?{' '}
              <Link href="/login" className="text-[var(--primary-spotify)] font-bold hover:underline">
                Đăng nhập
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
