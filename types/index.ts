export interface Track {
  id: string
  user_id: string
  title: string
  artist_id?: string | null
  album_id?: string | null
  spotify_album_id?: string | null
  artist_name?: string | null
  album_title?: string | null
  artist?: string | null
  album?: string | null
  genre?: string | null
  lyrics?: string | null
  duration: number
  file_path: string
  file_size?: number
  cover_url: string | null
  play_count?: number
  is_favorite?: boolean
  created_at: string
  audio_url?: string
  source?: 'local' | 'youtube' | 'audius' | 'itunes' | 'spotify' | 'nhaccuatui' | 'deezer'
  youtube_id?: string
  audius_id?: string
  itunes_id?: string | number
  spotify_id?: string
  nhaccuatui_id?: string
  file_ext?: string
  drive_file_id?: string
  disc_number?: number
  track_number?: number
  view_count?: number | null   // Real YouTube view count, only set when youtube_id exists.
}

export interface Playlist {
  id: string
  user_id: string
  name: string
  description: string | null
  cover_url: string | null
  is_public?: boolean
  share_code?: string | null
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

export interface UserProfile {
  id: string
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  theme: string
  created_at: string
  updated_at: string
}

export interface UserSettings {
  user_id: string
  audio_quality: string
  auto_play: boolean
  repeat_mode: string
  shuffle: boolean
  updated_at: string
}

export interface ListeningHistoryItem {
  id: string
  user_id: string
  track_id: string
  played_at: string
  track?: Track
}
