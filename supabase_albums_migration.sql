-- Migration to support Spotify Albums and cached track metadata in MusicWeb.
-- Copy and run this script in Supabase Dashboard > SQL Editor.

BEGIN;

-- 1. Create spotify_albums table
CREATE TABLE IF NOT EXISTS public.spotify_albums (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    artist TEXT,
    cover_url TEXT,
    release_date TEXT,
    total_tracks INTEGER DEFAULT 0,
    album_type TEXT DEFAULT 'album',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.spotify_albums DISABLE ROW LEVEL SECURITY;

-- 2. Add spotify_album_id and extra metadata fields to tracks table
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS spotify_album_id TEXT;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS disc_number INTEGER DEFAULT 1;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS track_number INTEGER DEFAULT 1;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS spotify_id TEXT;
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS youtube_id TEXT;

-- 3. Add foreign key relation from tracks.spotify_album_id to spotify_albums.id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_tracks_spotify_albums'
    ) THEN
        ALTER TABLE public.tracks
        ADD CONSTRAINT fk_tracks_spotify_albums
        FOREIGN KEY (spotify_album_id) REFERENCES public.spotify_albums(id) ON DELETE CASCADE;
    END IF;
END $$;

COMMIT;
