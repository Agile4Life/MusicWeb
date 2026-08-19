-- Add persistent external identities used by NCT-first playlist imports.
-- Safe to run against databases that already contain these columns.

ALTER TABLE public.tracks
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS nhaccuatui_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tracks_nhaccuatui_id
    ON public.tracks (nhaccuatui_id)
    WHERE nhaccuatui_id IS NOT NULL;
