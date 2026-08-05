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

ALTER TABLE public.user_profiles DISABLE ROW LEVEL SECURITY;

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
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tracks DISABLE ROW LEVEL SECURITY;

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

ALTER TABLE public.playlists DISABLE ROW LEVEL SECURITY;

-- 4. BẢNG PLAYLIST_TRACKS
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    track_id UUID NOT NULL,
    position INTEGER DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_playlist_track UNIQUE (playlist_id, track_id)
);

ALTER TABLE public.playlist_tracks DISABLE ROW LEVEL SECURITY;

-- 5. BẢNG FAVORITE_TRACKS
CREATE TABLE IF NOT EXISTS public.favorite_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    track_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_favorite UNIQUE (user_id, track_id)
);

ALTER TABLE public.favorite_tracks DISABLE ROW LEVEL SECURITY;

-- 6. BẢNG LISTENING_HISTORY
CREATE TABLE IF NOT EXISTS public.listening_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    track_id UUID NOT NULL,
    played_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.listening_history DISABLE ROW LEVEL SECURITY;

-- 7. BẢNG USER_SETTINGS
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY,
    audio_quality TEXT DEFAULT 'high',
    auto_play BOOLEAN DEFAULT TRUE,
    repeat_mode TEXT DEFAULT 'off',
    shuffle BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_settings DISABLE ROW LEVEL SECURITY;
