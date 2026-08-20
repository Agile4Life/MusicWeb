/**
 * Builds the YouTube audio stream URL for iOS/HTML5 playback.
 *
 * If NEXT_PUBLIC_YT_STREAM_WORKER_URL is configured (Cloudflare Worker + R2),
 * requests are routed through the Worker which:
 *   - serves from R2 cache on hit  → 0 Vercel Fluid CPU
 *   - resolves via InnerTube ANDROID (non-IP-bound URLs, no yt-dlp binary needed)
 *   - stores the full audio in R2 so all future requests bypass Vercel entirely
 *
 * Falls back to /api/youtube/stream (Vercel proxy) when no Worker is configured.
 */
export function buildYouTubeStreamUrl(videoId: string): string {
  const workerBase = process.env.NEXT_PUBLIC_YT_STREAM_WORKER_URL?.trim()
  if (workerBase) {
    return `${workerBase.replace(/\/+$/, '')}/api/yt-stream?id=${encodeURIComponent(videoId)}`
  }
  return `/api/youtube/stream?id=${encodeURIComponent(videoId)}`
}

/** Returns true when the YouTube stream Worker is configured. */
export function hasYouTubeStreamWorker(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_YT_STREAM_WORKER_URL?.trim())
}
