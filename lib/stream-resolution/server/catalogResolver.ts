import { resolveCatalogCandidates } from '@/lib/catalogResolutionRace';
import type { CatalogSources, CatalogResolver } from './contracts';
const DRIVE_HEAD_START_MS = 150;
const DRIVE_GRACE_MS = 400;
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
    return Promise.race([promise, timeout]).finally(() => { if (timer !== undefined)
        clearTimeout(timer); });
}
export function createCatalogResolver(sources: CatalogSources, now: () => number): CatalogResolver {
    return async (query, onLatePreferredResult) => {
        // Drive stays the top priority, but a slow DB lookup must not delay the
        // other sources: it gets a short head start, then everything runs together.
        const drivePromise = Promise.resolve().then(() => sources.drive(query)).catch(() => null);
        const early = await within(drivePromise, DRIVE_HEAD_START_MS);
        if (early)
            return early;
        let driveWon = false;
        const racePromise = resolveCatalogCandidates(() => sources.nhaccuatui(query), [() => sources.soundcloud(query), () => sources.youtube(query)], 2200, (late) => { if (!driveWon)
            onLatePreferredResult?.(late); });
        const drive = await within(drivePromise, DRIVE_GRACE_MS - DRIVE_HEAD_START_MS);
        if (drive) {
            driveWon = true;
            void racePromise.catch(() => null);
            return drive;
        }
        return await racePromise
            ?? { source: null, resolvedId: null, isMiss: true, expiresAt: now() + 60000 };
    };
}
