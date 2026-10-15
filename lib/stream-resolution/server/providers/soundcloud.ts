import { normalizeTitle } from '@/lib/youtube';
import { getPrimaryArtistName } from '@/lib/artistParser';
import * as soundcloudClient from '@/lib/soundcloudClient';
import { findBestSoundCloudMatch } from '@/lib/catalogMatching';
import type { SourceResolver } from '../contracts';
const L1_HIT_TTL = 600000;
export function createSoundcloudResolver(): SourceResolver {
    return async ({ title, artist, duration }) => {
        const primaryArtist = getPrimaryArtistName(artist) || artist;
        const cleanTitle = normalizeTitle(title);
        const cleanPrimaryArtist = normalizeTitle(primaryArtist);
        try {
            const scQuery = `${cleanTitle || title} ${cleanPrimaryArtist || primaryArtist}`.trim();
            const candidates = await soundcloudClient.searchSoundCloudTracks(scQuery, 5).catch(() => []);
            if (candidates.length === 0)
                return null;
            const verifyPlayable = (soundcloudClient as {
                verifySoundCloudTrackPlayable?: (id: string, timeoutMs?: number) => Promise<boolean>;
            }).verifySoundCloudTrackPlayable;
            let remaining = candidates;
            for (let attempt = 0; attempt < 2 && remaining.length > 0; attempt++) {
                const match = findBestSoundCloudMatch(remaining, {
                    title,
                    artist: primaryArtist || artist,
                    duration,
                });
                if (!match?.soundcloud_id && !match?.id)
                    break;
                const scId = match.soundcloud_id ? String(match.soundcloud_id) : match.id.replace(/^sc-/, '');
                const playable = typeof verifyPlayable === 'function' ? await verifyPlayable(scId, 2500) : true;
                if (playable) {
                    return {
                        source: 'soundcloud',
                        resolvedId: scId,
                        title: match.title,
                        artist: match.artist,
                        duration: match.duration,
                        coverUrl: match.cover_url || null,
                        isMiss: false,
                        expiresAt: Date.now() + L1_HIT_TTL,
                    };
                }
                remaining = remaining.filter((c) => c !== match &&
                    String(c.soundcloud_id || c.id) !== String(match.soundcloud_id || match.id));
            }
            return null;
        }
        catch {
            return null;
        }
    };
}
