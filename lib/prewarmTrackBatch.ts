import type { Track } from '@/types'
import { prewarmNctStreamUrl, getCachedNctStreamUrl } from './nhaccuatuiClient'
import { triggerDrivePrewarm } from './googleDriveUpload'
import { mapWithConcurrency } from './limitedConcurrency'

/** Pre-warm stream URLs for a batch of tracks in parallel.
 *  Only pre-warms NCT tracks (others handled by prewarmDrive/useEffect).
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

  // Also pre-warm Drive for local tracks
  const driveTracks = tracks.filter(
    (t) =>
      t.drive_file_id ||
      t.file_path?.includes('drive.google.com') ||
      t.file_path?.includes('drive-stream')
  )
  triggerDrivePrewarm(driveTracks)
}
