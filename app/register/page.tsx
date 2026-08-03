import { AuthForm } from '@/components/auth/AuthForm'

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-black flex items-center justify-center p-4">
      <AuthForm mode="register" />
    </main>
  )
}
