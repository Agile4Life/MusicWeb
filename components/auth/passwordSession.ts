import type { SignInResponse } from 'next-auth/react'

export type PasswordSignIn = (
  provider: 'credentials',
  options: {
    redirect: false
    email: string
    accessToken: string
  }
) => Promise<SignInResponse | undefined>

export async function createPasswordSession(signIn: PasswordSignIn, email: string, accessToken: string) {
  const result = await signIn('credentials', {
    redirect: false,
    email,
    accessToken,
  })

  if (!result?.ok) {
    throw new Error(result?.error || 'Unable to create password session')
  }
}
