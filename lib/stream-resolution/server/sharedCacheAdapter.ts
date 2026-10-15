import type { SupabaseClient } from '@supabase/supabase-js';
import { readSharedResolution, writeSharedResolution } from '@/lib/serverStreamResolutionCache';
import type { SharedCachePort } from './contracts';
export function createSharedCacheAdapter(client: SupabaseClient): SharedCachePort {
    return {
        read: (identity, invalidate) => readSharedResolution(client, identity, invalidate),
        write: (identity, generation, entry) => writeSharedResolution(client, identity, generation, entry),
    };
}
