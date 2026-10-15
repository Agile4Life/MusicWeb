import { expect, it, vi } from 'vitest';
import { createServerResolutionService } from '../serverResolutionService';
import type { ResolutionEntry, ServerResolutionDeps, SharedCachePort } from '../contracts';
const query = { title: 'Song', artist: 'Artist' };
const hit = (id: string, source = 'youtube'): ResolutionEntry => ({ source, resolvedId: id, isMiss: false, expiresAt: 600001 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function sharedFake() {
    let generation = BigInt(0);
    let entry: ResolutionEntry | null = null;
    const port: SharedCachePort = {
        async read(_identity, invalidate) { if (invalidate) {
            generation++;
            entry = null;
        } ; return { generation: String(generation), entry }; },
        async write(_identity, epoch, value) { const accepted = epoch === String(generation) && !(value.isMiss && entry && !entry.isMiss); if (accepted)
            entry = value; return { accepted: !!accepted, generation: String(generation) }; },
    };
    return { port, snapshot: () => ({ generation: String(generation), entry }) };
}
const deps = (resolveCatalog: ServerResolutionDeps['resolveCatalog'], sharedCache: SharedCachePort | null = null): ServerResolutionDeps => ({ resolveCatalog, sharedCache, lookupStaticDrive: () => null, now: () => 1, validateCachedEntry: async () => true });
it('revokes an old local request before invalidation awaits', async () => {
    const old = deferred<ResolutionEntry>();
    let calls = 0;
    const service = createServerResolutionService(deps(async () => ++calls === 1 ? old.promise : hit('new')));
    const first = service.resolve(query);
    expect(await service.resolve(query, { invalidate: true })).toEqual(hit('new'));
    old.resolve(hit('old'));
    await first;
    expect(await service.resolve(query)).toEqual(hit('new'));
});
it('rejects an old publication across two instances', async () => {
    const shared = sharedFake();
    const old = deferred<ResolutionEntry>();
    const a = createServerResolutionService(deps(() => old.promise, shared.port));
    const b = createServerResolutionService(deps(async () => hit('new'), shared.port));
    const first = a.resolve(query);
    await Promise.resolve();
    await b.resolve(query, { invalidate: true });
    old.resolve(hit('old'));
    await first;
    expect(shared.snapshot()).toEqual({ generation: '1', entry: hit('new') });
    expect(await a.resolve(query)).toMatchObject({ resolvedId: 'new' });
});
it('publishes initial winner before a preferred callback in the await gap', async () => {
    const shared = sharedFake();
    const service = createServerResolutionService(deps(async (_query, late) => { late?.(hit('preferred', 'nhaccuatui')); return hit('initial'); }, shared.port));
    expect(await service.resolve(query)).toEqual(hit('initial'));
    expect(shared.snapshot().entry).toEqual(hit('preferred', 'nhaccuatui'));
});
it('does not use unvalidated L1 or publish during a shared outage', async () => {
    const shared = sharedFake();
    let outage = false;
    const port = { ...shared.port, read: async (...args: Parameters<SharedCachePort['read']>) => outage ? null : shared.port.read(...args) };
    let calls = 0;
    const service = createServerResolutionService(deps(async () => hit(String(++calls)), port));
    await service.resolve(query);
    outage = true;
    expect(await service.resolve(query)).toEqual(hit('2'));
    expect(shared.snapshot().entry).toEqual(hit('1'));
});
it('invalidates an unplayable cached SoundCloud entry through the injected validator', async () => {
    const shared = sharedFake();
    await shared.port.write({ titleKey: '', artistKey: '', durBucket: 0 }, '0', hit('blocked', 'soundcloud'));
    const validate = vi.fn(async () => false);
    const service = createServerResolutionService({ ...deps(async () => hit('replacement'), shared.port), validateCachedEntry: validate });
    expect(await service.resolve(query)).toEqual(hit('replacement'));
    expect(validate).toHaveBeenCalledWith(hit('blocked', 'soundcloud'));
    expect(shared.snapshot()).toEqual({ generation: '1', entry: hit('replacement') });
});
it('does not cache a rejected publication locally', async () => {
    const shared = sharedFake();
    let calls = 0;
    const service = createServerResolutionService(deps(async () => hit(String(++calls)), { ...shared.port, write: async () => ({ accepted: false, generation: '1' }) }));
    await service.resolve(query);
    expect(await service.resolve(query)).toEqual(hit('2'));
    expect(shared.snapshot().entry).toBeNull();
});
it('does not let delayed cached validation roll back an invalidated epoch', async () => {
    const shared = sharedFake();
    await shared.port.write({ titleKey: '', artistKey: '', durBucket: 0 }, '0', hit('blocked', 'soundcloud'));
    const validation = deferred<boolean>();
    let validating = false;
    const service = createServerResolutionService({ ...deps(async () => hit('new'), shared.port), validateCachedEntry: async () => { validating = true; return validation.promise; } });
    const old = service.resolve(query);
    while (!validating)
        await Promise.resolve();
    await service.resolve(query, { invalidate: true });
    validation.resolve(false);
    await old;
    expect(shared.snapshot()).toEqual({ generation: '1', entry: hit('new') });
    expect(await service.resolve(query)).toMatchObject({ resolvedId: 'new' });
});
it('ignores a delayed shared read from an older epoch', async () => {
    const shared = sharedFake();
    const delayed = deferred<{
        generation: string;
        entry: ResolutionEntry | null;
    }>();
    let reads = 0;
    const port: SharedCachePort = { ...shared.port, read: (...args) => ++reads === 1 ? delayed.promise : shared.port.read(...args) };
    const service = createServerResolutionService(deps(async () => hit('new'), port));
    const old = service.resolve(query);
    await service.resolve(query, { invalidate: true });
    delayed.resolve({ generation: '0', entry: hit('old') });
    await old;
    expect(shared.snapshot()).toEqual({ generation: '1', entry: hit('new') });
    expect(await service.resolve(query)).toMatchObject({ resolvedId: 'new' });
});
it('expires local hits and misses using the injected clock', async () => {
    let now = 1;
    let calls = 0;
    const service = createServerResolutionService({ ...deps(async () => { calls++; return calls === 1 ? { source: null, resolvedId: null, isMiss: true, expiresAt: 60001 } : { ...hit(String(calls)), expiresAt: now + 600000 }; }), now: () => now });
    expect(await service.resolve(query)).toMatchObject({ isMiss: true });
    now = 60000;
    expect(await service.resolve(query)).toMatchObject({ isMiss: true });
    now = 60001;
    expect(await service.resolve(query)).toMatchObject({ resolvedId: '2' });
    now = 660001;
    expect(await service.resolve(query)).toMatchObject({ resolvedId: '3' });
});
it('re-resolves when cached-entry validation rejects', async () => {
  const shared = sharedFake()
  await shared.port.write({ titleKey: '', artistKey: '', durBucket: 0 }, '0', hit('blocked', 'soundcloud'))
  const service = createServerResolutionService({ ...deps(async () => hit('replacement'), shared.port), validateCachedEntry: async () => { throw new Error('validation unavailable') } })
  expect(await service.resolve(query)).toEqual(hit('replacement'))
  expect(shared.snapshot()).toEqual({ generation: '1', entry: hit('replacement') })
})
it('does not downgrade an existing shared hit with a racing miss', async () => {
  const shared = sharedFake(); const miss = deferred<ResolutionEntry>()
  const a = createServerResolutionService(deps(() => miss.promise, shared.port))
  const b = createServerResolutionService(deps(async () => hit('winner'), shared.port))
  const old = a.resolve(query); await Promise.resolve(); await b.resolve(query)
  miss.resolve({ source: null, resolvedId: null, isMiss: true, expiresAt: 60001 }); await old
  expect(shared.snapshot().entry).toEqual(hit('winner'))
  expect(await a.resolve(query)).toMatchObject({ resolvedId: 'winner', isMiss: false })
})
it('ignores a delayed validation bump after a newer invalidation owns the cache', async () => {
    const shared = sharedFake();
    await shared.port.write({ titleKey: '', artistKey: '', durBucket: 0 }, '0', hit('blocked', 'soundcloud'));
    const delayedBump = deferred<{ generation: string; entry: ResolutionEntry | null }>();
    let bumpStarted = false;
    const port: SharedCachePort = {
        ...shared.port,
        async read(identity, invalidate) {
            const snapshot = await shared.port.read(identity, invalidate);
            if (invalidate && !bumpStarted) {
                bumpStarted = true;
                return delayedBump.promise;
            }
            return snapshot;
        },
    };
    const catalog = vi.fn(async () => hit('fresh'));
    const service = createServerResolutionService({
        ...deps(catalog, port),
        validateCachedEntry: async entry => entry.source !== 'soundcloud',
    });
    const stale = service.resolve(query);
    while (!bumpStarted) await Promise.resolve();
    expect(await service.resolve(query, { invalidate: true })).toEqual(hit('fresh'));
    delayedBump.resolve({ generation: '1', entry: null });
    expect(await stale).toMatchObject({ resolvedId: 'fresh' });
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(shared.snapshot()).toEqual({ generation: '2', entry: hit('fresh') });
    expect(await service.resolve(query)).toMatchObject({ resolvedId: 'fresh' });
});
