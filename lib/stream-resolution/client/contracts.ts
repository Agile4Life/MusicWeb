import type { findMemoryDriveTrack } from '@/lib/driveTracksMap'
import type { getTrackResolution, saveTrackResolution, deleteTrackResolution } from '@/lib/playbackPersistence'

export interface ResolvedStreamResult {
  source: 'youtube' | 'nhaccuatui' | 'drive' | 'soundcloud'
  id: string
  title?: string
  artist?: string
  duration?: number
  coverUrl?: string | null
  streamUrl?: string | null
}

export interface ResolutionTrack {
  title: string
  artist?: string | null
  duration?: number | null
  album?: string | null
}
export interface ClientResolutionDeps {
  fetch: typeof globalThis.fetch
  now(): number
  findMemoryDriveTrack: typeof findMemoryDriveTrack
  persistence: {
    get: typeof getTrackResolution
    save: typeof saveTrackResolution
    delete: typeof deleteTrackResolution
  }
  buildStreamUrl(source: string, id: string): string
}
export interface ClientResolutionService {
  resolve(track: ResolutionTrack): Promise<ResolvedStreamResult | null>
  invalidate(track: ResolutionTrack): Promise<void>
  dispose(): void
}
