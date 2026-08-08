-- Safe, idempotent migration script for Queue Recommendation System (listen_events & helper functions)
-- Copy and paste into Supabase Dashboard > SQL Editor > Run

-- 1. BẢNG LISTEN_EVENTS
CREATE TABLE IF NOT EXISTS public.listen_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    track_id TEXT NOT NULL,
    artist TEXT,
    played_at TIMESTAMPTZ DEFAULT NOW(),
    completed BOOLEAN DEFAULT TRUE,
    skip_at_seconds INTEGER NULL
);

ALTER TABLE public.listen_events DISABLE ROW LEVEL SECURITY;

-- 2. INDEXES
CREATE INDEX IF NOT EXISTS idx_listen_events_user_played ON public.listen_events(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_listen_events_track_user ON public.listen_events(track_id, user_id);
CREATE INDEX IF NOT EXISTS idx_listen_events_user_artist ON public.listen_events(user_id, artist);
CREATE INDEX IF NOT EXISTS idx_listen_events_skip_check ON public.listen_events(user_id, completed, skip_at_seconds) WHERE completed = FALSE;

-- 3. FUNCTION LẤY BÀI HÁT USER THƯỜNG XUYÊN SKIP (< 15s) TRONG 30 NGÀY QUA
CREATE OR REPLACE FUNCTION public.fn_get_frequently_skipped_tracks(
    p_user_id UUID,
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE (track_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
    RETURN QUERY
    SELECT le.track_id
    FROM public.listen_events le
    WHERE le.user_id = p_user_id
      AND le.completed = FALSE
      AND (le.skip_at_seconds IS NULL OR le.skip_at_seconds < 15)
      AND le.played_at >= NOW() - (p_days || ' days')::INTERVAL
    GROUP BY le.track_id
    HAVING COUNT(*) >= 2;
END;
$func$;

-- 4. FUNCTION COLLABORATIVE FILTERING: "NGƯỜI NGHE TRACK X CŨNG NGHE BÀI Y"
CREATE OR REPLACE FUNCTION public.fn_get_collaborative_candidates(
    p_track_id TEXT,
    p_user_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 15
)
RETURNS TABLE (
    track_id TEXT,
    artist TEXT,
    play_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
    RETURN QUERY
    WITH co_listeners AS (
        SELECT DISTINCT le.user_id
        FROM public.listen_events le
        WHERE le.track_id = p_track_id
          AND (p_user_id IS NULL OR le.user_id != p_user_id)
        LIMIT 50
    )
    SELECT 
        le.track_id,
        le.artist,
        COUNT(*) AS play_count
    FROM public.listen_events le
    JOIN co_listeners cl ON le.user_id = cl.user_id
    WHERE le.track_id != p_track_id
      AND le.completed = TRUE
    GROUP BY le.track_id, le.artist
    ORDER BY play_count DESC
    LIMIT p_limit;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.fn_get_frequently_skipped_tracks(UUID, INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_collaborative_candidates(TEXT, UUID, INTEGER) TO authenticated, anon;
