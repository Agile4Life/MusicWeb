import { isRetiredMusicUrl } from '@/lib/retiredMusicSources';

export function extractDriveFileId(path: string): string | null {
    if (!path)
        return null;
    const patterns = [
        /\/d\/([a-zA-Z0-9_-]{20,})/,
        /id=([a-zA-Z0-9_-]{20,})/,
        /drive-stream\/([a-zA-Z0-9_-]{20,})/,
    ];
    for (const p of patterns) {
        const m = path.match(p);
        if (m)
            return m[1];
    }
    return null;
}
export function isPreviewUrl(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return (lower.includes('preview') ||
        isRetiredMusicUrl(filePath) ||
        lower.includes('spotify.com') ||
        lower.startsWith('spotify:') ||
        lower.includes('p.scdn.co') ||
        lower.includes('scdn.co') ||
        lower.includes('deezer.com') ||
        lower.startsWith('deezer:') ||
        lower.includes('dzcdn.net'));
}
