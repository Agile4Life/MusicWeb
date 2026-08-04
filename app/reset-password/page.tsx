'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

export default function ResetPasswordPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [hasSession, setHasSession] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then((result: { data: { session: Session | null } }) => setHasSession(Boolean(result.data.session)))
    const { data: listener } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'PASSWORD_RECOVERY') setHasSession(Boolean(session))
    })
    return () => listener.subscription.unsubscribe()
  }, [supabase])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')
    const result = hasSession
      ? await supabase.auth.updateUser({ password })
      : await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
    setLoading(false)
    if (result.error) setError(result.error.message)
    else setMessage(hasSession ? 'Đổi mật khẩu thành công.' : 'Đã gửi email hướng dẫn đặt lại mật khẩu.')
  }

  return (
    <main className="min-h-screen bg-[#07080c] flex items-center justify-center p-4 text-white">
      <form onSubmit={handleSubmit} className="glass-panel w-full max-w-md p-8 rounded-3xl flex flex-col gap-4">
        <h1 className="text-2xl font-extrabold">{hasSession ? 'Đặt mật khẩu mới' : 'Quên mật khẩu'}</h1>
        {!hasSession ? <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="glass-input rounded-xl px-4 py-3 outline-none" /> : <input required minLength={6} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu mới" className="glass-input rounded-xl px-4 py-3 outline-none" />}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-emerald-400">{message}</p>}
        <button disabled={loading} className="bg-[var(--primary-spotify)] text-black font-bold rounded-full py-3 disabled:opacity-50">{loading ? 'Đang xử lý...' : hasSession ? 'Cập nhật mật khẩu' : 'Gửi email đặt lại'}</button>
        <Link href="/login" className="text-center text-sm text-slate-400 hover:text-white">Quay lại đăng nhập</Link>
      </form>
    </main>
  )
}
