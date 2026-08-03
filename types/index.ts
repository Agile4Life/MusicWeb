export interface Track {
  id: string
  user_id: string
  title: string
  artist: string | null
  album: string | null
  duration: number
  file_path: string
  cover_url: string | null
  created_at: string
  audio_url?: string
}

export interface Playlist {
  id: string
  user_id: string
  name: string
  description: string | null
  cover_url: string | null
  created_at: string
  tracks_count?: number
}

export interface PlaylistTrack {
  id: string
  playlist_id: string
  track_id: string
  position: number
  added_at: string
  track?: Track
}
