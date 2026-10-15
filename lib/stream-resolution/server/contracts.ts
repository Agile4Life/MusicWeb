import type { ResolutionCacheIdentity, SharedResolutionEntry, SharedResolutionSnapshot } from '@/lib/serverStreamResolutionCache';
export interface ResolutionQuery {
    title: string;
    artist: string;
    duration?: number;
    album?: string;
}
export type ResolutionEntry = SharedResolutionEntry;
export type SourceResolver = (query: ResolutionQuery) => Promise<ResolutionEntry | null>;
export interface CatalogSources {
    drive: SourceResolver;
    nhaccuatui: SourceResolver;
    soundcloud: SourceResolver;
    youtube: SourceResolver;
}
export type CatalogResolver = (query: ResolutionQuery, onLatePreferredResult?: (entry: ResolutionEntry) => void) => Promise<ResolutionEntry>;
export interface SharedCachePort {
    read(identity: ResolutionCacheIdentity, invalidate: boolean): Promise<SharedResolutionSnapshot | null>;
    write(identity: ResolutionCacheIdentity, generation: string, entry: ResolutionEntry): Promise<{
        accepted: boolean;
        generation: string;
    } | null>;
}
export interface ServerResolutionDeps {
    resolveCatalog: CatalogResolver;
    lookupStaticDrive(query: ResolutionQuery): ResolutionEntry | null;
    sharedCache: SharedCachePort | null;
    validateCachedEntry(entry: ResolutionEntry): Promise<boolean>;
    now(): number;
}
export interface ServerResolutionService {
    resolve(query: ResolutionQuery, options?: {
        invalidate?: boolean;
    }): Promise<ResolutionEntry>;
}
