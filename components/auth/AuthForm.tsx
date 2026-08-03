'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Lock, Mail, Loader2, AlertCircle, CheckCircle2, Disc, Eye, EyeOff } from 'lucide-react'

interface AuthFormProps {
  mode: 'login' | 'register'
}

function translateAuthError(err: any): string {
  let errorMessage = 'Đã xảy ra lỗi khi xác thực'

  if (typeof err === 'string') {
    errorMessage = err
  } else if (err && typeof err.message === 'string') {
    errorMessage = err.message
  } else if (err && typeof err.error_description === 'string') {
    errorMessage = err.error_description
  }

  const msg = errorMessage.toLowerCase()
  if (msg.includes('invalid login credentials')) return 'Email hoặc mật khẩu không chính xác'
  if (msg.includes('user already registered') || msg.includes('already exists')) return 'Email này đã được đăng ký tài khoản'
  if (msg.includes('password should be at least')) return 'Mật khẩu phải có ít nhất 6 ký tự'
  if (msg.includes('invalid email')) return 'Định dạng email không hợp lệ'
  if (msg.includes('email not confirmed')) return 'Email chưa được xác nhận'

  return errorMessage
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

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
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
      setError(translateAuthError(err))
    } finally {
      setLoading(false)
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
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#1DB954] to-cyan-400 p-0.5 shadow-xl shadow-emerald-500/20">
            <div className="w-full h-full bg-[#0d0e15] rounded-[14px] flex items-center justify-center">
              <Disc className="w-7 h-7 text-[#1DB954] animate-spin-slow" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {mode === 'login' ? 'Đăng nhập vào MusicWeb' : 'Tạo tài khoản MusicWeb'}
          </h1>
          <p className="text-xs text-slate-400">Không gian nghe nhạc cá nhân high-quality</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-xs flex items-center gap-2 relative z-10">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 text-[#1DB954] rounded-xl text-xs flex items-center gap-2 relative z-10">
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
            className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold py-3 rounded-full transition-transform active:scale-95 flex items-center justify-center gap-2 mt-2 disabled:opacity-50 shadow-lg shadow-emerald-500/25"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === 'login' ? (
              'Đăng nhập'
            ) : (
              'Tạo tài khoản'
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-slate-400 border-t border-white/10 pt-4 relative z-10">
          {mode === 'login' ? (
            <p>
              Chưa có tài khoản?{' '}
              <Link href="/register" className="text-[#1DB954] font-bold hover:underline">
                Đăng ký ngay
              </Link>
            </p>
          ) : (
            <p>
              Đã có tài khoản?{' '}
              <Link href="/login" className="text-[#1DB954] font-bold hover:underline">
                Đăng nhập
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
