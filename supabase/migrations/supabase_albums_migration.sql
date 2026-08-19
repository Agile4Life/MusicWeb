-- Migration to clean duplicate tracks and support Spotify Albums in MusicWeb.
-- Copy and run this script in Supabase Dashboard > SQL Editor.

BEGIN;

-- 1. Clear references to duplicate tracks in dependent tables (playlist_tracks, favorite_tracks, listening_history)
WITH duplicates AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
               PARTITION BY user_id, LOWER(TRIM(title)), LOWER(TRIM(COALESCE(artist, '')))
               ORDER BY created_at DESC, id DESC
           ) AS keeper_id
    FROM public.tracks
),
duplicate_pairs AS (
    SELECT id AS dup_id, keeper_id
    FROM duplicates
    WHERE id <> keeper_id
)
UPDATE public.playlist_tracks pt
SET track_id = dp.keeper_id
FROM duplicate_pairs dp
WHERE pt.track_id = dp.dup_id
  AND NOT EXISTS (
      SELECT 1 FROM public.playlist_tracks existing
      WHERE existing.playlist_id = pt.playlist_id AND existing.track_id = dp.keeper_id
  );

WITH duplicates AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
               PARTITION BY user_id, LOWER(TRIM(title)), LOWER(TRIM(COALESCE(artist, '')))
               ORDER BY created_at DESC, id DESC
           ) AS keeper_id
    FROM public.tracks
),
duplicate_pairs AS (
    SELECT id AS dup_id, keeper_id
    FROM duplicates
    WHERE id <> keeper_id
)
DELETE FROM public.playlist_tracks pt
USING duplicate_pairs dp
WHERE pt.track_id = dp.dup_id;

WITH duplicates AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
               PARTITION BY user_id, LOWER(TRIM(title)), LOWER(TRIM(COALESCE(artist, '')))
               ORDER BY created_at DESC, id DESC
           ) AS keeper_id
    FROM public.tracks
),
duplicate_pairs AS (
    SELECT id AS dup_id, keeper_id
    FROM duplicates
    WHERE id <> keeper_id
)
DELETE FROM public.favorite_tracks ft
USING duplicate_pairs dp
WHERE ft.track_id = dp.dup_id;

WITH duplicates AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
               PARTITION BY user_id, LOWER(TRIM(title)), LOWER(TRIM(COALESCE(artist, '')))
               ORDER BY created_at DESC, id DESC
           ) AS keeper_id
    FROM public.tracks
),
duplicate_pairs AS (
    SELECT id AS dup_id, keeper_id
    FROM duplicates
    WHERE id <> keeper_id
)
UPDATE public.listening_history lh
SET track_id = dp.keeper_id
FROM duplicate_pairs dp
WHERE lh.track_id = dp.dup_id;

-- Remove duplicate tracks keeping only the latest version
WITH duplicates AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
               PARTITION BY user_id, LOWER(TRIM(title)), LOWER(TRIM(COALESCE(artist, '')))
               ORDER BY created_at DESC, id DESC
           ) AS keeper_id
    FROM public.tracks
)
DELETE FROM public.tracks
WHERE id IN (
    SELECT id FROM duplicates WHERE id <> keeper_id
);

-- 2. Create spotify_albums table
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

-- 3. Add columns to tracks table
ALTER TABLE public.tracks
    ADD COLUMN IF NOT EXISTS spotify_album_id TEXT,
    ADD COLUMN IF NOT EXISTS disc_number INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS track_number INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS spotify_id TEXT,
    ADD COLUMN IF NOT EXISTS youtube_id TEXT;

-- 4. Add foreign key relation & UNIQUE constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_tracks_spotify_albums'
    ) THEN
        ALTER TABLE public.tracks
        ADD CONSTRAINT fk_tracks_spotify_albums
        FOREIGN KEY (spotify_album_id) REFERENCES public.spotify_albums(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_title_artist'
    ) THEN
        ALTER TABLE public.tracks
        ADD CONSTRAINT unique_user_title_artist
        UNIQUE (user_id, title, artist);
    END IF;
END $$;

-- 5. Create Index
CREATE INDEX IF NOT EXISTS idx_tracks_spotify_album_id ON public.tracks(spotify_album_id);

COMMIT;
