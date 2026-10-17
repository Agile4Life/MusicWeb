import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/AuthForm'

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg-space,#07090e)] flex items-center justify-center text-slate-400">Đang tải...</div>}>
      <AuthForm mode="register" />
    </Suspense>
  )
}

