import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/AuthForm'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#07080c] flex items-center justify-center text-slate-400">Đang tải...</div>}>
      <AuthForm mode="login" />
    </Suspense>
  )
}

