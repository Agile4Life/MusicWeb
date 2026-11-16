import { describe, expect, test } from 'vitest'

import { isNextAuthRoute, isPublicAuthPath, isStreamProxyPath } from '../publicPaths'

describe('isPublicAuthPath', () => {
  test('allows the hoilauchay SSO complete hop', () => {
    expect(isPublicAuthPath('/sso/complete')).toBe(true)
    expect(isPublicAuthPath('/login')).toBe(true)
    expect(isPublicAuthPath('/spotify-lab')).toBe(true)
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

describe('isStreamProxyPath', () => {
  test('matches audio proxies only', () => {
    expect(isStreamProxyPath('/api/soundcloud/stream')).toBe(true)
    expect(isStreamProxyPath('/api/drive-stream/prewarm')).toBe(true)
    expect(isStreamProxyPath('/api/resolve-stream')).toBe(true)
    expect(isStreamProxyPath('/api/favorites/list')).toBe(false)
    expect(isStreamProxyPath('/api/soundcloud/search')).toBe(false)
  })
})
