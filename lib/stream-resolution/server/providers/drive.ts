import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeTitle } from '@/lib/youtube';
import { getPrimaryArtistName } from '@/lib/artistParser';
import { findMemoryDriveTrack } from '@/lib/driveTracksMap';
import { isCatalogTrackMatch } from '@/lib/catalogMatching';
import { extractDriveFileId, isPreviewUrl } from './driveHelpers';
import type { SourceResolver } from '../contracts';
const L1_HIT_TTL = 600000;
export function createDriveResolver(supabase: SupabaseClient | null): SourceResolver {
    return async ({ title, artist, duration }) => {
        const primaryArtist = getPrimaryArtistName(artist) || artist;
        const cleanTitle = normalizeTitle(title);
        const memTrack = findMemoryDriveTrack(title, artist, duration);
        if (memTrack) {
            return {
                source: 'drive',
                resolvedId: memTrack.file_path,
                title: memTrack.title,
                artist: memTrack.artist,
                duration: memTrack.duration,
                coverUrl: memTrack.cover_url || undefined,
                isMiss: false,
                expiresAt: Date.now() + L1_HIT_TTL,
            };
        }
        if (!supabase || !cleanTitle)
            return null;
        try {
            const { data: localMatches } = await supabase
                .from('tracks')
                .select('*')
                .or(`title.ilike.%${cleanTitle}%,artist.ilike.%${cleanTitle}%`)
                .limit(10);
            if (!localMatches || localMatches.length === 0)
                return null;
            for (const lt of localMatches) {
                if (!lt.file_path || isPreviewUrl(lt.file_path))
                    continue;
                if (!isCatalogTrackMatch(lt, { title, artist: primaryArtist || artist, duration }))
                    continue;
                const driveId = lt.drive_file_id || extractDriveFileId(lt.file_path);
                const isPlayableDrive = driveId || (lt.file_path?.startsWith('http') &&
                    !isPreviewUrl(lt.file_path) &&
                    (lt.file_path.includes('drive.google') || lt.file_path.includes('googleusercontent') || /\.(mp3|flac|m4a|wav|aac|ogg)(?:[?#]|$)/i.test(lt.file_path)));
                if (isPlayableDrive) {
                    return {
                        source: 'drive',
                        resolvedId: lt.file_path || lt.id,
                        title: lt.title,
                        artist: lt.artist,
                        duration: lt.duration,
                        coverUrl: lt.cover_url,
                        isMiss: false,
                        expiresAt: Date.now() + L1_HIT_TTL,
                    };
                }
            }
            return null;
        }
        catch (e) {
            console.warn('Drive track lookup error in resolve-stream:', e);
            return null;
        }
    };
}
