import { describe, expect, test, vi } from 'vitest'

import { createPasswordSession } from '../passwordSession'

describe('password session bridge', () => {
  test('creates a NextAuth credentials session from a verified Supabase access token', async () => {
    const signIn = vi.fn().mockResolvedValue({ ok: true, error: undefined })

    await createPasswordSession(signIn, 'admin@musicweb.com', 'access-token-123')

    expect(signIn).toHaveBeenCalledWith('credentials', {
      redirect: false,
      email: 'admin@musicweb.com',
      accessToken: 'access-token-123',
    })
  })

  test('throws when NextAuth credentials session cannot be created', async () => {
    const signIn = vi.fn().mockResolvedValue({ ok: false, error: 'CredentialsSignin' })

    await expect(createPasswordSession(signIn, 'admin@musicweb.com', 'access-token-123')).rejects.toThrow(
      'CredentialsSignin'
    )
  })
})
