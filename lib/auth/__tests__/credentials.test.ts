import { describe, expect, test, vi } from 'vitest'

import { authorizePasswordCredentials } from '../credentials'

describe('authorizePasswordCredentials', () => {
  test('returns a NextAuth user only after Supabase verifies the access token', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'user-1', email: 'admin@musicweb.com' } },
      error: null,
    })

    const user = await authorizePasswordCredentials(
      { email: 'admin@musicweb.com', accessToken: 'access-token-123' },
      () => ({ auth: { getUser } })
    )

    expect(getUser).toHaveBeenCalledWith('access-token-123')
    expect(user).toEqual({
      id: 'user-1',
      email: 'admin@musicweb.com',
      name: 'admin',
    })
  })

  test('rejects an invalid Supabase access token', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid jwt' },
    })

    const user = await authorizePasswordCredentials(
      { email: 'admin@musicweb.com', accessToken: 'bad-token' },
      () => ({ auth: { getUser } })
    )

    expect(user).toBeNull()
  })
})
