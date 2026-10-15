import { normalizeTitle, searchYouTubeTracks, findBestYouTubeMatch } from '@/lib/youtube';
import { getPrimaryArtistName } from '@/lib/artistParser';
import type { SourceResolver } from '../contracts';
const L1_HIT_TTL = 600000;
export function createYoutubeResolver(): SourceResolver {
    return async ({ title, artist, duration, album }) => {
        const primaryArtist = getPrimaryArtistName(artist) || artist;
        const cleanTitle = normalizeTitle(title);
        const cleanPrimaryArtist = normalizeTitle(primaryArtist);
        const cleanArtist = normalizeTitle(artist);
        try {
            const primaryQuery = `${cleanTitle || title} ${cleanPrimaryArtist || primaryArtist}`.trim();
            let candidates = await searchYouTubeTracks(primaryQuery, 10).catch(() => []);
            if (candidates.length === 0 && cleanTitle) {
                candidates = await searchYouTubeTracks(`${cleanTitle} ${cleanArtist}`, 8).catch(() => []);
            }
            if (candidates.length === 0)
                return null;
            const best = findBestYouTubeMatch(candidates, title, primaryArtist || artist, duration, album);
            if (!best?.youtube_id)
                return null;
            return {
                source: 'youtube',
                resolvedId: best.youtube_id,
                title: best.title || undefined,
                artist: best.artist || undefined,
                duration: best.duration,
                isMiss: false,
                expiresAt: Date.now() + L1_HIT_TTL,
            };
        }
        catch (e) {
            console.warn('YouTube resolution error in resolve-stream:', e);
            return null;
        }
    };
}
