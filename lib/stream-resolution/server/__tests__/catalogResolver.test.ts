import { expect, it, vi } from 'vitest';
import { createCatalogResolver } from '../catalogResolver';
import { createServerResolutionService } from '../serverResolutionService';
const query = { title: 'Song', artist: 'Artist' };
const hit = { source: 'drive', resolvedId: 'drive-1', isMiss: false, expiresAt: 600001 };
it('returns Drive without external searches', async () => {
    const external = vi.fn(async () => null);
    const resolve = createCatalogResolver({ drive: async () => hit, nhaccuatui: external, soundcloud: external, youtube: external }, () => 1);
    expect(await resolve(query)).toEqual(hit);
    expect(external).not.toHaveBeenCalled();
});
it('keeps service instances isolated and coalesces each instance', async () => {
    let complete!: (value: typeof hit) => void;
    const pending = new Promise<typeof hit>(resolve => { complete = resolve; });
    const catalog = vi.fn(() => pending);
    const deps = { resolveCatalog: catalog, lookupStaticDrive: () => null, sharedCache: null, now: () => 1, validateCachedEntry: async () => true };
    const a = createServerResolutionService(deps);
    const b = createServerResolutionService(deps);
    const first = a.resolve(query);
    const second = a.resolve(query);
    const other = b.resolve(query);
    expect(catalog).toHaveBeenCalledTimes(2);
    complete(hit);
    expect(await Promise.all([first, second, other])).toEqual([hit, hit, hit]);
    expect(await a.resolve(query)).toEqual(hit);
    expect(catalog).toHaveBeenCalledTimes(2);
});
it('uses the injected clock for the catalog miss TTL', async () => {
  const empty = async () => null
  const resolve = createCatalogResolver({ drive: empty, nhaccuatui: empty, soundcloud: empty, youtube: empty }, () => 123)
  expect(await resolve(query)).toEqual({ source: null, resolvedId: null, isMiss: true, expiresAt: 60123 })
})
it('preserves the NCT grace window and late preferred callback', async () => {
  vi.useFakeTimers()
  try {
    let finish!: (value: typeof hit) => void
    const preferred = new Promise<typeof hit>(done => { finish = done })
    const late = vi.fn()
    const fallback = { ...hit, source: 'soundcloud', resolvedId: 'fallback' }
    const resolve = createCatalogResolver({ drive: async () => null, nhaccuatui: () => preferred, soundcloud: async () => fallback, youtube: async () => ({ ...hit, source: 'youtube' }) }, () => 1)
    const result = resolve(query, late)
    await vi.advanceTimersByTimeAsync(2199)
    expect(late).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toEqual(fallback)
    finish(hit); await vi.advanceTimersByTimeAsync(0)
    expect(late).toHaveBeenCalledWith(hit)
  } finally { vi.useRealTimers() }
})
