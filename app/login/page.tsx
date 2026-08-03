import { AuthForm } from '@/components/auth/AuthForm'

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-black flex items-center justify-center p-4">
      <AuthForm mode="login" />
    </main>
  )
}
