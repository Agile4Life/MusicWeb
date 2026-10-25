import { buildStableProxyStreamUrl, resolveStreamCached } from './resolveStreamClient'
import { isRetiredMusicUrl } from './retiredMusicSources'
import type { BattleTrack } from './songBattleSources'

/** Resolve only migrated saved tracks; normal provider tracks keep their playback path. */
export async function resolveBattleTrackPlayback(track: BattleTrack): Promise<BattleTrack> {
  if (!track.needs_metadata_resolution || track.source !== 'musicweb' || track.stream_url) return track
  const result = await resolveStreamCached(track)
  if (!result?.id || isRetiredMusicUrl(result.id)) return track

  // Keep the saved identity and display metadata while replacing only playback.
  const playback = { ...track, needs_metadata_resolution: undefined, preview_url: null }
  switch (result.source) {
    case 'youtube':
      return { ...playback, source: 'youtube', youtube_id: result.id, source_url: `https://www.youtube.com/watch?v=${encodeURIComponent(result.id)}` }
    case 'soundcloud':
      return { ...playback, source: 'soundcloud', soundcloud_id: result.id }
    case 'nhaccuatui':
      return { ...playback, nhaccuatui_id: result.id, stream_url: buildStableProxyStreamUrl(result.source, result.id) }
    case 'drive':
      return { ...playback, stream_url: buildStableProxyStreamUrl(result.source, result.id) }
    default:
      return track
  }
}
