'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Lock, Mail, Loader2, AlertCircle, Disc } from 'lucide-react'

interface AuthFormProps {
  mode: 'login' | 'register'
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (mode === 'register') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        })
        if (signUpError) throw signUpError

        router.push('/')
        router.refresh()
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (signInError) throw signInError

        router.push('/')
        router.refresh()
      }
    } catch (err: any) {
      setError(err.message || 'Đã xảy ra lỗi khi xác thực')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md glass-panel p-8 rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden">
      {/* Background glow orb */}
      <div className="absolute -top-20 -right-20 w-48 h-48 bg-[#1DB954]/20 rounded-full blur-2xl pointer-events-none" />

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
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
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
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full glass-input rounded-xl pl-10 pr-3 py-2.5 text-xs text-white outline-none"
            />
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
  )
}
