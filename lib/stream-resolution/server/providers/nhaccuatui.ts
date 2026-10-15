import { normalizeTitle } from '@/lib/youtube';
import { getPrimaryArtistName } from '@/lib/artistParser';
import { findBestNhacCuaTuiMatch } from '@/lib/nhaccuatui';
import { resolveNctSongDetailCached, searchNctCached } from '@/lib/nctCacheStore';
import { stripNonIdentityAnnotations } from '@/lib/catalogMatching';
async function searchNctServer(query: string) { return searchNctCached(query, 2800); }
import type { SourceResolver } from '../contracts';
const L1_HIT_TTL = 600000;
export function createNhaccuatuiResolver(): SourceResolver {
    return async ({ title, artist, duration, album }) => {
        const primaryArtist = getPrimaryArtistName(artist) || artist;
        const cleanTitle = normalizeTitle(title);
        const searchableTitle = stripNonIdentityAnnotations(title) || cleanTitle || title;
        const queryStr = `${searchableTitle} ${primaryArtist}`.trim();
        try {
            let nctCandidates = await searchNctServer(queryStr);
            if (nctCandidates.length === 0 && cleanTitle && cleanTitle !== queryStr) {
                nctCandidates = await searchNctServer(cleanTitle);
            }
            if (nctCandidates.length === 0)
                return null;
            let remaining = nctCandidates;
            for (let attempt = 0; attempt < 2 && remaining.length > 0; attempt++) {
                const match = findBestNhacCuaTuiMatch(remaining, {
                    title,
                    artist: primaryArtist || artist,
                    duration,
                    album,
                });
                if (!match?.id)
                    break;
                const detail = await resolveNctSongDetailCached(match.id, 2500);
                if (detail?.audioUrl) {
                    return {
                        source: 'nhaccuatui',
                        resolvedId: match.id,
                        title: detail.title || match.title,
                        artist: detail.artist || match.artist,
                        duration: detail.duration ?? match.duration ?? undefined,
                        coverUrl: detail.coverUrl || match.thumbnail || null,
                        isMiss: false,
                        expiresAt: Date.now() + L1_HIT_TTL,
                    };
                }
                remaining = remaining.filter((c) => c.id !== match.id);
            }
            return null;
        }
        catch {
            return null;
        }
    };
}
