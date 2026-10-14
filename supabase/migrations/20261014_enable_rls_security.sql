-- ==============================================================================
-- MIGRATION: ENABLE ROW-LEVEL SECURITY (RLS) ON ALL CORE TABLES
-- Chạy script này trong Supabase Dashboard > SQL Editor trước khi public repo.
-- ==============================================================================

ALTER TABLE IF EXISTS public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.favorite_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.listening_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.spotify_albums ENABLE ROW LEVEL SECURITY;

-- 1. tracks: Cho phép đọc danh sách nhạc công khai, chỉ cho phép ghi qua service_role hoặc chủ sở hữu
DROP POLICY IF EXISTS "tracks_select_public" ON public.tracks;
CREATE POLICY "tracks_select_public" ON public.tracks FOR SELECT USING (true);

DROP POLICY IF EXISTS "tracks_write_owner_or_service" ON public.tracks;
CREATE POLICY "tracks_write_owner_or_service" ON public.tracks
    FOR ALL USING (auth.role() = 'service_role' OR auth.uid() = user_id)
    WITH CHECK (auth.role() = 'service_role' OR auth.uid() = user_id);

-- 2. spotify_albums: Cho phép đọc công khai, chỉ ghi qua service_role
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spotify_albums') THEN
    DROP POLICY IF EXISTS "spotify_albums_select_public" ON public.spotify_albums;
    CREATE POLICY "spotify_albums_select_public" ON public.spotify_albums FOR SELECT USING (true);

    DROP POLICY IF EXISTS "spotify_albums_write_service" ON public.spotify_albums;
    CREATE POLICY "spotify_albums_write_service" ON public.spotify_albums
        FOR ALL USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- 3. user_profiles
DROP POLICY IF EXISTS "user_profiles_owner_or_service" ON public.user_profiles;
CREATE POLICY "user_profiles_owner_or_service" ON public.user_profiles
    FOR ALL USING (auth.role() = 'service_role' OR auth.uid() = id)
    WITH CHECK (auth.role() = 'service_role' OR auth.uid() = id);

-- 4. playlists & playlist_tracks
DROP POLICY IF EXISTS "playlists_select_public_or_owner" ON public.playlists;
CREATE POLICY "playlists_select_public_or_owner" ON public.playlists
    FOR SELECT USING (is_public = true OR auth.role() = 'service_role' OR auth.uid() = user_id);

DROP POLICY IF EXISTS "playlists_write_owner_or_service" ON public.playlists;
CREATE POLICY "playlists_write_owner_or_service" ON public.playlists
    FOR ALL USING (auth.role() = 'service_role' OR auth.uid() = user_id)
    WITH CHECK (auth.role() = 'service_role' OR auth.uid() = user_id);

DROP POLICY IF EXISTS "playlist_tracks_select_public_or_owner" ON public.playlist_tracks;
CREATE POLICY "playlist_tracks_select_public_or_owner" ON public.playlist_tracks
    FOR SELECT USING (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM public.playlists p
            WHERE p.id = playlist_tracks.playlist_id
              AND (p.is_public = true OR p.user_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "playlist_tracks_write_service_or_owner" ON public.playlist_tracks;
CREATE POLICY "playlist_tracks_write_service_or_owner" ON public.playlist_tracks
    FOR ALL USING (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM public.playlists p
            WHERE p.id = playlist_tracks.playlist_id AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM public.playlists p
            WHERE p.id = playlist_tracks.playlist_id AND p.user_id = auth.uid()
        )
    );

-- 5. favorite_tracks, listening_history, user_settings
DROP POLICY IF EXISTS "favorite_tracks_owner_or_service" ON public.favorite_tracks;
CREATE POLICY "favorite_tracks_owner_or_service" ON public.favorite_tracks
    FOR ALL USING (auth.role() = 'service_role' OR auth.uid() = user_id)
    WITH CHECK (auth.role() = 'service_role' OR auth.uid() = user_id);

DROP POLICY IF EXISTS "listening_history_owner_or_service" ON public.listening_history;
CREATE POLICY "listening_history_owner_or_service" ON public.listening_history
    FOR ALL USING (auth.role() = 'service_role' OR auth.uid() = user_id)
    WITH CHECK (auth.role() = 'service_role' OR auth.uid() = user_id);

DROP POLICY IF EXISTS "user_settings_owner_or_service" ON public.user_settings;
CREATE POLICY "user_settings_owner_or_service" ON public.user_settings
    FOR ALL USING (auth.role() = 'service_role' OR auth.uid() = user_id)
    WITH CHECK (auth.role() = 'service_role' OR auth.uid() = user_id);
