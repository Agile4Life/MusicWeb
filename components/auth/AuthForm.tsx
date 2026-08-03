'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Music, Lock, Mail, Loader2, AlertCircle } from 'lucide-react'

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
    <div className="w-full max-w-md bg-[#121212] border border-[#282828] p-8 rounded-2xl shadow-2xl">
      <div className="flex flex-col items-center gap-2 mb-6 text-center">
        <div className="w-12 h-12 bg-[#1DB954] text-black rounded-full flex items-center justify-center">
          <Music className="w-6 h-6 fill-current" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          {mode === 'login' ? 'Đăng nhập vào MusicWeb' : 'Tạo tài khoản MusicWeb'}
        </h1>
        <p className="text-xs text-gray-400">Trải nghiệm nghe nhạc cá nhân độc bản</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Email</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-gray-500 absolute left-3 top-3" />
            <input
              type="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#181818] border border-[#282828] focus:border-[#1DB954] rounded-lg pl-9 pr-3 py-2.5 text-sm text-white outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Mật khẩu</label>
          <div className="relative">
            <Lock className="w-4 h-4 text-gray-500 absolute left-3 top-3" />
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#181818] border border-[#282828] focus:border-[#1DB954] rounded-lg pl-9 pr-3 py-2.5 text-sm text-white outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold py-3 rounded-full transition-transform active:scale-95 flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
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

      <div className="mt-6 text-center text-xs text-gray-400 border-t border-[#282828] pt-4">
        {mode === 'login' ? (
          <p>
            Chưa có tài khoản?{' '}
            <Link href="/register" className="text-[#1DB954] font-semibold hover:underline">
              Đăng ký ngay
            </Link>
          </p>
        ) : (
          <p>
            Đã có tài khoản?{' '}
            <Link href="/login" className="text-[#1DB954] font-semibold hover:underline">
              Đăng nhập
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
