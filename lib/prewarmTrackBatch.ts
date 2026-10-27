import type { Track } from '@/types'
import { prewarmNctStreamUrl, getCachedNctStreamUrl } from './nhaccuatuiClient'
import { triggerDrivePrewarm } from './googleDriveUpload'
import { mapWithConcurrency } from './limitedConcurrency'
import { isSoundCloudTrack, extractSoundCloudTarget } from './trackSourceClassifier'

const SOUNDCLOUD_PREWARM_TTL_MS = 10 * 60 * 1000
const prewarmedSoundCloudAt = new Map<string, number>()
const inFlightSoundCloudPrewarm = new Map<string, Promise<string | null>>()

export async function prewarmSoundCloudTrack(track: Track): Promise<string | null> {
  if (!track || !isSoundCloudTrack(track)) return null
  const scTarget = extractSoundCloudTarget(track)
  if (!scTarget) return null

  const cleanTarget = String(scTarget)
    .trim()
    .replace(/^sc-/, '')
    .replace(/^soundcloud:/, '')
  if (!cleanTarget) return null

  const now = Date.now()
  const cachedTs = prewarmedSoundCloudAt.get(cleanTarget)
  if (cachedTs && now - cachedTs < SOUNDCLOUD_PREWARM_TTL_MS) {
    return `/api/soundcloud/stream?id=${encodeURIComponent(cleanTarget)}`
  }

  const existing = inFlightSoundCloudPrewarm.get(cleanTarget)
  if (existing) return existing

  const isNumericId = /^\d+$/.test(cleanTarget)
  const effectiveTarget = isNumericId ? cleanTarget : scTarget
  const endpoint = `/api/soundcloud/stream?id=${encodeURIComponent(effectiveTarget)}&format=json`

  const promise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(endpoint)
      if (!res.ok) return null
      const data = await res.json().catch(() => null)
      if (data?.url) {
        if (prewarmedSoundCloudAt.size >= 100) {
          const oldest = prewarmedSoundCloudAt.keys().next().value
          if (oldest !== undefined) prewarmedSoundCloudAt.delete(oldest)
        }
        prewarmedSoundCloudAt.set(cleanTarget, Date.now())
        return String(data.url)
      }
      return null
    } catch {
      return null
    } finally {
      inFlightSoundCloudPrewarm.delete(cleanTarget)
    }
  })()

  inFlightSoundCloudPrewarm.set(cleanTarget, promise)
  return promise
}

/** Pre-warm stream URLs for a batch of tracks in parallel.
 *  Pre-warms NCT, SoundCloud, and Drive tracks.
 *  Skips tracks already in cache. */
export async function prewarmTrackBatch(tracks: Track[]): Promise<void> {
  if (!tracks?.length) return

  const nctTracks = tracks.filter(
    (t) => t?.source === 'nhaccuatui' && t.nhaccuatui_id && !getCachedNctStreamUrl(t.nhaccuatui_id)
  )

  // Deduplicate by nhaccuatui_id
  const seen = new Set<string>()
  const unique = nctTracks.filter((t) => {
    if (seen.has(t.nhaccuatui_id!)) return false
    seen.add(t.nhaccuatui_id!)
    return true
  })

  // Pre-warm up to 10 NCT stream URLs, but avoid saturating the NCT API.
  const toPrewarm = unique.slice(0, 10)
  await mapWithConcurrency(toPrewarm, 2, async (track) => {
    try {
      await prewarmNctStreamUrl(track.nhaccuatui_id!)
    } catch {
      // Prewarm is best-effort; later tracks should still be attempted.
    }
  })

  // Pre-warm up to 3 SoundCloud tracks in the batch so their stream URL + HLS buffer are hot
  const scTracks = tracks.filter((t) => t && isSoundCloudTrack(t)).slice(0, 3)
  if (scTracks.length > 0) {
    void mapWithConcurrency(scTracks, 2, async (track) => {
      try {
        await prewarmSoundCloudTrack(track)
      } catch {
        // Best-effort
      }
    })
  }

  // Also pre-warm Drive for local tracks
  const driveTracks = tracks.filter(
    (t) =>
      t.drive_file_id ||
      t.file_path?.includes('drive.google.com') ||
      t.file_path?.includes('drive-stream')
  )
  triggerDrivePrewarm(driveTracks)
}
