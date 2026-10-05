import { describe, expect, it } from 'vitest'
import {
  DEFAULT_URL_CACHE_TTL,
  NCT_URL_CACHE_TTL,
  SOUNDCLOUD_URL_CACHE_TTL,
  getAudioUrlCacheTtl,
  readFreshAudioUrl,
  type AudioUrlCacheEntry,
} from '../audioUrlCache'

const T0 = 1_000_000

function makeCache(id: string, ts: number, url = 'https://x/stream') {
  return new Map<string, AudioUrlCacheEntry>([[id, { url, ts }]])
}

describe('getAudioUrlCacheTtl', () => {
  it('uses shorter TTLs for signed-URL sources', () => {
    expect(getAudioUrlCacheTtl({ id: 'a', source: 'nhaccuatui' })).toBe(NCT_URL_CACHE_TTL)
    expect(getAudioUrlCacheTtl({ id: 'a', source: 'soundcloud' })).toBe(SOUNDCLOUD_URL_CACHE_TTL)
    expect(getAudioUrlCacheTtl({ id: 'sc-123' })).toBe(SOUNDCLOUD_URL_CACHE_TTL)
    expect(getAudioUrlCacheTtl({ id: 'a', soundcloud_id: '9' })).toBe(SOUNDCLOUD_URL_CACHE_TTL)
    expect(getAudioUrlCacheTtl({ id: 'a', source_url: 'https://soundcloud.com/x' })).toBe(
      SOUNDCLOUD_URL_CACHE_TTL
    )
  })

  it('uses the default TTL for stable sources', () => {
    expect(getAudioUrlCacheTtl({ id: 'a', source: 'local' })).toBe(DEFAULT_URL_CACHE_TTL)
  })
})

describe('readFreshAudioUrl', () => {
  it('returns a fresh entry', () => {
    const cache = makeCache('t1', T0)
    expect(readFreshAudioUrl(cache, { id: 't1', source: 'local' }, T0 + 1000)).toBe('https://x/stream')
  })

  it('rejects and evicts an expired SoundCloud URL even though the default TTL has not elapsed', () => {
    const cache = makeCache('sc-1', T0)
    const now = T0 + SOUNDCLOUD_URL_CACHE_TTL + 1
    expect(now - T0).toBeLessThan(DEFAULT_URL_CACHE_TTL)
    expect(readFreshAudioUrl(cache, { id: 'sc-1', source: 'soundcloud' }, now)).toBeNull()
    expect(cache.has('sc-1')).toBe(false)
  })

  it('rejects an expired NCT URL', () => {
    const cache = makeCache('n1', T0)
    expect(readFreshAudioUrl(cache, { id: 'n1', source: 'nhaccuatui' }, T0 + NCT_URL_CACHE_TTL)).toBeNull()
  })

  it('returns null for a missing entry or missing id', () => {
    expect(readFreshAudioUrl(new Map(), { id: 'nope' }, T0)).toBeNull()
    expect(readFreshAudioUrl(makeCache('t1', T0), { id: null }, T0)).toBeNull()
  })

  it('refreshes LRU order on a fresh hit', () => {
    const cache = new Map<string, AudioUrlCacheEntry>([
      ['a', { url: 'ua', ts: T0 }],
      ['b', { url: 'ub', ts: T0 }],
    ])
    readFreshAudioUrl(cache, { id: 'a', source: 'local' }, T0 + 1)
    expect([...cache.keys()]).toEqual(['b', 'a'])
  })
})
