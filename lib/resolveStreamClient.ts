import { getClientResolutionService } from './stream-resolution/client/composition'
import type { ResolutionTrack } from './stream-resolution/client/contracts'

export type { ResolvedStreamResult } from './stream-resolution/client/contracts'
export { buildStableProxyStreamUrl } from './stream-resolution/client/streamUrl'

export function resolveStreamCached(track: ResolutionTrack) {
  return getClientResolutionService().resolve(track)
}

export function invalidateStreamResolution(track: ResolutionTrack) {
  return getClientResolutionService().invalidate(track)
}
