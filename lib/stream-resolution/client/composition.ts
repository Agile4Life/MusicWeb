import { findMemoryDriveTrack } from '@/lib/driveTracksMap'
import { getTrackResolution, saveTrackResolution, deleteTrackResolution } from '@/lib/playbackPersistence'
import { createClientResolutionService } from './clientResolutionService'
import type { ClientResolutionService } from './contracts'
import { buildStableProxyStreamUrl } from './streamUrl'

// Shared for the client module lifetime: individual callers do not own disposal.
let defaultService: ClientResolutionService | undefined

export function getClientResolutionService(): ClientResolutionService {
  return defaultService ??= createClientResolutionService({
    fetch: (input, init) => globalThis.fetch(input, init),
    now: () => Date.now(),
    findMemoryDriveTrack,
    persistence: {
      get: getTrackResolution,
      save: saveTrackResolution,
      delete: deleteTrackResolution,
    },
    buildStreamUrl: buildStableProxyStreamUrl,
  })
}
