import { resolveCatalogCandidates } from '@/lib/catalogResolutionRace';
import type { CatalogSources, CatalogResolver } from './contracts';
export function createCatalogResolver(sources: CatalogSources, now: () => number): CatalogResolver {
    return async (query, onLatePreferredResult) => {
        const drive = await sources.drive(query);
        if (drive)
            return drive;
        return await resolveCatalogCandidates(() => sources.nhaccuatui(query), [() => sources.soundcloud(query), () => sources.youtube(query)], 2200, onLatePreferredResult)
            ?? { source: null, resolvedId: null, isMiss: true, expiresAt: now() + 60000 };
    };
}
