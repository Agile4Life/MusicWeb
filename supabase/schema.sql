-- ==============================================================================
-- MASTER DATABASE SCHEMA & SEED DATA CHO MUSICWEB (PERSONAL MUSIC STREAMING APP)
-- Sao chép toàn bộ script này và dán vào Supabase Dashboard > SQL Editor và nhấn RUN.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. BẢNG USER_PROFILES
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    theme TEXT DEFAULT 'summer',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 2. BẢNG TRACKS
CREATE TABLE IF NOT EXISTS public.tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    genre TEXT,
    lyrics TEXT,
    duration INTEGER DEFAULT 0,
    file_path TEXT NOT NULL,
    file_size BIGINT DEFAULT 0,
    cover_url TEXT,
    play_count INTEGER DEFAULT 0,
    is_favorite BOOLEAN DEFAULT FALSE,
    source TEXT,
    spotify_id TEXT,
    youtube_id TEXT,
    nhaccuatui_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;

-- 3. BẢNG PLAYLISTS
CREATE TABLE IF NOT EXISTS public.playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    share_code TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

-- 4. BẢNG PLAYLIST_TRACKS
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    track_id UUID NOT NULL,
    position INTEGER DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_playlist_track UNIQUE (playlist_id, track_id)
);

ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;

-- 5. BẢNG FAVORITE_TRACKS
CREATE TABLE IF NOT EXISTS public.favorite_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    track_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_favorite UNIQUE (user_id, track_id)
);

ALTER TABLE public.favorite_tracks ENABLE ROW LEVEL SECURITY;

-- 6. BẢNG LISTENING_HISTORY
CREATE TABLE IF NOT EXISTS public.listening_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    track_id UUID NOT NULL,
    played_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.listening_history ENABLE ROW LEVEL SECURITY;

-- 7. BẢNG USER_SETTINGS
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY,
    audio_quality TEXT DEFAULT 'high',
    auto_play BOOLEAN DEFAULT TRUE,
    repeat_mode TEXT DEFAULT 'off',
    shuffle BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- 8. ROW-LEVEL SECURITY POLICIES (LEAST PRIVILEGE)
-- Catalog tables (`tracks`): public read, write restricted to owner or service_role
DROP POLICY IF EXISTS "tracks_select_public" ON public.tracks;
CREATE POLICY "tracks_select_public" ON public.tracks FOR SELECT USING (true);

DROP POLICY IF EXISTS "tracks_write_owner_or_service" ON public.tracks;
CREATE POLICY "tracks_write_owner_or_service" ON public.tracks
    FOR ALL USING (auth.role() = 'service_role' OR auth.uid() = user_id)
    WITH CHECK (auth.role() = 'service_role' OR auth.uid() = user_id);

-- Private user tables: restricted to owner or server-side service_role API routes
DROP POLICY IF EXISTS "user_profiles_owner_or_service" ON public.user_profiles;
CREATE POLICY "user_profiles_owner_or_service" ON public.user_profiles
    FOR ALL USING (auth.role() = 'service_role' OR auth.uid() = id)
    WITH CHECK (auth.role() = 'service_role' OR auth.uid() = id);

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

