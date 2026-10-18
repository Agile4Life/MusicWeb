import { createClient } from '@supabase/supabase-js';
import { findMemoryDriveTrack } from '@/lib/driveTracksMap';
import * as soundcloudClient from '@/lib/soundcloudClient';
import * as nctCacheStore from '@/lib/nctCacheStore';
import { createCatalogResolver } from './catalogResolver';
import { createServerResolutionService } from './serverResolutionService';
import { createSharedCacheAdapter } from './sharedCacheAdapter';
import { createDriveResolver } from './providers/drive';
import { createNhaccuatuiResolver } from './providers/nhaccuatui';
import { createSoundcloudResolver } from './providers/soundcloud';
import { createYoutubeResolver } from './providers/youtube';
import type { ResolutionQuery, ResolutionEntry, ServerResolutionService } from './contracts';
function getSupabaseAdmin() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const key = serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key)
        return null;
    if (!serviceKey)
        console.warn('SUPABASE_SERVICE_ROLE_KEY missing — resolve-stream falling back to anon key; shared resolution caching is disabled; direct track lookup remains available.');
    return createClient(url, key, { auth: { persistSession: false } });
}
function lookupStaticDrive({ title, artist, duration }: ResolutionQuery): ResolutionEntry | null {
    const track = findMemoryDriveTrack(title, artist, duration);
    return track ? { source: 'drive', resolvedId: track.file_path, title: track.title, artist: track.artist, duration: track.duration, coverUrl: track.cover_url || undefined, isMiss: false, expiresAt: Date.now() + 600000 } : null;
}
let service: ServerResolutionService | undefined;
export function getServerResolutionService(): ServerResolutionService {
    if (!service) {
        const client = getSupabaseAdmin();
        service = createServerResolutionService({
            resolveCatalog: createCatalogResolver({ drive: createDriveResolver(client), nhaccuatui: createNhaccuatuiResolver(), soundcloud: createSoundcloudResolver(), youtube: createYoutubeResolver() }, Date.now),
            lookupStaticDrive,
            sharedCache: client && process.env.SUPABASE_SERVICE_ROLE_KEY ? createSharedCacheAdapter(client) : null,
            async validateCachedEntry(entry) {
                if (!entry.resolvedId)
                    return true;
                if (entry.source === 'soundcloud') {
                    const verify = (soundcloudClient as {
                        verifySoundCloudTrackPlayable?: (id: string, timeoutMs: number) => Promise<boolean>;
                    }).verifySoundCloudTrackPlayable;
                    return typeof verify === 'function' ? verify(entry.resolvedId, 2500) : true;
                }
                if (entry.source === 'nhaccuatui') {
                    const resolveDetail = (nctCacheStore as {
                        resolveNctSongDetailCached?: (id: string, timeoutMs: number) => Promise<{ audioUrl?: string | null } | null>;
                    }).resolveNctSongDetailCached;
                    if (typeof resolveDetail !== 'function')
                        return true;
                    const detail = await resolveDetail(entry.resolvedId, 2500);
                    return Boolean(detail?.audioUrl);
                }
                return true;
            },
            now: Date.now,
        });
    }
    return service;
}
