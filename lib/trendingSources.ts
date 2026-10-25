import type { Track } from '@/types'
import { fetchSpotifyPlaylistTracks } from '@/lib/spotify'

// Public regional charts, fetched once per day by the shared snapshot service.
const CHART_PLAYLISTS: Record<string, string> = {
  all: '37i9dQZEVXbMDoHDwVN2tF',
  vietnamese: '37i9dQZEVXbLdGSmz6xilI',
  usuk: '37i9dQZEVXbLRQDuF5jeBp',
  korean: '37i9dQZEVXbNxXF4SkHj9F',
  chinese: '37i9dQZEVXbMnZEatlMSiu',
  japanese: '37i9dQZEVXbKXQ4mDTEBXq',
}

export async function fetchDailySpotifyChartTracks(category: string): Promise<Track[]> {
  const tracks = await fetchSpotifyPlaylistTracks(CHART_PLAYLISTS[category] || CHART_PLAYLISTS.all, { fresh: true })
  return tracks.filter(track => track.spotify_id && track.title).map(track => ({
    id: `spotify-${track.spotify_id}`,
    user_id: 'spotify',
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    cover_url: track.cover_url && !track.cover_url.includes('charts-images.scdn.co') ? track.cover_url : null,
    file_path: `https://open.spotify.com/track/${track.spotify_id}`,
    source: 'spotify',
    spotify_id: track.spotify_id,
    created_at: new Date().toISOString(),
  }))
}
