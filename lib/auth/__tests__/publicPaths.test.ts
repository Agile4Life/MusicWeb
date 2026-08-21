import { describe, expect, test } from 'vitest'

import { isNextAuthRoute, isPublicAuthPath } from '../publicPaths'

describe('isPublicAuthPath', () => {
  test('allows the hoilauchay SSO complete hop', () => {
    expect(isPublicAuthPath('/sso/complete')).toBe(true)
    expect(isPublicAuthPath('/login')).toBe(true)
    expect(isPublicAuthPath('/')).toBe(false)
    expect(isPublicAuthPath('/albums')).toBe(false)
  })
})

describe('isNextAuthRoute', () => {
  test('allows NextAuth and passkey APIs', () => {
    expect(isNextAuthRoute('/api/auth/callback/credentials')).toBe(true)
    expect(isNextAuthRoute('/api/sso')).toBe(false)
  })
})
