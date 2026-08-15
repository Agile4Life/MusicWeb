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

-- FIX BẢO MẬT: BẬT LẠI ROW LEVEL SECURITY thay vì disable hoàn toàn.
-- Trước đây RLS bị tắt + RPC được grant cho `anon`, nên ai cũng có thể
-- truyền p_user_id tuỳ ý để đọc lịch sử nghe / gợi ý cá nhân hoá của người khác.
ALTER TABLE public.listen_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listen_events_select_own ON public.listen_events;
CREATE POLICY listen_events_select_own ON public.listen_events
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS listen_events_insert_own ON public.listen_events;
CREATE POLICY listen_events_insert_own ON public.listen_events
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 2. INDEXES
CREATE INDEX IF NOT EXISTS idx_listen_events_user_played ON public.listen_events(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_listen_events_track_user ON public.listen_events(track_id, user_id);
CREATE INDEX IF NOT EXISTS idx_listen_events_user_artist ON public.listen_events(user_id, artist);
CREATE INDEX IF NOT EXISTS idx_listen_events_skip_check ON public.listen_events(user_id, completed, skip_at_seconds) WHERE completed = FALSE;

-- 3. FUNCTION: BÀI USER THƯỜNG SKIP (< 15s) TRONG N NGÀY
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
    -- FIX: chỉ cho phép user tự truy vấn dữ liệu của chính mình,
    -- kể cả khi hàm chạy với SECURITY DEFINER (bỏ qua RLS).
    IF p_user_id IS NULL OR p_user_id != auth.uid() THEN
        RETURN;
    END IF;

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

-- 4. FUNCTION COLLABORATIVE FILTERING
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
    -- FIX: nếu có truyền p_user_id, bắt buộc phải khớp với auth.uid()
    -- (ngăn user A dùng lịch sử nghe của user B để lấy gợi ý CF)
    IF p_user_id IS NOT NULL AND p_user_id != auth.uid() THEN
        p_user_id := auth.uid();
    END IF;

    RETURN QUERY
    WITH co_listeners AS (
        SELECT DISTINCT le.user_id
        FROM public.listen_events le
        WHERE le.track_id = p_track_id
          AND (p_user_id IS NULL OR le.user_id != p_user_id)
        -- FIX: thêm ORDER BY trước khi LIMIT để lấy 50 user NGHE GẦN ĐÂY NHẤT
        -- thay vì 50 hàng theo thứ tự vật lý ngẫu nhiên của bảng
        ORDER BY le.played_at DESC
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

-- FIX: KHÔNG grant cho `anon` nữa — 2 hàm này đọc dữ liệu hành vi nghe nhạc,
-- chỉ user đã đăng nhập (authenticated) mới được gọi.
REVOKE EXECUTE ON FUNCTION public.fn_get_frequently_skipped_tracks(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_get_collaborative_candidates(TEXT, UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_get_frequently_skipped_tracks(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_collaborative_candidates(TEXT, UUID, INTEGER) TO authenticated;
