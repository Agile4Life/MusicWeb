-- Migration: Add missing indexes for external track lookups (Phase A/B Optimization)

-- These columns are used heavily in resolveExternalTrackId's Phase A & B
-- which now uses a single .or() query on all these columns.
-- Without these indexes, the .or() query will perform a sequential scan.

CREATE INDEX IF NOT EXISTS idx_tracks_spotify_id ON public.tracks(spotify_id);
CREATE INDEX IF NOT EXISTS idx_tracks_youtube_id ON public.tracks(youtube_id);
-- nhaccuatui_id already has an index (idx_tracks_nhaccuatui_id) from supabase_nct_playlist_migration.sql

-- file_path is used for Soundcloud, iTunes, Audius, Deezer and fallback local tracks.
-- B-Tree is appropriate here as well since it's queried with equality checks.
CREATE INDEX IF NOT EXISTS idx_tracks_file_path ON public.tracks(file_path);
