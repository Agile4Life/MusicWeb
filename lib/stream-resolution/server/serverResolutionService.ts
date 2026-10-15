import { normalizeTrackKey, normalizeTrackField, durationBucket } from '@/lib/normalizeTrackKey';
import type { ResolutionCacheIdentity } from '@/lib/serverStreamResolutionCache';
import type { ResolutionEntry, ServerResolutionDeps, ServerResolutionService } from './contracts';
interface L1Entry extends ResolutionEntry {
    sharedGeneration?: string;
}
export function createServerResolutionService(deps: ServerResolutionDeps): ServerResolutionService {
    const l1Cache = new Map<string, L1Entry>();
    const inFlightResolutions = new Map<string, {
        generation: number;
        sharedGeneration?: string;
        promise: Promise<L1Entry>;
    }>();
    const cacheGenerations = new Map<string, number>();
    const observedSharedGenerations = new Map<string, string>();
    // A generation check cannot revoke a DB write already on the wire. Serialize
    // publications per key; the DB generation guard coordinates other instances.
    const cacheMutations = new Map<string, Promise<void>>();
    const L1_HIT_TTL = 10 * 60 * 1000; // 10 min for hits
    const L1_MISS_TTL = 60 * 1000; // 1 min for misses
    const L1_MAX_SIZE = 2000;
    function evictL1IfFull(): void {
        if (l1Cache.size >= L1_MAX_SIZE) {
            const oldest = l1Cache.keys().next().value;
            if (oldest !== undefined)
                l1Cache.delete(oldest);
        }
    }
    function generationFor(key: string): number {
        return cacheGenerations.get(key) || 0;
    }
    function storeL1(key: string, generation: number, entry: L1Entry): void {
        if (generationFor(key) !== generation)
            return;
        evictL1IfFull();
        l1Cache.set(key, entry);
    }
    function mutateCache(key: string, generation: number, mutation: () => PromiseLike<unknown>): Promise<void> {
        const previous = cacheMutations.get(key) || Promise.resolve();
        const pending = previous.then(async () => {
            if (generationFor(key) === generation)
                await mutation();
        }).catch((error: unknown) => {
            console.warn('Failed to update stream resolution cache:', error);
        });
        cacheMutations.set(key, pending);
        void pending.then(() => {
            if (cacheMutations.get(key) === pending)
                cacheMutations.delete(key);
        });
        return pending;
    }
    function persistResolution(meta: ResolutionCacheIdentity & {
        cacheKey: string;
        generation: number;
        sharedGeneration: string;
    }, result: L1Entry): Promise<void> {
        return mutateCache(meta.cacheKey, meta.generation, async () => {
            const published = await deps.sharedCache!.write(meta, meta.sharedGeneration, result);
            if (published?.accepted && published.generation === meta.sharedGeneration) {
                storeL1(meta.cacheKey, meta.generation, { ...result, sharedGeneration: meta.sharedGeneration });
            }
        });
    }
    async function resolve(query: import('./contracts').ResolutionQuery, options: {
        invalidate?: boolean;
    } = {}): Promise<ResolutionEntry> {
        const { title, artist, duration, album } = query;
        const invalidate = options.invalidate === true;
        const titleKey = normalizeTrackField(title);
        const albumKey = normalizeTrackField(album);
        const baseArtistKey = normalizeTrackField(artist);
        const artistKey = albumKey ? `${baseArtistKey}___${albumKey}` : baseArtistKey;
        const durBucket = durationBucket(duration);
        const cacheKey = normalizeTrackKey(title, artist, duration, album);
        let generation = generationFor(cacheKey) + (invalidate ? 1 : 0);
        if (invalidate) {
            // Revoke ownership synchronously, before waiting on any network mutation.
            cacheGenerations.set(cacheKey, generation);
            l1Cache.delete(cacheKey);
            inFlightResolutions.delete(cacheKey);
        }
        // ── Invalidate path ───────────────────────────────────────────────
        const identity = { titleKey, artistKey, durBucket };
        // Every instance must consult the shared version before using its own cache.
        // An unavailable protocol never falls back to unversioned L2 writes/reads.
        const sharedClient = deps.sharedCache;
        let shared = sharedClient ? await sharedClient.read(identity, invalidate) : null;
        const previouslyObserved = observedSharedGenerations.get(cacheKey);
        if (shared && previouslyObserved && BigInt(shared.generation) < BigInt(previouslyObserved)) {
            // A delayed read response must not roll this instance back to an older epoch.
            shared = await sharedClient!.read(identity, false);
        }
        const latestObserved = observedSharedGenerations.get(cacheKey);
        if (shared && latestObserved && BigInt(shared.generation) < BigInt(latestObserved))
            shared = null;
        if (shared) {
            const observed = observedSharedGenerations.get(cacheKey);
            if (observed && observed !== shared.generation) {
                generation = generationFor(cacheKey) + 1;
                cacheGenerations.set(cacheKey, generation);
                l1Cache.delete(cacheKey);
                inFlightResolutions.delete(cacheKey);
            }
            else {
                generation = generationFor(cacheKey);
            }
            observedSharedGenerations.set(cacheKey, shared.generation);
        }
        // ── L1 check ──────────────────────────────────────────────────────
        if (!invalidate) {
            const l1 = l1Cache.get(cacheKey);
            if (l1 && deps.now() < l1.expiresAt &&
                (shared ? l1.sharedGeneration === shared.generation && shared.entry !== null &&
                    l1.source === shared.entry.source && l1.resolvedId === shared.entry.resolvedId &&
                    l1.isMiss === shared.entry.isMiss
                    : !sharedClient && !l1.sharedGeneration)) {
                return l1;
            }
        }
        // ── Direct Drive mapping (after shared version validation) ──────────
        const driveEntry = deps.lookupStaticDrive(query);
        if (driveEntry) {
            if (!sharedClient)
                storeL1(cacheKey, generation, driveEntry);
            return driveEntry;
        }
        // ── L2 check (Supabase) ───────────────────────────────────────────
        if (shared?.entry && !invalidate) {
            if (shared.entry.resolvedId) {
                const playable = await deps.validateCachedEntry(shared.entry).catch(() => false);
                if (generationFor(cacheKey) !== generation)
                    return resolve(query);
                if (!playable) {
                    if (sharedClient) {
                        const bumped = await sharedClient.read(identity, true);
                        const latestEpoch = observedSharedGenerations.get(cacheKey);
                        // The invalidation RPC can finish after a newer request has
                        // observed another epoch. Re-read without invalidating again.
                        if (generationFor(cacheKey) !== generation ||
                            (bumped && latestEpoch && BigInt(bumped.generation) < BigInt(latestEpoch))) {
                            return resolve(query);
                        }
                        if (bumped) {
                            shared = bumped;
                            generation = generationFor(cacheKey) + 1;
                            cacheGenerations.set(cacheKey, generation);
                            l1Cache.delete(cacheKey);
                            inFlightResolutions.delete(cacheKey);
                            observedSharedGenerations.set(cacheKey, bumped.generation);
                        }
                        else {
                            shared = { ...shared, entry: null };
                        }
                    }
                    else {
                        shared = { ...shared, entry: null };
                    }
                }
            }
            if (shared?.entry) {
                const sharedEntry: L1Entry = {
                    ...shared.entry,
                    sharedGeneration: shared.generation,
                    expiresAt: Math.min(shared.entry.expiresAt, deps.now() + (shared.entry.isMiss ? L1_MISS_TTL : L1_HIT_TTL)),
                };
                storeL1(cacheKey, generation, sharedEntry);
                return sharedEntry;
            }
        }
        // ── In-Flight Request Deduplication (Thundering Herd / Stampede Protection) ──
        if (!invalidate) {
            const existingInFlight = inFlightResolutions.get(cacheKey);
            if (existingInFlight?.generation === generation &&
                (shared ? existingInFlight.sharedGeneration === shared.generation
                    : !sharedClient && !existingInFlight.sharedGeneration)) {
                try {
                    const resolvedEntry = await existingInFlight.promise;
                    return resolvedEntry;
                }
                catch {
                    // Fall through to re-resolve if in-flight failed
                }
            }
        }
        // ── Resolve (cold path) with In-Flight Coalescing ───────────────────
        const resolvePromise = (async (): Promise<L1Entry> => {
            const meta = { cacheKey, titleKey, artistKey, durBucket, generation, sharedGeneration: shared?.generation };
            let initialStored = false;
            let latePreferred: L1Entry | undefined;
            const publish = async (entry: L1Entry): Promise<void> => {
                if (generationFor(cacheKey) !== generation)
                    return;
                if (sharedClient && meta.sharedGeneration !== undefined) {
                    await persistResolution({ ...meta, sharedGeneration: meta.sharedGeneration }, entry);
                }
                else if (!sharedClient) {
                    storeL1(cacheKey, generation, entry);
                }
            };
            const result = await deps.resolveCatalog(query, (preferred) => {
                // The callback can run in the microtask gap before this await resumes.
                // Store the initial winner first, then the preferred upgrade in order.
                latePreferred = preferred;
                if (initialStored)
                    void publish(preferred);
            });
            await publish(result);
            initialStored = true;
            if (latePreferred)
                await publish(latePreferred);
            return result;
        })();
        if (generationFor(cacheKey) === generation) {
            inFlightResolutions.set(cacheKey, { promise: resolvePromise, generation, sharedGeneration: shared?.generation });
        }
        try {
            const result = await resolvePromise;
            return result;
        }
        finally {
            if (inFlightResolutions.get(cacheKey)?.promise === resolvePromise) {
                inFlightResolutions.delete(cacheKey);
            }
        }
    }
    return { resolve };
}
