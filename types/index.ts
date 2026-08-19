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
  source?: 'local' | 'youtube' | 'audius' | 'itunes' | 'spotify' | 'nhaccuatui' | 'deezer' | 'soundcloud'
  youtube_id?: string
  audius_id?: string
  itunes_id?: string | number
  spotify_id?: string
  nhaccuatui_id?: string
  soundcloud_id?: string | number
  soundcloud_permalink_url?: string
  source_url?: string
  file_ext?: string
  drive_file_id?: string
  disc_number?: number
  track_number?: number
  view_count?: number | null   // Real YouTube view count, only set when youtube_id exists.
  /**
   * Playback engine to use for this track, independent of `source`.
   * Allows Deezer tracks to retain source='deezer' while still routing
   * through the Spotify-compatible preview engine when needed.
   * Values: 'spotify' | 'deezer' | 'nhaccuatui' | 'soundcloud' | 'youtube' | 'local'
   */
  playback_engine?: string
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

export interface SoundCloudPlaylist {
  id: string | number
  title: string
  artwork_url?: string | null
  track_count: number
  duration?: number
  permalink_url?: string
  user?: {
    id?: string | number
    username?: string
    avatar_url?: string
  }
  is_album?: boolean
  tracks?: Track[]
}
